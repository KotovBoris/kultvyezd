// avoid-ai-design-ignore-file: L4 — в этом экране нет «ленты метрик»: под L4 попал
// фильтр возрастного ценза (0+/6+/12+/16+), это реальный фильтр каталога.
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type CultureEvent, type EventSort, type SchoolClass, type SortOrder } from "../api";
import { ageBlockReason, splitByAge, upcomingRange, weekendRange } from "../age";
import { IconCalendar, IconPin, IconSearch } from "../icons";
import Alert from "../components/Alert";
import SkeletonLoader from "../components/Skeleton";

const SORT_LABELS: Record<EventSort, string> = {
  date: "по дате",
  price: "по цене",
  duration: "по длительности",
};

export default function CatalogScreen({
  classes,
  onCreated,
}: {
  classes: SchoolClass[];
  onCreated: (excursionId: number) => void;
}) {
  const [events, setEvents] = useState<CultureEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [age, setAge] = useState("");
  const [pushkin, setPushkin] = useState(false);
  const [free, setFree] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<EventSort>("date");
  const [order, setOrder] = useState<SortOrder>("asc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ageFit, setAgeFit] = useState(false);
  const [filterClassId, setFilterClassId] = useState<number | null>(classes[0]?.id ?? null);
  const [selected, setSelected] = useState<CultureEvent | null>(null);
  const [classId, setClassId] = useState<number | null>(classes[0]?.id ?? null);
  const [gathering, setGathering] = useState("08:30");
  const [returnTime, setReturnTime] = useState("14:00");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"info" | "ok" | "err">("info");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .events({
        city: "Казань",
        age,
        pushkin: pushkin || undefined,
        free: free || undefined,
        sort,
        order_by: order,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      .then((list) => {
        if (cancelled) return;
        setEvents(list);
        setMsg(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setMsg(`Ошибка каталога: ${e.message}`);
        setMsgTone("err");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [age, pushkin, free, sort, order, dateFrom, dateTo]);

  // Досыпаем id первого класса, когда классы пришли позже (экран мог открыться
  // до их загрузки). Зависим от classes[0].id, а не от массива: новая ссылка на
  // тот же список больше не запускает эффект и не даёт лишний setState.
  const firstClassId = classes[0]?.id;
  useEffect(() => {
    if (classId === null && firstClassId) setClassId(firstClassId);
  }, [firstClassId, classId]);

  useEffect(() => {
    if (filterClassId === null && firstClassId) setFilterClassId(firstClassId);
  }, [firstClassId, filterClassId]);

  async function create() {
    if (!selected || !classId) return;
    setBusy(true);
    setMsg(null);
    try {
      const exc = await api.createExcursion({
        class_id: classId,
        culture_event_id: selected.id,
        gathering_time: gathering,
        return_time: returnTime,
        deadline: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
      });
      setMsg(`Выезд «${exc.title}» создан — участники добавлены автоматически.`);
      setMsgTone("ok");
      onCreated(exc.id);
    } catch (e: any) {
      setMsg(`Не удалось создать выезд: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusy(false);
    }
  }

  function applyPreset(kind: "upcoming" | "weekend") {
    const range = kind === "upcoming" ? upcomingRange() : weekendRange();
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  // Клиентский поиск по названию/площадке + авто-фильтр «подходит классу по возрасту».
  // Мемоизируем: эти вычисления не должны повторяться на каждый рендер формы
  // оформления (ввод сбора/возвращения, выбор класса и т.п.).
  const needle = q.trim().toLowerCase();
  const searched = useMemo(
    () => (needle ? events.filter((e) => (e.title + e.venue).toLowerCase().includes(needle)) : events),
    [events, needle],
  );
  const filterClass = useMemo(
    () => classes.find((c) => c.id === filterClassId) ?? null,
    [classes, filterClassId],
  );
  const ageSplit = useMemo(
    () => (ageFit && filterClass ? splitByAge(searched, filterClass) : null),
    [ageFit, filterClass, searched],
  );
  const shown = ageSplit ? ageSplit.fit : searched;
  const blocked = ageSplit ? ageSplit.blocked : [];

  // Единственный источник «пусто/загружаем»: «не подошло» показываем только
  // после завершения загрузки, иначе пустой список выглядит как мёртвый экран.
  const empty = !loading && !shown.length;

  return (
    <>
      <div className="kv-card">
        <p className="kv-section">Каталог событий · Казань</p>
        <p className="kv-muted" style={{ marginTop: 0 }}>
          Модельные данные (снапшот PRO.Культура.РФ / «Пушкинская карта»). Реальная интеграция —
          следующий шаг.
        </p>
        {/* Доступное имя полю поиска: placeholder — только пример, не подпись (§4.1/§4.10) */}
        <label className="kv-chip" style={{ marginTop: 10 }}>
          <IconSearch size={13} />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="поиск по названию"
            aria-label="Поиск по названию или площадке"
            style={{ border: "none", outline: "none", width: "10rem", background: "transparent", font: "inherit" }}
          />
        </label>
        <div className="kv-filters" style={{ marginTop: 10 }}>
          <select value={age} onChange={(e) => setAge(e.target.value)} aria-label="Возраст">
            <option value="">Любой возраст</option>
            <option value="0+">0+</option>
            <option value="6+">6+</option>
            <option value="12+">12+</option>
            <option value="16+">16+</option>
          </select>
          <label className="kv-chip">
            <input type="checkbox" checked={pushkin} onChange={(e) => setPushkin(e.target.checked)} />
            Пушкинская карта
          </label>
          <label className="kv-chip">
            <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
            Бесплатные
          </label>
        </div>

        {/* Сортировка: поле + направление (по дате по умолчанию) */}
        <div className="kv-filters">
          <select value={sort} onChange={(e) => setSort(e.target.value as EventSort)} aria-label="Сортировка">
            <option value="date">{`Сортировка: ${SORT_LABELS.date}`}</option>
            <option value="price">{`Сортировка: ${SORT_LABELS.price}`}</option>
            <option value="duration">{`Сортировка: ${SORT_LABELS.duration}`}</option>
          </select>
          <button
            type="button"
            className="kv-btn ghost"
            aria-label={order === "asc" ? "Направление: по возрастанию" : "Направление: по убыванию"}
            onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))}
          >
            {order === "asc" ? "↑ возрастание" : "↓ убывание"}
          </button>
        </div>

        {/* Период: пресеты афиши + явный диапазон */}
        <div className="kv-filters">
          <button type="button" className="kv-btn ghost" onClick={() => applyPreset("upcoming")}>
            Ближайшие 7 дней
          </button>
          <button type="button" className="kv-btn ghost" onClick={() => applyPreset("weekend")}>
            На этих выходных
          </button>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              className="kv-btn ghost"
              aria-label="Сбросить период"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Сбросить период
            </button>
          )}
        </div>
        <div className="kv-filters">
          <label className="kv-chip">
            с
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Дата, с которой показывать события"
            />
          </label>
          <label className="kv-chip">
            по
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Дата, до которой показывать события"
            />
          </label>
        </div>

        {/* Авто-фильтр «подходит моему классу по возрасту» — по датам рождения класса */}
        <div className="kv-filters">
          <select
            value={filterClassId ?? ""}
            onChange={(e) => setFilterClassId(Number(e.target.value))}
            aria-label="Класс для авто-фильтра по возрасту"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.students.length} уч.
              </option>
            ))}
          </select>
          <label className="kv-chip">
            <input type="checkbox" checked={ageFit} onChange={(e) => setAgeFit(e.target.checked)} />
            Только по возрасту класса
          </label>
        </div>
        {ageFit && !filterClass && (
          <p className="kv-muted" role="status" aria-live="polite" style={{ margin: 0 }}>
            Нет класса, к которому подбирать, — фильтр не применён.
          </p>
        )}
        {ageFit && ageSplit && ageSplit.youngest === null && (
          <p className="kv-muted" role="status" aria-live="polite" style={{ margin: 0 }}>
            У класса нет дат рождения учеников — возраст не определить, фильтр не применён.
          </p>
        )}

        {/* Фильтр перезагружает список — озвучиваем смену состояния скринридеру */}
        <p className="kv-muted" role="status" aria-live="polite" style={{ margin: 0 }}>
          {loading ? "Загружаем каталог…" : `Найдено событий: ${shown.length}`}
        </p>
      </div>

      {msg && <Alert tone={msgTone}>{msg}</Alert>}

      <div className="kv-card">
        {loading ? (
          <SkeletonLoader />
        ) : (
          <>
            <table className="kv-table">
              <thead>
                <tr>
                  <th>Событие и площадка</th>
                  <th>Дата</th>
                  <th>Возраст</th>
                  <th>Цена</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((ev) => {
                  const isOpen = selected?.id === ev.id;
                  return (
                    <Fragment key={ev.id}>
                      <tr className={isOpen ? "is-active" : undefined}>
                        <td>
                          {/* Клик по строке выбирает событие; повторный клик сворачивает форму */}
                          <button
                            type="button"
                            className="kv-eventbtn"
                            aria-expanded={isOpen}
                            onClick={() => setSelected(isOpen ? null : ev)}
                          >
                            <b>{ev.title}</b>
                            <span className="kv-muted">
                              <IconPin size={12} /> {ev.venue}
                            </span>
                            <span className="kv-wrap" style={{ marginTop: 4 }}>
                              {ev.pushkin_eligible && <span className="kv-chip pushkin">Пушкинская карта</span>}
                              {ev.is_free && <span className="kv-chip free">Бесплатно</span>}
                            </span>
                          </button>
                        </td>
                        <td className="kv-data">
                          <IconCalendar size={12} /> {ev.event_date ?? "—"}
                        </td>
                        <td className="kv-muted">{ev.age_rating}</td>
                        <td className="kv-data">{ev.is_free ? "0 ₽" : `${ev.price.toFixed(0)} ₽`}</td>
                      </tr>

                      {/* Форма оформления раскрывается тут же, под выбранным событием */}
                      {isOpen && (
                        <tr className="kv-order-row">
                          <td colSpan={4}>
                            <div className="kv-inline-order">
                              <div className="kv-row" style={{ marginBottom: 8 }}>
                                <b>Оформление выезда</b>
                                <button className="kv-btn ghost" onClick={() => setSelected(null)}>
                                  Отмена
                                </button>
                              </div>
                              <div className="kv-filters">
                                <select
                                  value={classId ?? ""}
                                  onChange={(e) => setClassId(Number(e.target.value))}
                                  aria-label="Класс"
                                >
                                  {classes.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.title} · {c.students.length} уч.
                                    </option>
                                  ))}
                                </select>
                                <label className="kv-chip">
                                  сбор
                                  <input
                                    type="time"
                                    value={gathering}
                                    onChange={(e) => setGathering(e.target.value)}
                                    aria-label="Время сбора"
                                  />
                                </label>
                                <label className="kv-chip">
                                  возвращение
                                  <input
                                    type="time"
                                    value={returnTime}
                                    onChange={(e) => setReturnTime(e.target.value)}
                                    aria-label="Время возвращения"
                                  />
                                </label>
                              </div>
                              <div className="kv-actions">
                                <button className="kv-btn primary" disabled={busy || !classId} onClick={create}>
                                  {busy ? "Создаём…" : "Создать выезд"}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {empty && <div className="kv-empty" style={{ marginTop: 10 }}>Под фильтры ничего не подошло.</div>}
            {!empty && !selected && (
              <p className="kv-muted" style={{ marginTop: 10, marginBottom: 0 }}>
                Нажмите на событие, чтобы оформить выезд.
              </p>
            )}
          </>
        )}
      </div>

      {/* Почему события не в списке: авто-фильтр по возрасту класса объясним, не молчит */}
      {blocked.length > 0 && ageSplit && (
        <div className="kv-card">
          <p className="kv-section">Снято по возрасту класса</p>
          <p className="kv-muted" style={{ marginTop: 0 }}>
            Младшему ученику класса {ageSplit.youngest} лет — события ниже не показываем, чтобы не
            ошибиться с возрастным цензом.
          </p>
          <ul className="kv-skipped">
            {blocked.map((ev) => (
              <li key={ev.id}>
                {ev.title} — {ageBlockReason(ev, ageSplit.youngest)}
              </li>
            ))}
          </ul>
        </div>
      )}

    </>
  );
}
