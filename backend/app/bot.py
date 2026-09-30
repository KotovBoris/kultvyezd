from __future__ import annotations

import logging

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


class BotService:
    def __init__(self, client: MaxClient | None = None) -> None:
        self.client = client or MaxClient()

    async def handle_update(self, update: dict) -> None:
        utype = update.get("update_type")
        try:
            if utype == "bot_started":
                await self._on_started(update)
            elif utype == "message_created":
                await self._on_message(update)
            elif utype == "message_callback":
                await self._on_callback(update)
        except Exception as exc:  # noqa: BLE001
            log.exception("Ошибка обработки апдейта %s: %s", utype, exc)

    async def _on_started(self, update: dict) -> None:
        user = update.get("user") or {}
        chat_id = update.get("chat_id")
        user_id = user.get("user_id")
        payload = update.get("payload")
        if payload and str(payload).startswith("bind_"):
            code = str(payload)[len("bind_"):]
            student_id = self._bind_by_code(code, user_id)
            if student_id:
                await self._ask_link_confirmation(chat_id, user_id, student_id)
                return
            text = "Код привязки не найден или устарел. Новый код можно взять в мини-приложении."
        else:
            text = (
                "Здравствуйте, это бот «ClassGo».\n\n"
                "Классный руководитель собирает здесь группу на культурный выезд. "
                "Родитель подтверждает участие ребёнка и при необходимости открывает ссылку на кассу музея.\n\n"
                "Команды:\n"
                "/trips — мои выезды\n"
                "/mute — не беспокоить по всем мероприятиям\n"
                "/help — помощь"
            )
        attachments = [inline_keyboard([[open_app_button("Открыть приложение", settings.MAX_BOT_USERNAME)],
                                        [callback_button("Мои выезды", "cmd:trips")]])]
        await self.client.send_message(chat_id=chat_id, user_id=None if chat_id else user_id,
                                       text=text, attachments=attachments)

    async def _ask_link_confirmation(self, chat_id: int | None, user_id: int | None, student_id: int) -> None:
        with Session(engine) as session:
            student = session.get(Student, student_id)
        name = student.full_name if student else f"#{student_id}"
        text = (
            f"Учитель указал вас законным представителем: {name}.\n"
            "Подтвердите, что это ваш ребёнок. После подтверждения вы будете получать "
            "заявки на выезды и напоминания."
        )
        attachments = [inline_keyboard([
            [callback_button("Подтверждаю", f"plink:{student_id}:YES")],
            [callback_button("Это не мой ребёнок", f"plink:{student_id}:NO")],
        ])]
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
        if text.startswith("/mute"):
            await self._set_mute(chat_id, user_id, enabled=False)
            return
        if text.startswith("/unmute"):
            await self._set_mute(chat_id, user_id, enabled=True)
            return
        if text.startswith("/help"):
            await self.client.send_message(
                chat_id=chat_id, user_id=None if chat_id else user_id,
                text=(
                    "Каталог событий, статусы класса и документы — в мини-приложении.\n"
                    "/trips — выезды вашего ребёнка\n"
                    "/mute — не беспокоить, /unmute — включить напоминания обратно"
                ),
                attachments=[inline_keyboard([[open_app_button("Открыть приложение", settings.MAX_BOT_USERNAME)]])],
            )
            return

    async def _set_mute(self, chat_id: int | None, user_id: int | None, *, enabled: bool) -> None:
        if not user_id:
            return
        with Session(engine) as session:
            affected = services.set_notifications(session, user_id, enabled)
        if enabled:
            text = "Напоминания снова включены."
        else:
            text = (
                "Напоминания по всем мероприятиям отключены. "
                "Включить обратно: /unmute."
            )
        if not affected:
            text = "Вы пока не привязаны ни к одному ребёнку, беспокоить и так некому."
        await self.client.send_message(chat_id=chat_id, user_id=None if chat_id else user_id, text=text)

    async def _send_trips(self, chat_id: int | None, user_id: int | None) -> None:
        with Session(engine) as session:
            children = services.parent_context(session, user_id) if user_id else []
        if not children:
            await self.client.send_message(
                chat_id=chat_id, user_id=None if chat_id else user_id,
                text=(
                    "Вы пока не привязаны к ребёнку.\n"
                    "Откройте приложение и нажмите «Привязать бота для напоминаний»."
                ),
                attachments=[inline_keyboard([[open_app_button("Открыть приложение", settings.MAX_BOT_USERNAME)]])],
            )
            return
        for child in children:
            if not child["confirmed"]:
                await self._ask_link_confirmation(chat_id, user_id, child["student_id"])
                continue
            if not child["excursions"]:
                await self.client.send_message(
                    chat_id=chat_id, user_id=None if chat_id else user_id,
                    text=f"{child['student_name']}: активных выездов нет.",
                )
                continue
            for item in child["excursions"]:
                text = self._trip_text(child["student_name"], item)
                attachments = None
                if item["consent_status"] == "PENDING":
                    attachments = self._consent_keyboard_raw(item["excursion_id"], child["student_id"])
                elif item["ticket_status"] == "WAITING_PAYMENT" and item["ticket_sale_url"]:
                    attachments = [inline_keyboard([
                        [link_button("Купить билет", item["ticket_sale_url"])],
                        [callback_button("Билет куплен", f"ticket:{item['excursion_id']}:{child['student_id']}")],
                    ])]
                await self.client.send_message(chat_id=chat_id, user_id=None if chat_id else user_id,
                                               text=text, attachments=attachments)

    def _trip_text(self, student_name: str, item: dict) -> str:
        status = {
            "GREEN": "едет, всё готово",
            "YELLOW": "едет, билет ещё не отмечен",
            "GREY": "ответа пока нет",
            "RED": "отказ",
        }[item["traffic_light"]]
        lines = [
            f"{item['title']}",
            f"Место: {item['location_name']}",
            f"Дата: {item['event_date'] or 'уточняется'}",
            f"{student_name}: {status}",
        ]
        if item["deadline"]:
            lines.append(f"Ответить до: {item['deadline']:%d.%m.%Y %H:%M}")
        return "\n".join(lines)

    async def _on_callback(self, update: dict) -> None:
        callback = update.get("callback") or {}
        callback_id = callback.get("callback_id")
        payload = str(callback.get("payload") or "")
        user = callback.get("user") or {}
        user_id = user.get("user_id")
        message = update.get("message") or {}
        chat_id = (message.get("recipient") or {}).get("chat_id")

        if payload == "cmd:trips":
            await self.client.answer_callback(callback_id, notification="Открываю ваши выезды")
            await self._send_trips(chat_id, user_id)
            return

        if payload.startswith("plink:"):
            _, student_id_s, answer = payload.split(":", 2)
            with Session(engine) as session:
                parent = services.confirm_parent_link(session, int(student_id_s), user_id, answer == "YES")
            if not parent:
                await self.client.answer_callback(callback_id, notification="Привязка не найдена.")
            elif answer == "YES":
                await self.client.answer_callback(callback_id, notification="Готово, привязка подтверждена.")
                await self._send_trips(chat_id, user_id)
            else:
                await self.client.answer_callback(callback_id, notification="Привязка удалена.")
            return

        if payload.startswith("ticket:"):
            _, exc_id_s, student_id_s = payload.split(":", 2)
            with Session(engine) as session:
                excursion = session.get(Excursion, int(exc_id_s))
                if not excursion:
                    await self.client.answer_callback(callback_id, notification="Выезд не найден.")
                    return
                _, _, msg = services.confirm_ticket(
                    session, excursion, student_id=int(student_id_s), source="bot"
                )
            await self.client.answer_callback(callback_id, notification=msg)
            return

        if not payload.startswith("consent:"):
            return
        try:
            _, exc_id_s, student_id_s, decision = payload.split(":", 3)
            exc_id_i, student_id_i = int(exc_id_s), int(student_id_s)
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
        if changed:
            await self.notify_consent(exc_id_i, student_id_i, exclude_user_id=user_id)

    async def notify_consent(self, excursion_id: int, student_id: int, exclude_user_id: int | None = None) -> None:
        with Session(engine) as session:
            excursion = session.get(Excursion, excursion_id)
            student = session.get(Student, student_id)
            participant = services.get_participant(session, excursion_id, student_id)
            others = services.other_bound_parents(session, student_id, exclude_user_id)
        if not (excursion and student and participant) or not others:
            return
        if participant.consent_status.value == "APPROVED":
            verdict = "подписано согласие"
        else:
            verdict = "зафиксирован отказ"
        by = participant.signed_by_name or "законный представитель"
        when = participant.signed_at.strftime("%d.%m в %H:%M") if participant.signed_at else ""
        text = f"По выезду «{excursion.title}» ({student.full_name}) {verdict} ({by}{', ' + when if when else ''})."
        for parent in others:
            await self.client.send_message(user_id=parent.max_user_id, text=text)

    async def remind(self, excursion: Excursion, session: Session) -> tuple[int, list[str]]:
        targets = services.remind_targets(session, excursion)
        delivered: list[str] = []
        for t in targets:
            if not (t.get("max_user_id") and self.client.enabled):
                continue
            text = services.reminder_text(excursion, t["student_name"], t["traffic_light"])
            attachments = self._consent_keyboard(excursion, t["student_id"]) if t["traffic_light"] == TrafficLight.GREY else None
            result = await self.client.send_message(user_id=t["max_user_id"], text=text, attachments=attachments)
            if result is not None:
                delivered.append(t["student_name"])
        return len(targets), delivered

    async def send_auto_reminder(self, target: dict) -> bool:
        if not self.client.enabled:
            return False
        excursion: Excursion = target["excursion"]
        text = services.reminder_text(excursion, target["student_name"], target["traffic_light"])
        attachments = None
        if target["traffic_light"] == TrafficLight.GREY:
            attachments = self._consent_keyboard(excursion, target["student_id"])
        result = await self.client.send_message(user_id=target["max_user_id"], text=text, attachments=attachments)
        return result is not None

    def _consent_keyboard(self, excursion: Excursion, student_id: int) -> list[dict]:
        return self._consent_keyboard_raw(excursion.id, student_id)

    def _consent_keyboard_raw(self, excursion_id: int, student_id: int) -> list[dict]:
        approve = callback_button("Отпускаю ребёнка", f"consent:{excursion_id}:{student_id}:APPROVED")
        reject = callback_button("Не сможет поехать", f"consent:{excursion_id}:{student_id}:REJECTED")
        return [inline_keyboard([[approve], [reject]])]

    async def publish_to_chat(self, excursion: Excursion, chat_id: int) -> dict | None:
        lines = [
            f"Новый выезд: {excursion.title}",
            f"Место: {excursion.location_name}",
            f"Дата: {excursion.event_date.strftime('%d.%m.%Y') if excursion.event_date else 'уточняется'}",
        ]
        if excursion.ticket_price:
            lines.append(f"Стоимость: {excursion.ticket_price:.0f} ₽, оплата на сайте учреждения")
        else:
            lines.append("Вход бесплатный")
        if excursion.is_pushkin_card:
            lines.append("Можно по «Пушкинской карте»")
        lines.append(
            f"Ответить до: {excursion.deadline.strftime('%d.%m.%Y %H:%M') if excursion.deadline else '—'}"
        )
        text = "\n".join(lines)
        attachments = [inline_keyboard([[open_app_button("Ответить в приложении", settings.MAX_BOT_USERNAME)]])]
        return await self.client.send_message(chat_id=chat_id, text=text, attachments=attachments)

    async def tag_unactivated(self, excursion: Excursion, chat_id: int, names: list[str]) -> dict | None:
        listing = "\n".join(f"— {n}" for n in names)
        text = (
            f"По выезду «{excursion.title}» ждём ответа родителей, которые ещё не открыли бота:\n"
            f"{listing}\n"
            "Откройте бота, чтобы подтвердить участие ребёнка."
        )
        attachments = [inline_keyboard([[open_app_button("Открыть приложение", settings.MAX_BOT_USERNAME)]])]
        return await self.client.send_message(chat_id=chat_id, text=text, attachments=attachments)

    def _bind_by_code(self, code: str, user_id: int | None) -> int | None:
        if not user_id:
            return None
        with Session(engine) as session:
            link = session.exec(select(BotLinkCode).where(BotLinkCode.code == code, BotLinkCode.used == False)).first()  # noqa: E712
            if not link:
                return None
            parent = session.exec(
                select(ParentContact).where(ParentContact.student_id == link.student_id)
            ).first()
            if parent:
                parent.max_user_id = user_id
                session.add(parent)
            link.used = True
            session.add(link)
            session.commit()
            return link.student_id


def class_chat_id(session: Session, excursion: Excursion) -> int | None:
    klass = session.get(SchoolClass, excursion.class_id)
    return klass.chat_id if klass else None
