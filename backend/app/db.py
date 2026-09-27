"""Подключение к БД и жизненный цикл схемы.

На хакатоне используем SQLite (п.5 рекомендаций архитектуры) — ноль настройки,
воспроизводимость, файл рядом с приложением.

ВАЖНО про параллелизм SQLite. По умолчанию SQLite работает в режиме журнала
`delete` и при одновременных записях отдаёт «database is locked». Поэтому для SQLite
мы включаем:
  • WAL (write-ahead log) — читатели не блокируют писателя и наоборот;
  • busy_timeout — при конкуренции соединение ЖДЁТ, а не падает с ошибкой;
  • synchronous=NORMAL — безопасный и быстрый режим для WAL;
  • foreign_keys=ON — включаем проверку внешних ключей (по умолчанию выключена).

Проверено нагрузочным прогоном scripts/race_check.py (100 параллельных записей).
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.pool import QueuePool
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_settings = get_settings()
IS_SQLITE = _settings.DATABASE_URL.startswith("sqlite")

# Для sqlite убеждаемся, что каталог файла существует
if IS_SQLITE:
    db_path = _settings.DATABASE_URL.split("///", 1)[-1]
    if db_path and db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

_engine_kwargs: dict = {"echo": False}
if IS_SQLITE:
    # check_same_thread=False — доступ к файлу из потоков uvicorn/asyncio.
    # timeout=30 — сколько секунд драйвер ждёт освобождения блокировки.
    _engine_kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    # Пул под конкурентную нагрузку (по умолчанию 5+10 — мало для 100 запросов).
    _engine_kwargs["poolclass"] = QueuePool
    _engine_kwargs["pool_size"] = 20
    _engine_kwargs["max_overflow"] = 40
    _engine_kwargs["pool_timeout"] = 30

engine = create_engine(_settings.DATABASE_URL, **_engine_kwargs)

if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # noqa: ANN001
        """Настраивает PRAGMA на КАЖДОМ новом соединении."""
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


def init_db() -> None:
    # Импорт моделей обязателен до create_all, чтобы метаданные были зарегистрированы.
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def reset_db() -> None:
    """Полный сброс схемы — используется тестами и скриптом demo-reset."""
    from . import models  # noqa: F401

    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)


__all__ = ["engine", "init_db", "get_session", "reset_db", "Session"]
