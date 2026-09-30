from __future__ import annotations

import asyncio
import csv
import io
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, time

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openpyxl import load_workbook
from sqlmodel import Session, select

from . import __version__, services
from .bot import BotService, class_chat_id
from .catalog_seed import SOURCE, seed_all
from .config import get_settings
from .db import Session, engine, get_session, init_db
from .documents import build_order_docx, build_order_pdf
from .max_client import BOT_COMMANDS
from .max_validate import is_fresh, validate_webapp_data
from .models import (
    AccessRole,
    BotLinkCode,
    ClassAccess,
    CultureEvent,
    DocumentArtifact,
    Excursion,
    ExcursionParticipant,
    ExcursionStatus,
    ParentContact,
    School,
    SchoolAccess,
    SchoolClass,
    Student,
    TicketStatus,
)
from .schemas import (
    ClassCreate,
    ClassOut,
    ClassUpdate,
    ConsentRequest,
    ConsentResponse,
    CultureEventOut,
    DashboardOut,
    DocumentOut,
    ExcursionCreate,
    ExcursionOut,
    ImportResult,
    LinkCodeOut,
    NotificationsRequest,
    ParentLinkAction,
    ParentOut,
    ParticipantRow,
    RemindResponse,
    SchoolCreate,
    SchoolOut,
    ShareOut,
    ShareRequest,
    StudentCreate,
    StudentOut,
    TicketConfirmRequest,
)

log = logging.getLogger("classgo")
settings = get_settings()

_poll_task: asyncio.Task | None = None
_reminder_task: asyncio.Task | None = None


def _require_valid_parent(init_data: str | None) -> None:
    if not settings.MAX_VALIDATE_INIT_DATA:
        return
    valid, _ = validate_webapp_data(init_data or "", settings.MAX_BOT_TOKEN)
    if not valid:
        raise HTTPException(status_code=401, detail="Недействительные данные мини-приложения (initData)")


def _time_from_str(value: str | None) -> time | None:
    if not value:
        return None
    try:
        hh, mm = value.split(":")[:2]
        return time(int(hh), int(mm))
    except Exception:  # noqa: BLE001
        return None


def _excursion_out(exc: Excursion) -> ExcursionOut:
    return ExcursionOut(
        id=exc.id, class_id=exc.class_id, title=exc.title, location_name=exc.location_name,
        address=exc.address, event_date=exc.event_date,
        gathering_time=exc.gathering_time.strftime("%H:%M") if exc.gathering_time else None,
        return_time=exc.return_time.strftime("%H:%M") if exc.return_time else None,
        deadline=exc.deadline, ticket_price=exc.ticket_price, ticket_sale_url=exc.ticket_sale_url,
        is_pushkin_card=exc.is_pushkin_card, status=exc.status, school_name=exc.school_name,
        responsible_teacher=exc.responsible_teacher,
    )


def _parent_out(p: ParentContact) -> ParentOut:
    return ParentOut(
        id=p.id, full_name=p.full_name, phone_number=p.phone_number, role=p.role,
        confirmed=p.confirmed, bot_activated=bool(p.max_user_id),
        notifications_enabled=p.notifications_enabled,
    )


def _student_out(session: Session, s: Student) -> StudentOut:
    parents = session.exec(select(ParentContact).where(ParentContact.student_id == s.id)).all()
    return StudentOut(
        id=s.id, full_name=s.full_name, birth_date=s.birth_date,
        parent_phones=[p.phone_number for p in parents],
        parents=[_parent_out(p) for p in parents],
    )


def _can_edit_class(session: Session, klass: SchoolClass, user_id: int | None) -> bool:
    if klass.owner_user_id is None:
        return True
    if user_id is None:
        return False
    if klass.owner_user_id == user_id:
        return True
    access = session.exec(
        select(ClassAccess).where(ClassAccess.class_id == klass.id, ClassAccess.user_id == user_id)
    ).first()
    return bool(access and access.role in (AccessRole.OWNER, AccessRole.EDIT))


def _can_edit_school(session: Session, school: School, user_id: int | None) -> bool:
    if school.owner_user_id is None:
        return True
    if user_id is None:
        return False
    if school.owner_user_id == user_id:
        return True
    access = session.exec(
        select(SchoolAccess).where(SchoolAccess.school_id == school.id, SchoolAccess.user_id == user_id)
    ).first()
    return bool(access and access.role in (AccessRole.OWNER, AccessRole.EDIT))


