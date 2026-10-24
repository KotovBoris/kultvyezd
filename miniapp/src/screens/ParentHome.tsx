import { useCallback, useEffect, useState } from "react";
import { Button, Switch } from "@maxhub/max-ui";
import { api, type ParentChild } from "../api";
import { refreshMe, startDemo } from "../App";
import { dayShort, firstName, initials, plural } from "../format";
import { copyText, isInsideMax, requestContact, shareToChat } from "../max";
import { errorText, push, setState, toast, useAppState } from "../store";
import { Avatar, Card, Confirm, Empty, Hero, Icon, Notice, Page, QrCode, Section, Sheet, SkeletonList, Status, Tag } from "../ui";
import { ParentTripView } from "./ParentTrip";
import { Terms } from "./Terms";

export default function ParentHome() {
  const { me } = useAppState();
  const [children, setChildren] = useState<ParentChild[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Только что отвеченные выезды остаются развёрнутыми — родитель видит квитанцию «Готово».
  const [recent, setRecent] = useState<number[]>([]);
  const [inviteFor, setInviteFor] = useState<ParentChild | null>(null);

  const load = useCallback(async () => {
    if (!me?.user_id) {
      setChildren([]);
      return;
    }
    try {
      const ctx = await api.parentContext(me.user_id);
      setChildren(ctx.children);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [me?.user_id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const name = me?.name ? firstName(me.name) || me.name : "";
  const several = (children?.length ?? 0) > 1;

  if (children === null) {
    return (
      <Page>
        <Hero overline="Родитель" title={name ? `Здравствуйте, ${name}` : "Выезды"} />
        {error ? <Notice tone="error" icon="info">{error}</Notice> : <SkeletonList rows={2} />}
      </Page>
    );
  }

  if (children.length === 0) {
    return (
      <Page>
        <Hero overline="Родитель" title={name ? `Здравствуйте, ${name}` : "Подключитесь к классу"} />
        <JoinByPhone onLinked={load} />
      </Page>
    );
  }

  if (me && !me.terms_accepted) {
    return <Terms children={children} />;
  }

  const pendingCount = children.reduce(
    (n, c) => n + c.excursions.filter((e) => e.consent_status === "PENDING" && !e.started && !e.cancelled).length,
    0,
  );

  return (
    <Page>
      <Hero
        overline={several ? "Родитель · дети" : "Родитель"}
        title={name ? `Здравствуйте, ${name}` : several ? "Выезды детей" : "Выезды ребёнка"}
        subtitle={
          pendingCount
            ? `Ждут вашего ответа: ${pendingCount} ${plural(pendingCount, "приглашение", "приглашения", "приглашений")}`
            : "Новых приглашений нет. О новых напишем в MAX."
        }
      />

      {error && <Notice tone="error" icon="info">{error}</Notice>}

      {children.map((child) => {
        const open = (e: { consent_status: string; excursion_id: number; started: boolean; cancelled: boolean }) =>
          !e.cancelled && ((e.consent_status === "PENDING" && !e.started) || recent.includes(e.excursion_id));
        const active = child.excursions.filter(open);
        const others = child.excursions.filter((e) => !open(e));
        return (
          <Section key={child.student_id}>
            <div className="cg-childhead">
              <Avatar text={initials(child.student_name)} />
              <div>
                <b>{child.student_name}</b>
                <span className="cg-muted">
                  {child.class_title}
                  {child.school_name ? ` · ${child.school_name}` : ""}
                </span>
              </div>
              {child.is_demo && <Tag tone="demo">демо</Tag>}
            </div>

            {child.excursions.length === 0 && (
              <Empty icon="calendar" title="Пока нет выездов" text="Приглашение придёт сюда и в чат MAX." />
            )}

            <div className="cg-list">
              {active.map((trip) => (
                <ParentTripView
                  key={trip.excursion_id}
                  child={child}
                  trip={trip}
                  onChanged={() => {
                    setRecent((r) => (r.includes(trip.excursion_id) ? r : [...r, trip.excursion_id]));
                    return load();
                  }}
                />
              ))}
              {others.map((trip) => (
                <Card key={trip.excursion_id} onClick={() => push({ name: "parent-trip", excursionId: trip.excursion_id, studentId: child.student_id })}>
                  <div className="cg-answered">
                    <div className="cg-answered-text">
                      <span className="cg-overline">{dayShort(trip.event_date)}</span>
                      <b>{trip.title}</b>
                      {trip.cancelled ? (
                        <Status tone="neutral">Выезд отменён</Status>
                      ) : (
                        <>
                          {trip.consent_status === "APPROVED" && <Status tone="going">{firstName(child.student_name)} идёт</Status>}
                          {trip.consent_status === "REJECTED" && <Status tone="notgoing">Не пойдёт</Status>}
                          {trip.consent_status === "PENDING" && <Status tone="neutral">Без ответа</Status>}
                        </>
                      )}
                    </div>
                    <Icon name="chevron" size={20} className="cg-chev" />
                  </div>
                </Card>
              ))}
            </div>

            <button type="button" className="cg-link cg-linkrow" onClick={() => setInviteFor(child)}>
              <Icon name="users" size={16} /> Позвать второго родителя
            </button>
          </Section>
        );
      })}

      <NotificationsToggle children={children} onChanged={load} />
      <RevokeLink />

      <SecondParentSheet child={inviteFor} onClose={() => setInviteFor(null)} />
    </Page>
  );
}

/* ------------------------------------------------------------------ второй родитель */
function SecondParentSheet({ child, onClose }: { child: ParentChild | null; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLink(null);
    setError(null);
    if (!child) return;
    api.secondInvite(child.student_id).then((r) => setLink(r.app_link)).catch((e) => setError(errorText(e)));
  }, [child]);

  if (!child) return null;
  const name = firstName(child.student_name);
  const text = `Подключись к ClassGo, чтобы тоже получать приглашения на выезды класса ${child.class_title} (${name}).`;

  return (
    <Sheet open title="Позвать второго родителя" onClose={onClose}>
      <p className="cg-muted">
        Отправьте ссылку маме, папе или опекуну. Ссылка одноразовая. Не пересылайте сообщения бота — кнопки в них
        не работают.
      </p>
      {error && <Notice tone="error" icon="info">{error}</Notice>}
      {!link && !error && <p className="cg-muted">Готовим ссылку…</p>}
      {link && (
        <div className="cg-stack">
          <Button size="large" stretched iconBefore={<Icon name="share" size={20} />}
            onClick={() => void shareToChat(text, link).then((r) => r === "copied" && toast("Ссылка скопирована."))}>
            Отправить в MAX
          </Button>
          <Button size="medium" stretched variant="secondary"
            onClick={() => void copyText(link).then((ok) => toast(ok ? "Ссылка скопирована." : "Не получилось скопировать.", "info"))}>
            Скопировать ссылку
          </Button>
          <div className="cg-qr-wrap">
            <QrCode value={link} size={200} />
            <span className="cg-muted cg-small">Или покажите QR — второй родитель наведёт камеру.</span>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function RevokeLink() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await api.revoke();
      setConfirming(false);
      await refreshMe("parent");
      toast("Согласие отозвано. Бумажный бланк — у классного руководителя.", "info");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="cg-link cg-danger cg-center-link" onClick={() => setConfirming(true)}>
        Отозвать согласие
      </button>
      <Confirm open={confirming} title="Отозвать согласие?" yes="Да, отозвать" no="Не отзывать" danger busy={busy}
        onYes={() => void revoke()} onClose={() => setConfirming(false)}>
        <p>ClassGo отключит ваш MAX от класса: приглашения сюда приходить перестанут.</p>
        <p>Ответы, которые вы уже дали, останутся в реестре школы. Новые — на бумажном бланке у классного руководителя.</p>
        <p className="cg-muted">Передумаете — откройте ссылку класса ещё раз.</p>
      </Confirm>
    </>
  );
}

/* ------------------------------------------------------------------ подключение */
function JoinByPhone({ onLinked }: { onLinked: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const inside = isInsideMax();

  async function confirmPhone() {
    setBusy(true);
    setResult(null);
    try {
      const contact = await requestContact();
      if (!contact) {
        setResult({ tone: "warn", text: "Номер не получен. Нажмите кнопку ещё раз и разрешите MAX передать номер." });
        return;
      }
      const r = await api.join({ phone: contact.phone, auth_date: contact.authDate, hash: contact.hash });
      if (r.status === "linked") {
        toast(`Готово! Подключили: ${r.children.map(firstName).join(", ")}.`);
        await refreshMe("parent");
        await onLinked();
      } else {
        setResult({ tone: "warn", text: r.message });
      }
    } catch (e) {
      setResult({ tone: "warn", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function demo() {
    setBusy(true);
    try {
      await startDemo();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="cg-join">
        <span className="cg-join-icon"><Icon name="phone" size={26} /></span>
        <div className="cg-actions-title">Найдём вашего ребёнка по номеру телефона</div>
        <p className="cg-muted">
          Классный руководитель внёс ваш номер в список класса. Подтвердите его — и приглашения на выезды будут
          приходить вам в MAX.
        </p>
        {inside ? (
          <Button size="large" stretched loading={busy} onClick={() => void confirmPhone()}
            iconBefore={<Icon name="shield" size={20} />}>
            Подтвердить номер
          </Button>
        ) : (
          <Notice tone="info" icon="info">
            Откройте бота @t158_hakaton_max_bot в MAX и нажмите «Открыть ClassGo».
          </Notice>
        )}
        {result && <Notice tone={result.tone} icon="info">{result.text}</Notice>}
      </Card>
      <p className="cg-muted cg-small cg-center">
        Есть ссылка от учителя? Просто откройте её.
      </p>
      <button type="button" className="cg-demo-card" disabled={busy} onClick={() => void demo()}>
        <span className="cg-demo-icon"><Icon name="spark" size={22} /></span>
        <span className="cg-demo-text">
          <b>Посмотреть демо</b>
          <span>Демо-класс без настоящих детей: вы в нём и учитель, и родитель.</span>
        </span>
        <Icon name="chevron" size={20} />
      </button>
    </>
  );
}

function NotificationsToggle({ children, onChanged }: { children: ParentChild[]; onChanged: () => void }) {
  const { me } = useAppState();
  const on = children.some((c) => c.notifications_enabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    if (!me?.user_id) return;
    setBusy(true);
    try {
      await api.setNotifications(me.user_id, next);
      toast(next ? "Напоминания включены." : "Напоминания выключены. Приглашения на выезды всё равно придут.");
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="cg-setting">
      <div>
        <b>Напоминания в чате MAX</b>
        <span className="cg-muted">Если вы ещё не ответили. С 21 до 8 не пишем. Приглашения на выезды приходят всегда.</span>
      </div>
      <Switch checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} aria-label="Напоминания" />
    </Card>
  );
}
