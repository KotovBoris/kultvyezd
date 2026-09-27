"""Генерация пакета школьных документов: приказ + набор приложений (UC-7).

Форматы: DOCX (python-docx) и PDF (reportlab). Оба отдаются как файлы,
чтобы директор школы мог распечатать. Данные берутся только по подтверждённым
участникам (APPROVED), что исключает выбывших детей из приказа.

Состав приложений выбирается вызывающей стороной (ключи из ``ATTACHMENTS``):
список участников, реестр согласий ПЭП, лист инструктажа, а также обязательные
при организованной перевозке детей автобусами маршрутный лист и уведомление в
ГИБДД (ПП РФ №1527) и согласие на обработку персональных данных (152-ФЗ).
"""
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


# ------------------------------------------------------------------ приложения
# Порядок ключей = порядок приложений в документе. Значения — заголовки.
ATTACHMENTS: dict[str, str] = {
    "students": "Список участников группы",
    "consents": "Реестр цифровых согласий законных представителей",
    "briefing": "Лист целевого инструктажа по ТБ и ПДД",
    "route": "Маршрутный лист (ПП РФ №1527)",
    "gibdd": "Уведомление в подразделение Госавтоинспекции (ПП РФ №1527)",
    "pdn": "Согласие на обработку персональных данных (152-ФЗ)",
}


def normalize_attachments(keys: list[str] | None) -> list[str]:
    """Приводит выбор приложений к упорядоченному списку известных ключей.

    ``None``/пустой список → все приложения (совместимость с прежним поведением),
    где ``build_order_docx`` отдавал приказ + 3 приложения. Неизвестные ключи
    молча опускаются, дубликаты убираются — запрос не должен ронять генерацию.
    """
    if not keys:
        return list(ATTACHMENTS)
    return [k for k in ATTACHMENTS if k in set(keys)]


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
                "ticket_number": p.ticket_number or "—",
                "ticket": "куплен" if p.ticket_status.value == "PAID" else (
                    "не требуется" if p.ticket_status.value == "NOT_REQUIRED" else "ожидает оплаты"
                ),
            }
        )
    rows.sort(key=lambda r: r["name"])
    return rows


def _date_str(excursion: Excursion) -> str:
    return excursion.event_date.strftime("%d.%m.%Y") if excursion.event_date else "____"


def _gather_str(excursion: Excursion) -> str:
    return excursion.gathering_time.strftime("%H:%M") if excursion.gathering_time else "____"


def _return_str(excursion: Excursion) -> str:
    return excursion.return_time.strftime("%H:%M") if excursion.return_time else "____"


# ================================================================== DOCX
def _docx_heading(doc, text: str) -> None:
    doc.add_paragraph().add_run(text).bold = True


def _docx_students(doc, excursion: Excursion, rows: list[dict], number: int) -> None:
    _docx_heading(doc, f"Приложение {number}. {ATTACHMENTS['students']} ({len(rows)} чел.)")
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


def _docx_consents(doc, excursion: Excursion, rows: list[dict], number: int) -> None:
    _docx_heading(doc, f"Приложение {number}. {ATTACHMENTS['consents']}")
    t2 = doc.add_table(rows=1, cols=3)
    t2.style = "Table Grid"
    for i, h in enumerate(["ФИО обучающегося", "Подписант (телефон ПЭП)", "Дата и время подписания"]):
        t2.rows[0].cells[i].text = h
    for r in rows:
        c = t2.add_row().cells
        c[0].text = r["name"]
        c[1].text = r["signed_by"]
        c[2].text = r["signed_at"]


def _docx_briefing(doc, excursion: Excursion, rows: list[dict], number: int) -> None:
    _docx_heading(doc, f"Приложение {number}. {ATTACHMENTS['briefing']}")
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
        t3.add_row().cells[0].text = r["name"]


