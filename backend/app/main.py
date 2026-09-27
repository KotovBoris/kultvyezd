"""Точка входа: FastAPI-приложение «ClassGo» (модульный монолит).

Физически один контейнер, логически разделён на:
  • REST API ядра (домен)  — /api/v1/*
  • MAX Bot Adapter        — long polling / webhook + BotService
  • отдачу статики mini-app (в прод-образе кладётся в ./static)
Спецификация OpenAPI генерируется автоматически: /openapi.json, Swagger — /docs.
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openpyxl import load_workbook
from sqlmodel import Session, select

from . import __version__, services
from .bot import BotService
from .catalog_seed import SOURCE, seed_all
from .config import get_settings
from .db import Session, engine, get_session, init_db
from .documents import ATTACHMENTS, build_order_docx, build_order_pdf, normalize_attachments
from .max_client import BOT_COMMANDS
from .max_validate import is_fresh, validate_webapp_data


def _require_valid_parent(init_data: str | None) -> None:
    """Если включена проверка initData — действие родителя допускается только с валидной подписью.

    В демо-режиме (MAX_VALIDATE_INIT_DATA=false) проверка пропускается, чтобы проверяющий
    мог пройти сценарий без мессенджера.
    """
    if not settings.MAX_VALIDATE_INIT_DATA:
        return
    valid, _ = validate_webapp_data(init_data or "", settings.MAX_BOT_TOKEN)
    if not valid:
        raise HTTPException(status_code=401, detail="Недействительные данные мини-приложения (initData)")
from .models import (
    BotLinkCode,
    CultureEvent,
    DocumentArtifact,
    Excursion,
    ExcursionParticipant,
    ExcursionStatus,
    ParentContact,
    SchoolClass,
    Student,
    TicketStatus,
)
from .schemas import (
    ClassOut,
    ConsentRequest,
    ConsentResponse,
    CultureEventOut,
    DashboardOut,
    DocumentOut,
    ExcursionCreate,
    ExcursionOut,
    ImportResult,
    LinkCodeOut,
    ParticipantRow,
    RemindResponse,
    StudentOut,
    TicketConfirmRequest,
)

log = logging.getLogger("classgo")
settings = get_settings()

_poll_task: asyncio.Task | None = None


# ------------------------------------------------------------------ helpers
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


async def _poll_loop() -> None:
    """Long polling обновлений MAX (dev/test). Production — webhook."""
    bot = BotService()
    me = await bot.client.get_me()
    log.info("MAX polling запущен, бот: %s", (me or {}).get("name"))
    # Регистрируем команды бота в MAX (подсказки в интерфейсе мессенджера)
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _poll_task
    logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL, logging.INFO))
    init_db()
    if settings.AUTO_SEED:
        with Session(engine) as session:
            seed_all(session)
    if settings.bot_enabled and settings.MAX_BOT_MODE == "polling":
        _poll_task = asyncio.create_task(_poll_loop())
    yield
    if _poll_task:
        _poll_task.cancel()
        try:
            await _poll_task
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


# ================================================================== служебное
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
            "provenance": "модельные данные; реальная интеграция требует доступа к API PRO.Культура.РФ / СМЭВ",
            "is_mock": True,
        },
        "roles": ["teacher", "parent"],
        "max": {"api_base": settings.MAX_API_BASE, "bot_username": settings.MAX_BOT_USERNAME},
    }


# ================================================================== каталог
# Поле сортировки → колонка модели. Ключи RU/EN-алиасы, чтобы UI и API читались.
_SORT_COLUMNS = {
    "date": CultureEvent.event_date,
    "event_date": CultureEvent.event_date,
    "price": CultureEvent.price,
    "duration": CultureEvent.duration_min,
    "duration_min": CultureEvent.duration_min,
}


def _event_out(ev: CultureEvent) -> CultureEventOut:
    """ORM → схема ответа с явным полем age_min (нижняя граница ценза)."""
    return CultureEventOut(
        id=ev.id, title=ev.title, venue=ev.venue, city=ev.city, age_rating=ev.age_rating,
        event_date=ev.event_date, duration_min=ev.duration_min, price=ev.price,
        pushkin_eligible=ev.pushkin_eligible, is_free=ev.is_free, ticket_url=ev.ticket_url,
        address=ev.address, description=ev.description, source=ev.source,
        age_min=services.age_rating_min(ev.age_rating),
    )


@app.get("/api/v1/culture-events", response_model=list[CultureEventOut], tags=["catalog"])
def list_culture_events(
    city: str | None = Query(default=None),
    age: str | None = Query(default=None, description="Возрастной ценз: 0+, 6+, 12+, 16+"),
    pushkin: bool | None = Query(default=None),
    free: bool | None = Query(default=None),
    sort: str = Query(default="date", description="Сортировка: date (по умолчанию), price, duration"),
    order_by: str = Query(default="asc", description="Направление: asc или desc"),
    date_from: date | None = Query(default=None, description="События не раньше даты (YYYY-MM-DD)"),
    date_to: date | None = Query(default=None, description="События не позже даты (YYYY-MM-DD)"),
    class_id: int | None = Query(default=None, description="Класс для авто-фильтра по возрасту"),
    age_fit: bool = Query(default=False, description="Оставить только события, подходящие возрасту класса"),
    session: Session = Depends(get_session),
) -> list[CultureEventOut]:
    stmt = select(CultureEvent)
    if city:
        stmt = stmt.where(CultureEvent.city == city)
    if age:
        stmt = stmt.where(CultureEvent.age_rating == age)
    if pushkin is not None:
        stmt = stmt.where(CultureEvent.pushkin_eligible == pushkin)  # noqa: E712
    if free is not None:
        stmt = stmt.where(CultureEvent.is_free == free)  # noqa: E712
    if date_from is not None:
        stmt = stmt.where(CultureEvent.event_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(CultureEvent.event_date <= date_to)
    # Сортировка: неизвестное поле/направление не роняем, а откатываем к безопасным.
    column = _SORT_COLUMNS.get((sort or "date").lower(), CultureEvent.event_date)
    stmt = stmt.order_by(column.desc() if (order_by or "asc").lower() == "desc" else column.asc())
    events = [_event_out(ev) for ev in session.exec(stmt).all()]

    # Авто-фильтр «подходит моему классу по возрасту»: событие оставляем, только
    # если его ценз выдерживает самый младший ученик выбранного класса.
    if age_fit and class_id:
        klass = session.get(SchoolClass, class_id)
        if klass:
            students = session.exec(select(Student).where(Student.class_id == class_id)).all()
            youngest = services.youngest_age([s.birth_date for s in students], date.today())
            events = [e for e in events if services.event_age_fits(e.age_rating, youngest)]
    return events


# ================================================================== классы
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


def _normalize_phone(phone: str | None) -> str:
    """Канонизируем телефон для сравнения (только цифры), пустой → ''."""
    if not phone:
        return ""
    return "".join(ch for ch in str(phone) if ch.isdigit())


def _add_parent_contacts(session: Session, row: dict, student: Student, full_name: str) -> int:
    """Создаёт контакты родителей ученика из строки импорта (поддержка «двух родителей»).

    Логика:
    - специализированные колонки «мамы»/«папы» → роль и имя берём оттуда;
    - если специализированных нет, но есть общая колонка «Телефон родителя» → один
      контакт (роль «Законный представитель») — как раньше, чтобы не менять счётчик
      ``parents_created`` для старого формата CSV;
    - дубликаты телефонов не создаются, пустой телефон → контакт не создаётся.

    Возвращает фактическое число созданных контактов.
    """
    default_name = f"Родитель {full_name.split()[0]}"
    created = 0
    seen_phones: set[str] = set()

    def add(phone: str, name: str, role: str) -> None:
        nonlocal created
        key = _normalize_phone(phone)
        if not key or key in seen_phones:
            return
        seen_phones.add(key)
        session.add(ParentContact(student_id=student.id, phone_number=phone, full_name=name or default_name, role=role))
        created += 1

    mom_phone = _pick(row, "телефон мамы", "телефон мама", "телефон матери", "phone_mom", "mother_phone")
    dad_phone = _pick(row, "телефон папы", "телефон папа", "телефон отца", "phone_dad", "father_phone")
    generalized = _pick(row, "телефон родителя", "телефон", "phone")

    if mom_phone or dad_phone:
        mom_name = _pick(row, "фио мамы", "фио мама", "имя мамы", "mother_name")
        dad_name = _pick(row, "фио папы", "фио папа", "имя папы", "father_name")
        add(mom_phone, mom_name, "Мама")
        add(dad_phone, dad_name, "Папа")
        # общая колонка добавляется, только если телефоны не совпали со специализированными
        if generalized and any(
            _normalize_phone(p) == _normalize_phone(generalized) for p in (mom_phone, dad_phone) if p
        ):
            pass
        else:
            add(generalized, _pick(row, "фио родителя", "родитель", "parent"), "Законный представитель")
    else:
        add(generalized, _pick(row, "фио родителя", "родитель", "parent"), "Законный представитель")

    return created


@app.post("/api/v1/classes/import", response_model=ImportResult, tags=["classes"])
async def import_class(
    file: UploadFile = File(...),
    grade: str = Query(default="8"),
    letter: str = Query(default="А"),
    school_number: str = Query(default=""),
    school_name: str = Query(default=""),
    teacher_name: str = Query(default=""),
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
                        school_name=school_name, teacher_name=teacher_name)
    session.add(klass)
    session.commit()
    session.refresh(klass)

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
        parents_created += _add_parent_contacts(session, row, student, full_name)
    session.commit()
    return ImportResult(class_id=klass.id, title=klass.title, students_created=students_created,
                        parents_created=parents_created, skipped_rows=skipped[:20])


@app.get("/api/v1/classes", response_model=list[ClassOut], tags=["classes"])
def list_classes(session: Session = Depends(get_session)) -> list[ClassOut]:
    out: list[ClassOut] = []
    for k in session.exec(select(SchoolClass)).all():
        students = session.exec(select(Student).where(Student.class_id == k.id)).all()
        out.append(ClassOut(
            id=k.id, title=k.title, school_number=k.school_number, school_name=k.school_name,
            teacher_name=k.teacher_name,
            students=[StudentOut(
                id=s.id, full_name=s.full_name, birth_date=s.birth_date,
                parent_phones=[p.phone_number for p in session.exec(
                    select(ParentContact).where(ParentContact.student_id == s.id)).all()],
            ) for s in students],
        ))
    return out


@app.get("/api/v1/classes/{class_id}/roster", response_model=ClassOut, tags=["classes"])
def class_roster(class_id: int, session: Session = Depends(get_session)) -> ClassOut:
    k = session.get(SchoolClass, class_id)
    if not k:
        raise HTTPException(status_code=404, detail="Класс не найден")
    students = session.exec(select(Student).where(Student.class_id == k.id)).all()
    return ClassOut(
        id=k.id, title=k.title, school_number=k.school_number, school_name=k.school_name,
        teacher_name=k.teacher_name,
        students=[StudentOut(
            id=s.id, full_name=s.full_name, birth_date=s.birth_date,
            parent_phones=[p.phone_number for p in session.exec(
                select(ParentContact).where(ParentContact.student_id == s.id)).all()],
        ) for s in students],
    )


# ================================================================== выезды
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

    # Создаём участников по всем ученикам класса (статусы PENDING)
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


def _fmt_dt(value: datetime) -> str:
    """RFC 5545 (ICS): плавающее локальное время без зоны — YYYYMMDDTHHMMSS."""
    return value.strftime("%Y%m%dT%H%M%S")


def _ics_escape(value: str) -> str:
    """Экранирование текста для ICS: запятая, точка с запятой, слэш, перевод строки."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _build_ics(exc: Excursion, *, uid_key: str) -> str:
    """ICS-календарь для выезда: событие с датой/временем сбора и окончания.

    Без готового пикера времени берём ориентиры «09:00–15:00» на дату выезда;
    если дата не задана — сегодня, чтобы файл не был пустым. Оригинальная
    строка location_name в ICS не идёт — файл оборачивается в кавычки как
    quoted-printable-safe ASCII, это убирает проблему кодировки.
    """
    start = datetime.combine(exc.event_date or date.today(), time(9, 0))
    end = start + timedelta(hours=6)
    gather = exc.gathering_time.strftime("%H:%M") if exc.gathering_time else "уточняется"
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ClassGo//School Trips//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:classgo-{uid_key}-{exc.id}@classgo.local",
        f"DTSTAMP:{_fmt_dt(datetime.utcnow())}Z",
        f"DTSTART:{_fmt_dt(start)}",
        f"DTEND:{_fmt_dt(end)}",
        f"SUMMARY;LANGUAGE=ru:{_ics_escape(f'Выезд: {exc.title}')}",
        f"LOCATION;LANGUAGE=ru:{quote(exc.location_name or exc.address, safe='')}",
        f"DESCRIPTION;LANGUAGE=ru:{_ics_escape(f'Сбор: {gather}')}",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
    return "\r\n".join(lines)


