from __future__ import annotations

import io
from datetime import datetime

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib import colors
from sqlmodel import Session, select

from .models import ConsentStatus, Excursion, ExcursionParticipant, ParentContact, Student


def _collect(session: Session, excursion: Excursion) -> list[dict]:
    rows: list[dict] = []
    parts = session.exec(
        select(ExcursionParticipant).where(
            ExcursionParticipant.excursion_id == excursion.id,
            ExcursionParticipant.consent_status == ConsentStatus.APPROVED,
        )
    ).all()
    for p in parts:
        student = session.get(Student, p.student_id)
        parent = session.exec(
            select(ParentContact).where(ParentContact.student_id == p.student_id)
        ).first()
        rows.append(
            {
                "name": student.full_name if student else f"#{p.student_id}",
                "birth": student.birth_date.strftime("%d.%m.%Y") if student and student.birth_date else "—",
                "parent": (parent.full_name if parent else "—"),
                "phone": (parent.phone_number if parent else "—"),
                "signed_by": p.signed_by_phone or "—",
                "signed_at": p.signed_at.strftime("%d.%m.%Y %H:%M") if p.signed_at else "—",
                "ticket": "куплен" if p.ticket_status.value == "PAID" else (
                    "не требуется" if p.ticket_status.value == "NOT_REQUIRED" else "ожидает оплаты"
                ),
            }
        )
    rows.sort(key=lambda r: r["name"])
    return rows


def _date_str(excursion: Excursion) -> str:
    return excursion.event_date.strftime("%d.%m.%Y") if excursion.event_date else "____"


def build_order_docx(session: Session, excursion: Excursion) -> bytes:
    rows = _collect(session, excursion)
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(12)

    head = doc.add_paragraph()
    head.alignment = WD_ALIGN_PARAGRAPH.CENTER
    head.add_run(excursion.school_name or "____________________________\n").bold = True

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.add_run("ПРИКАЗ\n").bold = True
    title.add_run(f"«Об организации выездного экскурсионного мероприятия»\n\n")

    p = doc.add_paragraph()
    p.add_run(f"Дата издания: {datetime.now().strftime('%d.%m.%Y')} г.\n")
    p.add_run(f"Основание: {excursion.order_basis}.\n\n")

    doc.add_paragraph(
        f"1. Организовать выездное экскурсионное мероприятие «{excursion.title}» "
        f"для обучающихся {excursion.class_id} (далее — группа)."
    )
    doc.add_paragraph(f"2. Место проведения: {excursion.location_name}, {excursion.address}.")
    doc.add_paragraph(f"3. Дата проведения: {_date_str(excursion)}.")
    doc.add_paragraph(
        f"4. Время сбора группы у школы: {excursion.gathering_time.strftime('%H:%M') if excursion.gathering_time else '—'}, "
        f"планируемое время возвращения: {excursion.return_time.strftime('%H:%M') if excursion.return_time else '—'}."
    )
    doc.add_paragraph(
        f"5. Назначить ответственным за жизнь и здоровье обучающихся во время выезда: "
        f"{excursion.responsible_teacher or '__________________'}."
    )
    doc.add_paragraph(
        "6. Ответственному провести целевой инструктаж по технике безопасности и правилам дорожного "
        "движения с обучающимися под личную подпись перед началом выезда.\n"
    )
    doc.add_paragraph(f"Директор школы ______________ / ________________________\n\n")

    doc.add_paragraph().add_run(
        f"Приложение 1. Список участников группы ({len(rows)} чел.)"
    ).bold = True
    t1 = doc.add_table(rows=1, cols=4)
    t1.style = "Table Grid"
    for i, h in enumerate(["№", "ФИО обучающегося", "Дата рождения", "Телефон родителя"]):
        t1.rows[0].cells[i].text = h
    for i, r in enumerate(rows, 1):
        c = t1.add_row().cells
        c[0].text = str(i)
        c[1].text = r["name"]
        c[2].text = r["birth"]
        c[3].text = r["phone"]

    doc.add_paragraph().add_run("Приложение 2. Реестр цифровых согласий законных представителей").bold = True
    t2 = doc.add_table(rows=1, cols=3)
    t2.style = "Table Grid"
    for i, h in enumerate(["ФИО обучающегося", "Кто ответил (телефон)", "Дата и время"]):
        t2.rows[0].cells[i].text = h
    for r in rows:
        c = t2.add_row().cells
        c[0].text = r["name"]
        c[1].text = r["signed_by"]
        c[2].text = r["signed_at"]

    doc.add_paragraph().add_run("Приложение 3. Лист целевого инструктажа по ТБ и ПДД").bold = True
    doc.add_paragraph(
        "Инструктаж проведён по следующим вопросам: правила поведения в общественном транспорте; "
        "правила дорожного движения для пешеходов; правила поведения в местах массового скопления людей; "
        "порядок действий при возникновении чрезвычайной ситуации; запрет самовольного покидания группы."
    )
    t3 = doc.add_table(rows=1, cols=3)
    t3.style = "Table Grid"
    for i, h in enumerate(["ФИО обучающегося", "Подпись обучающегося", "Подпись педагога"]):
        t3.rows[0].cells[i].text = h
    for r in rows:
        c = t3.add_row().cells
        c[0].text = r["name"]

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _register_font() -> str:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for path in candidates:
        try:
            pdfmetrics.registerFont(TTFont("Base", path))
            return "Base"
        except Exception:  # noqa: BLE001
            continue
    return "Helvetica"