def _docx_route(doc, excursion: Excursion, rows: list[dict], number: int) -> None:
    """Маршрутный лист — обязателен при организованной перевозке детей автобусами."""
    _docx_heading(doc, f"Приложение {number}. {ATTACHMENTS['route']}")
    p = doc.add_paragraph()
    p.add_run(f"Дата поездки: {_date_str(excursion)}.\n")
    p.add_run(f"Организация: {excursion.school_name or '____________________________'}.\n")
    p.add_run(f"Маршрут: {excursion.location_name or '________________'}"
              f"{', ' + excursion.address if excursion.address else ''}.\n")
    p.add_run(f"Ответственный за перевозку: {excursion.responsible_teacher or '__________________'}.\n")
    p.add_run("Транспортное средство (марка, госномер, водитель): ______________________________.\n")
    p.add_run("Сопровождающие лица: __________________________________________________________.\n")
    p.add_run(f"Число перевозимых детей: {len(rows)}.\n")
    t = doc.add_table(rows=1, cols=4)
    t.style = "Table Grid"
    for i, h in enumerate(["Пункт маршрута", "Время прибытия", "Время отбытия", "Примечание"]):
        t.rows[0].cells[i].text = h
    for point, arrive, depart in (
        ("Сбор группы у школы, посадка", _gather_str(excursion), _gather_str(excursion)),
        ("Прибытие к месту проведения", "____", "____"),
        ("Отбытие от места проведения", "____", "____"),
        ("Возвращение к школе, высадка", _return_str(excursion), _return_str(excursion)),
    ):
        c = t.add_row().cells
        c[0].text = point
        c[1].text = arrive
        c[2].text = depart
        c[3].text = ""
    doc.add_paragraph(
        "Водитель ознакомлен с маршрутом и правилами организованной перевозки детей: "
        "______________ / ________________________"
    )


def _docx_gibdd(doc, excursion: Excursion, rows: list[dict], number: int) -> None:
    _docx_heading(doc, f"Приложение {number}. {ATTACHMENTS['gibdd']}")
    doc.add_paragraph(
        "В подразделение Госавтоинспекции по месту начала организованной перевозки группы детей."
    )
    p = doc.add_paragraph()
    p.add_run(f"Организатор перевозки: {excursion.school_name or '____________________________'}.\n")
    p.add_run(
        f"Уведомляем об организованной перевозке группы детей автобусом: "
        f"«{excursion.title}», {_date_str(excursion)}.\n"
    )
    p.add_run(f"Маршрут: {excursion.location_name or '________________'}"
              f"{', ' + excursion.address if excursion.address else ''}.\n")
    p.add_run(f"Время начала перевозки: {_gather_str(excursion)}, окончания: {_return_str(excursion)}.\n")
    p.add_run(f"Количество перевозимых детей: {len(rows)}.\n")
    p.add_run(
        "Транспортное средство: ______________, государственный регистрационный знак _____________.\n"
    )
    p.add_run("Водитель: ______________________________ (категория D, стаж ________).\n")
    p.add_run("Сопровождающие: ________________________________________________________.\n")
    doc.add_paragraph(
        "Ответственный за организацию перевозки: ______________ / ________________________\n"
        "Дата: " + datetime.now().strftime("%d.%m.%Y") + " г."
    )


def _docx_pdn(doc, excursion: Excursion, rows: list[dict], number: int) -> None:
    """Согласие на обработку персональных данных ребёнка (152-ФЗ)."""
    _docx_heading(doc, f"Приложение {number}. {ATTACHMENTS['pdn']}")
    doc.add_paragraph(
        "Я, ________________________________________________________________, "
        "законный представитель обучающегося, даю согласие оператору "
        f"({excursion.school_name or 'образовательная организация'}) на обработку персональных данных "
        "моего ребёнка (фамилия, имя, отчество, дата рождения, контактный телефон) в целях организации "
        "выездного мероприятия «" + excursion.title + "»."
    )
    doc.add_paragraph(
        "Согласие даётся на совершение следующих действий: сбор, запись, систематизация, накопление, "
        "хранение, уточнение (обновление, изменение), использование, передача (предоставление, доступ) "
        "уполномоченным сопровождающим и при необходимости в кассу учреждения культуры, обезличивание, "
        "блокирование, удаление и уничтожение персональных данных."
    )
    doc.add_paragraph(
        "Согласие действует до достижения цели обработки и может быть отозвано письменным заявлением "
        "законного представителя."
    )
    t = doc.add_table(rows=1, cols=2)
    t.style = "Table Grid"
    t.rows[0].cells[0].text = "ФИО обучающегося"
    t.rows[0].cells[1].text = "Подпись законного представителя"
    for r in rows:
        c = t.add_row().cells
        c[0].text = r["name"]


