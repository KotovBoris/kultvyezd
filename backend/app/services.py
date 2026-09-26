"""Бизнес-логика домена: «Светофор», фиксация согласий (ПЭП), билеты, напоминания.

Здесь сосредоточены правила из разделов 4–5 Продуктового описания:
- согласие привязано к ученику, повторное подписание исключено (ст. 64–65 СК РФ);
- сервис НЕ принимает деньги: только статус «билет куплен»;
- «Светофор»: зелёный/жёлтый/серый/красный.
"""
from __future__ import annotations

from datetime import datetime

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
) -> tuple[ExcursionParticipant, bool, str]:
    """Идемпотентно фиксирует согласие/отказ.

    Возвращает (участник, changed, человекочитаемое сообщение).
    Повторное действие по уже подписанному согласию не перезаписывает статус.
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
            }
        )
    total = len(parts) or 1
    ready = counts["GREEN"] + counts["RED"]  # определившиеся
    return {
        "summary": counts,
        "progress_percent": round(100 * ready / total),
        "participants": rows,
    }


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