def _class_out(session: Session, k: SchoolClass, user_id: int | None = None) -> ClassOut:
    students = session.exec(select(Student).where(Student.class_id == k.id)).all()
    return ClassOut(
        id=k.id, title=k.title, school_id=k.school_id, school_number=k.school_number,
        school_name=k.school_name, teacher_name=k.teacher_name, chat_id=k.chat_id,
        owner_user_id=k.owner_user_id, can_edit=_can_edit_class(session, k, user_id),
        students=[_student_out(session, s) for s in students],
    )


async def _poll_loop() -> None:
    bot = BotService()
    me = await bot.client.get_me()
    log.info("MAX polling запущен, бот: %s", (me or {}).get("name"))
    registered = await bot.client.set_commands(BOT_COMMANDS)
    if registered is not None:
        log.info("Команды бота зарегистрированы в MAX: %s", ", ".join(c["name"] for c in BOT_COMMANDS))
    marker: int | None = None
    while True:
        try:
            data = await bot.client.get_updates(marker=marker, timeout=settings.POLL_TIMEOUT,
                                                types=["message_created", "message_callback", "bot_started"])
            marker = data.get("marker", marker)
            for update in data.get("updates") or []:
                await bot.handle_update(update)
        except asyncio.CancelledError:
            log.info("MAX polling остановлен")
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("Сбой polling: %s", exc)
            await asyncio.sleep(3)


async def _reminder_loop() -> None:
    bot = BotService()
    while True:
        try:
            with Session(engine) as session:
                due = services.due_auto_reminders(session)
                for target in due:
                    sent = await bot.send_auto_reminder(target)
                    if sent:
                        services.mark_reminder_sent(
                            session, target["excursion"].id, target["student_id"], target["kind"]
                        )
            await asyncio.sleep(settings.REMINDER_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("Сбой цикла напоминаний: %s", exc)
            await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _poll_task, _reminder_task
    logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL, logging.INFO))
    init_db()
    if settings.AUTO_SEED:
        with Session(engine) as session:
            seed_all(session)
    if settings.bot_enabled and settings.MAX_BOT_MODE == "polling":
        _poll_task = asyncio.create_task(_poll_loop())
    if settings.bot_enabled:
        _reminder_task = asyncio.create_task(_reminder_loop())
    yield
    for task in (_poll_task, _reminder_task):
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="ClassGo API",
    description=(
        "Сервис организации школьных культурных выездов. "
        "Данные каталога — модельные (см. поле source), внешняя интеграция с PRO.Культура.РФ заглушена."
    ),
    version=__version__,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/healthz", tags=["service"])
def healthz() -> dict:
    return {"status": "ok", "version": __version__, "bot_mode": settings.MAX_BOT_MODE,
            "bot_enabled": settings.bot_enabled, "time": datetime.utcnow().isoformat()}


@app.get("/api/v1/meta", tags=["service"])
def meta() -> dict:
    return {
        "solution": "ClassGo",
        "version": __version__,
        "dataset": {
            "catalog_source": SOURCE,
            "provenance": "модельные данные; реальная интеграция требует доступа к API PRO.Культура.РФ",
            "is_mock": True,
        },
        "roles": ["teacher", "parent"],
        "max": {"api_base": settings.MAX_API_BASE, "bot_username": settings.MAX_BOT_USERNAME},
    }


