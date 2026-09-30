from __future__ import annotations

from datetime import datetime, timedelta

from sqlmodel import Session, select

from .models import (
    ConsentAudit,
    ConsentStatus,
    Excursion,
    ExcursionParticipant,
    ExcursionStatus,
    ParentContact,
    ReminderLog,
    Student,
    TicketStatus,
    TrafficLight,
)

REMINDER_KINDS: dict[str, timedelta] = {
    "H72": timedelta(hours=72),
    "H24": timedelta(hours=24),
    "H12": timedelta(hours=12),
}


def compute_traffic_light(participant: ExcursionParticipant) -> TrafficLight:
    if participant.consent_status == ConsentStatus.REJECTED:
        return TrafficLight.RED
    if participant.consent_status == ConsentStatus.PENDING:
        return TrafficLight.GREY
    if participant.ticket_status in (TicketStatus.PAID, TicketStatus.NOT_REQUIRED):
        return TrafficLight.GREEN
    return TrafficLight.YELLOW


def parent_status(participant: ExcursionParticipant, bot_activated: bool) -> str:
    if participant.consent_status == ConsentStatus.APPROVED:
        return "APPROVED"
    if participant.consent_status == ConsentStatus.REJECTED:
        return "REJECTED"
    return "NO_ANSWER" if bot_activated else "BOT_INACTIVE"


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


def student_parents(session: Session, student_id: int) -> list[ParentContact]:
    return list(session.exec(select(ParentContact).where(ParentContact.student_id == student_id)).all())


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
    participant = get_participant(session, excursion.id, student_id)
    if participant is None:
        raise ValueError("Участник не найден в этом выезде")

    if participant.consent_status != ConsentStatus.PENDING:
        existing_by = participant.signed_by_name or "законный представитель"
        when = participant.signed_at.strftime("%d.%m в %H:%M") if participant.signed_at else "ранее"
        if participant.consent_status == ConsentStatus.APPROVED:
            msg = f"Согласие уже подписано ({existing_by}, {when}). Статус: Едет."
        else:
            msg = f"Уже зафиксирован отказ ({existing_by}, {when})."
        return participant, False, msg

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
        parents = student_parents(session, p.student_id)
        activated = any(pc.max_user_id for pc in parents)
        tl = compute_traffic_light(p)
        counts[tl.value] += 1
        rows.append(
            {
                "student_id": p.student_id,
                "full_name": student.full_name if student else f"#{p.student_id}",
                "traffic_light": tl,
                "consent_status": p.consent_status,
                "ticket_status": p.ticket_status,
                "bot_activated": activated,
                "parent_status": parent_status(p, activated),
                "signed_by_name": p.signed_by_name,
                "signed_by_phone": p.signed_by_phone,
                "signed_at": p.signed_at,
                "rejection_reason": p.rejection_reason,
                "ticket_number": p.ticket_number,
            }
        )
    total = len(parts) or 1
    ready = counts["GREEN"] + counts["RED"]
    return {
        "summary": counts,
        "progress_percent": round(100 * ready / total),
        "participants": rows,
    }


def remind_targets(session: Session, excursion: Excursion) -> list[dict]:
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
            select(ParentContact).where(
                ParentContact.student_id == p.student_id,
                ParentContact.max_user_id != None,  # noqa: E711
                ParentContact.notifications_enabled == True,  # noqa: E712
            )
        ).first()
        fallback = session.exec(
            select(ParentContact).where(ParentContact.student_id == p.student_id)
        ).first()
        targets.append(
            {
                "student_id": p.student_id,
                "student_name": student.full_name if student else "",
                "max_user_id": parent.max_user_id if parent else None,
                "phone": (parent or fallback).phone_number if (parent or fallback) else "",
                "traffic_light": tl,
            }
        )
    return targets


def unactivated_children(session: Session, excursion: Excursion) -> list[str]:
    names: list[str] = []
    parts = session.exec(
        select(ExcursionParticipant).where(ExcursionParticipant.excursion_id == excursion.id)
    ).all()
    for p in parts:
        if p.consent_status != ConsentStatus.PENDING:
            continue
        parents = student_parents(session, p.student_id)
        if any(pc.max_user_id for pc in parents):
            continue
        student = session.get(Student, p.student_id)
        if student:
            names.append(student.full_name)
    return names


