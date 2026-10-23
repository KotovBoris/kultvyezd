from __future__ import annotations

import logging
from datetime import datetime

from sqlmodel import Session, select

from . import services
from .auth import upsert_profile_from_bot
from .config import get_settings
from .db import engine
from .max_client import (
    MaxClient,
    callback_button,
    inline_keyboard,
    link_button,
    open_app_button,
)
from .models import (
    BotLinkCode,
    ConsentStatus,
    Excursion,
    ExcursionParticipant,
    ParentContact,
    SchoolClass,
    Student,
    TicketStatus,
    TrafficLight,
    UserProfile,
)

log = logging.getLogger("classgo.bot")
settings = get_settings()

WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
          "сентября", "октября", "ноября", "декабря"]
# Причины без медицинских подробностей: сведения о здоровье — особая категория ПДн (152-ФЗ, ст. 10).
REJECT_REASONS = {"personal": "Личные причины", "family": "Семейные обстоятельства", "other": "Другие планы"}


def human_date(value) -> str:
    if not value:
        return "дата уточняется"
    return f"{WEEKDAYS[value.weekday()]}, {value.day} {MONTHS[value.month - 1]}"


def human_deadline(value: datetime | None) -> str:
    if not value:
        return ""
    value = value + services.MSK
    return f"{value.day} {MONTHS[value.month - 1]}, {value:%H:%M}"


def is_female(full_name: str) -> bool:
    """Пол по отчеству («-овна», «-евна», «-ична», «-кызы»), иначе по фамилии."""
    parts = full_name.split()
    if len(parts) >= 3:
        patronymic = parts[2].lower()
        return patronymic.endswith(("на", "кызы", "гызы"))
    return bool(parts) and parts[0].lower().endswith(("ова", "ева", "ина", "ая", "ына"))


def first_name(full_name: str) -> str:
    """«Сафин Тимур Ренатович» → «Тимур» (ФИО в школьных списках начинается с фамилии)."""
    parts = full_name.split()
    return parts[1] if len(parts) >= 2 else full_name


def quoted(title: str) -> str:
    """Название в кавычках-ёлочках, если их ещё нет: «Научное шоу «Физика»» выглядит неряшливо."""
    return title if "«" in title else f"«{title}»"


def app_button(text: str, payload: str = "") -> dict:
    return open_app_button(text, settings.MAX_BOT_USERNAME, payload)