@app.get("/api/v1/culture-events", response_model=list[CultureEventOut], tags=["catalog"])
def list_culture_events(
    city: str | None = Query(default=None),
    age: str | None = Query(default=None, description="Возрастной ценз: 0+, 6+, 12+, 16+"),
    pushkin: bool | None = Query(default=None),
    free: bool | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[CultureEvent]:
    stmt = select(CultureEvent)
    if city:
        stmt = stmt.where(CultureEvent.city == city)
    if age:
        stmt = stmt.where(CultureEvent.age_rating == age)
    if pushkin is not None:
        stmt = stmt.where(CultureEvent.pushkin_eligible == pushkin)  # noqa: E712
    if free is not None:
        stmt = stmt.where(CultureEvent.is_free == free)  # noqa: E712
    return list(session.exec(stmt).all())


@app.get("/api/v1/schools", response_model=list[SchoolOut], tags=["schools"])
def list_schools(query: str | None = Query(default=None), session: Session = Depends(get_session)) -> list[SchoolOut]:
    stmt = select(School)
    schools = session.exec(stmt).all()
    if query:
        q = query.strip().lower()
        schools = [s for s in schools if q in s.name.lower() or q in s.city.lower() or q == s.number]
    out = []
    for s in schools:
        count = len(session.exec(select(SchoolClass).where(SchoolClass.school_id == s.id)).all())
        out.append(SchoolOut(id=s.id, name=s.name, city=s.city, number=s.number,
                             owner_user_id=s.owner_user_id, classes_count=count))
    return out


@app.post("/api/v1/schools", response_model=SchoolOut, status_code=201, tags=["schools"])
def create_school(payload: SchoolCreate, session: Session = Depends(get_session)) -> SchoolOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Название школы обязательно")
    existing = session.exec(select(School).where(School.name == name, School.city == payload.city)).first()
    if existing:
        return SchoolOut(id=existing.id, name=existing.name, city=existing.city, number=existing.number,
                         owner_user_id=existing.owner_user_id)
    school = School(name=name, city=payload.city, number=payload.number, owner_user_id=payload.user_id)
    session.add(school)
    session.commit()
    session.refresh(school)
    if payload.user_id:
        session.add(SchoolAccess(school_id=school.id, user_id=payload.user_id, role=AccessRole.OWNER))
        session.commit()
    return SchoolOut(id=school.id, name=school.name, city=school.city, number=school.number,
                     owner_user_id=school.owner_user_id)


@app.post("/api/v1/schools/{school_id}/share", response_model=ShareOut, tags=["schools"])
def share_school(school_id: int, payload: ShareRequest,
                 user_id: int | None = Query(default=None),
                 session: Session = Depends(get_session)) -> ShareOut:
    school = session.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="Школа не найдена")
    if not _can_edit_school(session, school, user_id):
        raise HTTPException(status_code=403, detail="Нет прав на управление школой")
    existing = session.exec(
        select(SchoolAccess).where(SchoolAccess.school_id == school_id, SchoolAccess.user_id == payload.user_id)
    ).first()
    if existing:
        existing.role = AccessRole(payload.role)
        session.add(existing)
    else:
        session.add(SchoolAccess(school_id=school_id, user_id=payload.user_id, role=AccessRole(payload.role)))
    session.commit()
    return ShareOut(user_id=payload.user_id, role=AccessRole(payload.role))


def _parse_rows(content: bytes, filename: str) -> list[dict]:
    rows: list[dict] = []
    if filename.lower().endswith(".xlsx") or filename.lower().endswith(".xlsm"):
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        headers = [str(c.value).strip().lower() if c.value else "" for c in next(ws.iter_rows(min_row=1, max_row=1))]
        for r in ws.iter_rows(min_row=2, values_only=True):
            if not any(r):
                continue
            rows.append(dict(zip(headers, [("" if v is None else str(v).strip()) for v in r])))
    else:
        text = content.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        for r in reader:
            rows.append({(k or "").strip().lower(): (v or "").strip() for k, v in r.items()})
    return rows


def _pick(row: dict, *keys: str) -> str:
    for k in keys:
        if k in row and row[k]:
            return str(row[k]).strip()
    return ""


def _apply_school(session: Session, klass: SchoolClass, school_id: int | None) -> None:
    if school_id is None:
        return
    school = session.get(School, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="Школа не найдена")
    klass.school_id = school.id
    klass.school_name = school.name
    klass.school_number = school.number


