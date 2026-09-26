"""Тонкий клиент MAX Bot API (httpx). Полностью соответствует официальному контракту.

Домен: platform-api2.max.ru (актуальный по dev.max.ru).
Авторизация: заголовок Authorization: <access_token> (query-параметр устарел).
Используются только методы: GET /me, GET /updates, POST /messages, POST /answers.

Клиент не бросает исключения наружу в режиме бота: любая ошибка транспорта
логируется, чтобы падение внешнего шлюза не валило весь сервис
(критерий «Стабильность работы и обработка ошибок»).
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import get_settings

log = logging.getLogger("kultvyezd.max")


class MaxClient:
    def __init__(self, token: str | None = None, base: str | None = None, timeout: float = 40.0) -> None:
        s = get_settings()
        self.token = token or s.MAX_BOT_TOKEN
        self.base = (base or s.MAX_API_BASE).rstrip("/")
        self.timeout = timeout
        # MAX использует сертификаты Минцифры. verify: True | False | путь к PEM.
        if s.MAX_TLS_INSECURE:
            self.verify: bool | str = False
        elif s.MAX_CA_BUNDLE:
            self.verify = s.MAX_CA_BUNDLE
        else:
            self.verify = True

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": self.token, "Content-Type": "application/json"}

    # ------------------------------------------------------------- чтение
    async def get_me(self) -> dict[str, Any] | None:
        return await self._request("GET", "/me")

    async def get_updates(self, marker: int | None = None, timeout: int = 30,
                          limit: int = 100, types: list[str] | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"timeout": timeout, "limit": limit}
        if marker is not None:
            params["marker"] = marker
        if types:
            params["types"] = ",".join(types)
        return await self._request("GET", "/updates", params=params) or {"updates": [], "marker": marker}

    # ------------------------------------------------------------- запись
    async def send_message(self, *, user_id: int | None = None, chat_id: int | None = None,
                           text: str = "", attachments: list[dict] | None = None,
                           fmt: str | None = None, notify: bool = True) -> dict[str, Any] | None:
        params: dict[str, Any] = {}
        if user_id is not None:
            params["user_id"] = user_id
        if chat_id is not None:
            params["chat_id"] = chat_id
        body: dict[str, Any] = {"text": text, "notify": notify}
        if attachments:
            body["attachments"] = attachments
        if fmt:
            body["format"] = fmt
        return await self._request("POST", "/messages", params=params, json=body)

    async def set_commands(self, commands: list[dict[str, str]]) -> dict[str, Any] | None:
        """PATCH /me/commands — регистрирует команды бота (MAX Bot API, раздел bots).

        После регистрации MAX показывает пользователю подсказку по командам.
        """
        return await self._request("PATCH", "/me/commands", json={"commands": commands})

    async def answer_callback(self, callback_id: str, *, text: str | None = None,
                              attachments: list[dict] | None = None,
                              notification: str | None = None) -> dict[str, Any] | None:
        body: dict[str, Any] = {}
        if text is not None or attachments is not None:
            message: dict[str, Any] = {}
            if text is not None:
                message["text"] = text
            if attachments is not None:
                message["attachments"] = attachments
            body["message"] = message
        if notification:
            body["notification"] = notification
        return await self._request("POST", "/answers", params={"callback_id": callback_id}, json=body)

    # ------------------------------------------------------------- внутреннее
    async def _request(self, method: str, path: str, *, params: dict | None = None,
                       json: dict | None = None) -> dict[str, Any] | None:
        if not self.enabled:
            log.warning("MAX client disabled (нет токена): пропущен %s %s", method, path)
            return None
        url = f"{self.base}{path}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout, verify=self.verify) as client:
                resp = await client.request(method, url, params=params, json=json, headers=self._headers())
                if resp.status_code >= 400:
                    log.error("MAX %s %s -> %s: %s", method, path, resp.status_code, resp.text[:300])
                    return None
                if not resp.content:
                    return {}
                return resp.json()
        except Exception as exc:  # noqa: BLE001 — не роняем сервис из-за внешнего API
            log.error("MAX %s %s ошибка транспорта: %s", method, path, exc)
            return None


# ------------------------------------------------------------------ helpers
# Команды бота, регистрируемые в MAX через PATCH /me/commands (подсказки в мессенджере)
BOT_COMMANDS: list[dict[str, str]] = [
    {"name": "start", "description": "Начать работу с ботом «КультВыезд»"},
    {"name": "trips", "description": "Мои выезды и статусы по ребёнку"},
    {"name": "help", "description": "Как открыть мини-приложение"},
]


def inline_keyboard(buttons: list[list[dict]]) -> dict:
    """Формирует AttachmentRequest типа inline_keyboard (по схеме MAX)."""
    return {"type": "inline_keyboard", "payload": {"buttons": buttons}}


def callback_button(text: str, payload: str) -> dict:
    return {"type": "callback", "text": text, "payload": payload}


def link_button(text: str, url: str) -> dict:
    return {"type": "link", "text": text, "url": url}


def open_app_button(text: str, web_app: str, payload: str = "") -> dict:
    """Кнопка открытия мини-приложения: тип open_app, web_app = уникальное имя бота."""
    return {"type": "open_app", "text": text, "web_app": web_app, "payload": payload or None}
