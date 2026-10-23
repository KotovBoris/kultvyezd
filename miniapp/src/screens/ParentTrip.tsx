import { useCallback, useEffect, useState } from "react";
import { Button } from "@maxhub/max-ui";
import { api, type ParentChild, type ParentTrip as Trip } from "../api";
import { dayLong, deadlineText, firstName, isPast, money, stamp } from "../format";
import { haptic, openLink } from "../max";
import { errorText, toast, useAppState } from "../store";
import { Card, Hero, Icon, Loader, Notice, Page, Sheet, Status, Tag } from "../ui";

const REASONS = ["Болезнь", "Семейные обстоятельства", "Другая причина"];

/** Карточка выезда для родителя: ответ в одно касание, квитанция, билет, «Изменить ответ». */
export function ParentTripView({
  child,
  trip,
  onChanged,
  full = false,
}: {
  child: ParentChild;
  trip: Trip;
  onChanged: () => Promise<void> | void;
  full?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const name = firstName(child.student_name);
  const pending = trip.consent_status === "PENDING";
  const closed = isPast(trip.deadline);

  async function answer(status: "APPROVED" | "REJECTED", reason?: string) {
    setBusy(true);
    try {
      const r = await api.consent(trip.excursion_id, {
        student_id: child.student_id,
        status,
        reason: reason ?? null,
        source: "miniapp",
        parent_name: child.parent_name,
      });
      if (r.changed) haptic.ok();
      else toast(r.message, "info");
      setAskReason(false);
      await onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function change() {
    setBusy(true);
    try {
      const r = await api.resetConsent(trip.excursion_id, child.student_id);
      toast(r.changed ? "Можно ответить заново." : r.message, r.changed ? "ok" : "info");
      await onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function ticketBought() {
    setBusy(true);
    try {
      await api.ticket(trip.excursion_id, child.student_id);
      haptic.ok();
      toast("Отметили: билет куплен.");
      await onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={`cg-ptrip ${pending ? "pending" : ""}`}>
      <div className="cg-ptrip-head">
        <div>
          <div className="cg-overline">{dayLong(trip.event_date)}</div>
          <div className="cg-ptrip-title">{trip.title}</div>
          <div className="cg-muted">{trip.location_name}</div>
        </div>
      </div>

      <div className="cg-facts-inline">
        <div className="cg-fact">
          <Icon name="clock" size={18} />
          <span>
            Сбор в <b>{trip.gathering_time ?? "—"}</b> {trip.meeting_point}
            {trip.return_time && <>, вернёмся к <b>{trip.return_time}</b></>}
          </span>
        </div>
        <div className="cg-fact">
          <Icon name="ticket" size={18} />
          <span>
            {trip.ticket_price > 0 ? (
              <>
                Билет <b>{money(trip.ticket_price)}</b> — платите сами в кассе
                {trip.is_pushkin_card && <> или «Пушкинской картой» ребёнка (14+)</>}. Школа деньги не собирает.
              </>
            ) : (
              <>Вход бесплатный</>
            )}
          </span>
        </div>
        {full && (
          <>
            <div className="cg-fact">
              <Icon name="pin" size={18} />
              <span>{trip.address || trip.location_name}</span>
            </div>
            <div className="cg-fact">
              <Icon name="users" size={18} />
              <span>Ведёт {trip.responsible_teacher || child.teacher_name || "классный руководитель"}</span>
            </div>
          </>
        )}
      </div>

      {pending && !closed && (
        <>
          <div className="cg-question">
            {name} поедет на выезд?
            {trip.deadline && <span className="cg-muted"> Ответьте до {deadlineText(trip.deadline)}.</span>}
          </div>
          <div className="cg-stack">
            <Button size="large" stretched loading={busy && !askReason} onClick={() => void answer("APPROVED")}
              iconBefore={<Icon name="check" size={22} />}>
              Отпускаю
            </Button>
            <Button size="large" stretched variant="secondary" disabled={busy} onClick={() => setAskReason(true)}>
              Не сможет
            </Button>
          </div>
          <p className="cg-fineprint">Ваш ответ кнопкой считается подписью. Его можно изменить до срока.</p>
        </>
      )}

      {pending && closed && (
        <Notice tone="warn" icon="clock" title="Срок ответа прошёл">
          Напишите или позвоните классному руководителю, если ребёнок всё же едет.
        </Notice>
      )}

      {trip.consent_status === "APPROVED" && (
        <div className="cg-receipt ok">
          <Icon name="check" size={22} />
          <div>
            <b>Готово: {name} едет.</b>
            <span>
              Подпись записана {stamp(trip.signed_at)}. Учитель уже видит ответ.
            </span>
          </div>
        </div>
      )}

      {trip.consent_status === "REJECTED" && (
        <div className="cg-receipt no">
          <Icon name="x" size={22} />
          <div>
            <b>Вы ответили: {name} не сможет.</b>
            <span>
              {trip.rejection_reason || "Без причины"} · {stamp(trip.signed_at)}. Учитель уже видит ответ.
            </span>
          </div>
        </div>
      )}

      {trip.consent_status === "APPROVED" && trip.ticket_status === "WAITING_PAYMENT" && (
        <div className="cg-ticketstep">
          <div className="cg-actions-title">Остался билет</div>
          <p className="cg-muted">
            Купите билет сами на сайте учреждения
            {trip.is_pushkin_card ? " — подросток 14+ может оплатить своей «Пушкинской картой»" : ""}. Потом отметьте здесь.
          </p>
          <div className="cg-row-buttons">
            {trip.ticket_sale_url && (
              <Button size="medium" onClick={() => openLink(trip.ticket_sale_url)} iconBefore={<Icon name="ticket" size={18} />}>
                Купить билет
              </Button>
            )}
            <Button size="medium" variant="secondary" disabled={busy} onClick={() => void ticketBought()}>
              Билет купили
            </Button>
          </div>
        </div>
      )}

      {trip.consent_status === "APPROVED" && trip.ticket_status === "PAID" && (
        <Status tone="going">Билет куплен — всё готово</Status>
      )}

      {!pending && !closed && trip.ticket_status !== "PAID" && (
        <button type="button" className="cg-link" disabled={busy} onClick={() => void change()}>
          Изменить ответ
        </button>
      )}

      <Sheet open={askReason} title={`Почему ${name} не сможет?`} onClose={() => setAskReason(false)}>
        <p className="cg-muted">Учитель увидит только эту причину. Объяснять подробнее не нужно.</p>
        <div className="cg-stack">
          {REASONS.map((r) => (
            <Button key={r} size="large" stretched variant="secondary" disabled={busy} onClick={() => void answer("REJECTED", r)}>
              {r}
            </Button>
          ))}
        </div>
      </Sheet>
    </Card>
  );
}

export default function ParentTrip({ excursionId, studentId }: { excursionId: number; studentId: number }) {
  const { me } = useAppState();
  const [child, setChild] = useState<ParentChild | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me?.user_id) return;
    try {
      const ctx = await api.parentContext(me.user_id);
      const c = ctx.children.find((x) => x.student_id === studentId) ?? null;
      setChild(c);
      setError(c ? null : "Этот выезд не найден среди выездов ваших детей.");
    } catch (e) {
      setError(errorText(e));
    }
  }, [me?.user_id, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const trip = child?.excursions.find((e) => e.excursion_id === excursionId);
  if (!child || !trip) {
    return (
      <Page>{error ? <Notice tone="error" icon="info" title="Не удалось открыть выезд">{error}</Notice> : <Loader />}</Page>
    );
  }
  return (
    <Page>
      <Hero
        overline={`${child.student_name} · ${child.class_title}`}
        title="Приглашение на выезд"
        aside={child.is_demo ? <Tag tone="demo">демо</Tag> : undefined}
      />
      <ParentTripView child={child} trip={trip} onChanged={load} full />
    </Page>
  );
}
