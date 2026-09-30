import { useCallback, useEffect, useState } from "react";
import { api, type ParentChild, type ParentChildExcursion } from "../api";
import { haptic, openLink, requestContact } from "../max";

const LIGHT_LABEL: Record<string, string> = {
  GREEN: "Готов",
  YELLOW: "Ждём билет",
  GREY: "Нет ответа",
  RED: "Отказ",
};

export default function ParentScreen({ userId }: { userId: number | null }) {
  const [children, setChildren] = useState<ParentChild[]>([]);
  const [found, setFound] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("Болезнь");

  const load = useCallback(async () => {
    if (!userId) {
      setFound(false);
      return;
    }
    try {
      const ctx = await api.parentContext(userId);
      setChildren(ctx.children);
      setFound(ctx.found);
    } catch (e: any) {
      setMsg(`Не удалось загрузить данные: ${e.message}`);
      setFound(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmLink(studentId: number, accept: boolean) {
    if (!userId) return;
    setBusy(true);
    try {
      await api.confirmLink({ student_id: studentId, max_user_id: userId, accept });
      setMsg(accept ? "Привязка подтверждена." : "Привязка отклонена.");
      haptic();
      await load();
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleNotifications(enabled: boolean) {
    if (!userId) return;
    setBusy(true);
    try {
      await api.setNotifications({ max_user_id: userId, enabled });
      setMsg(enabled ? "Рассылка включена." : "Вы отказались от рассылки по всем мероприятиям.");
      await load();
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(child: ParentChild, exc: ParentChildExcursion, status: "APPROVED" | "REJECTED") {
    setBusy(true);
    setMsg(null);
    const contact = status === "APPROVED" ? await requestContact().catch(() => null) : null;
    try {
      const r = await api.consent(exc.excursion_id, {
        student_id: child.student_id,
        status,
        parent_phone: contact?.phone ?? "",
        parent_name: child.parent_name || "Законный представитель",
        reason: status === "REJECTED" ? reason : null,
        source: "miniapp",
        max_user_id: userId,
      });
      setMsg(r.message);
      haptic();
      await load();
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmTicket(child: ParentChild, exc: ParentChildExcursion) {
    setBusy(true);
    try {
      const r = await api.ticket(exc.excursion_id, { student_id: child.student_id, source: "miniapp" });
      setMsg(r.message);
      await load();
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (found === null) {
    return <div className="kv-card">Загрузка…</div>;
  }

  if (!found) {
    return (
      <div className="kv-card">
        <h3>Вы пока не привязаны к ребёнку</h3>
        <p className="kv-muted">
          Учитель добавляет ребёнка в класс и отправляет вам ссылку-приглашение. Откройте её —
          бот привяжет вас к профилю ребёнка, и здесь появится лента заявок на выезды.
        </p>
        <p className="kv-muted">
          Если вы учитель — переключите режим кнопкой «Я учитель» внизу экрана.
        </p>
        {msg && <div className="kv-alert info">{msg}</div>}
      </div>
    );
  }

  const notificationsOn = children.some((c) => c.notifications_enabled);

  return (
    <>
      <div className="kv-card">
        <h3>Заявки по моим детям</h3>
        <p className="kv-muted">
          Подтвердите участие ребёнка в выезде. Согласие фиксируется простой электронной подписью
          (дата, время, ID). Оплата билета — напрямую в кассу учреждения культуры.
        </p>
        <div className="kv-actions">
          {notificationsOn ? (
            <button className="kv-btn ghost" disabled={busy} onClick={() => toggleNotifications(false)}>
              Отказаться от рассылки по всем мероприятиям
            </button>
          ) : (
            <button className="kv-btn" disabled={busy} onClick={() => toggleNotifications(true)}>
              Включить рассылку снова
            </button>
          )}
        </div>
      </div>

      {msg && <div className="kv-alert info">{msg}</div>}

      {children.map((child) => (
        <div key={child.student_id}>
          {!child.confirmed && (
            <div className="kv-card" style={{ borderColor: "#e0a800" }}>
              <h3>Подтвердите привязку</h3>
              <p className="kv-muted">
                Учитель указал вас как родителя ученика <b>{child.student_name}</b>. Подтвердите,
                что это ваш ребёнок.
              </p>
              <div className="kv-actions">
                <button className="kv-btn primary" disabled={busy} onClick={() => confirmLink(child.student_id, true)}>
                  Да, это мой ребёнок
                </button>
                <button className="kv-btn" disabled={busy} onClick={() => confirmLink(child.student_id, false)}>
                  Нет, это ошибка
                </button>
              </div>
            </div>
          )}

          <div className="kv-card">
            <h3>{child.student_name}</h3>
            {!child.excursions.length && <p className="kv-muted">Активных выездов нет.</p>}
          </div>

          {child.excursions.map((e) => {
            const decided = e.consent_status !== "PENDING";
            return (
              <div key={e.excursion_id} className="kv-card">
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
                  <span className={`kv-badge badge-${e.traffic_light}`}>{LIGHT_LABEL[e.traffic_light]}</span>
                </div>

                {decided ? (
                  <div className="kv-alert ok" style={{ marginTop: 10 }}>
                    {e.consent_status === "APPROVED"
                      ? `Согласие подписано${e.signed_by_name ? ` (${e.signed_by_name})` : ""}${
                          e.signed_at ? `, ${new Date(e.signed_at).toLocaleString("ru-RU")}` : ""
                        }.`
                      : `Зафиксирован отказ: ${e.rejection_reason ?? "—"}.`}
                  </div>
                ) : (
                  <div className="kv-actions">
                    <button className="kv-btn primary" disabled={busy} onClick={() => act(child, e, "APPROVED")}>
                      Отпускаю ребёнка
                    </button>
                    <select value={reason} onChange={(ev) => setReason(ev.target.value)}>
                      <option>Болезнь</option>
                      <option>Семейные обстоятельства</option>
                      <option>Другое</option>
                    </select>
                    <button className="kv-btn" disabled={busy} onClick={() => act(child, e, "REJECTED")}>
                      Не сможет поехать
                    </button>
                  </div>
                )}

                {e.consent_status === "APPROVED" && e.ticket_status === "WAITING_PAYMENT" && (
                  <div className="kv-actions">
                    {e.ticket_sale_url && (
                      <button className="kv-btn" onClick={() => openLink(e.ticket_sale_url)}>
                        Купить билет на сайте музея
                      </button>
                    )}
                    <button className="kv-btn ghost" disabled={busy} onClick={() => confirmTicket(child, e)}>
                      Билет куплен
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
