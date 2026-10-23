import { useCallback, useEffect, useState } from "react";
import { Button, Switch } from "@maxhub/max-ui";
import { api, type ParentChild } from "../api";
import { refreshMe, startDemo } from "../App";
import { dayShort, firstName, initials, plural } from "../format";
import { isInsideMax, requestContact } from "../max";
import { errorText, push, setState, toast, useAppState } from "../store";
import { Avatar, Card, Empty, Hero, Icon, Notice, Page, Section, SkeletonList, Status, Tag } from "../ui";
import { ParentTripView } from "./ParentTrip";

export default function ParentHome() {
  const { me } = useAppState();
  const [children, setChildren] = useState<ParentChild[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Только что отвеченные выезды остаются развёрнутыми — родитель видит квитанцию «Готово».
  const [recent, setRecent] = useState<number[]>([]);

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

  if (children === null) {
    return (
      <Page>
        <Hero overline="Родитель" title={name ? `Здравствуйте, ${name}` : "Выезды ребёнка"} />
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
    return (
      <Page>
        <Hero overline="Один раз перед первым ответом" title="Как работают ответы в ClassGo" />
        <Terms />
      </Page>
    );
  }

  const pendingCount = children.reduce(
    (n, c) => n + c.excursions.filter((e) => e.consent_status === "PENDING").length,
    0,
  );

  return (
    <Page>
      <Hero
        overline="Родитель"
        title={name ? `Здравствуйте, ${name}` : "Выезды ребёнка"}
        subtitle={
          pendingCount
            ? `Ждут вашего ответа: ${pendingCount} ${plural(pendingCount, "приглашение", "приглашения", "приглашений")}`
            : "Новых приглашений нет — мы пришлём сообщение в MAX."
        }
      />

      {error && <Notice tone="error" icon="info">{error}</Notice>}

      {children.map((child) => {
        const open = (e: { consent_status: string; excursion_id: number }) =>
          e.consent_status === "PENDING" || recent.includes(e.excursion_id);
        const pending = child.excursions.filter(open);
        const answered = child.excursions.filter((e) => !open(e));
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
              <Empty icon="calendar" title="Пока нет выездов" text="Когда учитель позовёт класс в музей или театр, приглашение придёт сюда и в чат MAX." />
            )}

            <div className="cg-list">
              {pending.map((trip) => (
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
              {answered.map((trip) => (
                <Card key={trip.excursion_id} onClick={() => push({ name: "parent-trip", excursionId: trip.excursion_id, studentId: child.student_id })}>
                  <div className="cg-answered">
                    <div className="cg-answered-text">
                      <span className="cg-overline">{dayShort(trip.event_date)}</span>
                      <b>{trip.title}</b>
                      {trip.consent_status === "APPROVED" ? (
                        trip.ticket_status === "WAITING_PAYMENT" ? (
                          <Status tone="ticket">Отпустили · остался билет</Status>
                        ) : (
                          <Status tone="going">Вы отпустили</Status>
                        )
                      ) : (
                        <Status tone="notgoing">Не сможет</Status>
                      )}
                    </div>
                    <Icon name="chevron" size={20} className="cg-chev" />
                  </div>
                </Card>
              ))}
            </div>
          </Section>
        );
      })}

      <NotificationsToggle children={children} onChanged={load} />
    </Page>
  );
}

function Terms() {
  const [pep, setPep] = useState(false);
  const [pd, setPd] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const me = await api.acceptTerms();
      setState({ me });
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="cg-terms">
        <label className="cg-check">
          <input type="checkbox" checked={pep} onChange={(e) => setPep(e.target.checked)} />
          <span>
            <b>Мой ответ кнопкой — это моя подпись.</b>
            <span className="cg-muted">
              MAX подтверждает, что ответ дали именно вы. Не передавайте свой телефон и аккаунт MAX другим людям.
            </span>
          </span>
        </label>
        <label className="cg-check">
          <input type="checkbox" checked={pd} onChange={(e) => setPd(e.target.checked)} />
          <span>
            <b>Согласен на обработку данных для выездов.</b>
            <span className="cg-muted">
              Ваше имя и телефон, ФИО ребёнка и класс — только чтобы организовать выезды. Данные хранятся в России.
            </span>
          </span>
        </label>
        <button type="button" className="cg-link" onClick={() => setMore((v) => !v)}>
          {more ? "Свернуть" : "Читать полностью"}
        </button>
        {more && (
          <div className="cg-legal">
            <p>
              <b>Соглашение об использовании простой электронной подписи.</b> Ответ «Отпускаю» или «Не сможет»,
              данный в ClassGo или кнопкой в чате MAX, признаётся простой электронной подписью законного
              представителя (ст. 160 ГК РФ, ст. 6 и 9 Федерального закона № 63-ФЗ). Лицо определяется по аккаунту
              MAX и подтверждённому платформой номеру телефона; в реестре сохраняются дата, время, MAX ID и способ
              ответа. Ответ можно изменить до срока, указанного учителем.
            </p>
            <p>
              <b>Согласие на обработку персональных данных</b> (оформлено отдельно, ст. 9 Федерального закона
              № 152-ФЗ). Оператор — школа; ClassGo обрабатывает данные по её поручению. Состав: ФИО и телефон
              законного представителя, ФИО и класс ребёнка, ответы на приглашения. Цель — организация выездных
              мероприятий класса. Согласие можно отозвать, написав классному руководителю. Если вы не пользуетесь
              MAX, школа примет бумажное согласие.
            </p>
          </div>
        )}
      </Card>
      <Button size="large" stretched disabled={!pep || !pd} loading={busy} onClick={() => void accept()}>
        Продолжить
      </Button>
    </>
  );
}

function JoinByPhone({ onLinked }: { onLinked: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [manualPhone, setManualPhone] = useState("");
  const inside = isInsideMax();

  async function join(phone: string, authDate?: string, hash?: string) {
    const r = await api.join({ phone, auth_date: authDate, hash });
    if (r.status === "linked") {
      toast(`Готово: ${r.children.map(firstName).join(", ")} — ваш ребёнок в ClassGo.`);
      await refreshMe("parent");
      await onLinked();
    } else {
      setResult({ tone: "warn", text: r.message });
    }
  }

  async function confirmPhone() {
    setBusy(true);
    setResult(null);
    try {
      if (inside) {
        const contact = await requestContact();
        if (!contact) {
          setResult({ tone: "warn", text: "Номер не получен. Нажмите кнопку ещё раз и разрешите передать номер." });
          return;
        }
        await join(contact.phone, contact.authDate, contact.hash);
      } else {
        await join(manualPhone);
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
          Классный руководитель внёс ваш номер в список класса. MAX передаст его ClassGo — и все приглашения на
          выезды будут приходить вам в чат.
        </p>
        {!inside && (
          <input className="cg-input" inputMode="tel" placeholder="+7 900 123-45-67"
            value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
        )}
        <Button size="large" stretched loading={busy} disabled={!inside && manualPhone.replace(/\D/g, "").length < 10}
          onClick={() => void confirmPhone()} iconBefore={<Icon name="shield" size={20} />}>
          Подтвердить номер
        </Button>
        {result && <Notice tone={result.tone} icon="info">{result.text}</Notice>}
      </Card>
      <p className="cg-muted cg-small cg-center">
        Пришла ссылка-приглашение от учителя? Просто откройте её — подключение произойдёт так же.
      </p>
      <button type="button" className="cg-demo-card" disabled={busy} onClick={() => void demo()}>
        <span className="cg-demo-icon"><Icon name="spark" size={22} /></span>
        <span className="cg-demo-text">
          <b>Посмотреть демо</b>
          <span>Демо-класс, где вы и учитель, и родитель — без настоящих детей и телефонов.</span>
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
      toast(next ? "Напоминания включены." : "Напоминания выключены. Приглашения всё равно будут видны здесь.");
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
        <span className="cg-muted">Не чаще двух раз и только если вы ещё не ответили.</span>
      </div>
      <Switch checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} aria-label="Напоминания" />
    </Card>
  );
}