@app.post("/api/v1/classes/import", response_model=ImportResult, tags=["classes"])
async def import_class(
    file: UploadFile = File(...),
    grade: str = Query(default="8"),
    letter: str = Query(default="А"),
    school_id: int | None = Query(default=None),
    school_number: str = Query(default=""),
    school_name: str = Query(default=""),
    teacher_name: str = Query(default=""),
    user_id: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> ImportResult:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Пустой файл")
    try:
        rows = _parse_rows(content, file.filename or "upload.csv")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Не удалось разобрать файл: {exc}") from exc
    if not rows:
        raise HTTPException(status_code=400, detail="В файле не найдено строк данных")

    klass = SchoolClass(grade=grade, letter=letter, school_number=school_number,
                        school_name=school_name, teacher_name=teacher_name, owner_user_id=user_id)
    _apply_school(session, klass, school_id)
    session.add(klass)
    session.commit()
    session.refresh(klass)
    if user_id:
        session.add(ClassAccess(class_id=klass.id, user_id=user_id, role=AccessRole.OWNER))
        session.commit()

    students_created = parents_created = 0
    skipped: list[str] = []
    for i, row in enumerate(rows, start=2):
        full_name = _pick(row, "фио", "фио ребенка", "full_name", "ученик", "имя")
        if not full_name:
            skipped.append(f"строка {i}: нет ФИО")
            continue
        birth_raw = _pick(row, "дата рождения", "дата_рождения", "birth_date", "др")
        birth = None
        for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                birth = datetime.strptime(birth_raw, fmt).date()
                break
            except Exception:  # noqa: BLE001
                continue
        student = Student(class_id=klass.id, full_name=full_name, birth_date=birth)
        session.add(student)
        session.commit()
        session.refresh(student)
        students_created += 1
        phone = _pick(row, "телефон родителя", "телефон", "phone", "телефон мамы", "телефон папы")
        if phone:
            session.add(ParentContact(student_id=student.id, phone_number=phone,
                                      full_name=_pick(row, "фио родителя", "родитель", "parent")
                                      or f"Родитель {full_name.split()[0]}",
                                      role="Законный представитель"))
            parents_created += 1
    session.commit()
    return ImportResult(class_id=klass.id, title=klass.title, students_created=students_created,
                        parents_created=parents_created, skipped_rows=skipped[:20])


@app.post("/api/v1/classes", response_model=ClassOut, status_code=201, tags=["classes"])
def create_class(payload: ClassCreate, session: Session = Depends(get_session)) -> ClassOut:
    if not payload.grade.strip():
        raise HTTPException(status_code=422, detail="Параллель (grade) обязательна")
    klass = SchoolClass(
        grade=payload.grade.strip(), letter=payload.letter.strip(),
        school_number=payload.school_number, school_name=payload.school_name,
        teacher_name=payload.teacher_name, chat_id=payload.chat_id,
        owner_user_id=payload.user_id,
    )
    _apply_school(session, klass, payload.school_id)
    session.add(klass)
    session.commit()
    session.refresh(klass)
    if payload.user_id:
        session.add(ClassAccess(class_id=klass.id, user_id=payload.user_id, role=AccessRole.OWNER))
    for item in payload.students:
        student = Student(class_id=klass.id, full_name=item.full_name, birth_date=item.birth_date)
        session.add(student)
        session.commit()
        session.refresh(student)
        if item.parent_phone:
            session.add(ParentContact(
                student_id=student.id, phone_number=item.parent_phone,
                full_name=item.parent_name or f"Родитель {item.full_name.split()[0]}",
                role=item.parent_role,
            ))
    session.commit()
    return _class_out(session, klass, payload.user_id)


@app.get("/api/v1/classes", response_model=list[ClassOut], tags=["classes"])
def list_classes(user_id: int | None = Query(default=None),
                 session: Session = Depends(get_session)) -> list[ClassOut]:
    classes = session.exec(select(SchoolClass)).all()
    if user_id is not None:
        visible = []
        for k in classes:
            if k.owner_user_id is None or k.owner_user_id == user_id:
                visible.append(k)
                continue
            access = session.exec(
                select(ClassAccess).where(ClassAccess.class_id == k.id, ClassAccess.user_id == user_id)
            ).first()
            if access:
                visible.append(k)
        classes = visible
    return [_class_out(session, k, user_id) for k in classes]


@app.get("/api/v1/classes/{class_id}/roster", response_model=ClassOut, tags=["classes"])
def class_roster(class_id: int, user_id: int | None = Query(default=None),
                 session: Session = Depends(get_session)) -> ClassOut:
    k = session.get(SchoolClass, class_id)
    if not k:
        raise HTTPException(status_code=404, detail="Класс не найден")
    return _class_out(session, k, user_id)


@app.patch("/api/v1/classes/{class_id}", response_model=ClassOut, tags=["classes"])
def update_class(class_id: int, payload: ClassUpdate, session: Session = Depends(get_session)) -> ClassOut:
    k = session.get(SchoolClass, class_id)
    if not k:
        raise HTTPException(status_code=404, detail="Класс не найден")
    if not _can_edit_class(session, k, payload.user_id):
        raise HTTPException(status_code=403, detail="Нет прав на редактирование класса")
    if payload.grade is not None:
        k.grade = payload.grade.strip()
    if payload.letter is not None:
        k.letter = payload.letter.strip()
    if payload.teacher_name is not None:
        k.teacher_name = payload.teacher_name
    if payload.chat_id is not None:
        k.chat_id = payload.chat_id or None
    _apply_school(session, k, payload.school_id)
    session.add(k)
    session.commit()
    session.refresh(k)
    return _class_out(session, k, payload.user_id)


@app.post("/api/v1/classes/{class_id}/students", response_model=StudentOut, status_code=201, tags=["classes"])
def add_student(class_id: int, payload: StudentCreate,
                user_id: int | None = Query(default=None),
                session: Session = Depends(get_session)) -> StudentOut:
    k = session.get(SchoolClass, class_id)
    if not k:
        raise HTTPException(status_code=404, detail="Класс не найден")
    if not _can_edit_class(session, k, user_id):
        raise HTTPException(status_code=403, detail="Нет прав на редактирование класса")
    if not payload.full_name.strip():
        raise HTTPException(status_code=422, detail="ФИО обязательно")
    student = Student(class_id=class_id, full_name=payload.full_name.strip(), birth_date=payload.birth_date)
    session.add(student)
    session.commit()
    session.refresh(student)
    if payload.parent_phone:
        session.add(ParentContact(
            student_id=student.id, phone_number=payload.parent_phone,
            full_name=payload.parent_name or f"Родитель {student.full_name.split()[0]}",
            role=payload.parent_role,
        ))
        session.commit()
    for exc in session.exec(select(Excursion).where(Excursion.class_id == class_id)).all():
        if not services.get_participant(session, exc.id, student.id):
            session.add(ExcursionParticipant(
                excursion_id=exc.id, student_id=student.id,
                consent_status="PENDING",
                ticket_status=TicketStatus.NOT_REQUIRED if (exc.ticket_price or 0) == 0 else TicketStatus.WAITING_PAYMENT,
            ))
    session.commit()
    return _student_out(session, student)


@app.delete("/api/v1/classes/{class_id}/students/{student_id}", tags=["classes"])
def remove_student(class_id: int, student_id: int,
                   user_id: int | None = Query(default=None),
                   session: Session = Depends(get_session)) -> dict:
    k = session.get(SchoolClass, class_id)
    if not k:
        raise HTTPException(status_code=404, detail="Класс не найден")
    if not _can_edit_class(session, k, user_id):
        raise HTTPException(status_code=403, detail="Нет прав на редактирование класса")
    student = session.get(Student, student_id)
    if not student or student.class_id != class_id:
        raise HTTPException(status_code=404, detail="Ученик не найден в этом классе")
    for p in session.exec(select(ExcursionParticipant).where(ExcursionParticipant.student_id == student_id)).all():
        session.delete(p)
    for pc in session.exec(select(ParentContact).where(ParentContact.student_id == student_id)).all():
        session.delete(pc)
    session.delete(student)
    session.commit()
    return {"ok": True, "student_id": student_id}


@app.post("/api/v1/classes/{class_id}/share", response_model=ShareOut, tags=["classes"])
def share_class(class_id: int, payload: ShareRequest,
                user_id: int | None = Query(default=None),
                session: Session = Depends(get_session)) -> ShareOut:
    k = session.get(SchoolClass, class_id)
    if not k:
        raise HTTPException(status_code=404, detail="Класс не найден")
    if not _can_edit_class(session, k, user_id):
        raise HTTPException(status_code=403, detail="Нет прав на управление классом")
    existing = session.exec(
        select(ClassAccess).where(ClassAccess.class_id == class_id, ClassAccess.user_id == payload.user_id)
    ).first()
    if existing:
        existing.role = AccessRole(payload.role)
        session.add(existing)
    else:
        session.add(ClassAccess(class_id=class_id, user_id=payload.user_id, role=AccessRole(payload.role)))
    session.commit()
    return ShareOut(user_id=payload.user_id, role=AccessRole(payload.role))


@app.post("/api/v1/excursions", response_model=ExcursionOut, status_code=201, tags=["excursions"])
def create_excursion(payload: ExcursionCreate, session: Session = Depends(get_session)) -> ExcursionOut:
    klass = session.get(SchoolClass, payload.class_id)
    if not klass:
        raise HTTPException(status_code=404, detail="Класс не найден")
    event = session.get(CultureEvent, payload.culture_event_id) if payload.culture_event_id else None

    exc = Excursion(
        class_id=klass.id,
        culture_event_id=event.id if event else None,
        title=payload.title or (event.title if event else "Культурный выезд"),
        location_name=payload.location_name or (event.venue if event else ""),
        address=payload.address or (event.address if event else ""),
        event_date=payload.event_date or (event.event_date if event else None),
        gathering_time=_time_from_str(payload.gathering_time),
        return_time=_time_from_str(payload.return_time),
        deadline=payload.deadline,
        ticket_price=payload.ticket_price if payload.ticket_price is not None else (event.price if event else 0.0),
        ticket_sale_url=payload.ticket_sale_url or (event.ticket_url if event else ""),
        is_pushkin_card=payload.is_pushkin_card if payload.is_pushkin_card is not None else (event.pushkin_eligible if event else False),
        status=ExcursionStatus.VOTING,
        school_name=klass.school_name,
        responsible_teacher=klass.teacher_name,
        order_basis=payload.order_basis or "план воспитательной работы",
    )
    session.add(exc)
    session.commit()
    session.refresh(exc)

    for s in session.exec(select(Student).where(Student.class_id == klass.id)).all():
        session.add(ExcursionParticipant(
            excursion_id=exc.id, student_id=s.id,
            consent_status="PENDING",
            ticket_status=TicketStatus.NOT_REQUIRED if (exc.ticket_price or 0) == 0 else TicketStatus.WAITING_PAYMENT,
        ))
    session.commit()
    return _excursion_out(exc)


@app.get("/api/v1/excursions", response_model=list[ExcursionOut], tags=["excursions"])
def list_excursions(session: Session = Depends(get_session)) -> list[ExcursionOut]:
    return [_excursion_out(e) for e in session.exec(select(Excursion)).all()]


@app.get("/api/v1/excursions/{excursion_id}", response_model=ExcursionOut, tags=["excursions"])
def get_excursion(excursion_id: int, session: Session = Depends(get_session)) -> ExcursionOut:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    return _excursion_out(exc)


@app.get("/api/v1/excursions/{excursion_id}/dashboard", response_model=DashboardOut, tags=["excursions"])
def excursion_dashboard(excursion_id: int, session: Session = Depends(get_session)) -> DashboardOut:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    data = services.dashboard(session, exc)
    return DashboardOut(
        excursion=_excursion_out(exc),
        summary=data["summary"],
        progress_percent=data["progress_percent"],
        participants=[ParticipantRow(**row) for row in data["participants"]],
    )


@app.get("/api/v1/excursions/{excursion_id}/participants", tags=["excursions"])
def excursion_participants(excursion_id: int, session: Session = Depends(get_session)) -> dict:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    data = services.dashboard(session, exc)
    return {"excursion": _excursion_out(exc).model_dump(mode="json"), "participants": data["participants"]}


@app.post("/api/v1/excursions/{excursion_id}/consent", response_model=ConsentResponse, tags=["consent"])
async def post_consent(excursion_id: int, payload: ConsentRequest, session: Session = Depends(get_session)) -> ConsentResponse:
    _require_valid_parent(payload.init_data)
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    if payload.status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=422, detail="status должен быть APPROVED или REJECTED")
    try:
        p, changed, message = services.apply_consent(
            session, exc, student_id=payload.student_id, status=payload.status,
            parent_phone=payload.parent_phone, parent_name=payload.parent_name,
            reason=payload.reason, source=payload.source,
        )
    except ValueError as exc_err:
        raise HTTPException(status_code=404, detail=str(exc_err)) from exc_err
    if changed:
        try:
            await BotService().notify_consent(excursion_id, payload.student_id,
                                              exclude_user_id=payload.max_user_id)
        except Exception:  # noqa: BLE001
            log.warning("Не удалось уведомить второго родителя по выезду %s", excursion_id)
    return ConsentResponse(
        student_id=p.student_id, consent_status=p.consent_status, ticket_status=p.ticket_status,
        changed=changed, message=message, signed_by_name=p.signed_by_name, signed_at=p.signed_at,
    )


