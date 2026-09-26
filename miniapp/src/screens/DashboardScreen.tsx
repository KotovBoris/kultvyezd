import { useCallback, useEffect, useState } from "react";
import { api, type Dashboard, type ParticipantRow } from "../api";
import { downloadFile, haptic, openLink } from "../max";

const LABEL: Record<ParticipantRow["traffic_light"], string> = {
  GREEN: "Готов",
  YELLOW: "Ждём билет",
  GREY: "Нет ответа",
  RED: "Отказ",
};

export default function DashboardScreen({
  excursionId,
  onChange,
}: {
  excursionId: number;
  onChange: () => void;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard(excursionId));
    } catch (e: any) {
      setMsg(`Ошибка загрузки: ${e.message}`);
    }
  }, [excursionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <div className="kv-card">Загрузка выезда…</div>;

  const { excursion: exc, summary, progress_percent, participants } = data;

  async function remind() {
    setBusy(true);
    try {
      const r = await api.remind(excursionId);
      setMsg(`Напоминания отправлены: адресатов ${r.targeted}, доставлено ${r.delivered}.`);
      haptic();
    } catch (e: any) {
      setMsg(`Ошибка напоминаний: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function generateOrder() {
    setBusy(true);
    try {
      const r = await api.generateOrder(excursionId);
      setMsg(`Приказ сформирован (версия ${r.version}).`);
      downloadFile(api.exportOrderUrl(excursionId, "docx"), `Приказ_выезд_${excursionId}.docx`);
      haptic();
    } catch (e: any) {
      setMsg(`Ошибка генерации: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="kv-card">
        <h3>{exc.title}</h3>
        <p className="kv-muted">
          {exc.location_name} · {exc.address}
          <br />
          Дата: {exc.event_date ?? "—"} · сбор {exc.gathering_time ?? "—"} · возвращение {exc.return_time ?? "—"}
          <br />
          Дедлайн ответа: {exc.deadline ? new Date(exc.deadline).toLocaleString("ru-RU") : "—"}
        </p>
        <div className="kv-wrap">
          {exc.is_pushkin_card && <span className="kv-chip pushkin">Пушкинская карта</span>}
          {exc.ticket_price > 0 ? (
            <span className="kv-chip">{exc.ticket_price.toFixed(0)} ₽ — оплата в кассе</span>
          ) : (
            <span className="kv-chip free">Бесплатно</span>
          )}
        </div>

        <div className="kv-progress">
          <span style={{ width: `${progress_percent}%` }} />
        </div>
        <div className="kv-row">
          <span className="kv-muted">Готовность списка: {progress_percent}%</span>
        </div>
        <div className="kv-legend" style={{ marginTop: 8 }}>
          <span>
            <i className="kv-dot dot-GREEN" />
            Готов: {summary.GREEN}
          </span>
          <span>
            <i className="kv-dot dot-YELLOW" />
            Ждём билет: {summary.YELLOW}
          </span>
          <span>
            <i className="kv-dot dot-GREY" />
            Нет ответа: {summary.GREY}
          </span>
          <span>
            <i className="kv-dot dot-RED" />
            Отказ: {summary.RED}
          </span>
        </div>

        <div className="kv-actions">
          <button className="kv-btn primary" disabled={busy} onClick={remind}>
            Напомнить не ответившим
          </button>
          <button className="kv-btn" disabled={busy} onClick={generateOrder}>
            Сформировать приказ (DOCX)
          </button>
          <button
            className="kv-btn ghost"
            onClick={() => downloadFile(api.exportOrderUrl(excursionId, "pdf"), `Приказ_выезд_${excursionId}.pdf`)}
          >
            Скачать PDF
          </button>
          {exc.ticket_sale_url && (
            <button className="kv-btn ghost" onClick={() => openLink(exc.ticket_sale_url)}>
              Билетный шлюз музея
            </button>
          )}
        </div>
        {msg && <div className="kv-alert info" style={{ marginTop: 10 }}>{msg}</div>}
      </div>

      <div className="kv-card">
        <h3>Сводка «Светофор»</h3>
        <table className="kv-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Статус</th>
              <th>Согласие</th>
              <th>Билет</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.student_id}>
                <td>{p.full_name}</td>
                <td>
                  <span className={`kv-badge badge-${p.traffic_light}`}>{LABEL[p.traffic_light]}</span>
                </td>
                <td className="kv-muted">
                  {p.consent_status === "APPROVED"
                    ? `Подписано${p.signed_by_name ? ` (${p.signed_by_name})` : ""}`
                    : p.consent_status === "REJECTED"
                    ? `Отказ: ${p.rejection_reason ?? "—"}`
                    : "Ожидается"}
                </td>
                <td className="kv-muted">
                  {p.ticket_status === "PAID"
                    ? `Куплен ${p.ticket_number ?? ""}`
                    : p.ticket_status === "NOT_REQUIRED"
                    ? "Не требуется"
                    : "Ожидает оплаты"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
