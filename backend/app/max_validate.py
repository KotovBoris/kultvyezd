"""Серверная валидация стартовых параметров мини-приложения MAX (initData / WebAppData).

Алгоритм по официальной документации: https://dev.max.ru/docs/webapps/validation
  1. разобрать WebAppData (key=value через &), hash должен встречаться ровно один раз;
  2. URL-декодировать значения;
  3. отсортировать ключи a→z;
  4. launch_params = key=value, соединённые "\\n", без hash;
  5. secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token);
  6. signature  = HMAC_SHA256(key=secret_key, msg=launch_params) в hex;
  7. данные подлинны, если signature == hash.

Это позволяет подтвердить, что запрос пришёл от реального пользователя MAX и не был
подменён. В демо-режиме валидация необязательна (см. MAX_VALIDATE_INIT_DATA), но
реализована и покрыта тестами — как требуется для продакшена.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.parse
from typing import Any

# Рекомендуемый документацией срок жизни initData (сек)
DEFAULT_MAX_AGE = 3600


def _extract_web_app_data(url_or_fragment: str) -> str:
    """Достаёт WebAppData из URL с фрагментом #WebAppData=...&WebAppPlatform=..."""
    raw = url_or_fragment
    if "#" in raw:
        raw = raw.split("#", 1)[1]
    params = urllib.parse.parse_qs(raw, keep_blank_values=True)
    if "WebAppData" in params:
        return params["WebAppData"][0]
    # Если пришла уже «внутренняя» строка (window.WebApp.initData) — вернуть как есть
    return url_or_fragment


def validate_webapp_data(app_data: str, bot_token: str) -> tuple[bool, dict[str, Any]]:
    """Проверяет подпись initData. Возвращает (валидно, разобранные поля)."""
    if not app_data or not bot_token:
        return False, {}

    data = _extract_web_app_data(app_data)
    pairs: list[list[str]] = [p.split("=", 1) for p in data.split("&") if "=" in p]

    # hash обязан присутствовать ровно один раз
    hashes = [p[1] for p in pairs if p[0] == "hash"]
    if len(hashes) != 1:
        return False, {}
    original_hash = hashes[0]

    # URL-декодирование значений
    decoded = {k: urllib.parse.unquote(v) for k, v in pairs if k != "hash"}

    # строка для подписи: ключи a→z, соединение \n
    launch_params = "\n".join(f"{k}={decoded[k]}" for k in sorted(decoded))

    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    signature = hmac.new(secret_key, launch_params.encode(), hashlib.sha256).hexdigest()

    valid = hmac.compare_digest(signature, original_hash)

    fields: dict[str, Any] = {}
    if "user" in decoded:
        try:
            fields["user"] = json.loads(decoded["user"])
        except Exception:  # noqa: BLE001
            fields["user"] = None
    if "chat" in decoded:
        try:
            fields["chat"] = json.loads(decoded["chat"])
        except Exception:  # noqa: BLE001
            fields["chat"] = None
    if "auth_date" in decoded:
        try:
            fields["auth_date"] = int(decoded["auth_date"])
        except Exception:  # noqa: BLE001
            fields["auth_date"] = None
    fields["start_param"] = decoded.get("start_param")
    return valid, fields


def is_fresh(auth_date: int | None, max_age: int = DEFAULT_MAX_AGE) -> bool:
    """Проверяет, что initData не старше max_age (защита от повторного использования)."""
    if not auth_date:
        return False
    return (time.time() - auth_date) <= max_age


def build_signature_for_test(app_data_pairs: dict[str, str], bot_token: str) -> str:
    """Считает корректную подпись — используется в тестах и dev-скриптах."""
    launch_params = "\n".join(f"{k}={app_data_pairs[k]}" for k in sorted(app_data_pairs))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    return hmac.new(secret_key, launch_params.encode(), hashlib.sha256).hexdigest()