@app.post("/api/v1/excursions/{excursion_id}/ticket-confirm", response_model=ConsentResponse, tags=["consent"])
def post_ticket_confirm(excursion_id: int, payload: TicketConfirmRequest, session: Session = Depends(get_session)) -> ConsentResponse:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    try:
        p, changed, message = services.confirm_ticket(
            session, exc, student_id=payload.student_id, ticket_number=payload.ticket_number,
            source=payload.source,
        )
    except ValueError as exc_err:
        raise HTTPException(status_code=404, detail=str(exc_err)) from exc_err
    return ConsentResponse(
        student_id=p.student_id, consent_status=p.consent_status, ticket_status=p.ticket_status,
        changed=changed, message=message, signed_by_name=p.signed_by_name, signed_at=p.signed_at,
    )


@app.post("/api/v1/excursions/{excursion_id}/remind-unconfirmed", response_model=RemindResponse, tags=["consent"])
async def remind_unconfirmed(excursion_id: int, session: Session = Depends(get_session)) -> RemindResponse:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    bot = BotService()
    targeted, delivered = await bot.remind(exc, session)
    return RemindResponse(targeted=targeted, delivered=len(delivered), recipients=delivered)


@app.post("/api/v1/excursions/{excursion_id}/publish", tags=["consent"])
async def publish_excursion(excursion_id: int, chat_id: int | None = Query(default=None),
                            session: Session = Depends(get_session)) -> dict:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    target_chat = chat_id if chat_id is not None else class_chat_id(session, exc)
    if target_chat is None:
        raise HTTPException(status_code=400, detail="У класса не указан чат. Задайте chat_id в разделе «Классы».")
    bot = BotService()
    result = await bot.publish_to_chat(exc, target_chat)
    return {"ok": bool(result) or not settings.bot_enabled, "chat_id": target_chat,
            "delivered": bool(result)}


