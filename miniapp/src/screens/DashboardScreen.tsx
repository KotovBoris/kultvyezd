import { useEffect, useMemo, useState } from "react";
import {
  api,
  type AttachmentOption,
  type Dashboard,
  type EmergencyContacts,
  type ParticipantRow,
} from "../api";
import { currentChatId, downloadFile, haptic, openLink } from "../max";
import { IconBell, IconCard, IconDoc, IconDownload, IconMegaphone, IconPhone, IconSearch } from "../icons";
import Alert from "../components/Alert";
import SkeletonLoader from "../components/Skeleton";

/**
 * Приложения пакета документов по умолчанию. Дублируют реестр бэкенда
 * (documents.ATTACHMENTS) как fallback, если каталог не загрузился: юридически
 * значимые приложения (маршрутный лист, уведомление ГИБДД, согласие на ПДн)
 * включены сразу, их можно снять галочкой перед генерацией.
 */
const DEFAULT_ATTACHMENTS: AttachmentOption[] = [
  { key: "students", title: "Список участников группы" },
  { key: "consents", title: "Реестр цифровых согласий законных представителей" },
  { key: "briefing", title: "Лист целевого инструктажа по ТБ и ПДД" },
  { key: "route", title: "Маршрутный лист (ПП РФ №1527)" },
  { key: "gibdd", title: "Уведомление в ГИБДД (ПП РФ №1527)" },
  { key: "pdn", title: "Согласие на обработку ПДн (152-ФЗ)" },
];

/** Подпись статуса (заголовки — предложение, без ALL-CAPS) */
const LABEL: Record<ParticipantRow["traffic_light"], string> = {
  GREEN: "Готов",
  YELLOW: "Ждём билет",
  GREY: "Нет ответа",
  RED: "Отказ",
};

/**
 * Обратный отсчёт до дедлайна сбора ответов: «Осталось 2 дн 4 ч». Значение
 * пересчитывается по таймеру (раз в минуту), поэтому «срочность» не застывает
 * на моменте загрузки страницы. Прошедший дедлайн — это факт, а не «-3 дня».
 */