@app.get("/api/v1/excursions/{excursion_id}/participants", tags=["excursions"])
def excursion_participants(excursion_id: int, session: Session = Depends(get_session)) -> dict:
    """Публичный экран родителя: ученик → участие (для mini-app по контексту)."""
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    data = services.dashboard(session, exc)
    return {"excursion": _excursion_out(exc).model_dump(mode="json"), "participants": data["participants"]}


# ================================================================== согласия
@app.post("/api/v1/excursions/{excursion_id}/consent", response_model=ConsentResponse, tags=["consent"])
def post_consent(excursion_id: int, payload: ConsentRequest, session: Session = Depends(get_session)) -> ConsentResponse:
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
            reason=payload.reason, source=payload.source, pdn_consent=payload.pdn_consent,
        )
    except ValueError as exc_err:
        raise HTTPException(status_code=404, detail=str(exc_err)) from exc_err
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
async def publish_excursion(excursion_id: int, chat_id: int = Query(...), session: Session = Depends(get_session)) -> dict:
    """Публикация карточки выезда в чат класса MAX (инлайн-кнопка открытия приложения)."""
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    bot = BotService()
    result = await bot.publish_to_chat(exc, chat_id)
    return {"ok": bool(result) or not settings.bot_enabled, "chat_id": chat_id}


