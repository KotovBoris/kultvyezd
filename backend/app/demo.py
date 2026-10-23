"""Личная демо-песочница: каждый пользователь MAX получает свой класс.

Эксперт открывает бота и за минуту проходит обе роли: он классный руководитель
демо-класса 7Б и одновременно родитель одного из учеников. Остальные родители
виртуальные — после запуска выезда они отвечают сами в течение минуты, поэтому
«светофор» оживает на глазах. Песочницы разных пользователей не пересекаются.
"""
from __future__ import annotations

import random
import secrets
from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from . import services
from .models import (
    AccessRole,
    ClassAccess,
    ConsentAudit,
    ConsentStatus,
    CultureEvent,
    DemoAnswer,
    DocumentArtifact,
    Excursion,
    ExcursionParticipant,
    ExcursionStatus,
    ParentContact,
    ReminderLog,
    School,
    SchoolClass,
    Student,
    TicketStatus,
)

DEMO_SCHOOL = "Школа «ClassGo» (демо-данные)"
DEMO_CITY = "Казань"

# (ребёнок, дата рождения, родитель, роль)
_KIDS: list[tuple[str, str, str, str]] = [
    ("Сафин Тимур Ренатович", "2013-04-12", "", "Родитель"),  # ребёнок самого пользователя
    ("Абдуллина Алия Ильдаровна", "2013-03-12", "Абдуллина Гульнара Рамилевна", "Мама"),
    ("Бикмуллин Марат Ринатович", "2013-01-22", "Бикмуллин Ринат Айратович", "Папа"),
    ("Валеева Дина Артуровна", "2013-07-16", "Валеева Эльвира Маратовна", "Мама"),
    ("Гайнуллин Артём Русланович", "2013-09-09", "Гайнуллина Алсу Фаридовна", "Мама"),
    ("Егорова София Сергеевна", "2013-02-28", "Егоров Сергей Николаевич", "Папа"),
    ("Журавлёва Мария Андреевна", "2013-11-11", "Журавлёва Ольга Викторовна", "Мама"),
    ("Зарипов Ильназ Ленарович", "2013-04-19", "Зарипова Лейсан Рустемовна", "Мама"),
    ("Козлов Матвей Денисович", "2013-12-03", "Козлов Денис Викторович", "Папа"),
    ("Латыпова Карина Булатовна", "2013-01-17", "Латыпова Резеда Ирековна", "Бабушка"),
    ("Морозов Даниил Сергеевич", "2013-05-29", "Морозова Татьяна Юрьевна", "Мама"),
    ("Насырова Диляра Рамилевна", "2013-09-11", "Насырова Лилия Фаритовна", "Мама"),
]

# Состояния учеников в примере «идёт сбор ответов» (по индексам _KIDS, кроме 0).
_SAMPLE_PATTERN = {
    1: "PAID", 2: "PAID", 3: "WAIT", 4: "PAID", 5: "REJECT",
    6: "PAID", 7: "WAIT", 8: "PENDING", 9: "PENDING", 10: "PAID", 11: "PENDING",
}

_REJECT_REASONS = ["Болезнь", "Семейные обстоятельства"]


def new_invite_code() -> str:
    return secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8]


def sandbox_class(session: Session, user_id: int) -> SchoolClass | None:
    return session.exec(
        select(SchoolClass).where(SchoolClass.is_demo == True, SchoolClass.owner_user_id == user_id)  # noqa: E712
    ).first()


def _school(session: Session) -> School:
    school = session.exec(select(School).where(School.name == DEMO_SCHOOL)).first()
    if school:
        return school
    school = School(name=DEMO_SCHOOL, city=DEMO_CITY, number="")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school


def _pick_event(session: Session) -> CultureEvent | None:
    events = session.exec(select(CultureEvent)).all()
    paid_pushkin = [e for e in events if e.pushkin_eligible and e.price > 0]
    return (paid_pushkin or events or [None])[0]


