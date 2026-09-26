#!/usr/bin/env python3
"""Сборка презентации «КультВыезд» в PDF (обязательный артефакт формата сдачи).

Первый слайд — служебный (техническая информация для проверки, не оценивается).
Далее — продуктовая часть по критериям жюри: аудитория и проблема, решение,
эффект, архитектура, данные, масштабирование (35/25%), пилот, риски, источники.

Запуск:
  python3 scripts/build_presentation.py [REPO_URL] [COMMIT_HASH]
Печатает: артефакты в artifacts/kultvyezd-presentation.pdf
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "artifacts" / "kultvyezd-presentation.pdf"

# 16:9 слайд
PAGE = landscape((330 * mm, 185 * mm))

ACCENT = colors.HexColor("#6C4CF1")
ACCENT2 = colors.HexColor("#2FB3C7")
DARK = colors.HexColor("#1A1A1A")
MUTED = colors.HexColor("#5A5A66")
LIGHT = colors.HexColor("#F2F3F7")


def register_font() -> str:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            fmt = "truetype"
            pdfmetrics.registerFont(TTFont("KV", p))
            return "KV"
    return "Helvetica"


FONT = register_font()
ss = getSampleStyleSheet()


def st(name, size, leading, color=DARK, space_after=6, bold=False, align=0):
    return ParagraphStyle(
        name, parent=ss["Normal"], fontName=FONT, fontSize=size, leading=leading,
        textColor=color, spaceAfter=space_after, alignment=align,
    )


T_TITLE = st("t", 30, 36, DARK, 10)
T_SUB = st("s", 15, 20, MUTED, 6)
H1 = st("h1", 24, 30, ACCENT, 12)
BODY = st("b", 14, 20, DARK, 6)
SMALL = st("sm", 11, 15, MUTED, 4)
CODE = st("c", 11, 15, DARK, 3)


def bullets(items, style=BODY):
    return [Paragraph(f"• {i}", style) for i in items]


def slide(story, title, subtitle=None, accent=ACCENT):
    if title is not None:
        story.append(Paragraph(title, H1))
    if subtitle:
        story.append(Paragraph(subtitle, T_SUB))
    story.append(Spacer(1, 4))


def footer(canvas, doc_):
    canvas.saveState()
    canvas.setFillColor(ACCENT)
    canvas.rect(0, PAGE[1] - 6, PAGE[0], 6, stroke=0, fill=1)
    canvas.setFont(FONT, 9)
    canvas.setFillColor(MUTED)
    canvas.drawString(14 * mm, 8 * mm, "КультВыезд · трек «Досуг и развлечения» · MAX × Минобрнауки России")
    canvas.drawRightString(PAGE[0] - 14 * mm, 8 * mm, f"{doc_.page}")
    canvas.restoreState()


def build(repo_url: str, commit: str) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUT), pagesize=PAGE, leftMargin=16 * mm, rightMargin=16 * mm,
        topMargin=14 * mm, bottomMargin=16 * mm,
        title="КультВыезд — презентация", author="Команда КультВыезд",
    )
    S: list = []

    # ---------------- Слайд 1: СЛУЖЕБНЫЙ (тех. информация) ----------------
    S.append(Paragraph("КультВыезд — служебная информация для проверки", T_TITLE))
    S.append(Paragraph("Первый слайд не оценивается: данные только для технической проверки.", T_SUB))
    rows = [
        ["Чат-бот в MAX", "@t158_hakaton_max_bot — https://max.ru/t158_hakaton_max_bot"],
        ["Мини-приложение", "подключается к боту кнопкой «Открыть приложение» (MINIAPP_BASE_URL)"],
        ["Git-репозиторий", f"{repo_url} · commit {commit}"],
        ["Адрес собственного API", "http://localhost:8000 (Swagger: /docs); через nginx: http://localhost:8080"],
        ["Запуск одной командой", "docker compose up --build  →  mini-app http://localhost:8080"],
        ["Секреты / переменные", "см. .env.example (MAX_BOT_TOKEN, MAX_BOT_MODE, MAX_CA_BUNDLE и др.)"],
        ["Сертификаты Минцифры", "certs/ca-bundle.pem (монтируется как /certs); диагностика: scripts/doctor.py"],
        ["Тестовые данные", "artifacts/sample_class_import.csv; автоматический демо-класс 8-Б (24 ученика)"],
        ["План авто-проверки API", "artifacts/DATA-API.yaml, артефакты openapi.json / openapi.yaml"],
        ["Автотесты", "backend: pytest (13); бот через эмулятор MAX: scripts/e2e_agent.py (14); стек: scripts/e2e_docker.py (18)"],
    ]
    t = Table([[Paragraph(f"<b>{a}</b>", SMALL), Paragraph(b, SMALL)] for a, b in rows],
              colWidths=[62 * mm, 220 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDE8")),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    S.append(t)
    S.append(Spacer(1, 6))
    S.append(Paragraph(
        "<b>Порядок прохождения основного сценария:</b> "
        "бот @t158_hakaton_max_bot → «Начать» → «Открыть приложение» → вкладка «Каталог событий» → "
        "выбрать событие (Пушкинская карта) → «Создать выезд» → вкладка «Выезды класса» → «Светофор» → "
        "«Напомнить не ответившим» → «Сформировать приказ (DOCX)». "
        "Либо локально: docker compose up --build → http://localhost:8080.",
        SMALL))

    S.append(PageBreak())

    # ---------------- Слайд 2: Титул + резюме ----------------
    S.append(Paragraph("КультВыезд", T_TITLE))
    S.append(Paragraph("Организация школьных культурных выездов внутри мессенджера MAX", T_SUB))
    slide(S, "Executive summary")
    S += bullets([
        "Классный руководитель организует школьный культурный выезд за 15–20 минут вместо 3–6 часов.",
        "Родитель подтверждает участие одним нажатием в MAX — без бумажных согласий и наличных.",
        "Сервис автоматически собирает юридически значимый пакет документов (приказ + 3 приложения).",
        "Пилотный сценарий фокусируется на программе «Пушкинская карта» — рост утилизации льгот.",
    ])
    S.append(Spacer(1, 6))
    S.append(Paragraph("Состав команды и зоны ответственности", BODY))
    S.append(Paragraph("Продукт и аналитика: [указать] · Backend/интеграция MAX: [указать] · Frontend/UX mini-app: [указать]", SMALL))

    S.append(PageBreak())

    # ---------------- Слайд 3: Аудитория и проблема ----------------
    slide(S, "Целевая аудитория и проблема")
    S.append(Paragraph("Приоритетный сегмент: <b>классный руководитель</b> 25–55 лет, класс 25–60 детей, "
                       "обязан выполнять план воспитательной работы.", BODY))
    S.append(Spacer(1, 4))
    S.append(Paragraph("<b>Проблема</b> (формула: пользователь → контекст → барьер → последствие):", BODY))
    S.append(Paragraph(
        "Классный руководитель в ситуации подготовки обязательного культурного выезда хочет быстро и "
        "юридически чисто организовать поездку, но сталкивается с бумажным сбором согласий, хаосом в чате "
        "класса и ручным оформлением приказа, из-за чего теряет 3–6 часов и несёт риск ошибок в документах.",
        BODY))
    S.append(Spacer(1, 6))
    S.append(Paragraph("Подтверждение актуальности", BODY))
    S += bullets([
        "Запрет на сбор денег учителем (273-ФЗ): оплата должна идти напрямую в учреждение культуры.",
        "15–25% бумажных согласий теряются/забываются — прямой юридический риск школы при ЧП.",
        "Миллиарды рублей «Пушкинской карты» не используются из-за нехватки готовых школьных подборок.",
        "До 150 неструктурированных сообщений в чате класса на одну поездку.",
    ], SMALL)

    S.append(PageBreak())

    # ---------------- Слайд 4: Решение и сценарий ----------------
    slide(S, "Решение и основной пользовательский сценарий")
    S.append(Paragraph("Чат-бот MAX + мини-приложение. Сложные экраны (каталог, «Светофор», документы) — "
                       "в мини-приложении; быстрые действия и напоминания — в чате.", BODY))
    S.append(Spacer(1, 4))
    steps = [
        "Каталог: фильтры «Пушкинская карта» / возраст / бесплатные (модельный снапшот PRO.Культура.РФ).",
        "Создание выезда: дата, время сбора/возвращения, дедлайн; участники класса — автоматически.",
        "Согласие родителя в 1 клик в MAX (ПЭП с фиксацией даты, времени, подписанта).",
        "Билет: переход по ссылке на кассу музея; сервис хранит только статус «куплен» (денег не касается).",
        "«Светофор»: 🟢 готов / 🟡 ждём билет / ⚪ нет ответа / 🔴 отказ + точечные напоминания.",
        "Автогенерация приказа DOCX/PDF с приложениями (список, реестр согласий, инструктаж по ТБ).",
    ]
    for i, s in enumerate(steps, 1):
        S.append(Paragraph(f"<b>{i}.</b> {s}", BODY))

    S.append(PageBreak())

    # ---------------- Слайд 5: Эффект и метрики ----------------
    slide(S, "Ожидаемый эффект и метрики")
    metrics = [
        ["Метрика", "As Is", "To Be (цель)"],
        ["Время учителя на 1 выезд", "3–6 часов", "15–20 минут"],
        ["Срок сбора согласий и группы", "4–7 дней", "до 24 часов"],
        ["Потери бумажных согласий", "15–25%", "0% (все в цифре)"],
        ["Сообщений в чате класса", "50–150", "1 сервисное сообщение"],
        ["Утилизация «Пушкинской карты»", "низкая", "+30–40% участия"],
    ]
    t = Table(metrics, colWidths=[95 * mm, 65 * mm, 75 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDE8")),
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    S.append(t)
    S.append(Spacer(1, 8))
    S.append(Paragraph("Гипотеза: если дать учителю подбор события и цифровое согласие в MAX, "
                       "срок сбора группы сократится с дней до часов, потому что исчезнут бумажный обмен "
                       "и ручной обзвон (точечные пуши вместо флуда в чате).", SMALL))

    S.append(PageBreak())

    # ---------------- Слайд 6: Архитектура ----------------
    slide(S, "Архитектура решения")
    S.append(Paragraph("Модульный монолит: ядро не зависит от платформы MAX (ports & adapters).", BODY))
    arch = [
        ["Слой", "Реализация", "Роль"],
        ["Клиенты MAX", "мобильный / веб", "среда прохождения сценария"],
        ["Мини-приложение", "React 19 + MAX UI + MAX Bridge, nginx", "каталог, «Светофор», документы, экран родителя"],
        ["Ядро (backend)", "FastAPI, SQLModel, SQLite", "REST API, бизнес-правила, генерация документов"],
        ["MAX Bot Adapter", "long polling / webhook, POST /messages, /answers", "онбординг, кнопки согласия, точечные пуши"],
        ["Данные", "SQLite (volume) + модельный снапшот каталога", "класс/ученики/родители, выезды, аудит ПЭП"],
    ]
    t = Table([[Paragraph(f"<b>{a}</b>", SMALL) if i == 0 else Paragraph(a, SMALL) for a in row] for i, row in enumerate(arch)],
              colWidths=[45 * mm, 95 * mm, 95 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDE8")),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    S.append(t)
    S.append(Spacer(1, 6))
    S.append(Paragraph("Платформенный бонус MAX: нативная кнопка open_app, MAX Bridge (данные пользователя, "
                       "платформа устройства, нативное скачивание приказа), адаптация интерфейса под iOS/Android/desktop.", SMALL))

    S.append(PageBreak())

    # ---------------- Слайд 7: Данные и интеграции ----------------
    slide(S, "Данные и интеграции")
    data = [
        ["Источник", "Тип", "Статус"],
        ["MAX Bot API (platform-api2.max.ru)", "реальная интеграция", "подключено (polling + webhook)"],
        ["MAX Bridge (st.max.ru)", "реальная интеграция", "подключено (mini-app)"],
        ["Каталог PRO.Культура.РФ / «Пушкинская карта»", "модельные данные", "снапшот, поле source"],
        ["Билетные шлюзы музеев", "внешние ссылки", "ссылка на кассу"],
        ["СМЭВ / Госуслуги, ФИАС", "перспектива", "не в MVP"],
    ]
    t = Table([[Paragraph(f"<b>{a}</b>", SMALL) if i == 0 else Paragraph(a, SMALL) for a in row] for i, row in enumerate(data)],
              colWidths=[110 * mm, 55 * mm, 70 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDE8")),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    S.append(t)
    S.append(Spacer(1, 6))
    S.append(Paragraph("Разделяем факты и модельные данные: каждое событие каталога помечено полем "
                       "<b>source</b>, а <b>GET /api/v1/meta</b> возвращает <b>dataset.is_mock: true</b>. "
                       "Для продакшена нужен доступ к API PRO.Культура.РФ и валидация initData MAX Bridge.", SMALL))

    S.append(PageBreak())

    # ---------------- Слайд 8: Масштабирование ----------------
    slide(S, "Потенциал масштабирования (ядро / переменная часть)")
    left = [
        Paragraph("<b>Ядро продукта (не меняется)</b>", BODY),
        Paragraph("• Проблема и логика сценария", SMALL),
        Paragraph("• Архитектура и модель данных", SMALL),
        Paragraph("• Механика цифрового согласия (ПЭП)", SMALL),
        Paragraph("• Генератор документов и реестров", SMALL),
        Paragraph("• Ключевые элементы интерфейса", SMALL),
    ]
    right = [
        Paragraph("<b>Переменная часть (адаптируется)</b>", BODY),
        Paragraph("• Данные о событиях и площадках (регион)", SMALL),
        Paragraph("• Справочники и региональные фиды (ФИАС, data.tatarstan.ru)", SMALL),
        Paragraph("• Внешние системы и билетные операторы", SMALL),
        Paragraph("• Роли участников и правила выезда", SMALL),
        Paragraph("• Каналы доступа и модераторы", SMALL),
    ]
    t = Table([[left, right]], colWidths=[118 * mm, 118 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDE8")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDE8")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    S.append(t)
    S.append(Spacer(1, 8))
    S.append(Paragraph("Порядок тиражирования и риски", BODY))
    S += bullets([
        "Пилот: г. Казань → Департамент образования города (10–20 школ).",
        "Далее: вузы/колледжи (выездные практики, студвесна), ДЮСШ (соревнования), детские лагеря.",
        "Условия адаптации: подключить региональный фид событий и справочник площадок.",
        "Риски: юридическая типовка приказа (нужен юрист школы), ПДн детей, нагрузка на кассу музея.",
    ], SMALL)

    S.append(PageBreak())

    # ---------------- Слайд 9: Пилот ----------------
    slide(S, "Пилотный запуск и внедрение")
    pilot = [
        ["Что", "Как"],
        ["Где и для кого", "Пилотная школа в г. Казань, 3–5 классов (8–9 классы), 1 четверть"],
        ["Встраивание в процесс", "Пушкинская карта + чат класса + единая карточка выезда в MAX"],
        ["Данные и интеграции", "Региональный фид событий, справочник площадок, диплинки бота"],
        ["Доступ пользователей", "QR-код на родсобрании → бот MAX → мини-приложение"],
        ["Метрики пилота", "100% выездов через сервис; сбор группы ≤ 24 ч; 0 потерянных согласий"],
        ["После пилота", "Тиражирование на департамент, подключение касс музеев по API"],
    ]
    t = Table([[Paragraph(f"<b>{a}</b>", SMALL) if i == 0 else Paragraph(a, SMALL) for a in row] for i, row in enumerate(pilot)],
              colWidths=[60 * mm, 200 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDE8")),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    S.append(t)

    S.append(PageBreak())

    # ---------------- Слайд 10: Ограничения и риски ----------------
    slide(S, "Ограничения, риски и допущения")
    S += bullets([
        "Нет аутентификации REST API (демо); в проде — валидация initData MAX Bridge (hash, auth_date).",
        "Каталог модельный (снапшот), автообновления нет; реальный API PRO.Культура.РФ требует доступа.",
        "Сервис не обрабатывает деньги — оплата напрямую в кассу (снятие риска «поборов»).",
        "Типовой текст приказа требует юридической выверки школой.",
        "Long polling — только для демо; в продакшене используется webhook (/webhook/max).",
        "ПДн: в MVP используются обезличенные демонстрационные данные.",
    ])
    S.append(Spacer(1, 10))
    S.append(Paragraph("Что сознательно НЕ делаем в MVP (Won’t Have)", BODY))
    S += bullets([
        "Онлайн-оплату билетов внутри сервиса (юридические риски, интеграция с билетными операторами).",
        "Полноценную роль администрации школы и модерацию контента.",
        "Интеграцию с государственными системами (СМЭВ/Госуслуги) — только как следующий шаг.",
    ], SMALL)

    S.append(PageBreak())

    # ---------------- Слайд 11: Источники ----------------
    slide(S, "Источники")
    S += bullets([
        "MAX для разработчиков — Bot API: https://dev.max.ru/docs-api",
        "MAX Bridge (мини-приложения): https://dev.max.ru/docs/webapps/bridge",
        "Культура.РФ и «Пушкинская карта»: https://www.culture.ru",
        "PRO.Культура.РФ (публикация событий учреждениями): https://pro.culture.ru",
        "Регламент и критерии хакатона «Досуг и развлечения» (MAX × Минобрнауки России)",
        "Официальная спецификация MAX Bot API: github.com/max-messenger/api-schema",
    ], BODY)
    S.append(Spacer(1, 10))
    S.append(Paragraph("Примечание: данные каталога в демонстрации — модельные (снапшот), "
                       "созданы на основе открытого реестра событий; реальные интеграции обозначены явно.", SMALL))

    doc.build(S, onFirstPage=footer, onLaterPages=footer)
    print(f"✅ Презентация собрана: {OUT}")
    print(f"   слайдов: 11, шрифт: {FONT}")


if __name__ == "__main__":
    repo = sys.argv[1] if len(sys.argv) > 1 else "https://github.com/KotovBoris/kultvyezd"
    commit = sys.argv[2] if len(sys.argv) > 2 else "[commit hash]"
    build(repo, commit)