# ================================================================== документы
def _attach_query(attach: str | None) -> list[str] | None:
    """Разбирает параметр ``attach`` (список ключей приложений через запятую).

    Пусто → ``None`` (все приложения, совместимость с прежним поведением).
    """
    if attach:
        return [k.strip() for k in attach.split(",") if k.strip()]
    return None


@app.get("/api/v1/documents/attachments", tags=["documents"])
def list_attachments() -> dict:
    """Каталог доступных приложений пакета документов: ключ → заголовок.

    Нужен UI, чтобы отрисовать флаги «какие приложения включать» перед генерацией.
    """
    return {"attachments": [{"key": k, "title": v} for k, v in ATTACHMENTS.items()]}


@app.post("/api/v1/excursions/{excursion_id}/export-order", response_model=DocumentOut, tags=["documents"])
def generate_order(excursion_id: int, attach: str | None = Query(default=None, description="Приложения через запятую"),
                   session: Session = Depends(get_session)) -> DocumentOut:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    keys = normalize_attachments(_attach_query(attach))
    last = session.exec(
        select(DocumentArtifact).where(DocumentArtifact.excursion_id == excursion_id)
    ).all()
    version = len(last) + 1
    filename = f"Приказ_выезд_{excursion_id}.docx"
    session.add(DocumentArtifact(excursion_id=excursion_id, kind="order", version=version, filename=filename))
    session.commit()
    base = settings.PUBLIC_BASE_URL.rstrip("/")
    suffix = f"&attach={','.join(keys)}" if attach else ""
    return DocumentOut(
        excursion_id=excursion_id,
        docx_url=f"{base}/api/v1/excursions/{excursion_id}/export-order?fmt=docx{suffix}",
        pdf_url=f"{base}/api/v1/excursions/{excursion_id}/export-order?fmt=pdf{suffix}",
        version=version,
        generated_at=datetime.utcnow(),
        attachments=keys,
    )