def create_sandbox(session: Session, user_id: int, user_name: str = "") -> dict:
    """Создаёт демо-класс пользователя (идемпотентно) и пример выезда в процессе сбора."""
    existing = sandbox_class(session, user_id)
    if existing:
        return sandbox_info(session, existing, user_id, created=False)

    school = _school(session)
    teacher = user_name or "Вы (классный руководитель)"
    klass = SchoolClass(
        grade="7", letter="Б", school_id=school.id, school_name=school.name, school_number="",
        teacher_name=teacher, owner_user_id=user_id, teacher_max_id=user_id,
        invite_code=new_invite_code(), is_demo=True,
    )
    session.add(klass)
    session.commit()
    session.refresh(klass)
    session.add(ClassAccess(class_id=klass.id, user_id=user_id, role=AccessRole.OWNER))

    for idx, (child, birth, parent, role) in enumerate(_KIDS):
        student = Student(class_id=klass.id, full_name=child, birth_date=date.fromisoformat(birth))
        session.add(student)
        session.commit()
        session.refresh(student)
        if idx == 0:
            session.add(ParentContact(
                student_id=student.id, full_name=user_name or "Вы (демо-родитель)", phone_number="",
                role=role, max_user_id=user_id, confirmed=True,
            ))
        else:
            session.add(ParentContact(
                student_id=student.id, full_name=parent, phone_number=f"+7900000{idx:04d}",
                role=role, is_virtual=True, confirmed=True,
            ))
    session.commit()

    _create_sample_excursion(session, klass)
    return sandbox_info(session, klass, user_id, created=True)


def _create_sample_excursion(session: Session, klass: SchoolClass) -> Excursion | None:
    event = _pick_event(session)
    if not event:
        return None
    now = datetime.utcnow()
    exc = Excursion(
        class_id=klass.id, culture_event_id=event.id, title=event.title,
        location_name=event.venue, address=event.address,
        event_date=date.today() + timedelta(days=9),
        gathering_time=datetime.strptime("09:30", "%H:%M").time(),
        return_time=datetime.strptime("13:30", "%H:%M").time(),
        deadline=now + timedelta(days=3),
        ticket_price=event.price, ticket_sale_url=event.ticket_url,
        is_pushkin_card=event.pushkin_eligible, status=ExcursionStatus.VOTING,
        school_name=klass.school_name, responsible_teacher=klass.teacher_name,
        order_basis="план воспитательной работы на 2026/2027 учебный год",
        created_by_user_id=klass.owner_user_id,
    )
    session.add(exc)
    session.commit()
    session.refresh(exc)

    students = session.exec(select(Student).where(Student.class_id == klass.id).order_by(Student.id)).all()
    for idx, student in enumerate(students):
        kind = _SAMPLE_PATTERN.get(idx, "PENDING")
        part = ExcursionParticipant(
            excursion_id=exc.id, student_id=student.id,
            consent_status=ConsentStatus.PENDING,
            ticket_status=TicketStatus.WAITING_PAYMENT if exc.ticket_price > 0 else TicketStatus.NOT_REQUIRED,
        )
        if kind in ("PAID", "WAIT", "REJECT"):
            parent = session.exec(select(ParentContact).where(ParentContact.student_id == student.id)).first()
            part.signed_by_name = parent.full_name if parent else None
            part.signed_by_phone = parent.phone_number if parent else None
            part.signed_source = "bot"
            part.signed_at = now - timedelta(hours=random.randint(1, 20))
            if kind == "REJECT":
                part.consent_status = ConsentStatus.REJECTED
                part.rejection_reason = "Болезнь"
            else:
                part.consent_status = ConsentStatus.APPROVED
                if exc.ticket_price > 0:
                    part.ticket_status = TicketStatus.PAID if kind == "PAID" else TicketStatus.WAITING_PAYMENT
        session.add(part)
    session.commit()
    return exc


def sandbox_info(session: Session, klass: SchoolClass, user_id: int, created: bool) -> dict:
    own_child = session.exec(
        select(ParentContact).where(ParentContact.max_user_id == user_id)
        .join(Student, Student.id == ParentContact.student_id)
        .where(Student.class_id == klass.id)
    ).first()
    child = session.get(Student, own_child.student_id) if own_child else None
    excursions = session.exec(select(Excursion).where(Excursion.class_id == klass.id)).all()
    return {
        "created": created,
        "class_id": klass.id,
        "class_title": klass.title,
        "child_student_id": child.id if child else None,
        "child_name": child.full_name if child else None,
        "excursion_ids": [e.id for e in excursions],
    }