def build_order_docx(session: Session, excursion: Excursion, attachments: list[str] | None = None) -> bytes:
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
        f"4. Время сбора группы у школы: {_gather_str(excursion)}, "
        f"планируемое время возвращения: {_return_str(excursion)}."
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

    builders_docx = {
        "students": _docx_students,
        "consents": _docx_consents,
        "briefing": _docx_briefing,
        "route": _docx_route,
        "gibdd": _docx_gibdd,
        "pdn": _docx_pdn,
    }
    for number, key in enumerate(normalize_attachments(attachments), start=1):
        builders_docx[key](doc, excursion, rows, number)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ================================================================== PDF
def _register_font() -> str:
    """Пытаемся подключить DejaVuSans для кириллицы; иначе Helvetica (латиница)."""
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


def _pdf_table(header: list[str], body: list[list], widths: list[float]) -> Table:
    data = [header] + body
    t = Table(data, colWidths=widths)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
    ]))
    return t


def _pdf_students(story, n_style, small, excursion, rows, number: int) -> None:
    story.append(Paragraph(f"Приложение {number}. {ATTACHMENTS['students']} ({len(rows)} чел.)", n_style))
    body = [[str(i), Paragraph(r["name"], small), r["birth"], r["phone"]] for i, r in enumerate(rows, 1)]
    story.append(_pdf_table(["№", "ФИО обучающегося", "Дата рожд.", "Телефон родителя"],
                            body, [12 * mm, 80 * mm, 28 * mm, 40 * mm]))
    story.append(Spacer(1, 10))


def _pdf_consents(story, n_style, small, excursion, rows, number: int) -> None:
    story.append(Paragraph(f"Приложение {number}. {ATTACHMENTS['consents']}", n_style))
    body = [[Paragraph(r["name"], small), r["signed_by"], r["signed_at"]] for r in rows]
    story.append(_pdf_table(["ФИО обучающегося", "Подписант (тел.)", "Дата и время"],
                            body, [80 * mm, 40 * mm, 40 * mm]))
    story.append(Spacer(1, 10))


def _pdf_briefing(story, n_style, small, excursion, rows, number: int) -> None:
    story.append(Paragraph(f"Приложение {number}. {ATTACHMENTS['briefing']}", n_style))
    story.append(Paragraph(
        "Проведён инструктаж: ПДД для пешеходов, поведение в транспорте и местах массового скопления людей, "
        "действия при ЧС, запрет самовольного покидания группы.", small))
    body = [[Paragraph(r["name"], small), "", ""] for r in rows]
    story.append(_pdf_table(["ФИО обучающегося", "Подпись обучающегося", "Подпись педагога"],
                            body, [80 * mm, 40 * mm, 40 * mm]))
    story.append(Spacer(1, 10))


def _pdf_route(story, n_style, small, excursion, rows, number: int) -> None:
    story.append(Paragraph(f"Приложение {number}. {ATTACHMENTS['route']}", n_style))
    story.append(Paragraph(f"Дата поездки: {_date_str(excursion)}.", small))
    story.append(Paragraph(f"Организация: {excursion.school_name or '________________'}.", small))
    story.append(Paragraph(f"Маршрут: {excursion.location_name or '________________'}, {excursion.address}.", small))
    story.append(Paragraph(
        f"Ответственный за перевозку: {excursion.responsible_teacher or '________________'}.", small))
    story.append(Paragraph("Транспортное средство (марка, госномер, водитель): ______________________.", small))
    story.append(Paragraph(f"Число перевозимых детей: {len(rows)}.", small))
    body = [
        ["Сбор группы у школы, посадка", _gather_str(excursion), _gather_str(excursion), ""],
        ["Прибытие к месту проведения", "____", "____", ""],
        ["Отбытие от места проведения", "____", "____", ""],
        ["Возвращение к школе, высадка", _return_str(excursion), _return_str(excursion), ""],
    ]
    story.append(_pdf_table(["Пункт маршрута", "Прибытие", "Отбытие", "Примечание"],
                            body, [70 * mm, 25 * mm, 25 * mm, 40 * mm]))
    story.append(Spacer(1, 10))