@app.post("/api/v1/excursions/{excursion_id}/tag-unactivated", tags=["consent"])
async def tag_unactivated(excursion_id: int, chat_id: int | None = Query(default=None),
                          session: Session = Depends(get_session)) -> dict:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    names = services.unactivated_children(session, exc)
    if not names:
        return {"ok": True, "tagged": 0, "names": [], "delivered": False}
    target_chat = chat_id if chat_id is not None else class_chat_id(session, exc)
    if target_chat is None:
        raise HTTPException(status_code=400, detail="У класса не указан чат. Задайте chat_id в разделе «Классы».")
    bot = BotService()
    result = await bot.tag_unactivated(exc, target_chat, names)
    return {"ok": bool(result) or not settings.bot_enabled, "tagged": len(names),
            "names": names, "delivered": bool(result)}


@app.post("/api/v1/excursions/{excursion_id}/export-order", response_model=DocumentOut, tags=["documents"])
def generate_order(excursion_id: int, session: Session = Depends(get_session)) -> DocumentOut:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    last = session.exec(
        select(DocumentArtifact).where(DocumentArtifact.excursion_id == excursion_id)
    ).all()
    version = len(last) + 1
    filename = f"Приказ_выезд_{excursion_id}.docx"
    session.add(DocumentArtifact(excursion_id=excursion_id, kind="order", version=version, filename=filename))
    session.commit()
    base = settings.PUBLIC_BASE_URL.rstrip("/")
    return DocumentOut(
        excursion_id=excursion_id,
        docx_url=f"{base}/api/v1/excursions/{excursion_id}/export-order?fmt=docx",
        pdf_url=f"{base}/api/v1/excursions/{excursion_id}/export-order?fmt=pdf",
        version=version,
        generated_at=datetime.utcnow(),
    )


