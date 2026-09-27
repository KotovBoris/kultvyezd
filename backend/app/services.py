"""Бизнес-логика домена: «Светофор», фиксация согласий (ПЭП), билеты, напоминания.

Здесь сосредоточены правила из разделов 4–5 Продуктового описания:
- согласие привязано к ученику, повторное подписание исключено (ст. 64–65 СК РФ);
- сервис НЕ принимает деньги: только статус «билет куплен»;
- «Светофор»: зелёный/жёлтый/серый/красный.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlmodel import Session, select

from .models import (
    ConsentAudit,
    ConsentStatus,
    Excursion,
    ExcursionParticipant,
    ParentContact,
    Student,
    TicketStatus,
    TrafficLight,
)


def compute_traffic_light(participant: ExcursionParticipant) -> TrafficLight:
    if participant.consent_status == ConsentStatus.REJECTED:
        return TrafficLight.RED
    if participant.consent_status == ConsentStatus.PENDING:
        return TrafficLight.GREY
    # APPROVED
    if participant.ticket_status in (TicketStatus.PAID, TicketStatus.NOT_REQUIRED):
        return TrafficLight.GREEN
    return TrafficLight.YELLOW


def _ticket_status_for_approve(excursion: Excursion, current: TicketStatus) -> TicketStatus:
    if current == TicketStatus.PAID:
        return TicketStatus.PAID
    if excursion.ticket_price and excursion.ticket_price > 0:
        return TicketStatus.WAITING_PAYMENT
    return TicketStatus.NOT_REQUIRED


def get_participant(session: Session, excursion_id: int, student_id: int) -> ExcursionParticipant | None:
    return session.exec(
        select(ExcursionParticipant).where(
            ExcursionParticipant.excursion_id == excursion_id,
            ExcursionParticipant.student_id == student_id,
        )
    ).first()


def apply_consent(
    session: Session,
    excursion: Excursion,
    *,
    student_id: int,
    status: str,
    parent_phone: str = "",
    parent_name: str = "",
    reason: str | None = None,
    source: str = "api",
    pdn_consent: bool = False,
) -> tuple[ExcursionParticipant, bool, str]:
    """Идемпотентно фиксирует согласие/отказ.

    Возвращает (участник, changed, человекочитаемое сообщение).
    Повторное действие по уже подписанному согласию не перезаписывает статус.

    ``pdn_consent`` — отдельное согласие законного представителя на обработку
    персональных данных ребёнка (152-ФЗ). Фиксируется вместе с согласием на
    выезд и пишется отдельной записью в аудит (юридическая значимость).
    """
    participant = get_participant(session, excursion.id, student_id)
    if participant is None:
        raise ValueError("Участник не найден в этом выезде")

    # Правило «два родителя»: первое подписанное согласие блокирует статус.
    if participant.consent_status != ConsentStatus.PENDING:
        existing_by = participant.signed_by_name or "законный представитель"
        when = participant.signed_at.strftime("%d.%m в %H:%M") if participant.signed_at else "ранее"
        if participant.consent_status == ConsentStatus.APPROVED:
            msg = f"Согласие уже подписано ({existing_by}, {when}). Статус: Едет."
        else:
            msg = f"Уже зафиксирован отказ ({existing_by}, {when})."
        return participant, False, msg

    # Первичная фиксация
    if status == "APPROVED":
        participant.consent_status = ConsentStatus.APPROVED
        participant.ticket_status = _ticket_status_for_approve(excursion, participant.ticket_status)
        msg = "Согласие подписано. Билет можно оплатить напрямую в кассе."
    else:
        participant.consent_status = ConsentStatus.REJECTED
        participant.rejection_reason = reason or "Без указания причины"
        msg = "Отказ зафиксирован."

    participant.signed_by_phone = parent_phone or None
    participant.signed_by_name = parent_name or None
    participant.signed_at = datetime.utcnow()
    if status == "APPROVED" and pdn_consent:
        participant.pdn_consent_at = datetime.utcnow()
        participant.pdn_consent_by = parent_phone or parent_name or None

    session.add(participant)
    session.add(
        ConsentAudit(
            excursion_id=excursion.id,
            student_id=student_id,
            parent_phone=parent_phone,
            parent_name=parent_name,
            action="APPROVE" if status == "APPROVED" else "REJECT",
            reason=reason,
            source=source,
        )
    )
    if status == "APPROVED" and pdn_consent:
        # Отдельная запись аудита: согласие на ПДн — самостоятельное юридическое действие.
        session.add(
            ConsentAudit(
                excursion_id=excursion.id,
                student_id=student_id,
                parent_phone=parent_phone,
                parent_name=parent_name,
                action="PDN_CONSENT",
                source=source,
            )
        )
    session.commit()
    session.refresh(participant)
    return participant, True, msg


def confirm_ticket(
    session: Session, excursion: Excursion, *, student_id: int, ticket_number: str | None = None, source: str = "api"
) -> tuple[ExcursionParticipant, bool, str]:
    participant = get_participant(session, excursion.id, student_id)
    if participant is None:
        raise ValueError("Участник не найден в этом выезде")
    if participant.consent_status != ConsentStatus.APPROVED:
        return participant, False, "Сначала нужно подписать согласие."
    if participant.ticket_status == TicketStatus.PAID:
        return participant, False, "Билет уже отмечен как купленный."
    participant.ticket_status = TicketStatus.PAID
    participant.ticket_number = ticket_number or participant.ticket_number
    session.add(participant)
    session.add(
        ConsentAudit(
            excursion_id=excursion.id,
            student_id=student_id,
            action="TICKET_CONFIRM",
            source=source,
        )
    )
    session.commit()
    session.refresh(participant)
    return participant, True, "Билет отмечен как купленный."


def dashboard(session: Session, excursion: Excursion) -> dict:
    parts = session.exec(
        select(ExcursionParticipant).where(ExcursionParticipant.excursion_id == excursion.id)
    ).all()
    counts = {"GREEN": 0, "YELLOW": 0, "GREY": 0, "RED": 0}
    rows = []
    for p in parts:
        student = session.get(Student, p.student_id)
        tl = compute_traffic_light(p)
        counts[tl.value] += 1
        rows.append(
            {
                "student_id": p.student_id,
                "full_name": student.full_name if student else f"#{p.student_id}",
                "traffic_light": tl,
                "consent_status": p.consent_status,
                "ticket_status": p.ticket_status,
                "signed_by_name": p.signed_by_name,
                "signed_by_phone": p.signed_by_phone,
                "signed_at": p.signed_at,
                "rejection_reason": p.rejection_reason,
                "ticket_number": p.ticket_number,
                "pdn_consent_at": p.pdn_consent_at,
                "pdn_consent_by": p.pdn_consent_by,
            }
        )
    total = len(parts) or 1
    ready = counts["GREEN"] + counts["RED"]  # определившиеся
    return {
        "summary": counts,
        "progress_percent": round(100 * ready / total),
        "participants": rows,
    }


def roster_rows(session: Session, excursion: Excursion) -> list[dict]:
    """Строки списка класса для экспорта CSV и сводки экстренных телефонов.

    Один проход по участникам выезда: ФИО и дата рождения ученика, «светофор»,
    статусы согласия/билета и все контакты законных представителей с телефонами.
    Данные уже в модели — это дешёвая мелочь для туроператора/кассы и безопасности.
    """
    parts = session.exec(
        select(ExcursionParticipant).where(ExcursionParticipant.excursion_id == excursion.id)
    ).all()
    rows: list[dict] = []
    for p in parts:
        student = session.get(Student, p.student_id)
        contacts = session.exec(
            select(ParentContact).where(ParentContact.student_id == p.student_id)
        ).all()
        rows.append(
            {
                "student_id": p.student_id,
                "full_name": student.full_name if student else f"#{p.student_id}",
                "birth_date": student.birth_date if student else None,
                "traffic_light": compute_traffic_light(p).value,
                "consent_status": p.consent_status.value,
                "ticket_status": p.ticket_status.value,
                "ticket_number": p.ticket_number,
                "contacts": [
                    {"name": c.full_name, "phone": c.phone_number, "role": c.role} for c in contacts
                ],
            }
        )
    return rows


def remind_targets(session: Session, excursion: Excursion) -> list[dict]:
    """Родители детей со «серым» и «жёлтым» статусом — для точечных пушей."""
    parts = session.exec(
        select(ExcursionParticipant).where(ExcursionParticipant.excursion_id == excursion.id)
    ).all()
    targets = []
    for p in parts:
        tl = compute_traffic_light(p)
        if tl not in (TrafficLight.GREY, TrafficLight.YELLOW):
            continue
        student = session.get(Student, p.student_id)
        parent = session.exec(
            select(ParentContact).where(ParentContact.student_id == p.student_id)
        ).first()
        targets.append(
            {
                "student_id": p.student_id,
                "student_name": student.full_name if student else "",
                "max_user_id": parent.max_user_id if parent else None,
                "phone": parent.phone_number if parent else "",
                "traffic_light": tl,
            }
        )
    return targets


def _phones_match(a: str | None, b: str | None) -> bool:
    """Сравнение телефонов: точное совпадение либо совпадение цифр (форматы различаются)."""
    if not a or not b:
        return False
    if a == b:
        return True
    da = "".join(ch for ch in a if ch.isdigit())
    db = "".join(ch for ch in b if ch.isdigit())
    return bool(da) and da == db


def _contact_dict(contact: ParentContact) -> dict:
    return {
        "id": contact.id,
        "contact_id": contact.id,
        "full_name": contact.full_name,
        "phone_number": contact.phone_number,
        "role": contact.role,
        "max_user_id": contact.max_user_id,
    }


def parent_context(session: Session, max_user_id: int) -> list[dict]:
    """Контекст законного представителя по его MAX user_id (после привязки к боту).

    Возвращает список детей родителя и по каждому — активные выезды с текущим
    статусом согласия/билета. Это позволяет открывать экран родителя без
    ручной передачи student_id в ссылке (реалистичный продакшн-сценарий).

    Поддержка нескольких контактов на ученика: дети дедуплицируются по
    ``student_id`` (у ученика может быть и мама, и папа), а по каждому ребёнку
    отдаётся полный список контактов (``parents``) и по каждому выезду — список
    контактов с флагом ``is_signer`` («кто подписал»).
    """
    parents = session.exec(select(ParentContact).where(ParentContact.max_user_id == max_user_id)).all()
    result: list[dict] = []
    seen_students: set[int] = set()
    for parent in parents:
        if parent.student_id in seen_students:
            # один и тот же ребёнок уже добавлен (другой контакт того же ученика)
            continue
        student = session.get(Student, parent.student_id)
        if not student:
            continue
        seen_students.add(student.id)
        contacts = session.exec(
            select(ParentContact).where(ParentContact.student_id == student.id)
        ).all()
        contacts_payload = [_contact_dict(c) for c in contacts]
        excursions = session.exec(
            select(Excursion).where(Excursion.class_id == student.class_id)
        ).all()
        items = []
        for exc in excursions:
            p = get_participant(session, exc.id, student.id)
            if not p:
                continue
            signed = p.consent_status != ConsentStatus.PENDING
            signers = []
            for c in contacts:
                is_signer = bool(signed and _phones_match(p.signed_by_phone, c.phone_number))
                signers.append(
                    {
                        "contact_id": c.id,
                        "full_name": c.full_name,
                        "phone_number": c.phone_number,
                        "role": c.role,
                        "max_user_id": c.max_user_id,
                        "is_signer": is_signer,
                    }
                )
            items.append(
                {
                    "excursion_id": exc.id,
                    "title": exc.title,
                    "location_name": exc.location_name,
                    "event_date": exc.event_date,
                    "gathering_time": exc.gathering_time.strftime("%H:%M") if exc.gathering_time else None,
                    "return_time": exc.return_time.strftime("%H:%M") if exc.return_time else None,
                    "deadline": exc.deadline,
                    "ticket_price": exc.ticket_price,
                    "ticket_sale_url": exc.ticket_sale_url,
                    "is_pushkin_card": exc.is_pushkin_card,
                    "status": exc.status,
                    "traffic_light": compute_traffic_light(p).value,
                    "consent_status": p.consent_status.value,
                    "ticket_status": p.ticket_status.value,
                    "rejection_reason": p.rejection_reason,
                    "signed_by_name": p.signed_by_name,
                    "signed_by_phone": p.signed_by_phone,
                    "signed_at": p.signed_at,
                    "signers": signers,
                }
            )
        result.append(
            {
                "student_id": student.id,
                "student_name": student.full_name,
                "parent_name": parent.full_name,
                "parent_role": parent.role,
                "parent_contact_id": parent.id,
                "parents": contacts_payload,
                "excursions": items,
            }
        )
    return result


# ------------------------------------------------------------------ каталог
# Возрастной ценз события хранится строкой «12+» / «0+» / «16+». Разбираем её в
# нижнюю границу возраста и сопоставляем с возрастом самого младшего ученика класса.
AGE_RATINGS: tuple[str, ...] = ("0+", "6+", "12+", "16+")


def age_rating_min(age_rating: str) -> int:
    """Нижняя граница возрастного ценза: «12+» → 12. Неизвестное значение → 0."""
    digits = "".join(ch for ch in age_rating if ch.isdigit())
    return int(digits) if digits else 0


def age_on(birth: date | None, on: date) -> int:
    """Полных лет на дату `on`; None, если дата рождения неизвестна."""
    if birth is None:
        return 0
    years = on.year - birth.year
    if (on.month, on.day) < (birth.month, birth.day):
        years -= 1
    return max(years, 0)


def youngest_age(birth_dates, on: date) -> int | None:
    """Возраст самого младшего ученика (минимум по классу) на дату `on`.

    Авто-фильтр «подходит классу по возрасту» должен пропускать событие только
    тогда, когда его ценз выдерживает **каждый** ученик, поэтому берём минимум.
    Возвращает None, если нет ни одной известной даты рождения.
    """
    ages = [age_on(b, on) for b in birth_dates if b is not None]
    return min(ages) if ages else None


def event_age_fits(age_rating: str, youngest: int | None) -> bool:
    """Вписывается ли событие в возраст класса: ценз события ≤ возраст младшего."""
    if youngest is None:
        return True
    return age_rating_min(age_rating) <= youngest


def reminder_text(excursion: Excursion, student_name: str, tl: TrafficLight) -> str:
    if tl == TrafficLight.GREY:
        return (
            f"🔔 Напоминание по выезду «{excursion.title}»\n"
            f"{student_name} ещё не подтверждён(а).\n"
            f"Откройте бота и нажмите «Отпускаю ребёнка» или «Не сможет поехать»."
        )
    return (
        f"🔔 Напоминание по выезду «{excursion.title}»\n"
        f"Согласие по {student_name} подписано, но билет пока не отмечен.\n"
        f"Купите билет по ссылке в карточке и нажмите «Билет куплен»."
    )