def delete_sandbox(session: Session, user_id: int) -> bool:
    klass = sandbox_class(session, user_id)
    if not klass:
        return False
    student_ids = [s.id for s in session.exec(select(Student).where(Student.class_id == klass.id)).all()]
    exc_ids = [e.id for e in session.exec(select(Excursion).where(Excursion.class_id == klass.id)).all()]
    for model, column, ids in (
        (DemoAnswer, DemoAnswer.excursion_id, exc_ids),
        (ReminderLog, ReminderLog.excursion_id, exc_ids),
        (ConsentAudit, ConsentAudit.excursion_id, exc_ids),
        (DocumentArtifact, DocumentArtifact.excursion_id, exc_ids),
        (ExcursionParticipant, ExcursionParticipant.excursion_id, exc_ids),
        (ParentContact, ParentContact.student_id, student_ids),
    ):
        if ids:
            for row in session.exec(select(model).where(column.in_(ids))).all():
                session.delete(row)
    session.commit()
    for exc_id in exc_ids:
        row = session.get(Excursion, exc_id)
        if row:
            session.delete(row)
    for sid in student_ids:
        row = session.get(Student, sid)
        if row:
            session.delete(row)
    for access in session.exec(select(ClassAccess).where(ClassAccess.class_id == klass.id)).all():
        session.delete(access)
    session.commit()
    session.delete(klass)
    session.commit()
    return True


def schedule_virtual_answers(session: Session, excursion: Excursion, now: datetime | None = None) -> int:
    """После запуска выезда в демо-классе виртуальные родители отвечают в течение ~минуты.

    Большинство соглашается, один отказывается, двое молчат — чтобы было кого
    напомнить. При платном выезде часть согласившихся потом отмечает билет.
    """
    klass = session.get(SchoolClass, excursion.class_id)
    if not klass or not klass.is_demo:
        return 0
    now = now or datetime.utcnow()
    virtual: list[int] = []
    for part in session.exec(
        select(ExcursionParticipant).where(ExcursionParticipant.excursion_id == excursion.id)
    ).all():
        if part.consent_status != ConsentStatus.PENDING:
            continue
        parents = services.student_parents(session, part.student_id)
        if parents and all(p.is_virtual for p in parents):
            virtual.append(part.student_id)
    rng = random.Random(excursion.id)
    rng.shuffle(virtual)
    silent = virtual[:2]
    rejecting = virtual[2:3]
    delay = 6.0
    planned = 0
    for sid in virtual:
        if sid in silent:
            continue
        delay += rng.uniform(3, 9)
        decision = "REJECTED" if sid in rejecting else "APPROVED"
        session.add(DemoAnswer(
            excursion_id=excursion.id, student_id=sid, decision=decision,
            reason=rng.choice(_REJECT_REASONS) if decision == "REJECTED" else None,
            due_at=now + timedelta(seconds=delay),
        ))
        planned += 1
        if decision == "APPROVED" and excursion.ticket_price > 0 and rng.random() < 0.6:
            session.add(DemoAnswer(
                excursion_id=excursion.id, student_id=sid, decision="TICKET",
                due_at=now + timedelta(seconds=delay + rng.uniform(15, 40)),
            ))
    session.commit()
    return planned


def process_due_answers(session: Session, now: datetime | None = None) -> set[int]:
    """Применяет наступившие ответы виртуальных родителей. Возвращает id затронутых выездов."""
    now = now or datetime.utcnow()
    touched: set[int] = set()
    due = session.exec(
        select(DemoAnswer).where(DemoAnswer.done == False, DemoAnswer.due_at <= now)  # noqa: E712
        .order_by(DemoAnswer.due_at)
    ).all()
    for answer in due:
        answer.done = True
        session.add(answer)
        excursion = session.get(Excursion, answer.excursion_id)
        if not excursion:
            continue
        parent = session.exec(select(ParentContact).where(ParentContact.student_id == answer.student_id)).first()
        try:
            if answer.decision == "TICKET":
                services.confirm_ticket(session, excursion, student_id=answer.student_id, source="demo")
            else:
                services.apply_consent(
                    session, excursion, student_id=answer.student_id, status=answer.decision,
                    parent_name=parent.full_name if parent else "", parent_phone=parent.phone_number if parent else "",
                    reason=answer.reason, source="demo",
                )
        except ValueError:
            continue
        touched.add(excursion.id)
    session.commit()
    return touched