@app.get("/api/v1/excursions/{excursion_id}/export-order", tags=["documents"])
def download_order(excursion_id: int, fmt: str = Query(default="docx", pattern="^(docx|pdf)$"),
                   session: Session = Depends(get_session)) -> Response:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    if fmt == "pdf":
        content = build_order_pdf(session, exc)
        return Response(content=content, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="order_{excursion_id}.pdf"'})
    content = build_order_docx(session, exc)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="order_{excursion_id}.docx"'},
    )


@app.post("/api/v1/students/{student_id}/link-code", response_model=LinkCodeOut, tags=["consent"])
def create_link_code(student_id: int, session: Session = Depends(get_session)) -> LinkCodeOut:
    student = session.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")
    code = secrets.token_urlsafe(8)
    parent = session.exec(select(ParentContact).where(ParentContact.student_id == student_id)).first()
    session.add(BotLinkCode(code=code, student_id=student_id, parent_phone=parent.phone_number if parent else ""))
    session.commit()
    deep_link = f"https://max.ru/{settings.MAX_BOT_USERNAME}?start=bind_{code}"
    return LinkCodeOut(code=code, deep_link=deep_link, student_id=student_id)


@app.get("/api/v1/parent/context", tags=["parent"])
def parent_context(max_user_id: int = Query(..., description="MAX user_id родителя (после привязки)"),
                   session: Session = Depends(get_session)) -> dict:
    children = services.parent_context(session, max_user_id)
    return {"max_user_id": max_user_id, "children": children, "found": bool(children)}


