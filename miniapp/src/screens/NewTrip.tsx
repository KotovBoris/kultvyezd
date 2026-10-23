import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "@maxhub/max-ui";
import { api, type CultureEvent, type SchoolClass } from "../api";
import { addDays, dayLong, dayShort, isoDate, money, parseDay, plural, quote } from "../format";
import { haptic, setClosingConfirmation } from "../max";
import { errorText, replace, toast } from "../store";
import { Card, Chip, Empty, Field, Hero, Icon, Loader, Notice, Page, Section, Tag } from "../ui";

type Filter = "all" | "free" | "pushkin";

const AGE_ORDER = ["0+", "6+", "12+", "16+", "18+"];

/** Какой возрастной ценз подходит классу: 1–4 → до 6+, 5–8 → до 12+, 9–11 → до 16+. */
function maxAgeForGrade(grade: string): string {
  const g = parseInt(grade, 10);
  if (!g) return "16+";
  if (g <= 4) return "6+";
  if (g <= 8) return "12+";
  return "16+";
}

function gradeOf(klass: SchoolClass | undefined): string {
  return klass ? klass.title.replace(/\D/g, "") : "";
}

export default function NewTrip({ classId }: { classId?: number }) {
  const [step, setStep] = useState(1);
  const [classes, setClasses] = useState<SchoolClass[] | null>(null);
  const [events, setEvents] = useState<CultureEvent[] | null>(null);
  const [selectedClass, setSelectedClass] = useState<number | null>(classId ?? null);
  const [filter, setFilter] = useState<Filter>("all");
  const [byAge, setByAge] = useState(true);
  const [query, setQuery] = useState("");
  const [event, setEvent] = useState<CultureEvent | null>(null);
  const [date, setDate] = useState("");
  const [gathering, setGathering] = useState("09:00");
  const [returning, setReturning] = useState("13:00");
  const [meeting, setMeeting] = useState("у главного входа школы");
  const [escorts, setEscorts] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.myClasses(), api.events()])
      .then(([c, e]) => {
        setClasses(c);
        setEvents(e);
        if (!classId && c.length) setSelectedClass(c[0].id);
      })
      .catch((e) => setError(errorText(e)));
  }, [classId]);

  // Пока мастер не закончен, случайное закрытие спросит подтверждение.
  useEffect(() => {
    setClosingConfirmation(step > 1 || event !== null);
    return () => setClosingConfirmation(false);
  }, [step, event]);

  const klass = classes?.find((c) => c.id === selectedClass);
  const maxAge = maxAgeForGrade(gradeOf(klass));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (events ?? [])
      .filter((e) => (filter === "free" ? e.is_free : filter === "pushkin" ? e.pushkin_eligible : true))
      .filter((e) => !byAge || AGE_ORDER.indexOf(e.age_rating) <= AGE_ORDER.indexOf(maxAge))
      .filter((e) => !q || `${e.title} ${e.venue}`.toLowerCase().includes(q))
      .sort((a, b) => (a.event_date ?? "").localeCompare(b.event_date ?? ""));
  }, [events, filter, byAge, query, maxAge]);

  function pick(e: CultureEvent) {
    haptic.tap();
    setEvent(e);
    const day = e.event_date ?? isoDate(addDays(new Date(), 7));
    setDate(day);
    const eventDay = parseDay(day) ?? addDays(new Date(), 7);
    const dl = addDays(eventDay, -2);
    const tomorrow = addDays(new Date(), 1);
    setDeadlineDate(isoDate(dl > tomorrow ? dl : tomorrow));
  }

  const connected = klass ? klass.parents_connected : 0;
  const total = klass ? klass.students.length : 0;
  const todayIso = isoDate(new Date());
  const deadlineOk = deadlineDate >= todayIso && (!date || deadlineDate <= date);
  const timesOk = !gathering || !returning || returning > gathering;

  async function submit() {
    if (!event || !klass) return;
    setBusy(true);
    setError(null);
    try {
      const deadline = new Date(`${deadlineDate}T${deadlineTime || "18:00"}:00`);
      const trip = await api.createTrip({
        class_id: klass.id,
        culture_event_id: event.id,
        event_date: date,
        gathering_time: gathering,
        return_time: returning,
        meeting_point: meeting.trim() || "у главного входа школы",
        escorts: escorts.trim(),
        deadline: deadline.toISOString(),
      });
      setClosingConfirmation(false);
      haptic.ok();
      toast(
        klass.is_demo
          ? "Приглашения отправлены. Виртуальные родители ответят в течение минуты."
          : `Приглашения отправлены ${connected} ${plural(connected, "родителю", "родителям", "родителям")} в MAX.`,
      );
      replace({ name: "trip", id: trip.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!classes || !events) {
    return (
      <Page>
        {error ? <Notice tone="error" icon="info" title="Не удалось открыть каталог">{error}</Notice> : <Loader />}
      </Page>
    );
  }

  const stepTitle = ["Куда идём?", "Когда и как?", "Проверьте приглашение"][step - 1];

  const bottom =
    step === 1 ? (
      <Button size="large" stretched disabled={!event || !klass} onClick={() => setStep(2)}>
        {event ? "Далее" : "Выберите событие"}
      </Button>
    ) : step === 2 ? (
      <div className="cg-bottom-pair">
        <Button size="large" variant="secondary" onClick={() => setStep(1)}>Назад</Button>
        <Button size="large" stretched disabled={!date || !deadlineOk || !timesOk} onClick={() => setStep(3)}>
          Далее
        </Button>
      </div>
    ) : (
      <div className="cg-bottom-pair">
        <Button size="large" variant="secondary" onClick={() => setStep(2)} disabled={busy}>Назад</Button>
        <Button size="large" stretched loading={busy} onClick={() => void submit()}>
          Отправить родителям
        </Button>
      </div>
    );

  return (
    <Page bottom={bottom}>
      <Hero overline={`Новый выезд · шаг ${step} из 3`} title={stepTitle} />
      <div className="cg-steps" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= step ? "on" : ""} />
        ))}
      </div>

      {error && <Notice tone="error" icon="info" title="Не получилось создать выезд">{error}</Notice>}

      {step === 1 && (
        <>
          {classes.length > 1 && (
            <Section title="Класс">
              <div className="cg-chips">
                {classes.map((c) => (
                  <Chip key={c.id} active={c.id === selectedClass} onClick={() => setSelectedClass(c.id)}>
                    {c.title}
                    {c.is_demo ? " (демо)" : ""}
                  </Chip>
                ))}
              </div>
            </Section>
          )}
          <Section>
            <Input
              mode="contrast"
              placeholder="Музей, театр, выставка…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              withClearButton
              iconBefore={<Icon name="search" size={18} />}
            />
            <div className="cg-chips cg-mt">
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>Все</Chip>
              <Chip active={filter === "free"} onClick={() => setFilter("free")}>Бесплатные</Chip>
              <Chip active={filter === "pushkin"} onClick={() => setFilter("pushkin")}>Пушкинская карта</Chip>
              <Chip active={byAge} onClick={() => setByAge((v) => !v)}>Для {klass?.title ?? "класса"}: до {maxAge}</Chip>
            </div>
          </Section>
          {visible.length === 0 && (
            <Empty icon="calendar" title="Ничего не нашлось" text="Снимите фильтр или измените запрос." />
          )}
          <div className="cg-list">
            {visible.map((e) => {
              const active = event?.id === e.id;
              return (
                <Card key={e.id} className={`cg-event ${active ? "selected" : ""}`} onClick={() => pick(e)}>
                  <div className="cg-event-head">
                    <span className="cg-event-title">{e.title}</span>
                    <span className={`cg-radio ${active ? "on" : ""}`} aria-hidden="true">
                      {active && <Icon name="check" size={14} />}
                    </span>
                  </div>
                  <div className="cg-muted">{e.venue}</div>
                  <div className="cg-tags">
                    <Tag>{dayShort(e.event_date)}</Tag>
                    {e.is_free ? <Tag tone="free">бесплатно</Tag> : <Tag>{money(e.price)}</Tag>}
                    {e.pushkin_eligible && <Tag tone="pushkin">Пушкинская карта</Tag>}
                    <Tag>{e.age_rating}</Tag>
                    <Tag>{e.duration_min} мин</Tag>
                  </div>
                  {active && e.description && <p className="cg-event-desc">{e.description}</p>}
                </Card>
              );
            })}
          </div>
          <p className="cg-fineprint">
            Каталог — демонстрационный снимок афиши PRO.Культура.РФ по Казани. В рабочей версии события
            подтягиваются по открытому API Минкультуры.
          </p>
        </>
      )}

      {step === 2 && event && (
        <>
          <Card className="cg-picked">
            <b>{event.title}</b>
            <span className="cg-muted">{event.venue}</span>
          </Card>
          <Section>
            <div className="cg-form">
              <Field label="Дата выезда">
                <input className="cg-input" type="date" value={date} min={todayIso} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <div className="cg-form-row">
                <Field label="Сбор">
                  <input className="cg-input" type="time" value={gathering} onChange={(e) => setGathering(e.target.value)} />
                </Field>
                <Field label="Вернёмся к">
                  <input className="cg-input" type="time" value={returning} onChange={(e) => setReturning(e.target.value)} />
                </Field>
              </div>
              {!timesOk && <p className="cg-error">Время возвращения должно быть позже сбора.</p>}
              <Field label="Где собираемся">
                <input className="cg-input" value={meeting} onChange={(e) => setMeeting(e.target.value)} />
              </Field>
              <Field label="Кто ещё сопровождает" hint="Например: Иванова А. П., помощник. Попадёт в приказ.">
                <input className="cg-input" value={escorts} placeholder="Необязательно" onChange={(e) => setEscorts(e.target.value)} />
              </Field>
              <div className="cg-form-row">
                <Field label="Ответить до">
                  <input className="cg-input" type="date" value={deadlineDate} min={todayIso} max={date || undefined}
                    onChange={(e) => setDeadlineDate(e.target.value)} />
                </Field>
                <Field label="Время">
                  <input className="cg-input" type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
                </Field>
              </div>
              {!deadlineOk && <p className="cg-error">Срок ответа — не раньше сегодня и не позже дня выезда.</p>}
            </div>
          </Section>
          <Notice tone="info" icon="bell">
            Тем, кто не ответит, ClassGo сам напомнит за 3 дня, за день и за 12 часов до срока.
          </Notice>
        </>
      )}

      {step === 3 && event && klass && (
        <>
          <Section title="Так увидят родители">
            <div className="cg-preview">
              <div className="cg-preview-bubble">
                <b>Ученик {klass.title}: приглашение на выезд</b>
                <p>
                  {quote(event.title)} — {event.venue}
                  <br />
                  Когда: {dayLong(date)}, сбор в {gathering} {meeting}, вернёмся к {returning}
                  <br />
                  {event.price > 0
                    ? `Билет ${money(event.price)} — оплачиваете сами в кассе${event.pushkin_eligible ? " или «Пушкинской картой» ребёнка (14+)" : ""}. Школа деньги не собирает.`
                    : "Вход бесплатный."}
                </p>
                <p className="cg-muted">Ваш ответ кнопкой считается подписью.</p>
              </div>
              <div className="cg-preview-buttons">
                <span>✅ Отпускаю</span>
                <span>✖ Не сможет</span>
                <span>Подробнее</span>
              </div>
            </div>
          </Section>
          <Card className="cg-sendto">
            <div className="cg-fact">
              <Icon name="chat" size={18} />
              <span>
                Приглашение в MAX получат <b>{connected}</b> из {total} {plural(total, "семьи", "семей", "семей")}.
              </span>
            </div>
            {total - connected > 0 && (
              <div className="cg-fact">
                <Icon name="share" size={18} />
                <span>
                  {total - connected} {plural(total - connected, "семья ещё не подключена", "семьи ещё не подключены", "семей ещё не подключены")} —
                  после отправки поделитесь ссылкой в чате класса.
                </span>
              </div>
            )}
            {klass.is_demo && (
              <div className="cg-fact">
                <Icon name="spark" size={18} />
                <span>Демо: виртуальные родители ответят сами, а вам придёт приглашение как родителю Тимура.</span>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
