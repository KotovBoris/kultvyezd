"""Pydantic-схемы REST API (контракт описан в openapi.json и DATA-API.yaml)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from .models import ConsentStatus, ExcursionStatus, TicketStatus, TrafficLight


# ------------------------------------------------------------------ каталог
class CultureEventOut(BaseModel):
    id: int
    title: str
    venue: str
    city: str
    age_rating: str
    event_date: date | None
    duration_min: int
    price: float
    pushkin_eligible: bool
    is_free: bool
    ticket_url: str
    address: str
    description: str
    source: str


# ------------------------------------------------------------------ классы
class StudentOut(BaseModel):
    id: int
    full_name: str
    birth_date: date | None
    parent_phones: list[str] = Field(default_factory=list)


class ClassOut(BaseModel):
    id: int
    title: str
    school_number: str
    school_name: str
    teacher_name: str
    students: list[StudentOut] = Field(default_factory=list)


class ImportResult(BaseModel):
    class_id: int
    title: str
    students_created: int
    parents_created: int
    skipped_rows: list[str] = Field(default_factory=list)


# ------------------------------------------------------------------ выезды
class ExcursionCreate(BaseModel):
    class_id: int
    culture_event_id: int | None = None
    title: str | None = None
    location_name: str | None = None
    address: str | None = None
    event_date: date | None = None
    gathering_time: str | None = None  # "08:30"
    return_time: str | None = None  # "14:00"
    deadline: datetime | None = None
    ticket_price: float | None = None
    ticket_sale_url: str | None = None
    is_pushkin_card: bool | None = None
    order_basis: str | None = None


class ParticipantRow(BaseModel):
    student_id: int
    full_name: str
    traffic_light: TrafficLight
    consent_status: ConsentStatus
    ticket_status: TicketStatus
    signed_by_name: str | None = None
    signed_by_phone: str | None = None
    signed_at: datetime | None = None
    rejection_reason: str | None = None
    ticket_number: str | None = None


class ExcursionOut(BaseModel):
    id: int
    class_id: int
    title: str
    location_name: str
    address: str
    event_date: date | None
    gathering_time: str | None
    return_time: str | None
    deadline: datetime | None
    ticket_price: float
    ticket_sale_url: str
    is_pushkin_card: bool
    status: ExcursionStatus
    school_name: str
    responsible_teacher: str
    tree: str = "📋"


class DashboardOut(BaseModel):
    excursion: ExcursionOut
    summary: dict[str, int]
    progress_percent: int
    participants: list[ParticipantRow]


# ------------------------------------------------------------------ согласия
class ConsentRequest(BaseModel):
    student_id: int
    status: Literal["APPROVED", "REJECTED"]
    parent_phone: str = ""
    parent_name: str = ""
    reason: str | None = None
    source: str = "miniapp"
    # Стартовые параметры MAX Bridge (window.WebApp.initData). Проверяются только
    # если включена настройка MAX_VALIDATE_INIT_DATA (в проде).
    init_data: str | None = None


class ConsentResponse(BaseModel):
    student_id: int
    consent_status: ConsentStatus
    ticket_status: TicketStatus
    changed: bool
    message: str
    signed_by_name: str | None = None
    signed_at: datetime | None = None


class TicketConfirmRequest(BaseModel):
    student_id: int
    ticket_number: str | None = None
    source: str = "miniapp"


class RemindResponse(BaseModel):
    targeted: int
    delivered: int
    recipients: list[str] = Field(default_factory=list)


class DocumentOut(BaseModel):
    excursion_id: int
    docx_url: str
    pdf_url: str
    version: int
    generated_at: datetime


class LinkCodeOut(BaseModel):
    code: str
    deep_link: str
    student_id: int
    expires_in_min: int = 60
