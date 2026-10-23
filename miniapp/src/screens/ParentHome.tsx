import { useCallback, useEffect, useState } from "react";
import { Button, Switch } from "@maxhub/max-ui";
import { api, type ParentChild } from "../api";
import { refreshMe, startDemo } from "../App";
import { dayShort, firstName, initials, plural } from "../format";
import { copyText, isInsideMax, requestContact, shareToChat } from "../max";
import { errorText, push, setState, toast, useAppState } from "../store";
import { Avatar, Card, Empty, Hero, Icon, Notice, Page, QrCode, Section, Sheet, SkeletonList, Status, Tag } from "../ui";
import { ParentTripView } from "./ParentTrip";

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
            : "Новых приглашений нет — мы пришлём сообщение в MAX."
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
              <Empty icon="calendar" title="Пока нет выездов" text="Когда учитель позовёт класс в музей или театр, приглашение придёт сюда и в чат MAX." />
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

/* ------------------------------------------------------------------ соглашение и согласие */
function Terms({ children }: { children: ParentChild[] }) {
  const { me } = useAppState();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const school = children[0]?.school_name || "школа";
  const kids = children.map((c) => c.student_name).join(", ");

  async function accept() {
    setBusy(true);
    try {
      const next = await api.acceptTerms();
      setState({ me: next });
      toast("Спасибо! Теперь можно отвечать на приглашения.");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function paper() {
    setBusy(true);
    try {
      await api.revoke();
      await refreshMe("parent");
      toast("Хорошо: бумажный бланк согласия передаст классный руководитель.", "info");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      bottom={
        <div className="cg-stack">
          <Button size="large" stretched loading={busy} onClick={() => (step === 1 ? setStep(2) : void accept())}>
            {step === 1 ? "Принимаю" : "Даю согласие"}
          </Button>
          <button type="button" className="cg-link cg-center-link" disabled={busy} onClick={() => void paper()}>
            {step === 1 ? "Отвечать на бумаге" : "Не даю — отвечу на бумаге"}
          </button>
        </div>
      }
    >
      <Hero overline={`Шаг ${step} из 2 · один раз перед первым ответом`}
        title={step === 1 ? "Соглашение об электронной подписи" : "Согласие на обработку данных"} />
      {step === 1 ? (
        <Card className="cg-legalcard">
          <p>{school} и я, законный представитель ученика, договорились:</p>
          <ol>
            <li>Мой ответ кнопкой в ClassGo — простая электронная подпись (ст. 9 63-ФЗ); документ с ней равнозначен бумажному с моей подписью.</li>
            <li>Подписанта определяют по аккаунту MAX и его номеру телефона, совпадающему с номером у школы.</li>
            <li>Так подписываются только согласия и отказы на участие ребёнка в экскурсиях.</li>
            <li>Не передаю телефон и аккаунт MAX другим, об утрате сразу сообщаю классному руководителю; до этого ответы с аккаунта — мои.</li>
            <li>Могу отказаться в любой момент и отвечать на бумаге.</li>
          </ol>
          <p className="cg-muted cg-small">Редакция 1.0. Основание — Порядок получения согласий, утверждённый приказом школы.</p>
        </Card>
      ) : (
        <Card className="cg-legalcard">
          <p>
            Я, {me?.name || "законный представитель"}, свободно, своей волей и в своём интересе, в том числе как
            законный представитель ребёнка ({kids}), даю согласие оператору — {school} — на обработку: моих ФИО,
            телефона, ID в MAX, статуса (мать, отец, опекун); ФИО и класса ребёнка, а при поездке автобусом — его
            возраста; моих ответов и их времени.
          </p>
          <p><b>Цель:</b> участие ребёнка в экскурсиях школы — приглашения, согласия, списки, документы.</p>
          <p>
            <b>Действия:</b> сбор, запись, хранение, уточнение, использование, передача руководителю группы и
            администрации школы, удаление; автоматизированно. По поручению школы данные обрабатывает ClassGo,
            сообщения идут через MAX, хранение — в России.
          </p>
          <p>
            <b>Срок:</b> до конца учебного года или до отзыва. Отозвать — кнопкой «Отозвать согласие» внизу экрана
            или заявлением в школу; уже данные ответы школа хранит по номенклатуре дел.
          </p>
          <p className="cg-muted cg-small">Редакция 1.0. Оформлено отдельным документом (ст. 9 152-ФЗ).</p>
        </Card>
      )}
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
  const text = `Подключись к ClassGo, чтобы тоже получать приглашения на выезды класса ${child.class_title} (${name}) и отвечать на них.`;

  return (
    <Sheet open title="Позвать второго родителя" onClose={onClose}>
      <p className="cg-muted">
        Отправьте ссылку маме, папе или опекуну. Пересылать сообщения бота не нужно — кнопки при пересылке
        пропадают. Ссылка одноразовая.
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
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await api.revoke();
      await refreshMe("parent");
      toast("Согласие отозвано. Отвечать можно на бумаге через классного руководителя.", "info");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="cg-link cg-danger cg-center-link" disabled={busy} onClick={() => void revoke()}>
      {confirming ? "Нажмите ещё раз: отключиться и отвечать на бумаге" : "Отозвать согласие и отвечать на бумаге"}
    </button>
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
        toast(`Готово: ${r.children.map(firstName).join(", ")} — ваш ребёнок в ClassGo.`);
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
          Классный руководитель внёс ваш номер в список класса. MAX передаст его ClassGo с подписью платформы — и
          приглашения на выезды будут приходить вам в чат.
        </p>
        {inside ? (
          <Button size="large" stretched loading={busy} onClick={() => void confirmPhone()}
            iconBefore={<Icon name="shield" size={20} />}>
            Подтвердить номер
          </Button>
        ) : (
          <Notice tone="info" icon="info">
            Подключение по номеру работает внутри MAX: откройте бота @t158_hakaton_max_bot и нажмите «Открыть ClassGo».
          </Notice>
        )}
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
        <span className="cg-muted">Только если вы ещё не ответили, и не с 21:00 до 08:00.</span>
      </div>
      <Switch checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} aria-label="Напоминания" />
    </Card>
  );
}