function formatCountdown(
  deadline: string | null,
  now: number,
): { text: string; urgent: boolean } | null {
  if (!deadline) return null;
  const target = new Date(deadline).getTime();
  if (Number.isNaN(target)) return null;
  const diff = target - now;
  if (diff <= 0) return { text: "Срок сбора ответов истёк", urgent: true };
  const totalHours = Math.floor(diff / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return { text: `Осталось ${days} дн ${hours} ч`, urgent: days <= 1 };
  if (hours > 0) return { text: `Осталось ${hours} ч ${minutes} мин`, urgent: true };
  return { text: `Осталось ${minutes} мин`, urgent: true };
}

/** Согласие словами — от лица учителя («подписал», «ждём») */
function consentText(p: ParticipantRow): string {
  if (p.consent_status === "APPROVED") return p.signed_by_name ? `Подписал ${p.signed_by_name}` : "Подписано";
  if (p.consent_status === "REJECTED") return `Отказ: ${p.rejection_reason ?? "без причины"}`;
  return "Ждём ответа";
}

/** Билет словами */
function ticketText(p: ParticipantRow): string {
  if (p.ticket_status === "PAID") return p.ticket_number ? `Куплен, № ${p.ticket_number}` : "Куплен";
  if (p.ticket_status === "NOT_REQUIRED") return "Не нужен";
  return "Не оплачен";
}

/**
 * Кнопка одного действия: во время запроса дизейблится (и только она, а не весь
 * экран) и подписывается своим состоянием — «Напоминаем…», «Формируем…» и т.п.
 * В отличие от глобального `busy`, остальные кнопки блока остаются нажимаемыми.
 */
function ActionButton({
  busy,
  busyLabel,
  className = "kv-btn",
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  busyLabel: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${className}${busy ? " busy" : ""}`}
      aria-busy={busy}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? (
        <>
          <span className="kv-spin" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export default function DashboardScreen({
  excursionId,
  onChange,
}: {
  excursionId: number;
  onChange: () => void;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"info" | "ok" | "err">("info");
  // Какое именно действие идёт сейчас: publish | remind | order | send | contacts.
  const [busyAction, setBusyAction] = useState<
    "publish" | "remind" | "order" | "send" | "contacts" | null
  >(null);
  // Каталог приложений (с бэкенда) и выбранные галочками — состав пакета документов.
  const [attachmentOptions, setAttachmentOptions] = useState<AttachmentOption[]>(DEFAULT_ATTACHMENTS);
  const [chosen, setChosen] = useState<string[]>(DEFAULT_ATTACHMENTS.map((a) => a.key));
  // Раскрытие блока «Какие приложения включить» перед генерацией/отправкой.
  const [showAttach, setShowAttach] = useState(false);
  // Текущее время — для живого обратного отсчёта до дедлайна (без него «срочность» мертва).
  const [now, setNow] = useState(() => Date.now());
  // Поиск по имени и фильтр строк списка класса по статусу «Светофора».
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ParticipantRow["traffic_light"]>("ALL");
  // Сводка экстренных телефонов: грузим по запросу, не тянем зря (персональные данные).
  const [contacts, setContacts] = useState<EmergencyContacts | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // id чата класса: внутри MAX известен сразу, вне MAX спрашиваем вручную.
  const [chatId, setChatId] = useState<number | null>(currentChatId());
  // askChat — диалог ввода id чата; askChatFor — какое действие его открыло,
  // чтобы кнопка «Опубликовать» подтвердила именно его (публикация или файл).
  const [askChat, setAskChat] = useState(false);
  const [askChatFor, setAskChatFor] = useState<"publish" | "send">("publish");
  const [chatInput, setChatInput] = useState("");

  async function load() {
    try {
      setData(await api.dashboard(excursionId));
    } catch (e: any) {
      setMsg(`Ошибка загрузки: ${e.message}`);
      setMsgTone("err");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excursionId]);

  // Каталог приложений — один раз: какие приложения доступны для пакета документов.
  useEffect(() => {
    let cancelled = false;
    api
      .attachments()
      .then((r) => {
        if (cancelled || !r.attachments?.length) return;
        setAttachmentOptions(r.attachments);
        setChosen(r.attachments.map((a) => a.key));
      })
      .catch(() => {
        /* не критично: остаются приложения по умолчанию */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleAttachment(key: string, on: boolean) {
    setChosen((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key)));
  }

  // Обновляем обратный отсчёт раз в минуту: «осталось 4 ч 3 мин» должно жить.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Новый выезд — сбрасываем поиск/фильтр и ранее загруженные телефоны.
  useEffect(() => {
    setQuery("");
    setStatusFilter("ALL");
    setContacts(null);
  }, [excursionId]);

  // Мемоизированные выборки из ведомости. Хуки обязаны идти до early-return
  // `if (!data)`, поэтому считаем их над ним (порядок хуков должен быть стабилен).
  const participants = data?.participants ?? [];
  // Ряды мест: 4 места в ряд (автобус), номер места — сквозной. Перестраиваем
  // только при смене ведомости: ввод в поиске/номер билета иначе считал бы это заново.
  const bays = useMemo(() => {
    const rows: { seat: number; p: ParticipantRow }[][] = [];
    participants.forEach((p, i) => {
      const row = Math.floor(i / 4);
      if (!rows[row]) rows[row] = [];
      rows[row].push({ seat: i + 1, p });
    });
    return rows;
  }, [participants]);

  // Поиск по имени + фильтр строк списка класса по статусу «Светофора».
  const needle = query.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      participants.filter((p) => {
        if (statusFilter !== "ALL" && p.traffic_light !== statusFilter) return false;
        return needle ? p.full_name.toLowerCase().includes(needle) : true;
      }),
    [participants, needle, statusFilter],
  );

  // Пока ведомость грузится — скелетон формы будущего контента, а не «Загрузка…».
  if (!data) return <SkeletonLoader />;

  const { excursion: exc, summary } = data;
  const total = participants.length || 1;

  const selectedP = participants.find((p) => p.student_id === selected) ?? null;
  const selectedSeat = participants.findIndex((p) => p.student_id === selected) + 1;

  // Обратный отсчёт до дедлайна — «срочность» считается заново, не застывает.
  const countdown = formatCountdown(exc.deadline, now);

  const filtering = Boolean(needle) || statusFilter !== "ALL";

  async function loadContacts() {
    setBusyAction("contacts");
    setMsg(null);
    try {
      const r = await api.emergencyContacts(excursionId);
      setContacts(r);
      setMsgTone("info");
    } catch (e: any) {
      setMsg(`Ошибка загрузки телефонов: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusyAction(null);
    }
  }

  async function remind() {
    setBusyAction("remind");
    setMsg(null);
    try {
      const r = await api.remind(excursionId);
      setMsg(`Напоминания отправлены: адресатов ${r.targeted}, доставлено ${r.delivered}.`);
      setMsgTone("ok");
      haptic();
    } catch (e: any) {
      setMsg(`Ошибка напоминаний: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusyAction(null);
    }
  }

  async function publishToChat() {
    const target = chatId ?? (/^-?\d+$/.test(chatInput.trim()) ? Number(chatInput.trim()) : null);
    if (!target) {
      setAskChatFor("publish");
      setAskChat(true);
      return;
    }
    setBusyAction("publish");
    setMsg(null);
    try {
      const r = await api.publish(excursionId, target);
      setChatId(target);
      setAskChat(false);
      const ok = r.ok;
      setMsg(
        ok
          ? "Карточка выезда опубликована в чат класса."
          : "Запрос отправлен, но бот выключен — публикация не доставлена.",
      );
      setMsgTone(ok ? "ok" : "info");
      haptic();
    } catch (e: any) {
      setMsg(`Ошибка публикации: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusyAction(null);
    }
  }

  async function generateOrder() {
    setBusyAction("order");
    setMsg(null);
    try {
      const r = await api.generateOrder(excursionId, chosen);
      setMsg(
        `Приказ сформирован (версия ${r.version}, приложений: ${chosen.length}). ` +
          "Если файл не скачался — ссылки ниже.",
      );
      setMsgTone("ok");
      downloadFile(api.exportOrderUrl(excursionId, "docx", chosen), `Приказ_выезд_${excursionId}.docx`);
      haptic();
    } catch (e: any) {
      setMsg(`Ошибка генерации: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusyAction(null);
    }
  }

  async function sendOrderToChat() {
    const target = chatId ?? (/^-?\d+$/.test(chatInput.trim()) ? Number(chatInput.trim()) : null);
    if (!target) {
      setAskChatFor("send");
      setAskChat(true);
      return;
    }
    setBusyAction("send");
    setMsg(null);
    try {
      const r = await api.sendOrder(excursionId, { chatId: target, fmt: "docx", attach: chosen });
      setChatId(target);
      setAskChat(false);
      setMsg(r.message);
      setMsgTone(r.delivered ? "ok" : "info");
      if (r.delivered) haptic();
    } catch (e: any) {
      setMsg(`Ошибка отправки файла: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusyAction(null);
    }
  }

  const docxUrl = api.exportOrderUrl(excursionId, "docx", chosen);
  const pdfUrl = api.exportOrderUrl(excursionId, "pdf", chosen);

  return (
    <>
      {/* Список класса: статус сбора, факты выезда, действия */}
      <div className="kv-card">
        <p className="kv-section">Ведомость класса · {participants.length} чел.</p>
        <table className="kv-table">
          <tbody>
            <tr>
              <td className="kv-key">Место</td>
              <td>
                {exc.location_name}
                {exc.address ? <div className="kv-muted">{exc.address}</div> : null}
              </td>
            </tr>
            <tr>
              <td className="kv-key">Дата</td>
              <td className="kv-data">{exc.event_date ?? "уточняется"}</td>
            </tr>
            <tr>
              <td className="kv-key">Сбор</td>
              <td className="kv-data">
                {exc.gathering_time && exc.return_time
                  ? `${exc.gathering_time} — ${exc.return_time}`
                  : exc.gathering_time || exc.return_time || "уточняется"}
              </td>
            </tr>
            <tr>
              <td className="kv-key">Дедлайн</td>
              <td className="kv-data">
                {exc.deadline ? new Date(exc.deadline).toLocaleString("ru-RU") : "—"}
                {countdown && (
                  /* Счётчик пересчитывается раз в минуту — не делаем его live-region,
                     иначе скринридер «бубнит» каждую минуту; срочность видна цветом. */
                  <div className={`kv-countdown${countdown.urgent ? " urgent" : ""}`}>{countdown.text}</div>
                )}
              </td>
            </tr>
            <tr>
              <td className="kv-key">Условия</td>
              <td>
                <div className="kv-wrap">
                  {exc.is_pushkin_card && <span className="kv-chip pushkin">Пушкинская карта</span>}
                  {exc.ticket_price > 0 ? (
                    <span className="kv-chip money">{exc.ticket_price.toFixed(0)} ₽ · оплата в кассе</span>
                  ) : (
                    <span className="kv-chip free">Бесплатно</span>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="kv-bar" role="img" aria-label="Состав списка по статусам">
          <i className="seg-GREEN" style={{ width: `${(summary.GREEN / total) * 100}%` }} />
          <i className="seg-YELLOW" style={{ width: `${(summary.YELLOW / total) * 100}%` }} />
          <i className="seg-GREY" style={{ width: `${(summary.GREY / total) * 100}%` }} />
          <i className="seg-RED" style={{ width: `${(summary.RED / total) * 100}%` }} />
        </div>
        <div className="kv-counts">
          <span className="c-GREEN">Готов: {summary.GREEN}</span>
          <span className="c-YELLOW">Ждём билет: {summary.YELLOW}</span>
          <span className="c-GREY">Нет ответа: {summary.GREY}</span>
          <span className="c-RED">Отказ: {summary.RED}</span>
        </div>

        <div className="kv-actions">
          <ActionButton
            className="kv-btn primary"
            busy={busyAction === "publish"}
            busyLabel="Публикуем…"
            onClick={publishToChat}
          >
            <IconMegaphone /> Опубликовать в чат класса
          </ActionButton>
          <ActionButton
            busy={busyAction === "remind"}
            busyLabel="Напоминаем…"
            onClick={remind}
          >
            <IconBell /> Напомнить не ответившим
          </ActionButton>
          <ActionButton
            busy={busyAction === "order"}
            busyLabel="Формируем…"
            onClick={generateOrder}
          >
            <IconDoc /> Сформировать приказ
          </ActionButton>
          <ActionButton
            busy={busyAction === "send"}
            busyLabel="Отправляем…"
            onClick={sendOrderToChat}
          >
            <IconDoc /> Отправить приказ в чат
          </ActionButton>
          <button
            type="button"
            className="kv-btn ghost"
            aria-expanded={showAttach}
            aria-controls="kv-attach"
            onClick={() => setShowAttach((v) => !v)}
          >
            Приложения: {chosen.length} из {attachmentOptions.length}
          </button>
          <ActionButton
            busy={busyAction === "contacts"}
            busyLabel="Загружаем…"
            onClick={loadContacts}
          >
            <IconPhone /> Экстренные телефоны
          </ActionButton>
          {exc.ticket_sale_url && (
            <button className="kv-btn ghost" onClick={() => openLink(exc.ticket_sale_url)}>
              <IconCard /> Билетный шлюз
            </button>
          )}
        </div>

        {showAttach && (
          <fieldset id="kv-attach" className="kv-attach">
            <legend className="kv-muted">Какие приложения включить в пакет документов</legend>
            <p className="kv-muted" style={{ marginTop: 0 }}>
              Маршрутный лист и уведомление в ГИБДД обязательны при перевозке детей автобусом
              (ПП РФ №1527), согласие на ПДн — по 152-ФЗ. Снимите галочку, если приложение не нужно.
            </p>
            <div className="kv-wrap">
              {attachmentOptions.map((a) => (
                <label key={a.key} className="kv-chip" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(a.key)}
                    onChange={(e) => toggleAttachment(a.key, e.target.checked)}
                  />
                  {a.title}
                </label>
              ))}
            </div>
            {chosen.length === 0 && (
              <p className="kv-muted" role="status">
                Приложений не выбрано — будет сформирован только приказ.
              </p>
            )}
          </fieldset>
        )}

        {askChat && (
          <div className="kv-chatpick">
            <label className="kv-muted" htmlFor="kv-chat-id">
              Вне MAX чат класса не определён автоматически. Укажите id чата, куда
              публиковать карточку или отправить файл приказа (внутри MAX он подставляется сам).
            </label>
            <div className="kv-filters" style={{ marginTop: 6 }}>
              <input
                id="kv-chat-id"
                type="text"
                inputMode="numeric"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="например, -7123456789"
                aria-label="id чата класса"
              />
              <ActionButton
                busy={busyAction === askChatFor}
                busyLabel={askChatFor === "send" ? "Отправляем…" : "Публикуем…"}
                onClick={() => (askChatFor === "send" ? sendOrderToChat() : publishToChat())}
              >
                {askChatFor === "send" ? "Отправить файл" : "Опубликовать"}
              </ActionButton>
              <button className="kv-btn ghost" onClick={() => setAskChat(false)}>
                Отмена
              </button>
            </div>
          </div>
        )}
        {msg && (
          <Alert tone={msgTone} style={{ marginTop: 10 }}>
            {msg}
          </Alert>
        )}
        <div className="kv-files">
          <span className="kv-muted">Файлы приказа</span>
          <a className="kv-btn ghost" href={docxUrl} download>
            <IconDownload /> DOCX (прямая ссылка)
          </a>
          <a className="kv-btn ghost" href={pdfUrl} download>
            <IconDownload /> PDF (прямая ссылка)
          </a>
          <a className="kv-btn ghost" href={api.participantsCsvUrl(excursionId)} download>
            <IconDownload /> Список для туроператора (CSV)
          </a>
          <button className="kv-btn ghost" onClick={onChange}>
            Обновить
          </button>
        </div>

        {/* Экстренные телефоны — сводка по выезду, свёрнута по умолчанию (ПДн) */}
        {contacts && (
          <div className="kv-emergency">
            <p className="kv-section" style={{ marginBottom: 6 }}>
              Экстренные телефоны · {contacts.total}
            </p>
            {contacts.responsible_teacher && (
              <p className="kv-muted" style={{ marginTop: 0 }}>
                Ответственный сопровождающий: {contacts.responsible_teacher}
              </p>
            )}
            {contacts.total === 0 ? (
              <div className="kv-empty">У участников не указано ни одного телефона родителя.</div>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th>Обучающийся</th>
                    <th>Законный представитель</th>
                    <th>Телефон</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.contacts.map((c, i) => (
                    <tr key={`${c.student_id}-${i}`}>
                      <td>{c.student_name}</td>
                      <td className="kv-muted">
                        {c.parent_name}
                        {c.role ? ` (${c.role})` : ""}
                      </td>
                      <td className="kv-data">
                        <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}>{c.phone}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Signature: «Ряды мест» — рассадка класса в автобусе */}
      <div className="kv-card">
        <div className="kv-seats-head">
          <p className="kv-section" style={{ margin: 0, border: "none", padding: 0 }}>
            Ряды мест
          </p>
          <span className="kv-muted">нажмите на место, чтобы увидеть, чего не хватает</span>
        </div>
        {participants.length === 0 ? (
          <div className="kv-empty">В классе пока нет участников.</div>
        ) : (
          <div className="kv-seats">
            {bays.map((bay, r) => (
              <div className="kv-bay" key={r}>
                <span className="kv-aisle">Ряд {r + 1}</span>
                <div className="kv-seat-grid">
                  {bay.map(({ seat, p }) => (
                    <button
                      key={p.student_id}
                      type="button"
                      className={`kv-seat kv-seat-${p.traffic_light}${selected === p.student_id ? " is-active" : ""}`}
                      aria-label={`Место ${seat}, ${p.full_name}, ${LABEL[p.traffic_light]}`}
                      onClick={() => setSelected(p.student_id)}
                    >
                      {seat}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {selectedP && (
          <div className="kv-seat-list">
            <div className="kv-row">
              <div>
                <b>{selectedP.full_name}</b>
                <div className="kv-muted">Место {selectedSeat}</div>
              </div>
              <span className={`kv-badge badge-${selectedP.traffic_light}`}>
                {LABEL[selectedP.traffic_light]}
              </span>
            </div>
            <table className="kv-table" style={{ marginTop: 8 }}>
              <tbody>
                <tr>
                  <td className="kv-key">Согласие</td>
                  <td>{consentText(selectedP)}</td>
                </tr>
                <tr>
                  <td className="kv-key">Билет</td>
                  <td>{ticketText(selectedP)}</td>
                </tr>
                <tr>
                  <td className="kv-key">ПДн (152-ФЗ)</td>
                  <td>
                    {selectedP.pdn_consent_at
                      ? `Согласие дано, ${new Date(selectedP.pdn_consent_at).toLocaleString("ru-RU")}`
                      : "Не зафиксировано"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Полный список — таблица, если нужно прочитать построчно */}
      <div className="kv-card">
        <p className="kv-section">Список класса</p>

        {/* Поиск по имени + фильтр строк по статусу — вместо прокрутки 24 строк */}
        <div className="kv-filters">
          <label className="kv-chip" style={{ flex: "1 1 180px" }}>
            <IconSearch size={13} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="поиск по имени"
              aria-label="Поиск ученика по имени"
              style={{ border: "none", outline: "none", flex: 1, background: "transparent", font: "inherit" }}
            />
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "ALL" | ParticipantRow["traffic_light"])}
            aria-label="Фильтр списка по статусу"
          >
            <option value="ALL">Все статусы</option>
            <option value="GREEN">Готов</option>
            <option value="YELLOW">Ждём билет</option>
            <option value="GREY">Нет ответа</option>
            <option value="RED">Отказ</option>
          </select>
        </div>
        {/* aria-live без role="status": результат действия уже озвучивает Alert,
            второй status-регион конкурировал бы с ним за внимание скринридера. */}
        <p className="kv-muted" aria-live="polite" style={{ marginTop: 0 }}>
          Показано {visibleRows.length} из {participants.length}
        </p>

        {visibleRows.length === 0 ? (
          <div className="kv-empty">
            {filtering ? "Под фильтр никто не подошёл." : "В классе пока нет участников."}
          </div>
        ) : (
          <table className="kv-table">
            <thead>
              <tr>
                <th>Обучающийся</th>
                <th>Отметка</th>
                <th>Согласие</th>
                <th>Билет</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((p) => (
                <tr key={p.student_id}>
                  <td>
                    <b>{p.full_name}</b>
                  </td>
                  <td>
                    <span className={`kv-badge badge-${p.traffic_light}`}>{LABEL[p.traffic_light]}</span>
                  </td>
                  <td className="kv-muted">{consentText(p)}</td>
                  <td className="kv-muted">{ticketText(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
