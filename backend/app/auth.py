"""Кто делает запрос.

Внутри MAX мини-приложение передаёт подписанный initData в заголовке
``X-Max-Init-Data``: подпись проверяется токеном бота, и user_id берётся из неё —
подменить его нельзя. Вне MAX (веб-проверка экспертом, CI) действует прежний
демо-режим: user_id из параметра запроса. Если включён MAX_VALIDATE_INIT_DATA,
неподписанные запросы с чужим user_id отклоняются.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Query, Request
from sqlmodel import Session, select

from .config import get_settings
from .max_validate import validate_webapp_data
from .models import UserProfile

INIT_DATA_HEADER = "X-Max-Init-Data"


@dataclass
class Caller:
    user_id: int | None
    verified: bool
    first_name: str = ""
    last_name: str = ""

    @property
    def auth(self) -> str:
        if self.verified:
            return "max"
        return "demo" if self.user_id else "anonymous"

    @property
    def display_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.last_name) if p).strip()


def caller_from_request(request: Request, user_id: int | None) -> Caller:
    settings = get_settings()
    init_data = request.headers.get(INIT_DATA_HEADER, "")
    if init_data and settings.MAX_BOT_TOKEN:
        valid, fields = validate_webapp_data(init_data, settings.MAX_BOT_TOKEN)
        user = fields.get("user") or {}
        if valid and user.get("id"):
            return Caller(
                user_id=int(user["id"]),
                verified=True,
                first_name=str(user.get("first_name") or ""),
                last_name=str(user.get("last_name") or ""),
            )
        if settings.MAX_VALIDATE_INIT_DATA:
            raise HTTPException(status_code=401, detail="Недействительные данные мини-приложения (initData)")
    return Caller(user_id=user_id, verified=False)


def get_caller(request: Request, user_id: int | None = Query(default=None)) -> Caller:
    """FastAPI-зависимость: проверенный пользователь MAX либо демо-user_id."""
    return caller_from_request(request, user_id)


def remember_profile(session: Session, caller: Caller) -> UserProfile | None:
    if not caller.user_id:
        return None
    profile = session.exec(select(UserProfile).where(UserProfile.max_user_id == caller.user_id)).first()
    if profile is None:
        profile = UserProfile(max_user_id=caller.user_id)
    if caller.first_name:
        profile.first_name = caller.first_name
        profile.last_name = caller.last_name
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


def upsert_profile_from_bot(session: Session, user: dict) -> None:
    """Имя из апдейта бота (bot_started/message) — чтобы обращаться к человеку по имени."""
    uid = user.get("user_id")
    if not uid:
        return
    profile = session.exec(select(UserProfile).where(UserProfile.max_user_id == uid)).first()
    if profile is None:
        profile = UserProfile(max_user_id=uid)
    name = str(user.get("first_name") or user.get("name") or "")
    if name:
        profile.first_name = name
        profile.last_name = str(user.get("last_name") or "")
    session.add(profile)
    session.commit()
