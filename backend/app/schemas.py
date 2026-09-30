from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from .models import AccessRole, ConsentStatus, ExcursionStatus, TicketStatus, TrafficLight


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


class SchoolOut(BaseModel):
    id: int
    name: str
    city: str
    number: str
    owner_user_id: int | None = None
    classes_count: int = 0


class SchoolCreate(BaseModel):
    name: str
    city: str = ""
    number: str = ""
    user_id: int | None = None


class ShareRequest(BaseModel):
    user_id: int
    role: Literal["EDIT", "READ"] = "READ"


class ShareOut(BaseModel):
    user_id: int
    role: AccessRole


class ParentOut(BaseModel):
    id: int
    full_name: str
    phone_number: str
    role: str
    confirmed: bool
    bot_activated: bool
    notifications_enabled: bool


class StudentOut(BaseModel):
    id: int
    full_name: str
    birth_date: date | None
    parent_phones: list[str] = Field(default_factory=list)
    parents: list[ParentOut] = Field(default_factory=list)


class StudentCreate(BaseModel):
    full_name: str
    birth_date: date | None = None
    parent_phone: str = ""
    parent_name: str = ""
    parent_role: str = "Законный представитель"


class ClassOut(BaseModel):
    id: int
    title: str
    school_id: int | None = None
    school_number: str
    school_name: str
    teacher_name: str
    chat_id: int | None = None
    owner_user_id: int | None = None
    can_edit: bool = True
    students: list[StudentOut] = Field(default_factory=list)


class ClassCreate(BaseModel):
    grade: str
    letter: str = ""
    school_id: int | None = None
    school_name: str = ""
    school_number: str = ""
    teacher_name: str = ""
    chat_id: int | None = None
    user_id: int | None = None
    students: list[StudentCreate] = Field(default_factory=list)


class ClassUpdate(BaseModel):
    grade: str | None = None
    letter: str | None = None
    school_id: int | None = None
    teacher_name: str | None = None
    chat_id: int | None = None
    user_id: int | None = None


class ImportResult(BaseModel):
    class_id: int
    title: str
    students_created: int
    parents_created: int
    skipped_rows: list[str] = Field(default_factory=list)


class ExcursionCreate(BaseModel):
    class_id: int
    culture_event_id: int | None = None
    title: str | None = None
    location_name: str | None = None
    address: str | None = None
    event_date: date | None = None
    gathering_time: str | None = None
    return_time: str | None = None
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
    bot_activated: bool = False
    parent_status: Literal["APPROVED", "REJECTED", "NO_ANSWER", "BOT_INACTIVE"] = "NO_ANSWER"
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


class DashboardOut(BaseModel):
    excursion: ExcursionOut
    summary: dict[str, int]
    progress_percent: int
    participants: list[ParticipantRow]


class ConsentRequest(BaseModel):
    student_id: int
    status: Literal["APPROVED", "REJECTED"]
    parent_phone: str = ""
    parent_name: str = ""
    reason: str | None = None
    source: str = "miniapp"
    max_user_id: int | None = None
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
    init_data: str | None = None


class RemindResponse(BaseModel):
    targeted: int
    delivered: int
    recipients: list[str] = Field(default_factory=list)


class LinkCodeOut(BaseModel):
    code: str
    deep_link: str
    student_id: int
    expires_in_min: int = 60


class DocumentOut(BaseModel):
    excursion_id: int
    docx_url: str
    pdf_url: str
    version: int
    generated_at: datetime


class ParentLinkAction(BaseModel):
    student_id: int
    max_user_id: int
    accept: bool = True


class ParentSearchRow(BaseModel):
    parent_id: int
    parent_name: str
    role: str
    phone: str
    student_id: int
    student_name: str
    class_title: str
    claimed: bool


class ParentClaimRequest(BaseModel):
    parent_id: int
    max_user_id: int


class NotificationsRequest(BaseModel):
    max_user_id: int
    enabled: bool
