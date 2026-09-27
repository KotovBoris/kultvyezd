"""Логика чат-бота MAX: команды, карточки выезда, точечные напоминания, deep-link привязка.

Сценарий в чате (слайд 15: «что лучше работает в чате»):
- онбординг и быстрый ответ родителя (кнопки «Отпускаю» / «Не сможет»);
- точечные напоминания должникам (не засоряя общий чат);
- доставка сгенерированного приказа.
Сложные экраны (каталог, «Светофор», импорт) — в мини-приложении.
"""
from __future__ import annotations

import logging
from datetime import datetime

from sqlmodel import Session, select

from . import services
from .config import get_settings
from .db import engine
from .max_client import (
    BOT_COMMANDS,
    MaxClient,
    callback_button,
    inline_keyboard,
    link_button,
    open_app_button,
)
from .models import (
    BotLinkCode,
    Excursion,
    ParentContact,
    SchoolClass,
    Student,
    TrafficLight,
)

log = logging.getLogger("classgo.bot")
settings = get_settings()


def _digits(value: str | None) -> str:
    """Только цифры телефона — для сравнения контактов в разных форматах."""
    return "".join(ch for ch in (value or "") if ch.isdigit())


class BotService:
    def __init__(self, client: MaxClient | None = None) -> None:
        self.client = client or MaxClient()

    # ------------------------------------------------------------ онбординг
    async def handle_update(self, update: dict) -> None:
        utype = update.get("update_type")
        try:
            if utype == "bot_started":
                await self._on_started(update)
            elif utype == "message_created":
                await self._on_message(update)
            elif utype == "message_callback":
                await self._on_callback(update)
        except Exception as exc:  # noqa: BLE001 — бот не должен падать на одном апдейте
            log.exception("Ошибка обработки апдейта %s: %s", utype, exc)

    async def _on_started(self, update: dict) -> None:
        user = update.get("user") or {}
        chat_id = update.get("chat_id")
        user_id = user.get("user_id")
        payload = update.get("payload")
        # deep-link: /start=<code> привязывает родителя к ученику
        if payload and str(payload).startswith("bind_"):
            code = str(payload)[len("bind_"):]
            linked = self._bind_by_code(code, user_id)
            text = (
                "✅ Готово! Вы привязаны как законный представитель.\n"
                "Теперь вам будут приходить точечные напоминания по выездам вашего ребёнка."
                if linked
                else "⚠️ Код привязки не найден или устарел. Запросите новый код в мини-приложении."
            )
        else:
            text = (
                "👋 Здравствуйте! Это бот «ClassGo».\n\n"
                "Сервис помогает классному руководителю организовать школьный культурный выезд, "
                "а вам — за минуту подтвердить участие ребёнка и оплатить билет напрямую в кассу музея.\n\n"
                "Команды:\n"
                "/trips — мои выезды\n"
                "/help — помощь"
            )
        attachments = [inline_keyboard([[open_app_button("Открыть приложение", settings.MAX_BOT_USERNAME)],
                                        [callback_button("Мои выезды", "cmd:trips")]])]
        await self.client.send_message(chat_id=chat_id, user_id=None if chat_id else user_id,
                                       text=text, attachments=attachments)

    async def _on_message(self, update: dict) -> None:
        message = update.get("message") or {}
        body = message.get("body") or {}
        text = (body.get("text") or "").strip().lower()
        sender = message.get("sender") or {}
        chat_id = (message.get("recipient") or {}).get("chat_id")
        user_id = sender.get("user_id")
        if text.startswith("/start"):
            await self._on_started({**update, "chat_id": chat_id, "user": sender, "payload": None})
            return
        if text.startswith("/trips"):
            await self._send_trips(chat_id, user_id)
            return
        if text.startswith("/help"):
            await self.client.send_message(
                chat_id=chat_id, user_id=None if chat_id else user_id,
                text="Откройте мини-приложение кнопкой ниже — там каталог событий, статусы и документы.",
                attachments=[inline_keyboard([[open_app_button("Открыть приложение", settings.MAX_BOT_USERNAME)]])],
            )
            return

    async def _send_trips(self, chat_id: int | None, user_id: int | None) -> None:
        """Показывает родителю его детей и статусы по активным выездам (по max_user_id)."""
        with Session(engine) as session:
            children = services.parent_context(session, user_id) if user_id else []
        if not children:
            await self.client.send_message(
                chat_id=chat_id, user_id=None if chat_id else user_id,
                text=(
                    "Чтобы получать напоминания, привяжитесь к ребёнку в мини-приложении.\n"
                    "Откройте приложение и нажмите «Привязать бота для напоминаний»."
                ),
                attachments=[inline_keyboard([[open_app_button("Открыть приложение", settings.MAX_BOT_USERNAME)]])],
            )
            return

        ICON = {"GREEN": "🟢", "YELLOW": "🟡", "GREY": "⚪", "RED": "🔴"}
        LABEL = {"GREEN": "готов к поездке", "YELLOW": "ждём оплату билета",
                 "GREY": "нужно подтвердить участие", "RED": "зафиксирован отказ"}
        lines = []
        for child in children:
            lines.append(f"👤 {child['student_name']}")
            if not child["excursions"]:
                lines.append("   • активных выездов нет")
            for e in child["excursions"]:
                mark = ICON.get(e["traffic_light"], "•")
                when = e["event_date"] or "дата уточняется"
                lines.append(f"   {mark} {e['title']} — {when} ({LABEL.get(e['traffic_light'], '')})")
        text = "Мои выезды:\n\n" + "\n".join(lines)
        await self.client.send_message(
            chat_id=chat_id, user_id=None if chat_id else user_id,
            text=text,
            attachments=[inline_keyboard([[open_app_button("Открыть приложение", settings.MAX_BOT_USERNAME)]])],
        )

    async def _on_callback(self, update: dict) -> None:
        callback = update.get("callback") or {}
        callback_id = callback.get("callback_id")
        payload = callback.get("payload") or ""
        user = callback.get("user") or {}
        user_id = user.get("user_id")
        if payload == "cmd:trips":
            await self.client.answer_callback(callback_id, notification="Открываю список выездов в приложении.")
            return
        if payload.startswith("consent:"):
            await self._handle_consent_callback(callback_id, payload, user_id)
            return
        await self.client.answer_callback(callback_id)

    async def _handle_consent_callback(self, callback_id: str, payload: str, user_id: int | None) -> None:
        # payload: consent:<excursion_id>:<student_id>:<APPROVED|REJECTED>
        try:
            _, exc_id, student_id, decision = payload.split(":")
            exc_id_i, student_id_i = int(exc_id), int(student_id)
        except ValueError:
            await self.client.answer_callback(callback_id, notification="Некорректная команда.")
            return
        with Session(engine) as session:
            excursion = session.get(Excursion, exc_id_i)
            if not excursion:
                await self.client.answer_callback(callback_id, notification="Выезд не найден.")
                return
            if user_id:
                parent = session.exec(
                    select(ParentContact).where(
                        ParentContact.max_user_id == user_id, ParentContact.student_id == student_id_i
                    )
                ).first()
                if parent:
                    parent_name, parent_phone = parent.full_name, parent.phone_number
                else:
                    parent_name, parent_phone = "Законный представитель", ""
            else:
                parent_name, parent_phone = "Законный представитель", ""
            participant, changed, msg = services.apply_consent(
                session, excursion, student_id=student_id_i, status=decision,
                parent_name=parent_name, parent_phone=parent_phone, source="bot",
            )
        await self.client.answer_callback(callback_id, notification=msg)

    # ------------------------------------------------------------ напоминания
    async def remind(self, excursion: Excursion, session: Session) -> tuple[int, list[str]]:
        """Возвращает (число адресатов, список ФИО, кому реально доставлено).

        Доставленным считается только фактически отправленное сообщение —
        если родитель не привязан к боту или бот выключен, это не «доставлено».
        """
        targets = services.remind_targets(session, excursion)
        delivered: list[str] = []
        for t in targets:
            if not (t.get("max_user_id") and self.client.enabled):
                continue
            text = services.reminder_text(excursion, t["student_name"], t["traffic_light"])
            attachments = self._consent_keyboard(excursion, t["student_id"])
            result = await self.client.send_message(user_id=t["max_user_id"], text=text, attachments=attachments)
            if result is not None:
                delivered.append(t["student_name"])
        return len(targets), delivered

    def _consent_keyboard(self, excursion: Excursion, student_id: int) -> list[dict]:
        approve = callback_button("✅ Отпускаю ребёнка", f"consent:{excursion.id}:{student_id}:APPROVED")
        reject = callback_button("❌ Не сможет поехать", f"consent:{excursion.id}:{student_id}:REJECTED")
        return [inline_keyboard([[approve], [reject]])]

    # ------------------------------------------------------------ документы
    async def send_order_file(
        self, excursion: Excursion, *, fmt: str = "docx", chat_id: int | None = None,
        user_id: int | None = None, attachments: list[str] | None = None,
    ) -> bool:
        """Генерирует приказ и доставляет его файлом в чат/личку MAX.

        Файл загружается через MAX ``POST /uploads`` (внешние ссылки мессенджер
        запрещает) и отправляется сообщением с вложением типа ``file``. Возвращает
        ``True`` только если сообщение реально ушло. При выключенном боте или сбое
        загрузки — ``False``, файл остаётся доступен прямой ссылкой на скачивание.
        """
        from .documents import build_order_docx, build_order_pdf  # локальный импорт: нет цикла

        with Session(engine) as session:
            if fmt == "pdf":
                content = build_order_pdf(session, excursion, attachments)
            else:
                content = build_order_docx(session, excursion, attachments)
        ext = "pdf" if fmt == "pdf" else "docx"
        filename = f"Приказ_выезд_{excursion.id}.{ext}"
        token = await self.client.upload_file(content, filename)
        if not token:
            return False
        caption = (
            f"📄 Приказ по выезду «{excursion.title}» "
            f"(от {datetime.utcnow().strftime('%d.%m.%Y %H:%M')} UTC)"
        )
        result = await self.client.send_document(
            filename=filename, token=token, caption=caption, chat_id=chat_id, user_id=user_id
        )
        return result is not None

    # ------------------------------------------------------------ публикация
    async def publish_to_chat(self, excursion: Excursion, chat_id: int) -> dict | None:
        text = (
            f"📣 Новый выезд: {excursion.title}\n"
            f"📍 {excursion.location_name}\n"
            f"🗓 {excursion.event_date.strftime('%d.%m.%Y') if excursion.event_date else '—'}\n"
            + (f"💰 {excursion.ticket_price:.0f} ₽ (оплата напрямую в кассу)\n" if excursion.ticket_price else "🆓 Бесплатно\n")
            + (f"🎫 Доступно по «Пушкинской карте»\n" if excursion.is_pushkin_card else "")
            + f"⏳ Ответить до: {excursion.deadline.strftime('%d.%m.%Y %H:%M') if excursion.deadline else '—'}"
        )
        attachments = [inline_keyboard([[open_app_button("Ответить в приложении", settings.MAX_BOT_USERNAME)]])]
        return await self.client.send_message(chat_id=chat_id, text=text, attachments=attachments)

    # ------------------------------------------------------------ привязка
    def _bind_by_code(self, code: str, user_id: int | None) -> bool:
        if not user_id:
            return False
        with Session(engine) as session:
            link = session.exec(select(BotLinkCode).where(BotLinkCode.code == code, BotLinkCode.used == False)).first()  # noqa: E712
            if not link:
                return False
            contacts = session.exec(
                select(ParentContact).where(ParentContact.student_id == link.student_id)
            ).all()
            parent = None
            if link.parent_phone or link.role:
                # код выдан под конкретный контакт (сценарий «два родителя»):
                # ищем по телефону, затем по роли; если не нашли — НЕ привязываем первому
                want = _digits(link.parent_phone)
                if want:
                    parent = next((c for c in contacts if _digits(c.phone_number) == want), None)
                if parent is None and link.role:
                    parent = next((c for c in contacts if (c.role or "").lower() == link.role.lower()), None)
            else:
                # fallback: код без указания контакта — привязываем первый, как раньше
                parent = contacts[0] if contacts else None
            if parent is None:
                return False
            parent.max_user_id = user_id
            session.add(parent)
            link.used = True
            session.add(link)
            session.commit()
            return True


def _excursion_for_student(session: Session, student_id: int) -> Excursion | None:
    student = session.get(Student, student_id)
    if not student:
        return None
    return session.exec(select(Excursion).where(Excursion.class_id == student.class_id)).first()
