import { useEffect, useMemo, useState } from "react";
import { api, type Excursion, type ParentChild, type ParticipantRow } from "../api";
import { downloadFile, haptic, isInsideMax, openLink, requestContact } from "../max";
import { setSession } from "../store";
import { IconBack, IconCalendar, IconCard, IconCheck, IconCross } from "../icons";
import Alert from "../components/Alert";

/** Короткая памятка сборов вечером перед выездом — родителю, без лишних экранов. */
const PACK_LIST: string[] = [
  "перекус и бутылка воды",
  "сменная обувь и носки",
  "дождевик или зонт по погоде",
  "карманные деньги на кассу музея",
  "телефон заряжен, номер сопровождающего записан",
];

/**
 * Экран законного представителя (UC-4/UC-5).
 * Открывается из бота кнопкой open_app с контекстом ?startapp=<student_id>
 * либо по MAX-профилю (max_user_id). Если у родителя несколько детей в школе,
 * сверху появляется переключатель — раньше показывался только первый ребёнок.
 */
export default function ParentScreen({
  studentId,
  studentName,
  excursions,
  children,
  onSelectChild,
}: {
  studentId: number;
  studentName?: string;
  excursions: Excursion[];
  /** дети родителя из parent_context: включает переключатель и блок «кто подписал» */
  children?: ParentChild[];
  onSelectChild?: (studentId: number, studentName: string) => void;
}) {
  const [rows, setRows] = useState<Record<number, ParticipantRow>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"info" | "ok" | "err">("info");
  // Какое действие идёт сейчас: "approve-1" | "reject-1" | "ticket-1" | "bind" | null.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reason, setReason] = useState("Болезнь");
  // Выезд, для которого открыт шаг подтверждения согласия (ПЭП, юридически значимо).
  const [confirming, setConfirming] = useState<number | null>(null);
  // Обязательное согласие на обработку ПДн ребёнка (152-ФЗ) — без него ПЭП не уходит.
  const [pdnConsent, setPdnConsent] = useState(false);
  // Необязательный номер электронного билета по каждому выезду (UC-5).
  const [ticketNumbers, setTicketNumbers] = useState<Record<number, string>>({});

  const child = children?.find((c) => c.student_id === studentId) ?? null;
  const multi = (children?.length ?? 0) > 1;
  // Контекст ребёнка по выезду: поиск по id в рендере (а он частый — ввод причины,
  // номера билета) заменён на карту, которую пересчитываем только при смене ребёнка.
  const ctxByExcursion = useMemo(
    () => new Map((child?.excursions ?? []).map((x) => [x.excursion_id, x])),
    [child],
  );

  async function loadAll() {
    // Все ведомости грузим параллельно: последовательный for-await — классический
    // водопад (N детей × задержка запроса), здесь достаточно Promise.all.
    const results = await Promise.all(
      excursions.map(async (e) => {
        try {
          const d = await api.dashboard(e.id);
          const row = d.participants.find((p) => p.student_id === studentId);
          return row ? ([e.id, row] as const) : null;
        } catch {
          return null; // один выезд не должен ронять загрузку остальных
        }
      }),
    );
    setRows(Object.fromEntries(results.filter(Boolean) as (readonly [number, ParticipantRow])[]));
  }

  useEffect(() => {
    if (excursions.length) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excursions.length, studentId]);

  async function act(excursionId: number, status: "APPROVED" | "REJECTED") {
    setBusyKey(`${status === "APPROVED" ? "approve" : "reject"}-${excursionId}`);
    setMsg(null);
    const contact = status === "APPROVED" ? await requestContact().catch(() => null) : null;
    try {
      const r = await api.consent(excursionId, {
        student_id: studentId,
        status,
        parent_phone: contact?.phone ?? "",
        parent_name: "Законный представитель",
        reason: status === "REJECTED" ? reason : null,
        source: "miniapp",
        // Согласие на ПДн обязательно только при одобрении участия (152-ФЗ).
        pdn_consent: status === "APPROVED" ? pdnConsent : false,
      });
      setMsg(r.message);
      setMsgTone("ok");
      setConfirming(null);
      haptic();
      await loadAll();
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmTicket(excursionId: number) {
    setBusyKey(`ticket-${excursionId}`);
    setMsg(null);
    try {
      const number = (ticketNumbers[excursionId] ?? "").trim();
      const r = await api.ticket(excursionId, {
        student_id: studentId,
        source: "miniapp",
        // Необязательный номер электронного билета (UC-5): бэкенд его уже принимает.
        ticket_number: number || null,
      });
      setMsg(r.message);
      setMsgTone("ok");
      await loadAll();
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusyKey(null);
    }
  }

  async function bindBot() {
    setBusyKey("bind");
    setMsg(null);
    try {
      const r = await api.linkCode(studentId);
      setMsg(`Код привязки создан. Откройте бота, чтобы получать напоминания: ${r.deep_link}`);
      setMsgTone("info");
      openLink(r.deep_link);
    } catch (e: any) {
      setMsg(`Ошибка привязки: ${e.message}`);
      setMsgTone("err");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      <div className="kv-card">
        <p className="kv-section">Согласие законного представителя</p>

        {multi && (
          <div className="kv-childpick" role="group" aria-label="Выбор ребёнка">
            <span className="kv-muted">Дети:</span>
            {children!.map((c) => (
              <button
                key={c.student_id}
                type="button"
                className={`kv-childbtn${c.student_id === studentId ? " is-active" : ""}`}
                aria-pressed={c.student_id === studentId}
                onClick={() => onSelectChild?.(c.student_id, c.student_name)}
              >
                {c.student_name}
              </button>
            ))}
          </div>
        )}

        {studentName && (
          <p style={{ margin: "0 0 6px" }}>
            Обучающийся: <b>{studentName}</b>
          </p>
        )}
        <p className="kv-muted" style={{ marginTop: 0 }}>
          Подтвердите участие ребёнка. Согласие фиксируется простой электронной подписью (дата, время,
          подписант). Оплата билета — напрямую в кассу учреждения культуры.
        </p>
        {child && child.parents.length > 1 && (
          <p className="kv-muted" style={{ marginTop: 0 }}>
            В карточке ученика {child.parents.length} законных представителя. Достаточно подписи одного —
            второй увидит, кто уже ответил.
          </p>
        )}
        <div className="kv-actions">
          <button
            className={`kv-btn ghost${busyKey === "bind" ? " busy" : ""}`}
            aria-busy={busyKey === "bind"}
            disabled={busyKey === "bind"}
            onClick={bindBot}
          >
            {busyKey === "bind" ? (
              <>
                <span className="kv-spin" aria-hidden="true" />
                Готовим код…
              </>
            ) : (
              "Привязать бота для напоминаний"
            )}
          </button>
          {!isInsideMax() && (
            <button
              className="kv-btn ghost"
              onClick={() => setSession({ role: "teacher", studentId: null, resolvedStudentId: null })}
            >
              <IconBack /> В режим учителя
            </button>
          )}
        </div>
      </div>

      <div className="kv-card">
        <p className="kv-section">Что взять с собой</p>
        <p className="kv-muted" style={{ marginTop: 0 }}>
          Памятка для сборов перед выездом — чтобы ничего не забыть в утренней спешке.
        </p>
        <ul className="kv-skipped">
          {PACK_LIST.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      {msg && <Alert tone={msgTone}>{msg}</Alert>}

      {!excursions.length && <div className="kv-card kv-empty">Активных выездов нет.</div>}

      {excursions.map((e) => {
        const row = rows[e.id];
        const decided = row && row.consent_status !== "PENDING";
        const ctxExc = ctxByExcursion.get(e.id) ?? null;
        const signers = ctxExc?.signers ?? [];
        const signedPhone = ctxExc?.signed_by_phone ?? null;
        const approving = busyKey === `approve-${e.id}`;
        const rejecting = busyKey === `reject-${e.id}`;
        return (
          <div key={e.id} className="kv-card">
            <h3>{e.title}</h3>
            <table className="kv-table" style={{ marginTop: 6 }}>
              <tbody>
                <tr>
                  <td className="kv-key">Место</td>
                  <td>{e.location_name}</td>
                </tr>
                <tr>
                  <td className="kv-key">Дата</td>
                  <td className="kv-data">
                    {[
                      e.event_date ?? "уточняется",
                      e.gathering_time && e.return_time ? `${e.gathering_time}–${e.return_time}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="kv-wrap" style={{ marginTop: 8 }}>
              {e.is_pushkin_card && <span className="kv-chip pushkin">Пушкинская карта</span>}
              {e.ticket_price > 0 ? (
                <span className="kv-chip money">{e.ticket_price.toFixed(0)} ₽</span>
              ) : (
                <span className="kv-chip free">Бесплатно</span>
              )}
              {row && (
                <span className={`kv-badge badge-${row.traffic_light}`}>
                  {row.traffic_light === "GREEN"
                    ? "Готов"
                    : row.traffic_light === "YELLOW"
                    ? "Ждём билет"
                    : row.traffic_light === "GREY"
                    ? "Нет ответа"
                    : "Отказ"}
                </span>
              )}
            </div>

            {/* Добавить выезд в календарь: .ics приходит с бэкенда, скачиваем как файл */}
            <div className="kv-actions">
              <button
                type="button"
                className="kv-btn ghost"
                onClick={() =>
                  downloadFile(api.calendarIcsUrl(e.id), `Выезд_${e.id}.ics`)
                }
              >
                <IconCalendar /> Добавить в календарь
              </button>
            </div>

            {/* Два родителя: кто из законных представителей уже подписал */}
            {signers.length > 1 && (
              <div className="kv-reps">
                <span className="kv-muted">Законные представители</span>
                {signers.map((s) => (
                  <div className="kv-rep" key={s.contact_id}>
                    <span className="kv-rep-name">
                      {s.full_name}
                      {s.role ? <span className="kv-muted"> · {s.role}</span> : null}
                    </span>
                    <span className={`kv-chip${s.is_signer ? " rep-signed" : ""}`}>
                      {s.is_signer ? "подписал(а)" : "ждём ответа"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {decided ? (
              <div className="kv-alert ok" style={{ marginTop: 10 }}>
                {row!.consent_status === "APPROVED"
                  ? `Согласие подписано${row!.signed_by_name ? ` (${row!.signed_by_name})` : ""}${
                      row!.signed_at ? `, ${new Date(row!.signed_at).toLocaleString("ru-RU")}` : ""
                    }.`
                  : `Зафиксирован отказ: ${row!.rejection_reason ?? "—"}.`}
                {!signers.length && signedPhone ? (
                  <span className="kv-muted"> Подпись по телефону {signedPhone}.</span>
                ) : null}
              </div>
            ) : confirming === e.id ? (
              /* Подтверждение ПЭП: согласие юридически значимо, не уходит одним кликом */
              <div className="kv-confirm">
                <p>
                  <b>Отправляю согласие?</b> Подпись фиксируется простой электронной подписью — дата,
                  время и подписант. Отменить после отправки нельзя.
                </p>
                <label className="kv-pdn" htmlFor={`pdn-${e.id}`}>
                  <input
                    id={`pdn-${e.id}`}
                    type="checkbox"
                    checked={pdnConsent}
                    onChange={(ev) => setPdnConsent(ev.target.checked)}
                  />
                  <span>
                    Даю согласие на обработку персональных данных ребёнка (ФИО, дата рождения,
                    контактный телефон) для организации выезда — 152-ФЗ.
                  </span>
                </label>
                <div className="kv-actions">
                  <button
                    type="button"
                    className={`kv-btn primary${approving ? " busy" : ""}`}
                    aria-busy={approving}
                    disabled={approving || !pdnConsent}
                    onClick={() => act(e.id, "APPROVED")}
                  >
                    {approving ? (
                      <>
                        <span className="kv-spin" aria-hidden="true" />
                        Отправляем…
                      </>
                    ) : (
                      "Да, отправляю согласие"
                    )}
                  </button>
                  <button className="kv-btn ghost" disabled={approving} onClick={() => setConfirming(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div className="kv-actions">
                <button
                  className="kv-btn primary"
                  disabled={approving || rejecting}
                  onClick={() => setConfirming(e.id)}
                >
                  <IconCheck /> Отпускаю ребёнка
                </button>
                {/* Деструктив отделён линией и оформлен как опасное действие, не равнозначно главному */}
                <div className="kv-reject">
                  <select
                    value={reason}
                    onChange={(ev) => setReason(ev.target.value)}
                    aria-label="Причина отказа"
                    style={{ padding: "7px 8px", border: "1px solid var(--rule-strong)", borderRadius: 8, font: "inherit" }}
                  >
                    <option>Болезнь</option>
                    <option>Семейные обстоятельства</option>
                    <option>Другое</option>
                  </select>
                  <button
                    type="button"
                    className={`kv-btn danger${rejecting ? " busy" : ""}`}
                    aria-busy={rejecting}
                    disabled={rejecting}
                    onClick={() => act(e.id, "REJECTED")}
                  >
                    {rejecting ? (
                      <>
                        <span className="kv-spin" aria-hidden="true" />
                        Отправляем…
                      </>
                    ) : (
                      <>
                        <IconCross /> Не сможет поехать
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {row?.consent_status === "APPROVED" && row.ticket_status === "WAITING_PAYMENT" && (
              <div className="kv-actions">
                {e.ticket_sale_url && (
                  <button className="kv-btn" onClick={() => openLink(e.ticket_sale_url)}>
                    <IconCard /> Купить билет на сайте музея
                  </button>
                )}
                <label className="kv-pdn" htmlFor={`ticket-num-${e.id}`}>
                  <span>Номер билета (необязательно):</span>
                  <input
                    id={`ticket-num-${e.id}`}
                    type="text"
                    value={ticketNumbers[e.id] ?? ""}
                    onChange={(ev) => setTicketNumbers((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                    placeholder="например, KZ-000123"
                    aria-label="Номер электронного билета"
                  />
                </label>
                <button
                  type="button"
                  className={`kv-btn ghost${busyKey === `ticket-${e.id}` ? " busy" : ""}`}
                  aria-busy={busyKey === `ticket-${e.id}`}
                  disabled={busyKey === `ticket-${e.id}`}
                  onClick={() => confirmTicket(e.id)}
                >
                  {busyKey === `ticket-${e.id}` ? (
                    <>
                      <span className="kv-spin" aria-hidden="true" />
                      Отмечаем…
                    </>
                  ) : (
                    <>
                      <IconCheck /> Билет куплен
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
