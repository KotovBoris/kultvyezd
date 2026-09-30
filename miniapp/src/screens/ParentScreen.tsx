import { useCallback, useEffect, useState } from "react";
import { api, type ParentChild, type ParentChildExcursion, type ParentSearchRow } from "../api";
import { haptic, openLink, requestContact } from "../max";

const LIGHT_LABEL: Record<string, string> = {
  GREEN: "Готов",
  YELLOW: "Ждём билет",
  GREY: "Нет ответа",
  RED: "Отказ",
};

function ParentPicker({
  userId,
  onClaimed,
}: {
  userId: number | null;
  onClaimed: (studentName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ParentSearchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setRows([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchParents(query.trim())
        .then(setRows)
        .catch((e) => setErr(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function claim(row: ParentSearchRow) {
    if (!userId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.claimParent({ parent_id: row.parent_id, max_user_id: userId });
      onClaimed(r.student_name);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kv-card">
      <h3>Найти себя в базе</h3>
      <p className="kv-muted">
        Демо-режим для проверки: введите свою фамилию, телефон или имя ребёнка — и нажмите
        «Это я». Лента заявок привяжется к текущему пользователю.
      </p>
      <div className="kv-filters">
        <input
          placeholder="Фамилия родителя, телефон или ФИО ребёнка"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {err && <div className="kv-alert err">{err}</div>}
      {query.trim().length >= 2 && !rows.length && (
        <p className="kv-muted">Ничего не найдено. Попросите учителя добавить ребёнка в класс.</p>
      )}
      {rows.map((r) => (
        <div key={r.parent_id} className="kv-row" style={{ marginTop: 8 }}>
          <span>
            {r.parent_name} ({r.role}) — {r.student_name}, {r.class_title}
            {r.claimed && <span className="kv-muted"> · уже привязан</span>}
          </span>
          <button className="kv-btn primary" disabled={busy} onClick={() => claim(r)}>
            Это я
          </button>
        </div>
      ))}
    </div>
  );
}

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
      <>
        <div className="kv-card">
          <h3>Вы пока не привязаны к ребёнку</h3>
          <p className="kv-muted">
            Обычный путь: учитель отправляет ссылку-приглашение, бот привязывает вас к профилю
            ребёнка. Для проверки без приглашения найдите себя в базе ниже.
          </p>
          <p className="kv-muted">
            Если вы учитель — переключите режим кнопкой «Я учитель» внизу экрана.
          </p>
        </div>
        {msg && <div className="kv-alert info">{msg}</div>}
        <ParentPicker
          userId={userId}
          onClaimed={async (name) => {
            setMsg(`Вы привязаны как родитель: ${name}.`);
            await load();
          }}
        />
      </>
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
