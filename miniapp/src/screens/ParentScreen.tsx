import { useEffect, useState } from "react";
import { api, type Excursion, type ParticipantRow } from "../api";
import { downloadFile, haptic, isInsideMax, openLink, requestContact } from "../max";
import { setSession } from "../store";

/**
 * Экран законного представителя (UC-4/UC-5).
 * Открывается из бота кнопкой open_app с контекстом ?startapp=<student_id>.
 * Согласие привязывается к профилю ученика — повторное подписание невозможно.
 */
export default function ParentScreen({
  studentId,
  studentName,
  excursions,
}: {
  studentId: number;
  studentName?: string;
  excursions: Excursion[];
}) {
  const [rows, setRows] = useState<Record<number, ParticipantRow>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("Болезнь");

  async function loadAll() {
    const map: Record<number, ParticipantRow> = {};
    for (const e of excursions) {
      try {
        const d = await api.dashboard(e.id);
        const row = d.participants.find((p) => p.student_id === studentId);
        if (row) map[e.id] = row;
      } catch {
        /* пропускаем */
      }
    }
    setRows(map);
  }

  useEffect(() => {
    if (excursions.length) loadAll();
  }, [excursions.length, studentId]);

  async function act(excursionId: number, status: "APPROVED" | "REJECTED") {
    setBusy(true);
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
      });
      setMsg(r.message);
      haptic();
      await loadAll();
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmTicket(excursionId: number) {
    setBusy(true);
    try {
      const r = await api.ticket(excursionId, { student_id: studentId, source: "miniapp" });
      setMsg(r.message);
      await loadAll();
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function bindBot() {
    try {
      const r = await api.linkCode(studentId);
      setMsg(`Код привязки создан. Откройте бота по ссылке, чтобы получать персональные напоминания: ${r.deep_link}`);
      openLink(r.deep_link);
    } catch (e: any) {
      setMsg(`Ошибка привязки: ${e.message}`);
    }
  }

  return (
    <>
      <div className="kv-card">
        <h3>Мои выезды</h3>
        {studentName && <p className="kv-muted">Ребёнок: <b>{studentName}</b></p>}
        <p className="kv-muted">
          Подтвердите участие ребёнка. Согласие фиксируется простой электронной подписью (дата, время, ID).
          Оплата билета — напрямую в кассу учреждения культуры.
        </p>
        <div className="kv-actions">
          <button className="kv-btn ghost" onClick={bindBot}>
            Привязать бота для напоминаний
          </button>
          {!isInsideMax() && (
            <button
              className="kv-btn ghost"
              onClick={() => setSession({ role: "teacher", studentId: null, resolvedStudentId: null })}
            >
              ← Вернуться в режим учителя
            </button>
          )}
        </div>
      </div>

      {msg && <div className="kv-alert info">{msg}</div>}

      {!excursions.length && <div className="kv-card">Активных выездов нет.</div>}

      {excursions.map((e) => {
        const row = rows[e.id];
        const decided = row && row.consent_status !== "PENDING";
        return (
          <div key={e.id} className="kv-card">
            <h3>{e.title}</h3>
            <p className="kv-muted">
              {e.location_name} · {e.event_date ?? "дата уточняется"}
              <br />
              Сбор {e.gathering_time ?? "—"} · возвращение {e.return_time ?? "—"}
            </p>
            <div className="kv-wrap">
              {e.is_pushkin_card && <span className="kv-chip pushkin">Пушкинская карта</span>}
              {e.ticket_price > 0 ? (
                <span className="kv-chip">{e.ticket_price.toFixed(0)} ₽</span>
              ) : (
                <span className="kv-chip free">Бесплатно</span>
              )}
              {row && <span className={`kv-badge badge-${row.traffic_light}`}>{row.traffic_light}</span>}
            </div>

            {decided ? (
              <div className="kv-alert ok" style={{ marginTop: 10 }}>
                {row!.consent_status === "APPROVED"
                  ? `Согласие подписано${row!.signed_by_name ? ` (${row!.signed_by_name})` : ""}${
                      row!.signed_at ? `, ${new Date(row!.signed_at).toLocaleString("ru-RU")}` : ""
                    }.`
                  : `Зафиксирован отказ: ${row!.rejection_reason ?? "—"}.`}
              </div>
            ) : (
              <>
                <div className="kv-actions">
                  <button className="kv-btn primary" disabled={busy} onClick={() => act(e.id, "APPROVED")}>
                    ✅ Отпускаю ребёнка
                  </button>
                  <select value={reason} onChange={(ev) => setReason(ev.target.value)}>
                    <option>Болезнь</option>
                    <option>Семейные обстоятельства</option>
                    <option>Другое</option>
                  </select>
                  <button className="kv-btn" disabled={busy} onClick={() => act(e.id, "REJECTED")}>
                    ❌ Не сможет поехать
                  </button>
                </div>
              </>
            )}

            {row?.consent_status === "APPROVED" && row.ticket_status === "WAITING_PAYMENT" && (
              <div className="kv-actions">
                {e.ticket_sale_url && (
                  <button className="kv-btn" onClick={() => openLink(e.ticket_sale_url)}>
                    Купить билет на сайте музея
                  </button>
                )}
                <button className="kv-btn ghost" disabled={busy} onClick={() => confirmTicket(e.id)}>
                  Билет куплен
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