def _pdf_gibdd(story, n_style, small, excursion, rows, number: int) -> None:
    story.append(Paragraph(f"Приложение {number}. {ATTACHMENTS['gibdd']}", n_style))
    story.append(Paragraph(
        "В подразделение Госавтоинспекции по месту начала организованной перевозки группы детей.", small))
    story.append(Paragraph(f"Организатор: {excursion.school_name or '________________'}.", small))
    story.append(Paragraph(
        f"Уведомляем об организованной перевозке группы детей автобусом «{excursion.title}» "
        f"{_date_str(excursion)}.", small))
    story.append(Paragraph(
        f"Маршрут: {excursion.location_name or '________________'}, {excursion.address}.", small))
    story.append(Paragraph(
        f"Время начала: {_gather_str(excursion)}, окончания: {_return_str(excursion)}.", small))
    story.append(Paragraph(f"Количество детей: {len(rows)}.", small))
    story.append(Paragraph(
        "Транспортное средство: ______________, госномер ________. Водитель: ______________.", small))
    story.append(Paragraph(
        "Сопровождающие: ____________________________________________________.", small))
    story.append(Paragraph(
        "Ответственный за организацию перевозки: ______________ / ________________________.", small))
    story.append(Spacer(1, 10))


def _pdf_pdn(story, n_style, small, excursion, rows, number: int) -> None:
    story.append(Paragraph(f"Приложение {number}. {ATTACHMENTS['pdn']}", n_style))
    story.append(Paragraph(
        "Я, ________________________________________________, законный представитель обучающегося, "
        f"даю согласие оператору ({excursion.school_name or 'образовательная организация'}) на обработку "
        "персональных данных моего ребёнка (ФИО, дата рождения, контактный телефон) в целях организации "
        f"выездного мероприятия «{excursion.title}».", small))
    story.append(Paragraph(
        "Действия с данными: сбор, запись, систематизация, накопление, хранение, уточнение, использование, "
        "передача уполномоченным сопровождающим и в кассу учреждения культуры, обезличивание, блокирование, "
        "удаление и уничтожение персональных данных.", small))
    story.append(Paragraph(
        "Согласие действует до достижения цели обработки и может быть отозвано письменным заявлением.", small))
    body = [[Paragraph(r["name"], small), ""] for r in rows]
    story.append(_pdf_table(["ФИО обучающегося", "Подпись законного представителя"],
                            body, [80 * mm, 80 * mm]))
    story.append(Spacer(1, 10))


def build_order_pdf(session: Session, excursion: Excursion, attachments: list[str] | None = None) -> bytes:
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
    story.append(Paragraph(f"4. Сбор группы: {_gather_str(excursion)}, возвращение: {_return_str(excursion)}.", n))
    story.append(Paragraph(
        f"5. Ответственный за жизнь и здоровье обучающихся: {excursion.responsible_teacher or '________'}.", n))
    story.append(Paragraph("6. Провести целевой инструктаж по технике безопасности и ПДД под подпись.", n))
    story.append(Spacer(1, 10))

    builders_pdf = {
        "students": _pdf_students,
        "consents": _pdf_consents,
        "briefing": _pdf_briefing,
        "route": _pdf_route,
        "gibdd": _pdf_gibdd,
        "pdn": _pdf_pdn,
    }
    for number, key in enumerate(normalize_attachments(attachments), start=1):
        builders_pdf[key](story, n, small, excursion, rows, number)

    doc.build(story)
    return buf.getvalue()
