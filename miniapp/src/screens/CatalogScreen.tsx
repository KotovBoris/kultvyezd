import { useEffect, useState } from "react";
import { api, type CultureEvent, type SchoolClass } from "../api";

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

  return (
    <>
      <div className="kv-card">
        <h3>Каталог культурных событий</h3>
        <p className="kv-muted">
          Модельные данные (снапшот PRO.Культура.РФ / «Пушкинская карта»). Фильтры: город Казань,
          возрастной ценз, доступность по «Пушкинской карте», бесплатные.
        </p>
        <div className="kv-filters">
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

      {events.map((ev) => (
        <div key={ev.id} className="kv-card">
          <div className="kv-row">
            <h3>{ev.title}</h3>
            <span className="kv-chip">{ev.age_rating}</span>
          </div>
          <p className="kv-muted">
            {ev.venue} · {ev.address} · {ev.duration_min} мин · {ev.event_date ?? "дата уточняется"}
          </p>
          <div className="kv-wrap" style={{ marginTop: 6 }}>
            {ev.pushkin_eligible && <span className="kv-chip pushkin">Пушкинская карта</span>}
            {ev.is_free ? (
              <span className="kv-chip free">Бесплатно</span>
            ) : (
              <span className="kv-chip">{ev.price.toFixed(0)} ₽</span>
            )}
          </div>
          <div className="kv-actions">
            <button className="kv-btn primary" onClick={() => setSelected(ev)}>
              Выбрать событие
            </button>
          </div>
        </div>
      ))}

      {selected && (
        <div className="kv-card" style={{ borderColor: "#6c4cf1" }}>
          <h3>Новый выезд: {selected.title}</h3>
          <div className="kv-filters">
            <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {c.students.length} уч.
                </option>
              ))}
            </select>
            <label className="kv-chip">
              Сбор
              <input type="time" value={gathering} onChange={(e) => setGathering(e.target.value)} />
            </label>
            <label className="kv-chip">
              Возвращение
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
    </>
  );
}
