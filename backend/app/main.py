"""Точка входа: FastAPI-приложение «КультВыезд» (модульный монолит).

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
from datetime import datetime, time

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
from .documents import build_order_docx, build_order_pdf
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

log = logging.getLogger("kultvyezd")
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
    title="КультВыезд API",
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
        "solution": "КультВыезд",
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
        for phone_key, name_key, role in (
            (("телефон родителя", "телефон", "phone", "телефон мамы", "телефон папы"), ("фио родителя", "родитель", "parent"), "Законный представитель"),
        ):
            phone = _pick(row, *phone_key)
            if phone:
                session.add(ParentContact(student_id=student.id, phone_number=phone,
                                          full_name=_pick(row, *name_key) or f"Родитель {full_name.split()[0]}",
                                          role=role))
                parents_created += 1
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


# ================================================================== привязка родителя
@app.post("/api/v1/students/{student_id}/link-code", response_model=LinkCodeOut, tags=["consent"])
def create_link_code(student_id: int, session: Session = Depends(get_session)) -> LinkCodeOut:
    student = session.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")
    import secrets

    code = secrets.token_urlsafe(8)
    parent = session.exec(select(ParentContact).where(ParentContact.student_id == student_id)).first()
    session.add(BotLinkCode(code=code, student_id=student_id, parent_phone=parent.phone_number if parent else ""))
    session.commit()
    deep_link = f"https://max.ru/{settings.MAX_BOT_USERNAME}?start=bind_{code}"
    return LinkCodeOut(code=code, deep_link=deep_link, student_id=student_id)


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
