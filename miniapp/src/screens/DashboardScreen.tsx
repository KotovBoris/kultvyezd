import { useCallback, useEffect, useState } from "react";
import { api, type Dashboard, type ParticipantRow } from "../api";
import { downloadFile, haptic, openLink } from "../max";
import { IconBell, IconCard, IconDoc, IconDownload } from "../icons";

/** Подпись статуса (заголовки — предложение, без ALL-CAPS) */
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
      setMsg(`Приказ сформирован (версия ${r.version}). Если файл не скачался — ссылки ниже.`);
      downloadFile(api.exportOrderUrl(excursionId, "docx"), `Приказ_выезд_${excursionId}.docx`);
      haptic();
    } catch (e: any) {
      setMsg(`Ошибка генерации: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const docxUrl = api.exportOrderUrl(excursionId, "docx");
  const pdfUrl = api.exportOrderUrl(excursionId, "pdf");

  return (
    <>
      {/* Карточка выезда — как шапка документа */}
      <div className="kv-card">
        <h3>{exc.title}</h3>
        <table className="kv-table" style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <td className="kv-num">Место</td>
              <td>
                {exc.location_name}
                {exc.address ? <div className="kv-muted">{exc.address}</div> : null}
              </td>
            </tr>
            <tr>
              <td className="kv-num">Дата</td>
              <td className="kv-data">
                {exc.event_date ?? "—"} · сбор {exc.gathering_time ?? "—"} · возвращение{" "}
                {exc.return_time ?? "—"}
              </td>
            </tr>
            <tr>
              <td className="kv-num">Дедлайн</td>
              <td className="kv-data">
                {exc.deadline ? new Date(exc.deadline).toLocaleString("ru-RU") : "—"}
              </td>
            </tr>
            <tr>
              <td className="kv-num">Условия</td>
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

        <div className="kv-progress">
          <span style={{ width: `${progress_percent}%` }} />
        </div>
        <div className="kv-row">
          <span className="kv-muted">Готовность списка</span>
          <span className="kv-data">{progress_percent}%</span>
        </div>
        <div className="kv-legend" style={{ marginTop: 10 }}>
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
            <IconBell /> Напомнить не ответившим
          </button>
          <button className="kv-btn" disabled={busy} onClick={generateOrder}>
            <IconDoc /> Сформировать приказ
          </button>
          <button className="kv-btn ghost" onClick={() => downloadFile(pdfUrl, `Приказ_выезд_${excursionId}.pdf`)}>
            <IconDownload /> PDF
          </button>
          {exc.ticket_sale_url && (
            <button className="kv-btn ghost" onClick={() => openLink(exc.ticket_sale_url)}>
              <IconCard /> Билетный шлюз
            </button>
          )}
        </div>
        {msg && (
          <div className="kv-alert info" style={{ marginTop: 10 }}>
            {msg}
          </div>
        )}
        <div className="kv-actions" style={{ marginTop: 8 }}>
          <a className="kv-btn ghost" href={docxUrl} download>
            <IconDownload /> DOCX (прямая ссылка)
          </a>
          <a className="kv-btn ghost" href={pdfUrl} download>
            <IconDownload /> PDF (прямая ссылка)
          </a>
        </div>
      </div>

      {/* Ведомость — ключевой паттерн: строки с номерами, как в журнале */}
      <div className="kv-card">
        <p className="kv-section">Ведомость класса · {participants.length} чел.</p>
        <table className="kv-table">
          <thead>
            <tr>
              <th style={{ width: 24 }}>№</th>
              <th>Обучающийся</th>
              <th>Отметка</th>
              <th>Согласие</th>
              <th>Билет</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p, i) => (
              <tr key={p.student_id}>
                <td className="kv-num">{i + 1}</td>
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
                  {p.ticket_status === "PAID" ? (
                    <span className="kv-data">{p.ticket_number ?? "куплен"}</span>
                  ) : p.ticket_status === "NOT_REQUIRED" ? (
                    "Не требуется"
                  ) : (
                    "Ожидает оплаты"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
