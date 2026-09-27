"""Тесты «полезных мелочей» ST-5: CSV списка, экстренные телефоны, ICS-календарь.

Требования к поведению:
- CSV участников отдаётся как файл (text/csv) с BOM и колонками туроператора;
- экстренные телефоны — плоский сводный список без дублей;
- ICS — валидный календарь с событием на дату выезда.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import make_excursion


def test_csv_participants_headers_and_rows(client: TestClient, first_class, paid_event) -> None:
    exc = make_excursion(client, first_class, paid_event["id"], deadline="2026-10-01T12:00:00")
    r = client.get(f"/api/v1/excursions/{exc['id']}/participants.csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    # BOM — Excel корректно читает кириллицу
    assert r.content.startswith(b"\xef\xbb\xbf")
    text = r.content.decode("utf-8-sig")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    assert lines[0].startswith("№,ФИО")
    # строк ровно столько, сколько участников (+ шапка)
    assert len(lines) == len(first_class["students"]) + 1
    student_name = first_class["students"][0]["full_name"]
    assert student_name in text
    assert "attachment" in r.headers["content-disposition"]


def test_csv_unknown_excursion_404(client: TestClient) -> None:
    assert client.get("/api/v1/excursions/999999/participants.csv").status_code == 404


def test_emergency_contacts_flat_and_dedup(client: TestClient, first_class, paid_event) -> None:
    exc = make_excursion(client, first_class, paid_event["id"])
    r = client.get(f"/api/v1/excursions/{exc['id']}/emergency-contacts")
    assert r.status_code == 200
    body = r.json()
    assert body["excursion_id"] == exc["id"]
    assert body["total"] == len(body["contacts"]) > 0
    for c in body["contacts"]:
        assert c["phone"]
        assert c["student_name"]
    # дубликатов телефонов нет
    digits = ["".join(ch for ch in c["phone"] if ch.isdigit()) for c in body["contacts"]]
    assert len(digits) == len(set(digits))


def test_emergency_contacts_unknown_404(client: TestClient) -> None:
    assert client.get("/api/v1/excursions/999999/emergency-contacts").status_code == 404


def test_ics_calendar_has_event(client: TestClient, first_class, paid_event) -> None:
    exc = make_excursion(client, first_class, paid_event["id"])
    r = client.get(f"/api/v1/excursions/{exc['id']}/calendar.ics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/calendar")
    text = r.content.decode("utf-8")
    assert text.startswith("BEGIN:VCALENDAR")
    assert "BEGIN:VEVENT" in text and "END:VCALENDAR" in text
    assert "DTSTART:" in text and "DTEND:" in text
    assert exc["title"] in text
    assert "attachment" in r.headers["content-disposition"]


def test_ics_unknown_excursion_404(client: TestClient) -> None:
    assert client.get("/api/v1/excursions/999999/calendar.ics").status_code == 404