@app.get("/api/v1/excursions/{excursion_id}/export-order", tags=["documents"])
def download_order(excursion_id: int, fmt: str = Query(default="docx", pattern="^(docx|pdf)$"),
                   attach: str | None = Query(default=None, description="Приложения через запятую"),
                   session: Session = Depends(get_session)) -> Response:
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    keys = normalize_attachments(_attach_query(attach))
    if fmt == "pdf":
        content = build_order_pdf(session, exc, keys)
        return Response(content=content, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="order_{excursion_id}.pdf"'})
    content = build_order_docx(session, exc, keys)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="order_{excursion_id}.docx"'},
    )


@app.post("/api/v1/excursions/{excursion_id}/send-order", tags=["documents"])
async def send_order_to_chat(
    excursion_id: int,
    chat_id: int | None = Query(default=None, description="Чат класса; без него — в личку отправителю (user_id)"),
    user_id: int | None = Query(default=None, description="MAX user_id получателя (личка)"),
    fmt: str = Query(default="docx", pattern="^(docx|pdf)$"),
    attach: str | None = Query(default=None, description="Приложения через запятую"),
    session: Session = Depends(get_session),
) -> dict:
    """Отправляет сгенерированный приказ файлом в чат или личку MAX.

    Файл проходит через ``POST /uploads`` (внешние ссылки MAX запрещает) и
    уходит вложением типа ``file``. Если бот выключен или файл не загрузился,
    ``delivered=false`` — файл остаётся доступен прямой ссылкой на скачивание.
    """
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    if chat_id is None and user_id is None:
        raise HTTPException(status_code=422, detail="Укажите chat_id или user_id")
    keys = normalize_attachments(_attach_query(attach))
    bot = BotService()
    delivered = await bot.send_order_file(exc, fmt=fmt, chat_id=chat_id, user_id=user_id, attachments=keys)
    base = settings.PUBLIC_BASE_URL.rstrip("/")
    suffix = f"&attach={','.join(keys)}" if attach else ""
    return {
        "delivered": delivered,
        "chat_id": chat_id,
        "user_id": user_id,
        "fmt": fmt,
        "bot_enabled": settings.bot_enabled,
        "download_url": f"{base}/api/v1/excursions/{excursion_id}/export-order?fmt={fmt}{suffix}",
        "message": (
            "Приказ отправлен файлом в MAX."
            if delivered
            else "Файл не доставлен (бот выключен или MAX недоступен) — доступен по прямой ссылке."
        ),
    }


