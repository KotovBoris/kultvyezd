from datetime import date, datetime, time
from enum import Enum
from typing import List, Optional

from sqlmodel import Field, Relationship, SQLModel


class ConsentStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class TicketStatus(str, Enum):
    NOT_REQUIRED = "NOT_REQUIRED"
    WAITING_PAYMENT = "WAITING_PAYMENT"
    PAID = "PAID"


class ExcursionStatus(str, Enum):
    DRAFT = "DRAFT"
    VOTING = "VOTING"
    CLOSED = "CLOSED"


class TrafficLight(str, Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    GREY = "GREY"
    RED = "RED"


class AccessRole(str, Enum):
    OWNER = "OWNER"
    EDIT = "EDIT"
    READ = "READ"


class School(SQLModel, table=True):
    __tablename__ = "schools"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    city: str = ""
    number: str = ""
    owner_user_id: Optional[int] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SchoolAccess(SQLModel, table=True):
    __tablename__ = "school_access"

    id: Optional[int] = Field(default=None, primary_key=True)
    school_id: int = Field(foreign_key="schools.id", index=True)
    user_id: int = Field(index=True)
    role: AccessRole = Field(default=AccessRole.READ)


class SchoolClass(SQLModel, table=True):
    __tablename__ = "school_classes"

    id: Optional[int] = Field(default=None, primary_key=True)
    grade: str = Field(index=True)
    letter: str = ""
    school_id: Optional[int] = Field(default=None, foreign_key="schools.id", index=True)
    school_number: str = ""
    school_name: str = ""
    chat_id: Optional[int] = Field(default=None)
    owner_user_id: Optional[int] = Field(default=None, index=True)
    teacher_max_id: Optional[int] = None
    teacher_name: str = ""
    teacher_phone: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)

    students: List["Student"] = Relationship(back_populates="school_class")

    @property
    def title(self) -> str:
        return f"{self.grade}{self.letter}"


class ClassAccess(SQLModel, table=True):
    __tablename__ = "class_access"

    id: Optional[int] = Field(default=None, primary_key=True)
    class_id: int = Field(foreign_key="school_classes.id", index=True)
    user_id: int = Field(index=True)
    role: AccessRole = Field(default=AccessRole.READ)


class Student(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    class_id: int = Field(foreign_key="school_classes.id", index=True)
    full_name: str
    birth_date: Optional[date] = None

    school_class: Optional["SchoolClass"] = Relationship(back_populates="students")
    parents: List["ParentContact"] = Relationship(back_populates="student")


class ParentContact(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    student_id: int = Field(foreign_key="student.id", index=True)
    full_name: str = ""
    phone_number: str = Field(index=True)
    max_user_id: Optional[int] = Field(default=None, index=True)
    role: str = "Законный представитель"
    confirmed: bool = False
    notifications_enabled: bool = True

    student: Optional[Student] = Relationship(back_populates="parents")


class CultureEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    external_id: str = Field(index=True)
    title: str
    venue: str = ""
    city: str = Field(default="Казань", index=True)
    age_rating: str = "0+"
    event_date: Optional[date] = None
    duration_min: int = 90
    price: float = 0.0
    pushkin_eligible: bool = False
    is_free: bool = False
    ticket_url: str = ""
    address: str = ""
    description: str = ""
    source: str = "PRO.Культура.РФ (модельные данные, снапшот каталога)"


class Excursion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    class_id: int = Field(foreign_key="school_classes.id", index=True)
    culture_event_id: Optional[int] = Field(default=None, foreign_key="cultureevent.id")

    title: str
    location_name: str = ""
    address: str = ""
    event_date: Optional[date] = None
    gathering_time: Optional[time] = None
    return_time: Optional[time] = None
    deadline: Optional[datetime] = None

    ticket_price: float = 0.0
    ticket_sale_url: str = ""
    is_pushkin_card: bool = False

    status: ExcursionStatus = Field(default=ExcursionStatus.DRAFT)
    school_name: str = ""
    order_basis: str = "План воспитательной работы школы"
    responsible_teacher: str = ""

    created_at: datetime = Field(default_factory=datetime.utcnow)

    participants: List["ExcursionParticipant"] = Relationship(back_populates="excursion")


class ExcursionParticipant(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    excursion_id: int = Field(foreign_key="excursion.id", index=True)
    student_id: int = Field(foreign_key="student.id", index=True)

    consent_status: ConsentStatus = Field(default=ConsentStatus.PENDING)
    ticket_status: TicketStatus = Field(default=TicketStatus.NOT_REQUIRED)

    signed_by_phone: Optional[str] = None
    signed_by_name: Optional[str] = None
    signed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    ticket_number: Optional[str] = None

    excursion: Optional[Excursion] = Relationship(back_populates="participants")
    student: Optional[Student] = Relationship()


class ConsentAudit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    excursion_id: int = Field(index=True)
    student_id: int = Field(index=True)
    parent_phone: str = ""
    parent_name: str = ""
    action: str = ""
    reason: Optional[str] = None
    source: str = "bot"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DocumentArtifact(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    excursion_id: int = Field(index=True)
    kind: str = "order"
    version: int = 1
    filename: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class BotLinkCode(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True)
    student_id: int
    parent_phone: str = ""
    used: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ReminderLog(SQLModel, table=True):
    __tablename__ = "reminder_log"

    id: Optional[int] = Field(default=None, primary_key=True)
    excursion_id: int = Field(index=True)
    student_id: int = Field(index=True)
    kind: str = Field(index=True)
    sent_at: datetime = Field(default_factory=datetime.utcnow)