class BotService:
    def __init__(self, client: MaxClient | None = None) -> None:
        self.client = client or MaxClient()

    # ------------------------------------------------------------------ входящие
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

    async def _reply(self, chat_id: int | None, user_id: int | None, text: str,
                     attachments: list[dict] | None = None) -> dict | None:
        return await self.client.send_message(chat_id=chat_id, user_id=None if chat_id else user_id,
                                              text=text, attachments=attachments)

    async def _on_started(self, update: dict) -> None:
        user = update.get("user") or {}
        chat_id = update.get("chat_id")
        user_id = user.get("user_id")
        payload = str(update.get("payload") or "")
        with Session(engine) as session:
            upsert_profile_from_bot(session, user)

        if payload.startswith("bind_"):
            student_id = self._bind_by_code(payload[len("bind_"):], user_id)
            if student_id:
                await self._ask_link_confirmation(chat_id, user_id, student_id)
                return
            await self._reply(chat_id, user_id,
                              "Ссылка-приглашение устарела. Попросите классного руководителя прислать новую.")
            return

        if payload.startswith("pair_"):
            with Session(engine) as session:
                profile_name = " ".join(p for p in (str(user.get("first_name") or ""), str(user.get("last_name") or "")) if p)
                student = services.accept_pair_code(session, payload[len("pair_"):], user_id, profile_name)
            if student:
                await self._reply(chat_id, user_id,
                                  f"Готово: вы подключены как второй родитель — {student.full_name}. "
                                  "Приглашения на выезды теперь будут приходить и вам.")
                await self._send_trips(chat_id, user_id)
                return
            await self._reply(chat_id, user_id, "Ссылка уже использована или устарела. Попросите прислать новую.")
            return

        if payload.startswith("join_"):
            code = payload[len("join_"):]
            with Session(engine) as session:
                klass = session.exec(select(SchoolClass).where(SchoolClass.invite_code == code)).first()
            if klass:
                await self._reply(
                    chat_id, user_id,
                    f"Вас пригласили в класс {klass.title} ({klass.school_name}).\n\n"
                    "Откройте ClassGo и подтвердите номер телефона — "
                    "мы найдём вашего ребёнка в списке класса.",
                    [inline_keyboard([[app_button("Подключиться к классу", f"join_{code}")]])],
                )
                return

        if payload == "demo":
            await self._reply(
                chat_id, user_id,
                "Демо ClassGo: вы классный руководитель демо-класса 7Б и одновременно родитель "
                "одного из учеников. Создайте выезд — приглашение придёт сюда же, а остальные "
                "родители ответят сами.",
                [inline_keyboard([[app_button("Открыть демо", "demo")]])],
            )
            return

        text = (
            "Здравствуйте! ClassGo помогает собрать класс на экскурсию, в музей или театр.\n\n"
            "Классному руководителю — список «кто едет» и готовый приказ для директора.\n"
            "Родителю — ответ одной кнопкой прямо здесь, в MAX.\n\n"
            "/trips — выезды вашего ребёнка\n"
            "/help — как это работает"
        )
        await self._reply(chat_id, user_id, text, [inline_keyboard([
            [app_button("Открыть ClassGo")],
            [callback_button("Выезды моего ребёнка", "cmd:trips")],
            [app_button("Попробовать демо за 2 минуты", "demo")],
        ])])

    async def _ask_link_confirmation(self, chat_id: int | None, user_id: int | None, student_id: int) -> None:
        with Session(engine) as session:
            student = session.get(Student, student_id)
        name = student.full_name if student else f"#{student_id}"
        await self._reply(
            chat_id, user_id,
            f"Классный руководитель указал вас родителем ученика: {name}.\n"
            "Подтвердите, что это ваш ребёнок, — после этого приглашения на выезды будут приходить сюда.",
            [inline_keyboard([
                [callback_button("Да, это мой ребёнок", f"plink:{student_id}:YES")],
                [callback_button("Нет, это ошибка", f"plink:{student_id}:NO")],
            ])],
        )

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
            await self._reply(
                chat_id, user_id,
                "Как это работает:\n"
                "1. Классный руководитель выбирает событие и отправляет приглашение.\n"
                "2. Родитель нажимает «Да, пойдёт» или «Нет» — прямо в этом чате.\n"
                "3. Учитель видит, кто едет, и получает готовый приказ и списки.\n\n"
                "/trips — выезды вашего ребёнка\n"
                "/mute — не присылать напоминания, /unmute — включить снова",
                [inline_keyboard([[app_button("Открыть ClassGo")]])],
            )
            return

    async def _set_mute(self, chat_id: int | None, user_id: int | None, *, enabled: bool) -> None:
        if not user_id:
            return
        with Session(engine) as session:
            affected = services.set_notifications(session, user_id, enabled)
        if not affected:
            text = "Вы пока не подключены ни к одному классу — напоминаний и так не будет."
        elif enabled:
            text = "Напоминания снова включены."
        else:
            text = "Напоминания отключены. Включить обратно: /unmute."
        await self._reply(chat_id, user_id, text)

    async def _send_trips(self, chat_id: int | None, user_id: int | None) -> None:
        with Session(engine) as session:
            children = services.parent_context(session, user_id) if user_id else []
        if not children:
            await self._reply(
                chat_id, user_id,
                "Вы пока не подключены к классу. Откройте ссылку-приглашение от классного "
                "руководителя или попробуйте демо.",
                [inline_keyboard([[app_button("Открыть ClassGo")], [app_button("Попробовать демо", "demo")]])],
            )
            return
        for child in children:
            if not child["confirmed"]:
                await self._ask_link_confirmation(chat_id, user_id, child["student_id"])
                continue
            if not child["excursions"]:
                await self._reply(chat_id, user_id, f"{child['student_name']}: запланированных выездов нет.")
                continue
            for item in child["excursions"]:
                with Session(engine) as session:
                    excursion = session.get(Excursion, item["excursion_id"])
                    participant = services.get_participant(session, item["excursion_id"], child["student_id"])
                    if not (excursion and participant):
                        continue
                    text, keyboard = self._parent_card(excursion, child["student_name"], participant)
                await self._reply(chat_id, user_id, text, keyboard)

    # ------------------------------------------------------------------ карточки
    def _trip_lines(self, excursion: Excursion, student: Student | None = None) -> list[str]:
        """Что, когда, деньги — коротко и словами, без канцелярита."""
        lines = [f"{quoted(excursion.title)} — {excursion.location_name}"]
        when = human_date(excursion.event_date)
        if excursion.gathering_time:
            when += f", сбор в {excursion.gathering_time:%H:%M} {excursion.meeting_point}"
        if excursion.return_time:
            when += f", вернёмся к {excursion.return_time:%H:%M}"
        lines.append(f"Когда: {when}")
        if excursion.ticket_price:
            price = f"Билет: {excursion.ticket_price:.0f} ₽ — покупаете сами на сайте или в кассе учреждения"
            pushkin = services.pushkin_for(student, excursion)
            if pushkin is True:
                price += ", можно «Пушкинской картой» ребёнка"
            elif pushkin is None:
                price += " (если ребёнку уже 14, можно «Пушкинской картой»)"
            lines.append(price + ". Школа деньги не собирает.")
        else:
            lines.append("Вход бесплатный.")
        return lines

    def _parent_card(self, excursion: Excursion, student_name: str, participant) -> tuple[str, list[dict]]:
        """Текст и кнопки карточки выезда для родителя — по текущему статусу ребёнка.

        Требования из тестов с родителями 60+: в первой строке — чей ребёнок и класс, дальше —
        кто пишет (учитель, школа), кнопки называют ребёнка, явно сказано, что платить в чате
        ничего не нужно, и есть контакт учителя.
        """
        with Session(engine) as session:
            student = session.get(Student, participant.student_id)
            klass = session.get(SchoolClass, excursion.class_id)
        name = first_name(student_name)
        class_title = klass.title if klass else ""
        teacher = excursion.responsible_teacher or (klass.teacher_name if klass else "") or "классный руководитель"
        contact = f"Вопросы — {teacher}" + (f", {klass.teacher_phone}" if klass and klass.teacher_phone else "") + "."
        lines = self._trip_lines(excursion, student)
        open_btn = [app_button("Подробнее", f"trip_{excursion.id}")]
        head = f"{student_name}{f' ({class_title})' if class_title else ''}"

        if participant.consent_status == ConsentStatus.PENDING:
            deadline = human_deadline(excursion.deadline)
            school = f", {klass.school_name}," if klass and klass.school_name else ""
            keyboard = inline_keyboard([
                [callback_button(f"✅ Да, {name} пойдёт", f"consent:{excursion.id}:{participant.student_id}:APPROVED")],
                [callback_button(f"Нет, {name} не пойдёт", f"consent:{excursion.id}:{participant.student_id}:REJECTED")],
                open_btn,
            ])
            text = "\n".join([
                f"{head} — приглашение на выезд",
                "",
                f"Здравствуйте! Классный руководитель {teacher}{school} зовёт класс:",
                "",
                *lines,
                "",
                (f"Ответьте до {deadline}. " if deadline else "") + "Ответ кнопкой — ваша подпись под согласием "
                "на поход. Платить в чате ничего не нужно.",
                contact,
            ])
            return text, [keyboard]

        when = services.msk_stamp(participant.signed_at)
        can_change = not services.trip_started(excursion)
        change_btn = [callback_button("Изменить ответ", f"change:{excursion.id}:{participant.student_id}")]
        if participant.consent_status == ConsentStatus.REJECTED:
            text = "\n".join([
                f"Готово: вы ответили, что {name} не пойдёт ({(participant.rejection_reason or 'без причины').lower()}).",
                f"{head}. Ответ записан{' ' + when if when else ''}, учитель уже видит его.",
                "", *lines[:2], contact,  # без строки про билет — ребёнок не идёт
            ])
            return text, [inline_keyboard([open_btn] + ([change_btn] if can_change else []))]

        rows: list[list[dict]] = []
        status = f"Готово: {name} идёт на выезд — {human_date(excursion.event_date)}."
        extra: list[str] = [f"{head}. Подпись записана{' ' + when if when else ''}."]
        tail: list[str] = []
        if excursion.ticket_price:
            # Учитель оплату не видит и о ней не напоминает: семья решает сама (ВК-2227/08).
            tail.append("Трудности с оплатой билета — скажите классному руководителю.")
            if excursion.ticket_sale_url:
                rows.append([link_button("Сайт учреждения", excursion.ticket_sale_url)])
        else:
            extra.append("Больше ничего делать не нужно.")
        rows.append(open_btn)
        if can_change:
            rows.append(change_btn)
        return "\n".join([status, *extra, "", *lines, *tail, contact]), [inline_keyboard(rows)]

    # ------------------------------------------------------------------ кнопки
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
                await self.client.answer_callback(callback_id, text="Готово: вы подключены к классу.",
                                                  attachments=[])
                await self._send_trips(chat_id, user_id)
            else:
                await self.client.answer_callback(callback_id, text="Привязка удалена. Спасибо, что сообщили.",
                                                  attachments=[])
            return

        if payload.startswith("docs:"):
            exc_id = int(payload.split(":", 1)[1])
            await self.client.answer_callback(callback_id, notification="Готовлю документы…")
            with Session(engine) as session:
                excursion = session.get(Excursion, exc_id)
                if excursion:
                    await self.send_documents(session, excursion, user_id)
            return

        if payload.startswith("ticket:"):
            _, exc_id_s, student_id_s = payload.split(":", 2)
            with Session(engine) as session:
                excursion = session.get(Excursion, int(exc_id_s))
                if not excursion:
                    await self.client.answer_callback(callback_id, notification="Выезд не найден.")
                    return
                participant, _, msg = services.confirm_ticket(
                    session, excursion, student_id=int(student_id_s), source="bot"
                )
                student = session.get(Student, participant.student_id)
                text, keyboard = self._parent_card(excursion, student.full_name if student else "", participant)
            await self.client.answer_callback(callback_id, text=text, attachments=keyboard, notification=msg)
            await self.notify_teacher_if_complete(int(exc_id_s))
            return

        if payload.startswith("reason:"):
            _, exc_id_s, student_id_s, code = payload.split(":", 3)
            await self._apply_bot_consent(callback_id, user_id, int(exc_id_s), int(student_id_s),
                                          "REJECTED", REJECT_REASONS.get(code, "Другая причина"))
            return

        if payload.startswith("change:"):
            _, exc_id_s, student_id_s = payload.split(":", 2)
            with Session(engine) as session:
                excursion = session.get(Excursion, int(exc_id_s))
                if not excursion:
                    await self.client.answer_callback(callback_id, notification="Выезд не найден.")
                    return
                try:
                    participant, _, msg = services.reset_consent(
                        session, excursion, student_id=int(student_id_s), user_id=user_id, source="bot",
                    )
                except ValueError:
                    await self.client.answer_callback(callback_id, notification="Выезд не найден.")
                    return
                student = session.get(Student, int(student_id_s))
                text, keyboard = self._parent_card(excursion, student.full_name if student else "", participant)
            await self.client.answer_callback(callback_id, text=text, attachments=keyboard, notification=msg)
            return

        if payload.startswith("back:"):
            _, exc_id_s, student_id_s = payload.split(":", 2)
            with Session(engine) as session:
                excursion = session.get(Excursion, int(exc_id_s))
                participant = services.get_participant(session, int(exc_id_s), int(student_id_s))
                student = session.get(Student, int(student_id_s))
                if not (excursion and participant):
                    await self.client.answer_callback(callback_id, notification="Выезд не найден.")
                    return
                text, keyboard = self._parent_card(excursion, student.full_name if student else "", participant)
            await self.client.answer_callback(callback_id, text=text, attachments=keyboard)
            return

        if payload.startswith("paper:"):
            _, exc_id_s, student_id_s = payload.split(":", 2)
            with Session(engine) as session:
                excursion = session.get(Excursion, int(exc_id_s))
                klass = session.get(SchoolClass, excursion.class_id) if excursion else None
                if user_id:
                    services.set_notifications(session, user_id, False)  # напоминания в MAX больше не шлём
            teacher = (klass.teacher_name if klass else "") or "классного руководителя"
            await self.client.answer_callback(
                callback_id,
                text=f"Хорошо, ответите на бумаге. Бланк согласия — у классного руководителя ({teacher}). "
                     "Напоминаний в MAX больше не будет. Передумаете — нажмите «Назад».",
                attachments=[inline_keyboard([[callback_button("← Назад", f"back:{exc_id_s}:{student_id_s}")]])],
            )
            return

        if not payload.startswith(("consent:", "terms:")):
            return
        try:
            if payload.startswith("terms:"):
                _, step_s, exc_id_s, student_id_s, decision = payload.split(":", 4)
                step = int(step_s)
            else:
                _, exc_id_s, student_id_s, decision = payload.split(":", 3)
                step = 0
            exc_id_i, student_id_i = int(exc_id_s), int(student_id_s)
        except ValueError:
            await self.client.answer_callback(callback_id, notification="Некорректная команда.")
            return
        if step == 2 and user_id:
            self._accept_terms(user_id)
        if step == 1 or (user_id and not self._terms_accepted(user_id)):
            # Один раз перед первым ответом: соглашение о ПЭП и отдельное согласие на ПДн.
            await self._ask_terms(callback_id, 2 if step == 1 else 1, exc_id_i, student_id_i, decision)
            return
        if decision == "REJECTED":
            # Сначала уточняем причину — общими словами, без сведений о здоровье (152-ФЗ, ст. 10).
            with Session(engine) as session:
                participant = services.get_participant(session, exc_id_i, student_id_i)
                excursion = session.get(Excursion, exc_id_i)
                student = session.get(Student, student_id_i)
                if participant and excursion and participant.consent_status != ConsentStatus.PENDING:
                    text, keyboard = self._parent_card(excursion, student.full_name if student else "", participant)
                    await self.client.answer_callback(callback_id, text=text, attachments=keyboard,
                                                      notification="Ответ уже записан")
                    return
            child = first_name(student.full_name) if student else "ребёнок"
            await self.client.answer_callback(
                callback_id,
                text=f"Почему {child} не пойдёт? Учитель увидит только этот вариант — подробности объяснять "
                     "не нужно.",
                attachments=[inline_keyboard([
                    [callback_button(label, f"reason:{exc_id_i}:{student_id_i}:{code}")]
                    for code, label in REJECT_REASONS.items()
                ] + [[callback_button("← Назад", f"back:{exc_id_i}:{student_id_i}")]])],
            )
            return
        await self._apply_bot_consent(callback_id, user_id, exc_id_i, student_id_i, decision, None)

    @staticmethod
    def _terms_accepted(user_id: int) -> bool:
        with Session(engine) as session:
            profile = session.exec(select(UserProfile).where(UserProfile.max_user_id == user_id)).first()
            return bool(profile and profile.terms_accepted_at)

    @staticmethod
    def _accept_terms(user_id: int) -> None:
        with Session(engine) as session:
            profile = session.exec(select(UserProfile).where(UserProfile.max_user_id == user_id)).first()
            profile = profile or UserProfile(max_user_id=user_id)
            if not profile.terms_accepted_at:
                profile.terms_accepted_at = datetime.utcnow()
                session.add(profile)
                session.commit()
                services.set_notifications(session, user_id, True)  # если раньше выбирал «на бумаге»

    async def _ask_terms(self, callback_id: str, step: int, exc_id: int, student_id: int, decision: str) -> None:
        """Те же тексты, что в мини-приложении (ParentHome → Terms), коротко для чата."""
        with Session(engine) as session:
            excursion = session.get(Excursion, exc_id)
            klass = session.get(SchoolClass, excursion.class_id) if excursion else None
        school = (klass.school_name if klass else "") or "школа"
        if step == 1:
            text = "\n".join([
                "Один раз перед первым ответом. Шаг 1 из 2 — соглашение об электронной подписи.",
                "",
                f"{school} и я, законный представитель ученика, договорились:",
                "1. Мой ответ кнопкой в ClassGo — простая электронная подпись (ст. 9 63-ФЗ); документ с ней "
                "равнозначен бумажному с моей подписью.",
                "2. Подписанта определяют по аккаунту MAX и его номеру телефона, совпадающему с номером у школы.",
                "3. Так подписываются только согласия и отказы на участие ребёнка в экскурсиях.",
                "4. Не передаю телефон и аккаунт MAX другим, об утрате сразу сообщаю классному руководителю.",
                "5. Могу отказаться в любой момент и отвечать на бумаге.",
            ])
            accept = callback_button("✅ Принимаю", f"terms:1:{exc_id}:{student_id}:{decision}")
            decline = callback_button("Отвечать на бумаге", f"paper:{exc_id}:{student_id}")
        else:
            text = "\n".join([
                "Шаг 2 из 2 — согласие на обработку персональных данных (отдельный документ, ст. 9 152-ФЗ).",
                "",
                f"Оператор — {school}. Данные: мои ФИО, телефон, ID в MAX, статус (мать, отец, опекун); ФИО и "
                "класс ребёнка, а при поездке автобусом — его возраст; мои ответы и их время.",
                "Цель: участие ребёнка в экскурсиях школы — приглашения, согласия, списки, документы.",
                "Действия: сбор, запись, хранение, уточнение, использование, передача руководителю группы и "
                "администрации школы, удаление; автоматизированно. По поручению школы данные обрабатывает "
                "ClassGo, сообщения идут через MAX, хранение — в России.",
                "Срок: до конца учебного года или до отзыва — в приложении ClassGo или заявлением в школу.",
            ])
            accept = callback_button("✅ Даю согласие", f"terms:2:{exc_id}:{student_id}:{decision}")
            decline = callback_button("Не даю — отвечу на бумаге", f"paper:{exc_id}:{student_id}")
        await self.client.answer_callback(callback_id, text=text, attachments=[inline_keyboard([
            [accept], [decline], [callback_button("← Назад", f"back:{exc_id}:{student_id}")],
        ])])

    async def _apply_bot_consent(self, callback_id: str, user_id: int | None, exc_id: int,
                                 student_id: int, decision: str, reason: str | None) -> None:
        with Session(engine) as session:
            excursion = session.get(Excursion, exc_id)
            if not excursion:
                await self.client.answer_callback(callback_id, notification="Выезд не найден.")
                return
            parent = None
            if user_id:
                parent = session.exec(
                    select(ParentContact).where(
                        ParentContact.max_user_id == user_id, ParentContact.student_id == student_id
                    )
                ).first()
            participant, changed, msg = services.apply_consent(
                session, excursion, student_id=student_id, status=decision,
                parent_name=parent.full_name if parent else "Законный представитель",
                parent_phone=parent.phone_number if parent else "",
                reason=reason, source="bot", max_user_id=user_id,
            )
            student = session.get(Student, student_id)
            text, keyboard = self._parent_card(excursion, student.full_name if student else "", participant)
        await self.client.answer_callback(callback_id, text=text, attachments=keyboard, notification=msg)
        if changed:
            await self.notify_consent(exc_id, student_id, exclude_user_id=user_id)
            await self.notify_teacher_if_complete(exc_id)

    # ------------------------------------------------------------------ исходящие
    async def invite_one(self, excursion_id: int, student_id: int, user_id: int) -> bool:
        """Приглашение одному родителю — тому, кто только что подключился к классу."""
        with Session(engine) as session:
            excursion = session.get(Excursion, excursion_id)
            participant = services.get_participant(session, excursion_id, student_id)
            student = session.get(Student, student_id)
            if not (excursion and participant and student) or excursion.cancelled:
                return False
            if participant.consent_status != ConsentStatus.PENDING or services.trip_started(excursion):
                return False
            text, keyboard = self._parent_card(excursion, student.full_name, participant)
        return await self.client.send_message(user_id=user_id, text=text, attachments=keyboard) is not None

    async def notify_owner_joined(self, klass: SchoolClass, parent_name: str, student_name: str) -> None:
        teacher_id = klass.teacher_max_id or klass.owner_user_id
        if not teacher_id:
            return
        await self.client.send_message(
            user_id=teacher_id,
            text=f"{klass.title}: подключился родитель — {parent_name} ({student_name}). "
                 "Приглашения на выезды уже отправлены ему в MAX.",
        )

    def _going_parents(self, session: Session, excursion: Excursion) -> list[tuple[Student, ParentContact, object]]:
        result = []
        for part in session.exec(select(ExcursionParticipant).where(
                ExcursionParticipant.excursion_id == excursion.id)).all():
            student = session.get(Student, part.student_id)
            for parent in services.student_parents(session, part.student_id):
                if parent.max_user_id and not parent.is_virtual and student:
                    result.append((student, parent, part))
        return result

    async def notify_milestone(self, excursion_id: int, kind: str) -> int:
        """День выезда: «группа выехала» (кто на месте, кто не пришёл) и «группа вернулась»."""
        messages: list[tuple[int, str]] = []
        with Session(engine) as session:
            excursion = session.get(Excursion, excursion_id)
            if not excursion:
                return 0
            now = (datetime.utcnow() + services.MSK).strftime("%H:%M")
            for student, parent, part in self._going_parents(session, excursion):
                if part.consent_status != ConsentStatus.APPROVED:
                    continue
                name = first_name(student.full_name)
                if kind == "departed":
                    if part.present is False:
                        came = "пришла" if is_female(student.full_name) else "пришёл"
                        text = (f"{quoted(excursion.title)}: группа выехала в {now}, а {name} не {came} на сбор. "
                                "Пожалуйста, свяжитесь с классным руководителем.")
                    elif part.present is True:
                        text = f"{quoted(excursion.title)}: группа выехала в {now}. {name} с классом."
                    else:
                        text = f"{quoted(excursion.title)}: группа выехала в {now}."
                else:
                    if part.present is False:
                        continue
                    text = f"{quoted(excursion.title)}: группа вернулась в {now}. Можно встречать {name}."
                messages.append((parent.max_user_id, text))
        sent = 0
        for user_id, text in messages:
            if await self.client.send_message(user_id=user_id, text=text) is not None:
                sent += 1
        return sent

    async def notify_cancelled(self, excursion_id: int) -> int:
        messages: list[tuple[int, str]] = []
        with Session(engine) as session:
            excursion = session.get(Excursion, excursion_id)
            if not excursion:
                return 0
            for student, parent, part in self._going_parents(session, excursion):
                if part.consent_status == ConsentStatus.REJECTED:
                    continue
                messages.append((parent.max_user_id,
                                 f"Выезд {quoted(excursion.title)} ({human_date(excursion.event_date)}) отменён. "
                                 f"{first_name(student.full_name)} остаётся на уроках по расписанию. "
                                 "Если вы уже купили билет — уточните у классного руководителя про возврат."))
        sent = 0
        for user_id, text in messages:
            if await self.client.send_message(user_id=user_id, text=text) is not None:
                sent += 1
        return sent

    async def invite_parents(self, excursion_id: int) -> int:
        """Персональное приглашение каждому подключённому родителю — с кнопками ответа."""
        sent = 0
        with Session(engine) as session:
            excursion = session.get(Excursion, excursion_id)
            if not excursion or excursion.cancelled:
                return 0
            cards = []
            for student, parent in services.invitation_targets(session, excursion):
                participant = services.get_participant(session, excursion.id, student.id)
                if not participant or participant.consent_status != ConsentStatus.PENDING:
                    continue
                text, keyboard = self._parent_card(excursion, student.full_name, participant)
                cards.append((parent.max_user_id, text, keyboard))
        for user_id, text, keyboard in cards:
            if await self.client.send_message(user_id=user_id, text=text, attachments=keyboard) is not None:
                sent += 1
        return sent

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
        when = services.msk_stamp(participant.signed_at)
        text = f"По выезду {quoted(excursion.title)} ({student.full_name}) {verdict} ({by}{', ' + when if when else ''})."
        for parent in others:
            if parent.is_virtual:
                continue
            await self.client.send_message(user_id=parent.max_user_id, text=text)

    async def notify_teacher_if_complete(self, excursion_id: int) -> bool:
        """Один раз сообщает учителю, что ответили все родители, и предлагает документы."""
        with Session(engine) as session:
            excursion = session.get(Excursion, excursion_id)
            if not excursion or excursion.teacher_notified_complete:
                return False
            klass = session.get(SchoolClass, excursion.class_id)
            teacher_id = (klass.teacher_max_id or klass.owner_user_id) if klass else None
            stats = services.excursion_summary(session, excursion)
            if not teacher_id or stats["waiting"] > 0 or stats["total"] == 0:
                return False
            excursion.teacher_notified_complete = True
            session.add(excursion)
            session.commit()
            title, class_title = excursion.title, klass.title
        text = (
            f"{class_title}, {quoted(title)}: ответили все родители.\n"
            f"Отпускают: {stats['going']}, не смогут: {stats['not_going']}.\n\n"
            "Готов проект приказа для директора, список группы, реестр согласий и ведомость инструктажа."
        )
        await self.client.send_message(user_id=teacher_id, text=text, attachments=[inline_keyboard([
            [callback_button("Получить документы", f"docs:{excursion_id}")],
            [app_button("Открыть выезд", f"trip_{excursion_id}")],
        ])])
        return True

    async def send_documents(self, session: Session, excursion: Excursion, user_id: int | None) -> bool:
        """Отправляет приказ (PDF и DOCX) файлами в личный чат с учителем."""
        from .documents import build_order_docx, build_order_pdf

        if not user_id or not self.client.enabled:
            return False
        klass = session.get(SchoolClass, excursion.class_id)
        stamp = excursion.event_date.strftime("%d.%m") if excursion.event_date else ""
        base = f"Приказ_{klass.title if klass else ''}_{stamp}".strip("_")
        files = [
            (f"{base}.pdf", build_order_pdf(session, excursion)),
            (f"{base}.docx", build_order_docx(session, excursion)),
        ]
        stats = services.excursion_summary(session, excursion)
        delivered = False
        for idx, (filename, content) in enumerate(files):
            token = await self.client.upload_file(content, filename)
            if not token:
                continue
            caption = ""
            if idx == 0:
                caption = (
                    f"Документы по выезду {quoted(excursion.title)}: приказ, список группы ({stats['going']} чел.), "
                    "реестр согласий и лист инструктажа. PDF — для печати, DOCX — если нужно поправить шапку."
                )
            result = await self.client.send_document(filename=filename, token=token, caption=caption,
                                                      user_id=user_id)
            delivered = delivered or result is not None
        return delivered

    async def remind(self, excursion: Excursion, session: Session) -> tuple[int, list[str]]:
        if excursion.cancelled:
            return 0, []
        targets = services.remind_targets(session, excursion)
        delivered: list[str] = []
        for t in targets:
            if not (t.get("max_user_id") and self.client.enabled):
                continue
            participant = services.get_participant(session, excursion.id, t["student_id"])
            if not participant:
                continue
            text, keyboard = self._parent_card(excursion, t["student_name"], participant)
            result = await self.client.send_message(user_id=t["max_user_id"], text="Напоминание\n\n" + text,
                                                    attachments=keyboard)
            if result is not None:
                delivered.append(t["student_name"])
        return len(targets), delivered

    async def send_auto_reminder(self, target: dict) -> bool:
        if not self.client.enabled:
            return False
        excursion: Excursion = target["excursion"]
        with Session(engine) as session:
            participant = services.get_participant(session, excursion.id, target["student_id"])
            if not participant:
                return False
            text, keyboard = self._parent_card(excursion, target["student_name"], participant)
        result = await self.client.send_message(user_id=target["max_user_id"], text="Напоминание\n\n" + text,
                                                attachments=keyboard)
        return result is not None

    def _consent_keyboard(self, excursion: Excursion, student_id: int) -> list[dict]:
        return self._consent_keyboard_raw(excursion.id, student_id)

    def _consent_keyboard_raw(self, excursion_id: int, student_id: int) -> list[dict]:
        approve = callback_button("✅ Да, пойдёт", f"consent:{excursion_id}:{student_id}:APPROVED")
        reject = callback_button("Нет, не пойдёт", f"consent:{excursion_id}:{student_id}:REJECTED")
        return [inline_keyboard([[approve], [reject]])]

    async def publish_to_chat(self, excursion: Excursion, chat_id: int) -> dict | None:
        lines = ["Новый выезд класса:", *self._trip_lines(excursion)]
        if excursion.deadline:
            lines.append(f"Ответить до: {human_deadline(excursion.deadline)}")
        lines.append("")
        lines.append("Родители, ответьте, пожалуйста, в ClassGo — одной кнопкой.")
        attachments = [inline_keyboard([[app_button("Ответить", f"trip_{excursion.id}")]])]
        return await self.client.send_message(chat_id=chat_id, text="\n".join(lines), attachments=attachments)

    async def tag_unactivated(self, excursion: Excursion, chat_id: int, names: list[str]) -> dict | None:
        listing = "\n".join(f"— {n}" for n in names)
        text = (
            f"По выезду {quoted(excursion.title)} ждём ответа родителей:\n"
            f"{listing}\n"
            "Откройте ClassGo, подтвердите номер телефона — и сразу увидите приглашение."
        )
        with Session(engine) as session:
            klass = session.get(SchoolClass, excursion.class_id)
            code = klass.invite_code if klass else None
        payload = f"join_{code}" if code else ""
        attachments = [inline_keyboard([[app_button("Подключиться", payload)]])]
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


__all__ = ["BotService", "class_chat_id", "TrafficLight"]
