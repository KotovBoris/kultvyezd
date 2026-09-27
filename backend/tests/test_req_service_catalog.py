"""Требования SVC-*, CAT-* (docs/REQUIREMENTS.md)."""
from __future__ import annotations

import io
from datetime import date, timedelta

from fastapi.testclient import TestClient

from sqlmodel import select

from app import services
from app.models import Student


def _events(client: TestClient, **params) -> list[dict]:
    r = client.get("/api/v1/culture-events", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _sorted(seq: list, key) -> bool:
    values = [key(x) for x in seq]
    return values == sorted(values)


# --------------------------------------------------------------- SVC
def test_SVC_1_healthz(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    for field in ("version", "bot_mode", "bot_enabled", "time"):
        assert field in body


def test_SVC_2_meta(client: TestClient) -> None:
    body = client.get("/api/v1/meta").json()
    assert body["dataset"]["is_mock"] is True
    assert "PRO.Культура" in body["dataset"]["catalog_source"]
    assert "roles" in body and "max" in body


def test_SVC_3_openapi(client: TestClient) -> None:
    r = client.get("/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    assert {"openapi", "paths", "info"} <= set(spec)
    assert len(spec["paths"]) >= 15


def test_SVC_4_docs(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200


def test_SVC_5_unknown_path_404(client: TestClient) -> None:
    assert client.get("/api/v1/nope").status_code == 404


# --------------------------------------------------------------- CAT
def test_CAT_1_all_events(client: TestClient) -> None:
    events = client.get("/api/v1/culture-events").json()
    assert len(events) >= 15
    for e in events:
        for f in ("id", "title", "venue", "city", "age_rating", "price", "pushkin_eligible", "is_free", "source"):
            assert f in e


def test_CAT_2_pushkin_true(client: TestClient) -> None:
    events = client.get("/api/v1/culture-events", params={"pushkin": True}).json()
    assert events and all(e["pushkin_eligible"] for e in events)


def test_CAT_3_pushkin_false(client: TestClient) -> None:
    events = client.get("/api/v1/culture-events", params={"pushkin": False}).json()
    assert all(not e["pushkin_eligible"] for e in events)


def test_CAT_4_free_true(client: TestClient) -> None:
    events = client.get("/api/v1/culture-events", params={"free": True}).json()
    assert events and all(e["is_free"] for e in events)


def test_CAT_5_city(client: TestClient) -> None:
    events = client.get("/api/v1/culture-events", params={"city": "Казань"}).json()
    assert events and all(e["city"] == "Казань" for e in events)


def test_CAT_6_age(client: TestClient) -> None:
    events = client.get("/api/v1/culture-events", params={"age": "12+"}).json()
    assert all(e["age_rating"] == "12+" for e in events)


def test_CAT_7_combined_filters(client: TestClient) -> None:
    events = client.get(
        "/api/v1/culture-events", params={"city": "Казань", "pushkin": True, "free": True}
    ).json()
    for e in events:
        assert e["city"] == "Казань" and e["pushkin_eligible"] and e["is_free"]


def test_CAT_8_no_match_empty(client: TestClient) -> None:
    events = client.get("/api/v1/culture-events", params={"city": "НетТакогоГорода"}).json()
    assert events == []


def test_CAT_9_source_present(client: TestClient) -> None:
    events = client.get("/api/v1/culture-events").json()
    assert all(isinstance(e["source"], str) and e["source"] for e in events)


# --------------------------------------------------------- ST-4: сортировка
def test_CAT_10_default_sort_by_date_asc(client: TestClient) -> None:
    events = _events(client)
    assert events
    assert _sorted([e for e in events if e["event_date"]], key=lambda e: e["event_date"])


def test_CAT_11_sort_by_price_asc(client: TestClient) -> None:
    events = _events(client, sort="price", order_by="asc")
    assert events
    assert _sorted(events, key=lambda e: e["price"])


def test_CAT_12_sort_by_price_desc(client: TestClient) -> None:
    events = _events(client, sort="price", order_by="desc")
    prices = [e["price"] for e in events]
    assert prices == sorted(prices, reverse=True)
    # тот же состав, что и по возрастанию (порядок при равных ценах БД не гарантирует)
    asc = _events(client, sort="price", order_by="asc")
    assert {e["id"] for e in events} == {e["id"] for e in asc}


def test_CAT_13_sort_by_duration(client: TestClient) -> None:
    events = _events(client, sort="duration", order_by="asc")
    assert events
    assert _sorted(events, key=lambda e: e["duration_min"])


def test_CAT_14_unknown_sort_falls_back_to_date(client: TestClient) -> None:
    events = _events(client, sort="нет-такого", order_by="наоборот")
    assert events  # не падаем — откат к дате по возрастанию
    assert _sorted([e for e in events if e["event_date"]], key=lambda e: e["event_date"])


# ---------------------------------------------------------- ST-4: период
def test_CAT_15_date_from_future_empty(client: TestClient) -> None:
    far = (date.today() + timedelta(days=3650)).isoformat()
    assert _events(client, date_from=far) == []


def test_CAT_16_date_to_past_empty(client: TestClient) -> None:
    past = (date.today() - timedelta(days=1)).isoformat()
    assert _events(client, date_to=past) == []


def test_CAT_17_date_range_bounds(client: TestClient) -> None:
    lo = (date.today() + timedelta(days=6)).isoformat()
    hi = (date.today() + timedelta(days=12)).isoformat()
    events = _events(client, date_from=lo, date_to=hi)
    assert events
    assert all(lo <= e["event_date"] <= hi for e in events)


def test_CAT_18_combined_date_and_sort(client: TestClient) -> None:
    lo = (date.today()).isoformat()
    hi = (date.today() + timedelta(days=30)).isoformat()
    events = _events(client, date_from=lo, date_to=hi, sort="price", order_by="desc")
    prices = [e["price"] for e in events]
    assert prices == sorted(prices, reverse=True)


# ------------------------------------------- ST-4: авто-фильтр по возрасту
def test_CAT_19_age_min_present(client: TestClient) -> None:
    events = _events(client)
    assert all("age_min" in e for e in events)
    for e in events:
        assert e["age_min"] == services.age_rating_min(e["age_rating"])


def test_CAT_20_age_fit_filters_by_class(client: TestClient, session) -> None:
    # импортируем «младший» класс: детям ~8 лет — события 12+/16+ не подходят
    data = (
        "ФИО,Дата рождения,Телефон родителя\n"
        "Младший Первый,2018-05-01,+79990007001\n"
        "Младший Второй,2018-06-01,+79990007002\n"
    ).encode("utf-8")
    r = client.post(
        "/api/v1/classes/import",
        files={"file": ("young.csv", io.BytesIO(data), "text/csv")},
        params={"grade": "2", "letter": "А"},
    )
    assert r.status_code == 200
    young_id = r.json()["class_id"]
    youngest = services.youngest_age(
        [s.birth_date for s in session.exec(select(Student).where(Student.class_id == young_id)).all()],
        date.today(),
    )
    assert youngest is not None and youngest <= 9

    all_events = _events(client)
    fitted = _events(client, class_id=young_id, age_fit=True)
    assert fitted, "должны остаться события 0+/6+"
    assert all(e["age_min"] <= youngest for e in fitted)
    assert len(fitted) < len(all_events), "часть событий (12+) должна быть снята"
    # без флага age_fit класс ничего не фильтрует
    assert len(_events(client, class_id=young_id)) == len(all_events)


def test_CAT_21_age_fit_without_class_is_noop(client: TestClient) -> None:
    assert len(_events(client, age_fit=True)) == len(_events(client))


# ------------------------------------------------- unit: логика возраста
def test_AGE_1_rating_parsing() -> None:
    assert services.age_rating_min("0+") == 0
    assert services.age_rating_min("16+") == 16
    assert services.age_rating_min("неизвестно") == 0


def test_AGE_2_age_on_birthday_boundary() -> None:
    assert services.age_on(date(2010, 3, 12), date(2026, 3, 11)) == 15
    assert services.age_on(date(2010, 3, 12), date(2026, 3, 12)) == 16
    assert services.age_on(None, date(2026, 3, 12)) == 0


def test_AGE_3_youngest_and_fit() -> None:
    assert services.youngest_age([date(2010, 1, 1), date(2012, 1, 1)], date(2026, 6, 1)) == 14
    assert services.youngest_age([None, None], date(2026, 6, 1)) is None
    assert services.event_age_fits("12+", 14) is True
    assert services.event_age_fits("16+", 14) is False
    # неизвестный возраст — не режем ничего (консервативно пропускаем)
    assert services.event_age_fits("16+", None) is True