def build_order_pdf(session: Session, excursion: Excursion) -> bytes:
    rows = _collect(session, excursion)
    font = _register_font()
    styles = getSampleStyleSheet()
    h = ParagraphStyle("h", parent=styles["Title"], fontName=font, fontSize=14)
    n = ParagraphStyle("n", parent=styles["Normal"], fontName=font, fontSize=10, leading=14)
    small = ParagraphStyle("s", parent=styles["Normal"], fontName=font, fontSize=8, leading=10)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=15 * mm, topMargin=15 * mm)
    story = []
    story.append(Paragraph(excursion.school_name or "", h))
    story.append(Spacer(1, 6))
    story.append(Paragraph("ПРИКАЗ «Об организации выездного экскурсионного мероприятия»", h))
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"Дата издания: {datetime.now().strftime('%d.%m.%Y')} г.", n))
    story.append(Paragraph(f"Основание: {excursion.order_basis}.", n))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"1. Организовать выезд «{excursion.title}».", n))
    story.append(Paragraph(f"2. Место проведения: {excursion.location_name}, {excursion.address}.", n))
    story.append(Paragraph(f"3. Дата проведения: {_date_str(excursion)}.", n))
    story.append(
        Paragraph(
            f"4. Сбор группы: {excursion.gathering_time.strftime('%H:%M') if excursion.gathering_time else '—'}, "
            f"возвращение: {excursion.return_time.strftime('%H:%M') if excursion.return_time else '—'}.", n,
        )
    )
    story.append(
        Paragraph(
            f"5. Ответственный за жизнь и здоровье обучающихся: {excursion.responsible_teacher or '________'}.", n,
        )
    )
    story.append(Paragraph("6. Провести целевой инструктаж по технике безопасности и ПДД под подпись.", n))
    story.append(Spacer(1, 10))
    story.append(Paragraph(f"Приложение 1. Список участников группы ({len(rows)} чел.)", n))
    data = [["№", "ФИО обучающегося", "Дата рожд.", "Телефон родителя"]]
    for i, r in enumerate(rows, 1):
        data.append([str(i), Paragraph(r["name"], small), r["birth"], r["phone"]])
    t = Table(data, colWidths=[12 * mm, 80 * mm, 28 * mm, 40 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(Spacer(1, 10))
    story.append(Paragraph("Приложение 2. Реестр ответов родителей", n))
    data2 = [["ФИО обучающегося", "Подписант (тел.)", "Дата и время"]]
    for r in rows:
        data2.append([Paragraph(r["name"], small), r["signed_by"], r["signed_at"]])
    t2 = Table(data2, colWidths=[80 * mm, 40 * mm, 40 * mm])
    t2.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
    ]))
    story.append(t2)
    story.append(Spacer(1, 10))
    story.append(Paragraph("Приложение 3. Лист целевого инструктажа по ТБ и ПДД", n))
    story.append(Paragraph(
        "Проведён инструктаж: ПДД для пешеходов, поведение в транспорте и местах массового скопления людей, "
        "действия при ЧС, запрет самовольного покидания группы.", small))
    doc.build(story)
    return buf.getvalue()
