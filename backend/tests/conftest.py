"""Общая обвязка тестов: изолированная БД и клиент приложения.

Переменные окружения выставляются ДО импорта приложения, чтобы engine взял тестовую БД.
Бот MAX принудительно выключен (MAX_BOT_MODE=off) — тесты не ходят во внешнюю сеть.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="kultvyezd-tests-"))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TMP_DIR / 'test.db'}")
os.environ["MAX_BOT_TOKEN"] = ""
os.environ["MAX_BOT_MODE"] = "off"
os.environ["AUTO_SEED"] = "true"
os.environ["PUBLIC_BASE_URL"] = "http://testserver"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def first_class(client: TestClient) -> dict:
    return client.get("/api/v1/classes").json()[0]
