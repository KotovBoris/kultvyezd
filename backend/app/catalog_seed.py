"""Модельные демонстрационные данные (п.10 ограничений: данные помечены как модельные).

Источник-прообраз — каталог PRO.Культура.РФ / «Пушкинская карта» (раздел 21 презентации).
Реальный API недоступен на хакатоне, поэтому используется подготовленный снапшот;
в поле source у каждого события это явно указано.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from .models import (
    CultureEvent,
    Excursion,
    ExcursionParticipant,
    ExcursionStatus,
    ParentContact,
    SchoolClass,
    Student,
    TicketStatus,
)

SOURCE = "PRO.Культура.РФ / «Пушкинская карта» — модельные данные (снапшот каталога, г. Казань)"

# Смещения дат от «сегодня», чтобы демо всегда выглядело актуальным
_EVENTS: list[dict] = [
    dict(title="Экскурсия «Казанский Кремль: сквозь века»", venue="Музей-заповедник «Казанский Кремль»",
         age_rating="6+", days=7, duration_min=90, price=0.0, pushkin=False, free=True,
         address="г. Казань, Кремль, 1", ticket_url="https://kazan-kremlin.ru/",
         description="Обзорная экскурсия по объекту Всемирного наследия ЮНЕСКО."),
    dict(title="Выставка «Сокровища Национального музея РТ»", venue="Национальный музей Республики Татарстан",
         age_rating="12+", days=10, duration_min=75, price=0.0, pushkin=True, free=True,
         address="г. Казань, ул. Кремлёвская, 2", ticket_url="https://tatmuseum.ru/",
         description="Постоянная экспозиция истории и культуры Татарстана. Вход по «Пушкинской карте»."),
    dict(title="Спектакль «Гөлбакча» (Театр кукол «Экият»)", venue="Татарский государственный театр кукол «Экият»",
         age_rating="6+", days=5, duration_min=70, price=450.0, pushkin=True, free=False,
         address="г. Казань, ул. Петербургская, 57", ticket_url="https://ekiyat.ru/",
         description="Музыкальная сказка для школьников."),
    dict(title="Планетарий: программа «Космос для школьников»", venue="Планетарий КФУ",
         age_rating="6+", days=4, duration_min=60, price=300.0, pushkin=True, free=False,
         address="г. Казань, ул. Кремлёвская, 18", ticket_url="https://planetarium.kpfu.ru/",
         description="Полнокупольная научно-познавательная программа."),
    dict(title="Экскурсия в Центр «Эрмитаж-Казань»", venue="Центр «Эрмитаж-Казань»",
         age_rating="12+", days=12, duration_min=80, price=500.0, pushkin=True, free=False,
         address="г. Казань, Кремль, 6", ticket_url="https://ermitage-kazan.ru/",
         description="Выставка западноевропейского искусства из собрания Эрмитажа."),
    dict(title="Литературный музей Г. Тукая", venue="Литературный музей Габдуллы Тукая",
         age_rating="12+", days=9, duration_min=60, price=250.0, pushkin=True, free=False,
         address="г. Казань, ул. Тукая, 74", ticket_url="https://tatmuseum.ru/",
         description="Экскурсия по жизни и творчеству поэта."),
    dict(title="Спектакль Татарского театра им. Г. Камала", venue="Татарский академический театр им. Г. Камала",
         age_rating="12+", days=14, duration_min=150, price=700.0, pushkin=True, free=False,
         address="г. Казань, ул. Татарстан, 1", ticket_url="https://kamalteatr.ru/",
         description="Классическая постановка национального репертуара."),
    dict(title="Дом-музей В. И. Ленина", venue="Дом-музей В. И. Ленина",
         age_rating="12+", days=6, duration_min=50, price=200.0, pushkin=True, free=False,
         address="г. Казань, ул. Ульянова-Ленина, 58", ticket_url="https://tatmuseum.ru/",
         description="Мемориальный музей, связанный с казанским периодом жизни."),
    dict(title="Научное шоу «Физика вокруг нас»", venue="Музей естественной истории Татарстана",
         age_rating="6+", days=3, duration_min=60, price=350.0, pushkin=True, free=False,
         address="г. Казань, Кремль, 5", ticket_url="https://tatmuseum.ru/",
         description="Интерактивное занятие по естественным наукам."),
    dict(title="Экскурсия «Старо-Татарская слобода»", venue="Пешеходная экскурсия по историческому центру",
         age_rating="0+", days=8, duration_min=120, price=0.0, pushkin=False, free=True,
         address="г. Казань, ул. Марджани", ticket_url="https://kazan-kremlin.ru/",
         description="Бесплатная городская пешая экскурсия (в сопровождении педагога)."),
    dict(title="Выставка «Искусство Татарстана XX века»", venue="Государственный музей изобразительных искусств РТ",
         age_rating="12+", days=11, duration_min=70, price=300.0, pushkin=True, free=False,
         address="г. Казань, ул. Карла Маркса, 64", ticket_url="https://izo-museum.ru/",
         description="Живопись и графика мастеров республики."),
    dict(title="Концерт органной музыки", venue="Государственный большой концертный зал им. С. Сайдашева",
         age_rating="12+", days=13, duration_min=90, price=400.0, pushkin=True, free=False,
         address="г. Казань, ул. Пушкина, 66", ticket_url="https://gbsk.ru/",
         description="Просветительский концерт для школьной аудитории."),
    dict(title="Экскурсия в Национальную библиотеку РТ", venue="Национальная библиотека Республики Татарстан",
         age_rating="12+", days=15, duration_min=60, price=0.0, pushkin=False, free=True,
         address="г. Казань, ул. Пушкина, 86", ticket_url="https://kitaphane.tatarstan.ru/",
         description="Знакомство с современным библиотечным пространством."),
    dict(title="Мастер-класс «Живопись для начинающих»", venue="Детская художественная школа №1",
         age_rating="6+", days=16, duration_min=90, price=600.0, pushkin=True, free=False,
         address="г. Казань, ул. Достоевского, 10", ticket_url="https://dmsh-kazan.ru/",
         description="Практическое занятие по живописи."),
    dict(title="Театрализованная программа «В гостях у сказки»", venue="Дом актёра им. М. Салимжанова",
         age_rating="6+", days=18, duration_min=60, price=350.0, pushkin=True, free=False,
         address="г. Казань, ул. Щапова, 37", ticket_url="https://domaktera.ru/",
         description="Интерактивный спектакль для младших классов."),
    dict(title="Экскурсия «Мир профессий: музей связи»", venue="Музей связи Республики Татарстан",
         age_rating="12+", days=17, duration_min=70, price=250.0, pushkin=True, free=False,
         address="г. Казань, ул. Право-Булачная, 26", ticket_url="https://tatmuseum.ru/",
         description="Профориентационная экскурсия."),
]

# Демонстрационный класс: 8-Б, 24 ученика
_DEMO_STUDENTS: list[tuple[str, str, str, str]] = [
    # ФИО, дата рождения, телефон родителя, роль
    ("Абдуллина Алия Ильдаровна", "2010-03-12", "+79001234501", "Мама"),
    ("Бикмуллин Тимур Ринатович", "2010-05-04", "+79001234502", "Папа"),
    ("Валеева Дина Артуровна", "2010-01-22", "+79001234503", "Мама"),
    ("Гайнуллин Артём Русланович", "2010-07-16", "+79001234504", "Мама"),
    ("Давлетшина Камиля Маратовна", "2010-09-09", "+79001234505", "Мама"),
    ("Егоров Никита Сергеевич", "2010-02-28", "+79001234506", "Папа"),
    ("Журавлёва София Андреевна", "2010-11-11", "+79001234507", "Мама"),
    ("Зарипов Ильназ Ленарович", "2010-04-19", "+79001234508", "Папа"),
    ("Иванова Полина Дмитриевна", "2010-06-30", "+79001234509", "Мама"),
    ("Каримов Ранель Ильдарович", "2010-08-08", "+79001234510", "Мама"),
    ("Лебедева Мария Алексеевна", "2010-10-23", "+79001234511", "Мама"),
    ("Мифтахов Амир Рустемович", "2010-12-05", "+79001234512", "Папа"),
    ("Нигматуллина Азалия Ринатовна", "2010-03-27", "+79001234513", "Мама"),
    ("Орлова Ева Максимовна", "2010-01-15", "+79001234514", "Мама"),
    ("Петров Арсений Иванович", "2010-05-21", "+79001234515", "Папа"),
    ("Рахимова Эмилия Азатовна", "2010-07-03", "+79001234516", "Мама"),
    ("Сафин Данияр Ирекович", "2010-09-18", "+79001234517", "Мама"),
    ("Тимофеева Варвара Олеговна", "2010-02-09", "+79001234518", "Мама"),
    ("Усманов Карим Наилевич", "2010-04-26", "+79001234519", "Папа"),
    ("Фёдорова Алиса Павловна", "2010-06-14", "+79001234520", "Мама"),
    ("Хайруллина Ясмина Рушановна", "2010-08-25", "+79001234521", "Мама"),
    ("Царёва Дарья Валерьевна", "2010-10-07", "+79001234522", "Мама"),
    ("Шакиров Ильмир Маратович", "2010-12-19", "++79001234523", "Папа"),
    ("Юсупова Амина Ринатовна", "2010-03-30", "+79001234524", "Мама"),
]


def seed_catalog(session: Session) -> int:
    """Наполняет каталог, если он пуст. Возвращает число событий."""
    existing = session.exec(select(CultureEvent)).first()
    if existing:
        return 0
    today = date.today()
    created = 0
    for i, e in enumerate(_EVENTS):
        session.add(
            CultureEvent(
                external_id=f"prokultura-kzn-{i + 1:03d}",
                title=e["title"],
                venue=e["venue"],
                city="Казань",
                age_rating=e["age_rating"],
                event_date=today + timedelta(days=e["days"]),
                duration_min=e["duration_min"],
                price=e["price"],
                pushkin_eligible=e["pushkin"],
                is_free=e["free"],
                ticket_url=e["ticket_url"],
                address=e["address"],
                description=e["description"],
                source=SOURCE,
            )
        )
        created += 1
    session.commit()
    return created


def seed_demo_class(session: Session) -> int:
    """Создаёт демо-класс 8-Б с 24 учениками и родителями. Возвращает id класса."""
    existing = session.exec(select(SchoolClass)).first()
    if existing:
        return existing.id
    klass = SchoolClass(
        grade="8",
        letter="Б",
        school_number="7",
        school_name="МБОУ «Гимназия №7» г. Казань",
        teacher_name="Классный руководитель: Салимова Гульнара Рифкатовна",
        teacher_phone="+79001230000",
    )
    session.add(klass)
    session.commit()
    session.refresh(klass)
    for full_name, birth, phone, role in _DEMO_STUDENTS:
        student = Student(class_id=klass.id, full_name=full_name, birth_date=date.fromisoformat(birth))
        session.add(student)
        session.commit()
        session.refresh(student)
        session.add(
            ParentContact(
                student_id=student.id,
                full_name=f"Родитель: {full_name.split()[0]}",
                phone_number=phone.replace("++", "+"),
                role=role,
            )
        )
    session.commit()
    return klass.id


def seed_demo_excursion(session: Session) -> int:
    """Создаёт демонстрационный выезд «в разгаре сбора» со смешанными статусами."""
    existing = session.exec(select(Excursion)).first()
    if existing:
        return existing.id
    klass = session.exec(select(SchoolClass)).first()
    if not klass:
        return 0
    event = session.exec(select(CultureEvent).where(CultureEvent.pushkin_eligible == True)).first()  # noqa: E712
    if not event:
        event = session.exec(select(CultureEvent)).first()

    today = date.today()
    excursion = Excursion(
        class_id=klass.id,
        culture_event_id=event.id if event else None,
        title=event.title if event else "Экскурсия",
        location_name=event.venue if event else "Музей",
        address=event.address if event else "г. Казань",
        event_date=today + timedelta(days=7),
        deadline=datetime.now() + timedelta(days=3),
        ticket_price=event.price if event else 0.0,
        ticket_sale_url=event.ticket_url if event else "",
        is_pushkin_card=bool(event.pushkin_eligible) if event else False,
        status=ExcursionStatus.VOTING,
        school_name=klass.school_name,
        responsible_teacher=klass.teacher_name,
        order_basis="план воспитательной работы на 2026/2027 учебный год",
    )
    session.add(excursion)
    session.commit()
    session.refresh(excursion)

    students = session.exec(select(Student).where(Student.class_id == klass.id)).all()
    for idx, student in enumerate(students):
        parent = session.exec(
            select(ParentContact).where(ParentContact.student_id == student.id)
        ).first()
        status_consent = "PENDING"
        ticket = TicketStatus.NOT_REQUIRED
        if idx % 3 == 0:
            status_consent = "APPROVED"
            ticket = TicketStatus.PAID if excursion.ticket_price > 0 else TicketStatus.NOT_REQUIRED
        elif idx % 3 == 1:
            status_consent = "APPROVED"
            ticket = TicketStatus.WAITING_PAYMENT if excursion.ticket_price > 0 else TicketStatus.NOT_REQUIRED
        elif idx % 7 == 2:
            status_consent = "REJECTED"
        part = ExcursionParticipant(
            excursion_id=excursion.id,
            student_id=student.id,
            consent_status=status_consent,
            ticket_status=ticket,
            signed_by_name=parent.full_name if status_consent != "PENDING" else None,
            signed_by_phone=parent.phone_number if status_consent != "PENDING" else None,
            signed_at=datetime.now() if status_consent != "PENDING" else None,
            rejection_reason="Болезнь" if status_consent == "REJECTED" else None,
        )
        session.add(part)
    session.commit()
    return excursion.id


def seed_all(session: Session) -> dict[str, int]:
    events = seed_catalog(session)
    class_id = seed_demo_class(session)
    excursion_id = seed_demo_excursion(session)
    return {"events": events, "class_id": class_id, "excursion_id": excursion_id}