@app.post("/api/v1/parent/confirm-link", tags=["parent"])
def parent_confirm_link(payload: ParentLinkAction, session: Session = Depends(get_session)) -> dict:
    parent = services.confirm_parent_link(session, payload.student_id, payload.max_user_id, payload.accept)
    if not parent:
        raise HTTPException(status_code=404, detail="Привязка не найдена")
    return {"ok": True, "confirmed": parent.confirmed,
            "linked": parent.max_user_id is not None}


@app.post("/api/v1/parent/notifications", tags=["parent"])
def parent_notifications(payload: NotificationsRequest, session: Session = Depends(get_session)) -> dict:
    affected = services.set_notifications(session, payload.max_user_id, payload.enabled)
    return {"ok": True, "enabled": payload.enabled, "affected": affected}


@app.post("/api/v1/max/validate-init-data", tags=["max"])
def validate_init_data(payload: dict) -> dict:
    init_data = (payload or {}).get("init_data", "")
    if not settings.MAX_BOT_TOKEN:
        return {"valid": False, "reason": "bot_token_not_configured"}
    valid, fields = validate_webapp_data(init_data, settings.MAX_BOT_TOKEN)
    return {
        "valid": valid,
        "fresh": is_fresh(fields.get("auth_date")),
        "user": fields.get("user"),
        "chat": fields.get("chat"),
    }


@app.post("/api/v1/admin/reset-demo", tags=["service"])
def reset_demo(session: Session = Depends(get_session)) -> dict:
    exc = session.exec(select(Excursion)).first()
    if not exc:
        raise HTTPException(status_code=404, detail="Демо-выезд не создан")
    changed = 0
    for p in session.exec(select(ExcursionParticipant).where(ExcursionParticipant.excursion_id == exc.id)).all():
        p.consent_status = "PENDING"
        p.ticket_status = TicketStatus.WAITING_PAYMENT if (exc.ticket_price or 0) > 0 else TicketStatus.NOT_REQUIRED
        p.signed_at = None
        p.signed_by_name = None
        p.signed_by_phone = None
        p.rejection_reason = None
        p.ticket_number = None
        session.add(p)
        changed += 1
    session.commit()
    return {"excursion_id": exc.id, "reset_participants": changed}


@app.post("/webhook/max", tags=["max"])
async def max_webhook(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": "invalid json"}, status_code=400)
    updates = payload if isinstance(payload, list) else [payload]
    bot = BotService()
    processed = 0
    for update in updates:
        if isinstance(update, dict) and update.get("update_type"):
            await bot.handle_update(update)
            processed += 1
    return JSONResponse({"ok": True, "processed": processed})
