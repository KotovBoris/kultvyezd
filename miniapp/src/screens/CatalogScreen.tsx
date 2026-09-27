import { useEffect, useState } from "react";
import { api, type CultureEvent, type SchoolClass } from "../api";
import { IconCalendar, IconPin, IconSearch } from "../icons";

export default function CatalogScreen({
  classes,
  onCreated,
}: {
  classes: SchoolClass[];
  onCreated: (excursionId: number) => void;
}) {
  const [events, setEvents] = useState<CultureEvent[]>([]);
  const [age, setAge] = useState("");
  const [pushkin, setPushkin] = useState(false);
  const [free, setFree] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CultureEvent | null>(null);
  const [classId, setClassId] = useState<number | null>(classes[0]?.id ?? null);
  const [gathering, setGathering] = useState("08:30");
  const [returnTime, setReturnTime] = useState("14:00");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .events({ city: "Казань", age, pushkin: pushkin || undefined, free: free || undefined })
      .then(setEvents)
      .catch((e) => setMsg(`Ошибка каталога: ${e.message}`));
  }, [age, pushkin, free]);

  useEffect(() => {
    if (classId === null && classes[0]) setClassId(classes[0].id);
  }, [classes]);

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
      onCreated(exc.id);
    } catch (e: any) {
      setMsg(`Не удалось создать выезд: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const shown = events.filter((e) =>
    q.trim() ? (e.title + e.venue).toLowerCase().includes(q.trim().toLowerCase()) : true,
  );

  return (
    <>
      <div className="kv-card">
        <p className="kv-section">Каталог событий · Казань</p>
        <p className="kv-muted">
          Модельные данные (снапшот PRO.Культура.РФ / «Пушкинская карта»). Реальная интеграция —
          следующий шаг.
        </p>
        <div className="kv-filters" style={{ marginTop: 10 }}>
          <label className="kv-chip">
            <IconSearch size={13} />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="поиск по названию"
              style={{ border: "none", outline: "none", width: 150, background: "transparent", font: "inherit" }}
            />
          </label>
          {/* avoid-ai-design-ignore: L4 — это возрастной ценз события (0+/6+/12+/16+),
              осмысленный фильтр каталога, а не «лента метрик ради доказательства» */}
          <select value={age} onChange={(e) => setAge(e.target.value)}>
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
      </div>

      {msg && <div className="kv-alert info">{msg}</div>}

      {/* Каталог как перечень документов: строки, а не карточки */}
      <div className="kv-card">
        <table className="kv-table">
          <thead>
            <tr>
              <th style={{ width: 24 }}>№</th>
              <th>Событие и площадка</th>
              <th>Дата</th>
              <th>Возраст</th>
              <th>Цена</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((ev, i) => (
              <tr key={ev.id}>
                <td className="kv-num">{i + 1}</td>
                <td>
                  <b>{ev.title}</b>
                  <div className="kv-muted">
                    <IconPin size={12} /> {ev.venue}
                  </div>
                  <div className="kv-wrap" style={{ marginTop: 4 }}>
                    {ev.pushkin_eligible && <span className="kv-chip pushkin">Пушкинская карта</span>}
                    {ev.is_free && <span className="kv-chip free">Бесплатно</span>}
                  </div>
                </td>
                <td className="kv-data">
                  <IconCalendar size={12} /> {ev.event_date ?? "—"}
                </td>
                <td className="kv-muted">{ev.age_rating}</td>
                <td className="kv-data">{ev.is_free ? "0 ₽" : `${ev.price.toFixed(0)} ₽`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="kv-muted" style={{ marginTop: 8 }}>Ничего не найдено.</p>}
      </div>

      {selected && (
        <div className="kv-card" style={{ borderColor: "var(--ink)" }}>
          <p className="kv-section">Оформление выезда</p>
          <h3>{selected.title}</h3>
          <div className="kv-filters">
            <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {c.students.length} уч.
                </option>
              ))}
            </select>
            <label className="kv-chip">
              сбор
              <input type="time" value={gathering} onChange={(e) => setGathering(e.target.value)} />
            </label>
            <label className="kv-chip">
              возвращение
              <input type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
            </label>
          </div>
          <div className="kv-actions">
            <button className="kv-btn primary" disabled={busy || !classId} onClick={create}>
              {busy ? "Создаём…" : "Создать выезд"}
            </button>
            <button className="kv-btn ghost" onClick={() => setSelected(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Выбор события — отдельная кнопка в строке каталога */}
      {!selected && shown.length > 0 && (
        <div className="kv-card">
          <p className="kv-section">Выбор события</p>
          <div className="kv-filters">
            <select
              defaultValue=""
              onChange={(e) => {
                const ev = shown.find((x) => String(x.id) === e.target.value);
                if (ev) setSelected(ev);
              }}
            >
              <option value="">Выбрать из каталога…</option>
              {shown.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} — {ev.venue}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </>
  );
}