def due_auto_reminders(session: Session, now: datetime | None = None) -> list[dict]:
    now = now or datetime.utcnow()
    due: list[dict] = []
    excursions = session.exec(
        select(Excursion).where(Excursion.status == ExcursionStatus.VOTING, Excursion.deadline != None)  # noqa: E711
    ).all()
    for exc in excursions:
        if exc.deadline <= now:
            continue
        for kind, offset in REMINDER_KINDS.items():
            if now < exc.deadline - offset:
                continue
            for target in remind_targets(session, exc):
                if not target["max_user_id"]:
                    continue
                already = session.exec(
                    select(ReminderLog).where(
                        ReminderLog.excursion_id == exc.id,
                        ReminderLog.student_id == target["student_id"],
                        ReminderLog.kind == kind,
                    )
                ).first()
                if already:
                    continue
                due.append({"excursion": exc, "kind": kind, **target})
    return due


def mark_reminder_sent(session: Session, excursion_id: int, student_id: int, kind: str) -> None:
    session.add(ReminderLog(excursion_id=excursion_id, student_id=student_id, kind=kind))
    session.commit()


def other_bound_parents(session: Session, student_id: int, exclude_user_id: int | None) -> list[ParentContact]:
    parents = session.exec(
        select(ParentContact).where(
            ParentContact.student_id == student_id,
            ParentContact.max_user_id != None,  # noqa: E711
            ParentContact.notifications_enabled == True,  # noqa: E712
        )
    ).all()
    return [p for p in parents if p.max_user_id != exclude_user_id]


def set_notifications(session: Session, max_user_id: int, enabled: bool) -> int:
    parents = session.exec(
        select(ParentContact).where(ParentContact.max_user_id == max_user_id)
    ).all()
    for p in parents:
        p.notifications_enabled = enabled
        session.add(p)
    session.commit()
    return len(parents)


def confirm_parent_link(session: Session, student_id: int, max_user_id: int, accept: bool) -> ParentContact | None:
    parent = session.exec(
        select(ParentContact).where(
            ParentContact.student_id == student_id, ParentContact.max_user_id == max_user_id
        )
    ).first()
    if not parent:
        return None
    if accept:
        parent.confirmed = True
    else:
        parent.max_user_id = None
        parent.confirmed = False
    session.add(parent)
    session.commit()
    session.refresh(parent)
    return parent


def parent_context(session: Session, max_user_id: int) -> list[dict]:
    parents = session.exec(select(ParentContact).where(ParentContact.max_user_id == max_user_id)).all()
    result: list[dict] = []
    for parent in parents:
        student = session.get(Student, parent.student_id)
        if not student:
            continue
        excursions = session.exec(
            select(Excursion).where(Excursion.class_id == student.class_id)
        ).all()
        items = []
        for exc in excursions:
            p = get_participant(session, exc.id, student.id)
            if not p:
                continue
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
                    "signed_at": p.signed_at,
                }
            )
        result.append(
            {
                "student_id": student.id,
                "student_name": student.full_name,
                "parent_name": parent.full_name,
                "parent_role": parent.role,
                "confirmed": parent.confirmed,
                "notifications_enabled": parent.notifications_enabled,
                "excursions": items,
            }
        )
    return result


def reminder_text(excursion: Excursion, student_name: str, tl: TrafficLight) -> str:
    if tl == TrafficLight.GREY:
        return (
            f"Напоминание по выезду «{excursion.title}».\n"
            f"{student_name}: участие ещё не подтверждено.\n"
            f"Нажмите «Отпускаю ребёнка» или «Не сможет поехать»."
        )
    return (
        f"Напоминание по выезду «{excursion.title}».\n"
        f"Согласие по {student_name} подписано, билет пока не отмечен.\n"
        f"Купите билет по ссылке в карточке и нажмите «Билет куплен»."
    )
