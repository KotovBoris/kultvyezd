"""ST-1: мультидети (parent_context) и сценарий «два родителя» (PRD §5.1).

Проверяются:
- родитель с двумя детьми видит обоих через /api/v1/parent/context (дедупликация);
- повторное согласие «второго родителя» не перезаписывает уже зафиксированное;
- привязка к нужному контакту по parent_phone в link-code + bot._bind_by_code.

Тесты создают собственные классы/учеников, чтобы не влиять на состояние,
разделяемое другими тест-модулями (общая session-scoped БД).
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.bot import BotService
from app.db import engine
from app.models import ParentContact, SchoolClass, Student

from conftest import make_excursion


class FakeClient:
    enabled = True

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_message(self, **kwargs):
        self.sent.append(kwargs)
        return {"ok": True}

    async def answer_callback(self, *args, **kwargs):
        return {"ok": True}


def _make_class_with_students(n: int = 1, letter: str = "МП") -> tuple[int, list[int]]:
    with Session(engine) as s:
        klass = SchoolClass(grade="7", letter=letter, school_name="Тестовая школа")
        s.add(klass)
        s.commit()
        s.refresh(klass)
        ids: list[int] = []
        for i in range(n):
            st = Student(class_id=klass.id, full_name=f"Ученик Мультиродителев {i + 1}")
            s.add(st)
            s.commit()
            s.refresh(st)
            ids.append(st.id)
        return klass.id, ids


def _add_contact(student_id: int, name: str, phone: str, role: str = "Законный представитель",
                 max_user_id: int | None = None) -> int:
    with Session(engine) as s:
        c = ParentContact(student_id=student_id, full_name=name, phone_number=phone,
                          role=role, max_user_id=max_user_id)
        s.add(c)
        s.commit()
        s.refresh(c)
        return c.id


def test_MULTI_1_parent_sees_two_children(client: TestClient) -> None:
    """Родитель (один max_user_id) привязан к двум детям — видит обоих, без дублей."""
    _, sids = _make_class_with_students(2, letter="МП")
    for sid in sids:
        _add_contact(sid, "Многодетный Родитель", f"+7900{sid:07d}", max_user_id=990101)
    body = client.get("/api/v1/parent/context", params={"max_user_id": 990101}).json()
    assert body["found"] is True
    got = [c["student_id"] for c in body["children"]]
    assert set(sids) <= set(got)
    assert len(got) == len(set(got)), "дети не должны дублироваться"


def test_MULTI_2_second_parent_does_not_overwrite(client: TestClient) -> None:
    """Первый родитель подписал (APPROVED) — второй (REJECTED) не перезаписывает."""
    class_id, sids = _make_class_with_students(1, letter="МП")
    sid = sids[0]
    mom_id = _add_contact(sid, "Мама Тестова", "+79005000101", role="Мама")
    dad_id = _add_contact(sid, "Папа Тестов", "+79005000202", role="Папа")
    exc = make_excursion(client, {"id": class_id}, title="Мультиродительский выезд")

    r1 = client.post(f"/api/v1/excursions/{exc['id']}/consent", json={
        "student_id": sid, "status": "APPROVED",
        "parent_name": "Мама Тестова", "parent_phone": "+79005000101",
    }).json()
    assert r1["changed"] is True and r1["consent_status"] == "APPROVED"
    assert r1["signed_by_name"] == "Мама Тестова"

    r2 = client.post(f"/api/v1/excursions/{exc['id']}/consent", json={
        "student_id": sid, "status": "REJECTED",
        "parent_name": "Папа Тестов", "parent_phone": "+79005000202",
    }).json()
    assert r2["changed"] is False
    assert r2["consent_status"] == "APPROVED"
    assert r2["signed_by_name"] == "Мама Тестова", "подпись первого родителя не перезаписана"

    # signers в parent_context: мама — подписант, папа — нет
    with Session(engine) as s:
        s.get(ParentContact, mom_id).max_user_id = 990202
        s.commit()
    ctx = client.get("/api/v1/parent/context", params={"max_user_id": 990202}).json()
    child = next(c for c in ctx["children"] if c["student_id"] == sid)
    assert len(child["parents"]) == 2, "оба контакта ученика должны быть в parents"
    ex = next(e for e in child["excursions"] if e["excursion_id"] == exc["id"])
    signers = {s["contact_id"]: s["is_signer"] for s in ex["signers"]}
    assert signers[mom_id] is True
    assert signers[dad_id] is False


def test_MULTI_3_bind_second_contact(client: TestClient) -> None:
    """link-code с parent_phone второго контакта привязывает именно его, не первый."""
    _, sids = _make_class_with_students(1, letter="МП")
    sid = sids[0]
    first_id = _add_contact(sid, "Первый Родитель", "+79006000101", role="Мама")
    second_id = _add_contact(sid, "Второй Родитель", "+79006000202", role="Папа")

    code = client.post(
        f"/api/v1/students/{sid}/link-code", params={"parent_phone": "+79006000202"}
    ).json()["code"]
    svc = BotService(client=FakeClient())
    assert svc._bind_by_code(code, 990303) is True

    with Session(engine) as s:
        first = s.get(ParentContact, first_id)
        second = s.get(ParentContact, second_id)
    assert second.max_user_id == 990303
    assert first.max_user_id is None, "первый контакт не должен быть привязан"


def test_MULTI_4_bind_role_fallback(client: TestClient) -> None:
    """Если parent_phone не задан, но задана роль — привязка идёт по роли."""
    _, sids = _make_class_with_students(1, letter="МП")
    sid = sids[0]
    mom_id = _add_contact(sid, "Мама Ролевая", "+79007000101", role="Мама")
    dad_id = _add_contact(sid, "Папа Ролевой", "+79007000202", role="Папа")

    code = client.post(f"/api/v1/students/{sid}/link-code", params={"role": "Папа"}).json()["code"]
    svc = BotService(client=FakeClient())
    assert svc._bind_by_code(code, 990404) is True

    with Session(engine) as s:
        mom = s.get(ParentContact, mom_id)
        dad = s.get(ParentContact, dad_id)
    assert dad.max_user_id == 990404
    assert mom.max_user_id is None


def test_MULTI_5_import_two_parents_columns(client: TestClient) -> None:
    """CSV с колонками мамы/папы создаёт два контакта с корректными ролями."""
    import io

    csv_bytes = (
        "ФИО,Дата рождения,Телефон мамы,ФИО мамы,Телефон папы,ФИО папы\n"
        "Двухродителев Ученик,01.09.2010,+79990004001,Мама Двухродителева,"
        "+79990004002,Папа Двухродителев\n"
    ).encode("utf-8")
    r = client.post(
        "/api/v1/classes/import",
        files={"file": ("mp.csv", io.BytesIO(csv_bytes), "text/csv")},
        params={"grade": "6", "letter": "МП"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["students_created"] == 1
    assert body["parents_created"] == 2

    with Session(engine) as s:
        klass = s.get(SchoolClass, body["class_id"])
        student = s.exec(select(Student).where(Student.class_id == klass.id)).first()
        contacts = s.exec(select(ParentContact).where(ParentContact.student_id == student.id)).all()
    roles = {c.role for c in contacts}
    assert roles == {"Мама", "Папа"}
    assert {c.full_name for c in contacts} == {"Мама Двухродителева", "Папа Двухродителев"}
