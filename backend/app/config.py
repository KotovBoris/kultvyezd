"""Конфигурация приложения. Все секреты — только из переменных окружения (п.8 ограничений)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Интеграция с MAX ---
    # Токен выдаёт платформа MAX. В репозитории его нет — только .env.example.
    MAX_BOT_TOKEN: str = ""
    # ВАЖНО: актуальный домен по документации dev.max.ru — platform-api2.max.ru
    MAX_API_BASE: str = "https://platform-api2.max.ru"
    # polling | webhook | off  (off = бот не запускается, работает только REST/mini-app)
    MAX_BOT_MODE: str = "polling"
    # Публичный HTTPS-адрес для регистрации webhook (если MAX_BOT_MODE=webhook)
    MAX_WEBHOOK_URL: str = ""
    # Секрет для проверки подлинности вебхука (передаётся MAX при подписке)
    MAX_WEBHOOK_SECRET: str = ""
    # Ник бота в MAX (используется для диплинков и кнопки open_app)
    MAX_BOT_USERNAME: str = "t158_hakaton_max_bot"
    # TLS: платформа MAX использует сертификаты Минцифры. Если корневой CA не в системном
    # хранилище контейнера — укажите путь к PEM (например, /certs/russian_trusted_root_ca.pem).
    MAX_CA_BUNDLE: str = ""
    # Только для локальной демонстрации: отключить проверку сертификата (по умолчанию выкл.).
    MAX_TLS_INSECURE: bool = False

    # --- Приложение ---
    DATABASE_URL: str = "sqlite:///./data/kultvyezd.db"
    # Публичный базовый адрес mini-app (для ссылок open_app из бота)
    MINIAPP_BASE_URL: str = "http://localhost:8080"
    # База, с которой генерируются абсолютные ссылки в API-ответах
    PUBLIC_BASE_URL: str = "http://localhost:8080"
    # Автосоздание схемы и сидирование демо-данных при старте
    AUTO_SEED: bool = True
    # Таймаут long polling к MAX, сек
    POLL_TIMEOUT: int = 30
    LOG_LEVEL: str = "INFO"

    @property
    def bot_enabled(self) -> bool:
        return bool(self.MAX_BOT_TOKEN) and self.MAX_BOT_MODE in ("polling", "webhook")


@lru_cache
def get_settings() -> Settings:
    return Settings()
