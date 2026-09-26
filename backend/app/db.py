"""Подключение к БД и жизненный цикл схемы.

На хакатоне используем SQLite (п.5 рекомендаций архитектуры) — ноль настройки,
воспроизводимость, файл рядом с приложением.
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_settings = get_settings()

# Для sqlite убеждаемся, что каталог файла существует
if _settings.DATABASE_URL.startswith("sqlite"):
    db_path = _settings.DATABASE_URL.split("///", 1)[-1]
    if db_path and db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

connect_args = {"check_same_thread": False} if _settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(_settings.DATABASE_URL, echo=False, connect_args=connect_args)


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