# ================================================================== мелочи: CSV/ICS
@app.get("/api/v1/excursions/{excursion_id}/participants.csv", tags=["excursions"])
def export_participants_csv(excursion_id: int, session: Session = Depends(get_session)) -> Response:
    """Экспорт списка участников в CSV (туроператору / в кассу).

    Колонки: место, ФИО, дата рождения, светофор, согласие, билет, номер билета,
    телефоны законных представителей. CSV с BOM — Excel корректно читает кириллицу.
    """
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["№", "ФИО", "Дата рождения", "Статус", "Согласие", "Билет", "Номер билета", "Телефоны родителей"]
    )
    for i, row in enumerate(services.roster_rows(session, exc), start=1):
        day = row["birth_date"].strftime("%d.%m.%Y") if row["birth_date"] else ""
        phones = "; ".join(f"{c['name']} ({c['role']}): {c['phone']}" for c in row["contacts"])
        writer.writerow(
            [i, row["full_name"], day, row["traffic_light"], row["consent_status"],
             row["ticket_status"], row["ticket_number"] or "", phones]
        )
    content = "\ufeff" + buf.getvalue()
    filename = f"classgo_excursion_{excursion_id}.csv"
    return Response(
        content=content.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/v1/excursions/{excursion_id}/emergency-contacts", tags=["excursions"])
def emergency_contacts(excursion_id: int, session: Session = Depends(get_session)) -> dict:
    """Сводный список телефонов родителей по выезду — для дня поездки.

    Плоский список контактов всех участников (дубликаты телефонов убраны):
    ФИО ребёнка, кто звонит (ФИО + роль) и номер. Данные уже в модели, вывод —
    безопасность в день выезда.
    """
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    contacts: list[dict] = []
    seen: set[str] = set()
    for row in services.roster_rows(session, exc):
        for c in row["contacts"]:
            if not c["phone"]:
                continue
            key = "".join(ch for ch in c["phone"] if ch.isdigit())
            if not key or key in seen:
                continue
            seen.add(key)
            contacts.append(
                {
                    "student_id": row["student_id"],
                    "student_name": row["full_name"],
                    "parent_name": c["name"],
                    "role": c["role"],
                    "phone": c["phone"],
                }
            )
    return {
        "excursion_id": excursion_id,
        "title": exc.title,
        "responsible_teacher": exc.responsible_teacher,
        "total": len(contacts),
        "contacts": contacts,
    }


@app.get("/api/v1/excursions/{excursion_id}/calendar.ics", tags=["excursions"])
def excursion_ics(excursion_id: int, session: Session = Depends(get_session)) -> Response:
    """Календарь (.ics) по выезду: родитель добавляет поездку в свой календарь."""
    exc = session.get(Excursion, excursion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Выезд не найден")
    ics = _build_ics(exc, uid_key="excursion")
    return Response(
        content=ics.encode("utf-8"),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="classgo_excursion_{excursion_id}.ics"'},
    )


# ================================================================== привязка родителя
@app.post("/api/v1/students/{student_id}/link-code", response_model=LinkCodeOut, tags=["consent"])
def create_link_code(
    student_id: int,
    parent_phone: str | None = Query(default=None, description="Телефон контакта родителя для привязки (если у ученика их несколько)"),
    role: str | None = Query(default=None, description="Роль контакта («Мама»/«Папа»/«Законный представитель»)"),
    session: Session = Depends(get_session),
) -> LinkCodeOut:
    """Выдаёт одноразовый код привязки родителя к ученику.

    Если у ученика несколько контактов («два родителя»), можно указать
    ``parent_phone`` (и/или ``role``), чтобы привязать именно нужный контакт.
    Без параметров — fallback на первый контакт (совместимость).
    """
    student = session.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")
    import secrets

    code = secrets.token_urlsafe(8)
    contacts = session.exec(select(ParentContact).where(ParentContact.student_id == student_id)).all()
    target = None
    if parent_phone:
        target = next((c for c in contacts if _normalize_phone(c.phone_number) == _normalize_phone(parent_phone)), None)
    if target is None and role:
        target = next((c for c in contacts if (c.role or "").lower() == role.lower()), None)
    if target is None:
        target = contacts[0] if contacts else None
    session.add(BotLinkCode(
        code=code,
        student_id=student_id,
        parent_phone=target.phone_number if target else "",
        role=target.role if target else "",
    ))
    session.commit()
    deep_link = f"https://max.ru/{settings.MAX_BOT_USERNAME}?start=bind_{code}"
    return LinkCodeOut(code=code, deep_link=deep_link, student_id=student_id)


@app.get("/api/v1/parent/context", tags=["consent"])
def parent_context(max_user_id: int = Query(..., description="MAX user_id родителя (после привязки)"),
                   session: Session = Depends(get_session)) -> dict:
    """Контекст родителя по его MAX user_id: дети и активные выезды со статусами.

    Позволяет открывать экран родителя без ручной подстановки student_id в ссылку —
    так это работает в реальном сценарии MAX (родитель просто написал боту).
    """
    children = services.parent_context(session, max_user_id)
    return {"max_user_id": max_user_id, "children": children, "found": bool(children)}


# ================================================================== demo-reset
@app.post("/api/v1/max/validate-init-data", tags=["max"])
def validate_init_data(payload: dict) -> dict:
    """Серверная валидация стартовых параметров мини-приложения MAX (initData/WebAppData).

    Тело: {"init_data": "<строка из window.WebApp.initData>"}.
    Возвращает валидность подписи и разобранные данные пользователя/чата.

    Алгоритм соответствует документации: https://dev.max.ru/docs/webapps/validation
    """
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
    """Сброс демонстрационного выезда: возвращает всех участников в статус «ожидает».

    Нужно, чтобы проверяющий мог прогнать сценарий много раз подряд на чистом состоянии.
    """
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
        p.pdn_consent_at = None
        p.pdn_consent_by = None
        session.add(p)
        changed += 1
    session.commit()
    return {"excursion_id": exc.id, "reset_participants": changed}


# ================================================================== webhook MAX
@app.post("/webhook/max", tags=["max"])
async def max_webhook(request: Request) -> JSONResponse:
    """Приём обновлений MAX (production-канал). Обрабатываем и одиночный Update, и список."""
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
