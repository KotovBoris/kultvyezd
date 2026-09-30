from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from .models import (
    CultureEvent,
    Excursion,
    ExcursionParticipant,
    ExcursionStatus,
    ParentContact,
    School,
    SchoolClass,
    Student,
    TicketStatus,
)

SOURCE = "PRO.Культура.РФ / «Пушкинская карта» — модельные данные (снапшот каталога, г. Казань)"

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

_DEMO_STUDENTS: list[dict] = [
    {
        "name": "Абдуллина Алия Ильдаровна",
        "birth": "2010-03-12",
        "parents": [
            {"name": "Абдуллина Гульнара Рамилевна", "phone": "+79001234501", "role": "Мама",
             "max_user_id": 1001, "confirmed": True},
            {"name": "Абдуллин Ильдар Наилевич", "phone": "+79001234502", "role": "Папа",
             "max_user_id": 1002, "confirmed": True},
        ],
    },
    {
        "name": "Абдуллин Тимур Ильдарович",
        "birth": "2012-05-04",
        "parents": [
            {"name": "Абдуллина Гульнара Рамилевна", "phone": "+79001234501", "role": "Мама",
             "max_user_id": 1001, "confirmed": True},
        ],
    },
    {
        "name": "Бикмуллин Марат Ринатович",
        "birth": "2010-01-22",
        "parents": [
            {"name": "Бикмуллин Ринат Айратович", "phone": "+79001234503", "role": "Папа",
             "max_user_id": 1003, "confirmed": False},
        ],
    },
    {
        "name": "Валеева Дина Артуровна",
        "birth": "2010-07-16",
        "parents": [
            {"name": "Валеева Эльвира Маратовна", "phone": "+79001234504", "role": "Мама"},
        ],
    },
    {
        "name": "Гайнуллин Артём Русланович",
        "birth": "2010-09-09",
        "parents": [
            {"name": "Гайнуллина Алсу Фаридовна", "phone": "+79001234505", "role": "Мама",
             "max_user_id": 1004, "confirmed": True},
        ],
    },
    {
        "name": "Егорова София Сергеевна",
        "birth": "2010-02-28",
        "parents": [
            {"name": "Егоров Сергей Николаевич", "phone": "+79001234506", "role": "Папа",
             "max_user_id": 1005, "confirmed": True},
        ],
    },
    {
        "name": "Журавлёва Мария Андреевна",
        "birth": "2010-11-11",
        "parents": [
            {"name": "Журавлёва Ольга Викторовна", "phone": "+79001234507", "role": "Мама",
             "max_user_id": 1006, "confirmed": True},
        ],
    },
    {
        "name": "Зарипов Ильназ Ленарович",
        "birth": "2010-04-19",
        "parents": [
            {"name": "Зарипова Лейсан Рустемовна", "phone": "+79001234508", "role": "Мама"},
        ],
    },
]


def seed_catalog(session: Session) -> int:
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


def seed_demo_school(session: Session) -> int:
    existing = session.exec(select(School)).first()
    if existing:
        return existing.id
    school = School(name="МБОУ «Гимназия №7» г. Казань", city="Казань", number="7")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def seed_demo_class(session: Session) -> int:
    existing = session.exec(select(SchoolClass)).first()
    if existing:
        return existing.id
    school_id = seed_demo_school(session)
    klass = SchoolClass(
        grade="8",
        letter="Б",
        school_id=school_id,
        school_number="7",
        school_name="МБОУ «Гимназия №7» г. Казань",
        teacher_name="Салимова Гульнара Рифкатовна",
        teacher_phone="+79001230000",
        chat_id=-100200300,
    )
    session.add(klass)
    session.commit()
    session.refresh(klass)
    for item in _DEMO_STUDENTS:
        student = Student(class_id=klass.id, full_name=item["name"], birth_date=date.fromisoformat(item["birth"]))
        session.add(student)
        session.commit()
        session.refresh(student)
        for parent in item["parents"]:
            session.add(
                ParentContact(
                    student_id=student.id,
                    full_name=parent["name"],
                    phone_number=parent["phone"],
                    role=parent["role"],
                    max_user_id=parent.get("max_user_id"),
                    confirmed=parent.get("confirmed", False),
                )
            )
    session.commit()
    return klass.id


def seed_demo_excursion(session: Session) -> int:
    existing = session.exec(select(Excursion)).first()
    if existing:
        return existing.id
    klass = session.exec(select(SchoolClass)).first()
    if not klass:
        return 0
    event = session.exec(
        select(CultureEvent).where(CultureEvent.pushkin_eligible == True, CultureEvent.price > 0)  # noqa: E712
    ).first()
    if not event:
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

    pattern = ["PAID", "WAIT", "REJECT", "PENDING", "PAID", "PENDING", "WAIT", "PAID"]
    students = session.exec(select(Student).where(Student.class_id == klass.id)).all()
    for idx, student in enumerate(students):
        parent = session.exec(
            select(ParentContact).where(ParentContact.student_id == student.id)
        ).first()
        kind = pattern[idx % len(pattern)]
        status_consent = "PENDING"
        ticket = TicketStatus.NOT_REQUIRED
        if kind == "PAID":
            status_consent = "APPROVED"
            ticket = TicketStatus.PAID if excursion.ticket_price > 0 else TicketStatus.NOT_REQUIRED
        elif kind == "WAIT":
            status_consent = "APPROVED"
            ticket = TicketStatus.WAITING_PAYMENT if excursion.ticket_price > 0 else TicketStatus.NOT_REQUIRED
        elif kind == "REJECT":
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
