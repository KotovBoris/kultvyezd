import { useEffect, useState } from "react";
import { api, type CultureEvent, type SchoolClass } from "../api";

export default function WizardScreen({
  classes,
  onCreated,
  onCancel,
}: {
  classes: SchoolClass[];
  onCreated: (excursionId: number) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);
  const [classId, setClassId] = useState<number | null>(classes[0]?.id ?? null);
  const [events, setEvents] = useState<CultureEvent[]>([]);
  const [age, setAge] = useState("");
  const [pushkin, setPushkin] = useState(false);
  const [free, setFree] = useState(false);
  const [selected, setSelected] = useState<CultureEvent | null>(null);
  const [gathering, setGathering] = useState("08:30");
  const [returnTime, setReturnTime] = useState("14:00");
  const [deadlineDays, setDeadlineDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const klass = classes.find((c) => c.id === classId) ?? null;

  useEffect(() => {
    if (step !== 2) return;
    api
      .events({ city: "Казань", age, pushkin: pushkin || undefined, free: free || undefined })
      .then(setEvents)
      .catch((e) => setMsg(`Ошибка каталога: ${e.message}`));
  }, [step, age, pushkin, free]);

  async function launch() {
    if (!selected || !classId) return;
    setBusy(true);
    setMsg(null);
    try {
      const exc = await api.createExcursion({
        class_id: classId,
        culture_event_id: selected.id,
        gathering_time: gathering,
        return_time: returnTime,
        deadline: new Date(Date.now() + deadlineDays * 24 * 3600 * 1000).toISOString(),
      });
      let publishNote = "";
      if (klass?.chat_id) {
        try {
          await api.publish(exc.id);
          publishNote = " Анонс отправлен в чат класса.";
        } catch (e: any) {
          publishNote = ` Публикация в чат не удалась: ${e.message}`;
        }
      } else {
        publishNote = " Чат класса не указан — анонс не публиковался (задайте чат в разделе «Классы»).";
      }
      setMsg(`Мероприятие «${exc.title}» запущено, рассылка родителям началась.${publishNote}`);
      onCreated(exc.id);
    } catch (e: any) {
      setMsg(`Не удалось создать мероприятие: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="kv-card">
        <div className="kv-row">
          <h3>Новое мероприятие — шаг {step} из 4</h3>
          <button className="kv-btn ghost" onClick={onCancel}>
            Отмена
          </button>
        </div>
        <p className="kv-muted">
          {step === 1 && "Выберите школу и класс, для которого организуется выезд."}
          {step === 2 && "Выберите событие из каталога. Фильтры: возраст, Пушкинская карта, бесплатные."}
          {step === 3 && "Укажите время сбора, возвращения и срок ответа родителей."}
          {step === 4 && "Проверьте данные и запустите рассылку."}
        </p>
      </div>

      {msg && <div className="kv-alert info">{msg}</div>}

      {step === 1 && (
        <div className="kv-card">
          {!classes.length && (
            <p className="kv-muted">Сначала создайте класс в разделе «Классы».</p>
          )}
          <div className="kv-filters">
            <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value) || null)}>
              <option value="">Выберите класс…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {c.school_name || "школа не указана"} · {c.students.length} уч.
                </option>
              ))}
            </select>
          </div>
          {klass && (
            <p className="kv-muted" style={{ marginTop: 8 }}>
              Школа: {klass.school_name || "не указана"}. Чат класса:{" "}
              {klass.chat_id ? "указан — анонс уйдёт в чат" : "не указан — анонс в чат не отправится"}.
            </p>
          )}
          <div className="kv-actions">
            <button className="kv-btn primary" disabled={!classId} onClick={() => setStep(2)}>
              Далее
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="kv-card">
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
            <div className="kv-actions">
              <button className="kv-btn ghost" onClick={() => setStep(1)}>
                Назад
              </button>
              <button className="kv-btn primary" disabled={!selected} onClick={() => setStep(3)}>
                Далее{selected ? `: ${selected.title}` : ""}
              </button>
            </div>
          </div>
          {events.map((ev) => (
            <div
              key={ev.id}
              className="kv-card"
              style={{ borderColor: selected?.id === ev.id ? "#6c4cf1" : undefined, cursor: "pointer" }}
              onClick={() => setSelected(ev)}
            >
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
                {selected?.id === ev.id && <span className="kv-chip">Выбрано</span>}
              </div>
            </div>
          ))}
        </>
      )}

      {step === 3 && selected && (
        <div className="kv-card">
          <h3>{selected.title}</h3>
          <div className="kv-filters">
            <label className="kv-chip">
              Сбор
              <input type="time" value={gathering} onChange={(e) => setGathering(e.target.value)} />
            </label>
            <label className="kv-chip">
              Возвращение
              <input type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
            </label>
            <label className="kv-chip">
              Ответ родителей: дней
              <input
                type="number"
                min={1}
                max={14}
                style={{ width: 50 }}
                value={deadlineDays}
                onChange={(e) => setDeadlineDays(Number(e.target.value) || 3)}
              />
            </label>
          </div>
          <p className="kv-muted" style={{ marginTop: 8 }}>
            Автонапоминания родителям без ответа уйдут за 3 дня, за день и за 12 часов до дедлайна.
          </p>
          <div className="kv-actions">
            <button className="kv-btn ghost" onClick={() => setStep(2)}>
              Назад
            </button>
            <button className="kv-btn primary" onClick={() => setStep(4)}>
              Далее
            </button>
          </div>
        </div>
      )}

      {step === 4 && selected && klass && (
        <div className="kv-card" style={{ borderColor: "#6c4cf1" }}>
          <h3>Проверьте и запустите</h3>
          <p className="kv-muted">
            Класс: <b>{klass.title}</b> ({klass.students.length} уч.), школа: {klass.school_name || "не указана"}
            <br />
            Событие: <b>{selected.title}</b>, {selected.venue}
            <br />
            Сбор {gathering}, возвращение {returnTime}, срок ответа — {deadlineDays} дн.
            <br />
            Стоимость: {selected.is_free ? "бесплатно" : `${selected.price.toFixed(0)} ₽`}
            {selected.pushkin_eligible ? " (доступна Пушкинская карта)" : ""}
          </p>
          <p className="kv-muted">
            После запуска все ученики класса добавятся в список, родителям с активированным ботом уйдёт
            рассылка, анонс опубликуется в чат класса (если указан).
          </p>
          <div className="kv-actions">
            <button className="kv-btn ghost" onClick={() => setStep(3)}>
              Назад
            </button>
            <button className="kv-btn primary" disabled={busy} onClick={launch}>
              {busy ? "Запускаем…" : "Запустить мероприятие"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
