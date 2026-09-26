#!/usr/bin/env python3
"""E2E-проверка ПОДНЯТОГО docker-стека (как это делал бы проверяющий эксперт).

Бьёт по публичному адресу (по умолчанию http://localhost:8080 — mini-app + nginx-прокси)
и проходит основной пользовательский сценарий целиком. Только стандартная библиотека.

Запуск:  docker compose up -d --build && python3 scripts/e2e_docker.py [BASE_URL]
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080").rstrip("/")

passed = failed = 0


def check(cond: bool, label: str, extra: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {label}")
    else:
        failed += 1
        print(f"  ❌ {label} {extra}")


def call(method: str, path: str, body: dict | None = None, raw: bool = False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            c = r.read()
            if raw:
                return r.status, c
            try:
                return r.status, json.loads(c or b"{}")
            except json.JSONDecodeError:
                return r.status, c  # HTML/текст (например, /docs)
    except urllib.error.HTTPError as e:
        content = e.read()
        if raw:
            return e.code, content
        try:
            return e.code, json.loads(content or b"{}")
        except json.JSONDecodeError:
            return e.code, content


def main() -> int:
    print(f"▶ Проверка поднятого решения: {BASE}\n")

    s, h = call("GET", "/healthz")
    check(s == 200 and h.get("status") == "ok", "GET /healthz — сервис жив")

    s, _ = call("GET", "/docs")
    check(s == 200, "GET /docs — Swagger/OpenAPI доступен")
    s, spec = call("GET", "/openapi.json")
    check(s == 200 and "paths" in spec, "GET /openapi.json — спецификация отдаётся")

    s, html = call("GET", "/", raw=True)
    check(s == 200 and b"<div id=\"root\">" in html, "GET / — мини-приложение (SPA) отдаётся")

    s, meta = call("GET", "/api/v1/meta")
    check(s == 200 and meta.get("dataset", {}).get("is_mock") is True,
          "GET /api/v1/meta — данные явно помечены как модельные")

    s, events = call("GET", "/api/v1/culture-events?pushkin=true")
    check(s == 200 and len(events) >= 5, f"Каталог: события по «Пушкинской карте» ({len(events)})")

    s, classes = call("GET", "/api/v1/classes")
    check(s == 200 and classes and len(classes[0]["students"]) >= 20,
          f"Демо-класс засеян ({len(classes[0]['students'])} учеников)")
    klass = classes[0]
    student_id = klass["students"][0]["id"]

    s, exc = call("POST", "/api/v1/excursions", {
        "class_id": klass["id"], "culture_event_id": events[0]["id"],
        "gathering_time": "08:30", "return_time": "14:00",
    })
    check(s == 201 and exc.get("id"), "Создание выезда — 201 Created")
    exc_id = exc["id"]

    s, dash = call("GET", f"/api/v1/excursions/{exc_id}/dashboard")
    check(s == 200 and "summary" in dash, "Дашборд «Светофор» отдаётся")

    s, consent = call("POST", f"/api/v1/excursions/{exc_id}/consent", {
        "student_id": student_id, "status": "APPROVED",
        "parent_name": "Мама", "parent_phone": "+79001234501",
    })
    check(s == 200 and consent["consent_status"] == "APPROVED", "Согласие родителя зафиксировано")

    s, repeat = call("POST", f"/api/v1/excursions/{exc_id}/consent", {
        "student_id": student_id, "status": "REJECTED",
    })
    check(repeat.get("changed") is False and repeat["consent_status"] == "APPROVED",
          "Идемпотентность — повтор не перезаписывает согласие")

    s, ticket = call("POST", f"/api/v1/excursions/{exc_id}/ticket-confirm", {
        "student_id": student_id, "ticket_number": "KZ-42",
    })
    check(s == 200 and ticket["ticket_status"] == "PAID", "Отметка «билет куплен»")

    s, _ = call("POST", f"/api/v1/excursions/{exc_id}/remind-unconfirmed")
    check(s == 200, "Напоминания не ответившим — эндпоинт отвечает")

    s, gen = call("POST", f"/api/v1/excursions/{exc_id}/export-order")
    check(s == 200 and gen.get("version", 0) >= 1, "Приказ сформирован (есть версия)")
    s, docx = call("GET", f"/api/v1/excursions/{exc_id}/export-order?fmt=docx", raw=True)
    s2, pdf = call("GET", f"/api/v1/excursions/{exc_id}/export-order?fmt=pdf", raw=True)
    check(isinstance(docx, bytes) and docx[:2] == b"PK", "Приказ DOCX — валидный контейнер")
    check(isinstance(pdf, bytes) and pdf[:4] == b"%PDF", "Приказ PDF — валидный файл")

    s, lc = call("POST", f"/api/v1/students/{student_id}/link-code")
    check(s == 200 and lc["deep_link"].startswith("https://max.ru/"), "Диплинк привязки родителя")

    s, err = call("POST", "/api/v1/excursions/999999/consent", {"student_id": 1, "status": "APPROVED"})
    check(s == 404, "Обработка ошибки: несуществующий выезд → 404")

    print(f"\n── Итог проверки стека: успешно {passed}, провалено {failed} ──")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
