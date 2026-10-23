import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@maxhub/max-ui";
import { api, type Dashboard, type Invite, type ParticipantRow } from "../api";
import { dayLong, deadlineText, formatPhone, initials, isPast, money, parseDay, plural, quote, shortName, stamp } from "../format";
import { downloadFile, haptic, isInsideMax, shareToChat, telHref } from "../max";
import { errorText, toast } from "../store";
import {
  Avatar,
  Card,
  Hero,
  Icon,
  Loader,
  Notice,
  Page,
  ProgressBar,
  Section,
  Sheet,
  StatTiles,
  Status,
  Tag,
  type StatusTone,
} from "../ui";

const SOURCE_LABEL: Record<string, string> = {
  bot: "кнопкой в чате MAX",
  miniapp: "в приложении ClassGo",
  paper: "бумажное согласие — отметил учитель",
  call: "устно — нужно письменное подтверждение",
  person: "устно — нужно письменное подтверждение",
  demo: "кнопкой в чате MAX (демо)",
  api: "в ClassGo",
};

function rowTone(p: ParticipantRow): StatusTone {
  if (p.consent_status === "REJECTED") return "notgoing";
  if (p.consent_status === "PENDING") return "waiting";
  return "going";
}

function rowStatus(p: ParticipantRow): string {
  if (p.consent_status === "REJECTED") return "Не сможет";
  if (p.consent_status === "PENDING") return "Ждём ответ";
  return "Отпускают";
}

function rowSubtitle(p: ParticipantRow): string {
  const role = p.parent_role && p.parent_role !== "Законный представитель" ? p.parent_role : "Родитель";
  if (p.consent_status === "PENDING") {
    return p.bot_activated ? `${role} · приглашение в MAX` : `${role} · не подключён к MAX`;
  }
  const manual = p.signed_source === "paper";
  const when = shortStamp(p.signed_at);
  if (p.consent_status === "REJECTED") return `${p.rejection_reason || "Без причины"} · ${when}`;
  return `${manual ? "Бумажное согласие" : role} · ${when}`;
}

/** День выезда наступил (по дате телефона учителя). */
function tripDayReached(eventDate: string | null): boolean {
  const day = parseDay(eventDate);
  if (!day) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return day.getTime() <= today.getTime();
}

function shortStamp(value: string | null): string {
  return stamp(value).replace(/ в /, ", ");
}

export default function TripScreen({ id }: { id: number }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ParticipantRow | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.dashboard(id);
      setData(d);
      setError(null);
      setSelected((cur) => (cur ? d.participants.find((p) => p.student_id === cur.student_id) ?? null : null));
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  const classId = data?.excursion.class_id;
  useEffect(() => {
    if (!classId) return;
    api.invite(classId).then(setInvite).catch(() => setInvite(null));
  }, [classId]);

  const groups = useMemo(() => {
    const rows = data?.participants ?? [];
    return {
      waiting: rows.filter((p) => p.consent_status === "PENDING"),
      going: rows.filter((p) => p.consent_status === "APPROVED"),
      notGoing: rows.filter((p) => p.consent_status === "REJECTED"),
    };
  }, [data]);

  if (!data) {
    return (
      <Page>
        {error ? (
          <Notice tone="error" icon="info" title="Не удалось открыть выезд">
            {error}
          </Notice>
        ) : (
          <Loader label="Открываем выезд…" />
        )}
      </Page>
    );
  }

  const exc = data.excursion;
  const stats = exc.stats ?? {
    total: data.participants.length,
    answered: data.participants.length - groups.waiting.length,
    going: groups.going.length,
    not_going: groups.notGoing.length,
    waiting: groups.waiting.length,
    waiting_ticket: groups.going.filter((p) => p.ticket_status === "WAITING_PAYMENT").length,
  };
  const allAnswered = stats.waiting === 0 && stats.total > 0;
  const hasUnconnected = groups.waiting.some((p) => !p.bot_activated);
  const shareText =
    `${exc.class_title}: выезд ${quote(exc.title)}, ${dayLong(exc.event_date)}. ` +
    `Родители, ответьте одной кнопкой в ClassGo: «Да» или «Нет».`;

  async function remind() {
    setBusy("remind");
    try {
      const r = await api.remind(id);
      haptic.ok();
      const rest = r.targeted - r.delivered;
      toast(
        r.delivered
          ? `Напомнили в MAX ${r.delivered} ${plural(r.delivered, "родителю", "родителям", "родителям")}.` +
              (rest > 0 ? ` Ещё ${rest} без MAX — отправьте им ссылку или дайте бумажный бланк.` : "")
          : "Кто не ответил, ещё не подключён к MAX. Отправьте ссылку в чат класса.",
        r.delivered ? "ok" : "info",
      );
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function shareInvite() {
    if (!invite) return;
    const result = await shareToChat(shareText, invite.app_link);
    if (result === "copied") toast("Ссылка скопирована — вставьте её в чат класса.");
    if (result === "shared") toast("Приглашение отправлено в чат.");
  }

  async function sendDocs() {
    setBusy("docs");
    try {
      const r = await api.sendDocuments(id);
      toast(r.message, r.delivered ? "ok" : "info");
      if (r.delivered) haptic.ok();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const fileBase = `Приказ_${exc.class_title}_${(exc.event_date ?? "").slice(5).replace("-", ".")}`;

  return (
    <Page
      bottom={
        exc.cancelled ? undefined : !allAnswered && stats.waiting > 0 && !exc.departed_at ? (
          <Button size="large" stretched loading={busy === "remind"} onClick={() => void remind()}
            iconBefore={<Icon name="bell" size={20} />}>
            Напомнить {stats.waiting} {plural(stats.waiting, "родителю", "родителям", "родителям")}
          </Button>
        ) : (
          <Button size="large" stretched loading={busy === "docs"} iconBefore={<Icon name="doc" size={20} />}
            onClick={() => (isInsideMax() ? void sendDocs() : downloadFile(api.orderUrl(id, "pdf"), `${fileBase}.pdf`))}>
            {isInsideMax() ? "Прислать документы в чат" : "Скачать документы (PDF)"}
          </Button>
        )
      }
    >
      <Hero
        overline={`${exc.class_title} · ${dayLong(exc.event_date)}`}
        title={exc.title}
        subtitle={exc.location_name}
        aside={exc.is_demo ? <Tag tone="demo">демо</Tag> : undefined}
      />

      {exc.cancelled && (
        <Notice tone="warn" icon="info" title="Выезд отменён">
          Родители получили сообщение об отмене. Ответы и документы сохранены.
        </Notice>
      )}

      <Card className="cg-facts">
        <Fact icon="clock">
          Сбор в <b>{exc.gathering_time ?? "—"}</b> {exc.meeting_point}
          {exc.return_time && <>, вернёмся к <b>{exc.return_time}</b></>}
        </Fact>
        <Fact icon="pin">
          {exc.address || exc.location_name}
          {exc.transport && <>. Добираемся: {exc.transport}</>}
        </Fact>
        <Fact icon="ticket">
          {exc.ticket_price > 0 ? (
            <>
              Билет <b>{money(exc.ticket_price)}</b> — семьи покупают сами, школа деньги не собирает
              {exc.is_pushkin_card && <>. С 14 лет — «Пушкинской картой»</>}
            </>
          ) : (
            <>Вход бесплатный</>
          )}
        </Fact>
        <Fact icon="users">
          Ведёт: {exc.responsible_teacher || "классный руководитель"}
          {exc.escorts && <>, сопровождают: {exc.escorts}</>}
        </Fact>
        {exc.deadline && (
          <Fact icon="calendar">
            {isPast(exc.deadline) ? "Срок ответа прошёл: " : "Ответить до "}
            <b>{deadlineText(exc.deadline)}</b>
          </Fact>
        )}
      </Card>

      <Section>
        <StatTiles stats={stats} />
        <ProgressBar stats={stats} />
      </Section>

      {allAnswered ? (
        <Notice tone="ok" icon="check" title="Ответили все родители">
          Едут {stats.going} из {stats.total}. Документы для директора готовы.
        </Notice>
      ) : !hasUnconnected ? null : (
        <Card className="cg-actions-card">
          <div className="cg-actions-title">Не все родители в MAX</div>
          <p className="cg-muted">
            Отправьте ссылку в чат класса. Родитель подтвердит номер и сразу увидит приглашение.
          </p>
          <Button size="medium" variant="secondary" stretched disabled={!invite}
            iconBefore={<Icon name="share" size={18} />} onClick={() => void shareInvite()}>
            Отправить ссылку в чат
          </Button>
        </Card>
      )}

      {exc.is_demo && !allAnswered && (
        <p className="cg-muted cg-small cg-live">
          <span className="cg-dot" /> Демо-родители отвечают сами — список обновляется на глазах.
        </p>
      )}

      <StudentGroup title="Ещё не ответили" rows={groups.waiting} onOpen={setSelected} />
      <StudentGroup title="Отпускают" rows={groups.going} onOpen={setSelected} />
      <StudentGroup title="Не смогут" rows={groups.notGoing} onOpen={setSelected} />

      <Section title="Документы для директора">
        <Card>
          <ul className="cg-doclist">
            <li><Icon name="doc" size={18} />Проект приказа — на подпись директору</li>
            <li><Icon name="users" size={18} />Список группы и список с телефонами родителей</li>
            <li><Icon name="shield" size={18} />Реестр согласий: кто, когда и как ответил</li>
            <li><Icon name="check" size={18} />Ведомость инструктажа и памятка ученикам</li>
            <li><Icon name="edit" size={18} />Бумажные бланки для тех, кто без MAX</li>
          </ul>
          {!allAnswered && (
            <p className="cg-muted cg-small">
              Сейчас в списке {stats.going} {plural(stats.going, "ученик", "ученика", "учеников")} — те, кого уже
              отпустили. Когда ответят остальные, документы обновятся.
            </p>
          )}
          <div className="cg-row-buttons">
            {isInsideMax() && (
              <Button size="medium" variant={allAnswered ? "primary" : "secondary"} loading={busy === "docs"}
                onClick={() => void sendDocs()}>
                В чат MAX
              </Button>
            )}
            <Button size="medium" variant="secondary" onClick={() => downloadFile(api.orderUrl(id, "pdf"), `${fileBase}.pdf`)}>
              PDF
            </Button>
            <Button size="medium" variant="secondary" onClick={() => downloadFile(api.orderUrl(id, "docx"), `${fileBase}.docx`)}>
              DOCX
            </Button>
          </div>
        </Card>
      </Section>

      {!exc.cancelled && stats.going > 0 && (exc.is_demo || tripDayReached(exc.event_date) || exc.departed_at) && (
        <TripDay
          excursionId={id}
          going={groups.going}
          departedAt={exc.departed_at}
          returnedAt={exc.returned_at}
          onChanged={() => void load()}
        />
      )}

      {!exc.cancelled && !exc.returned_at && <CancelTrip excursionId={id} onDone={() => void load()} />}

      <StudentSheet
        excursionId={id}
        row={selected}
        onClose={() => setSelected(null)}
        onChanged={() => void load()}
      />
    </Page>
  );
}

function Fact({ icon, children }: { icon: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode }) {
  return (
    <div className="cg-fact">
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </div>
  );
}

function StudentGroup({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: ParticipantRow[];
  onOpen: (p: ParticipantRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <Section title={`${title} · ${rows.length}`}>
      <div className="cg-people">
        {rows.map((p) => {
          const tone = rowTone(p);
          return (
            <button key={p.student_id} type="button" className="cg-person" onClick={() => onOpen(p)}>
              <Avatar text={initials(p.full_name)} tone={tone} />
              <span className="cg-person-text">
                <b>{shortName(p.full_name)}</b>
                <span className="cg-muted">{rowSubtitle(p)}</span>
              </span>
              {p.present === false && <Status tone="notgoing">Нет на сборе</Status>}
              {p.present === true && <Status tone="going">На месте</Status>}
              <Icon name="chevron" size={18} className="cg-chev" />
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function StudentSheet({
  excursionId,
  row,
  onClose,
  onChanged,
}: {
  excursionId: number;
  row: ParticipantRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!row) return <Sheet open={false} title="" onClose={onClose}>{null}</Sheet>;
  const tel = telHref(row.parent_phone);

  async function mark(status: "APPROVED" | "REJECTED") {
    if (!row) return;
    setBusy(true);
    try {
      await api.consent(excursionId, {
        student_id: row.student_id,
        status,
        source: "paper",
        parent_name: `${row.parent_name || "Законный представитель"} (бумажный бланк, отметил учитель)`,
        reason: status === "REJECTED" ? "Ответ на бумаге" : null,
      });
      toast(status === "APPROVED" ? "Отмечено: отпускают." : "Отмечено: не сможет.");
      onChanged();
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!row) return;
    setBusy(true);
    try {
      const r = await api.resetConsent(excursionId, row.student_id, true);
      toast(r.changed ? "Отметка снята. Ученик снова в списке «Ещё не ответили»." : r.message, r.changed ? "ok" : "info");
      onChanged();
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open title={shortName(row.full_name)} onClose={onClose}>
      <div className="cg-sheet-status">
        <Status tone={rowTone(row)}>{rowStatus(row)}</Status>
      </div>
      <dl className="cg-dl">
        <dt>Родитель</dt>
        <dd>
          {row.parent_name || "не указан"}
          {row.parent_role ? ` · ${row.parent_role.toLowerCase()}` : ""}
        </dd>
        {row.parent_phone && (
          <>
            <dt>Телефон</dt>
            <dd>{formatPhone(row.parent_phone)}</dd>
          </>
        )}
        {row.consent_status !== "PENDING" && (
          <>
            <dt>Ответ</dt>
            <dd>
              {row.consent_status === "APPROVED" ? "Да, пойдёт" : `Нет: ${row.rejection_reason || "без причины"}`}
              <br />
              <span className="cg-muted">
                {stamp(row.signed_at)} · {SOURCE_LABEL[row.signed_source ?? "api"] ?? "в ClassGo"}
              </span>
            </dd>
            {row.signed_by_max_user_id && (
              <>
                <dt>Подпись</dt>
                <dd className="cg-muted">Простая электронная подпись, ID в MAX: {row.signed_by_max_user_id}</dd>
              </>
            )}
          </>
        )}
      </dl>

      {tel && (
        <a className="cg-callbtn" href={tel}>
          <Icon name="phone" size={18} /> Позвонить родителю
        </a>
      )}

      {row.consent_status === "PENDING" ? (
        <div className="cg-manual">
          <div className="cg-actions-title">Родитель принёс бумажный бланк?</div>
          <p className="cg-muted cg-small">
            Отметьте ответ по бланку. В реестре будет видно, что согласие бумажное. Звонок или устный ответ бланк
            не заменяют.
          </p>
          <div className="cg-row-buttons">
            <Button size="medium" disabled={busy} onClick={() => void mark("APPROVED")}>Бланк: отпускают</Button>
            <Button size="medium" variant="secondary" disabled={busy} onClick={() => void mark("REJECTED")}>
              Бланк: не сможет
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className="cg-link cg-danger" disabled={busy} onClick={() => void reset()}>
          Снять отметку
        </button>
      )}
    </Sheet>
  );
}

function timeOf(value: string | null): string {
  return stamp(value).split(" в ")[1] ?? "";
}

function TripDay({
  excursionId,
  going,
  departedAt,
  returnedAt,
  onChanged,
}: {
  excursionId: number;
  going: ParticipantRow[];
  departedAt: string | null;
  returnedAt: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const present = going.filter((p) => p.present === true).length;
  const absent = going.filter((p) => p.present === false).length;
  const unmarked = going.length - present - absent;

  async function mark(studentId: number, value: boolean | null) {
    try {
      await api.attendance(excursionId, studentId, value);
      haptic.tap();
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function restPresent() {
    setBusy("rest");
    try {
      for (const p of going.filter((x) => x.present == null)) {
        await api.attendance(excursionId, p.student_id, true);
      }
      haptic.ok();
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function milestone(kind: "departed" | "returned") {
    setBusy(kind);
    try {
      const r = await api.milestone(excursionId, kind);
      haptic.ok();
      const head = kind === "departed" ? "Отмечено: группа выехала." : "Отмечено: группа вернулась.";
      toast(r.notified ? `${head} Написали родителям в MAX: ${r.notified}.` : head);
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="День выезда">
      <Card className="cg-actions-card">
        <p className="cg-muted">
          Отметьте, кто пришёл. Родители получат в MAX два сообщения: «Группа выехала» и «Группа вернулась».
        </p>
        <div className="cg-tripday">
          <span><b>{present}</b> на месте</span>
          <span><b>{absent}</b> нет на сборе</span>
          <span><b>{unmarked}</b> не отмечены</span>
        </div>
        <Button size="medium" stretched variant="secondary" iconBefore={<Icon name="check" size={18} />}
          onClick={() => setOpen(true)}>
          Перекличка
        </Button>
        <div className="cg-row-buttons">
          <Button size="medium" variant={departedAt ? "secondary" : "primary"} loading={busy === "departed"}
            disabled={Boolean(departedAt)} onClick={() => void milestone("departed")}>
            {departedAt ? `Выехали в ${timeOf(departedAt)}` : "Группа выехала"}
          </Button>
          <Button size="medium" variant="secondary" loading={busy === "returned"}
            disabled={!departedAt || Boolean(returnedAt)} onClick={() => void milestone("returned")}>
            {returnedAt ? `Вернулись в ${timeOf(returnedAt)}` : "Группа вернулась"}
          </Button>
        </div>
      </Card>

      <Sheet open={open} title="Перекличка" onClose={() => setOpen(false)}>
        <p className="cg-muted cg-small">
          Отметьте, кто пришёл на сбор. Родители тех, кого нет, узнают об этом, когда вы нажмёте «Группа выехала».
        </p>
        <div className="cg-people">
          {going.map((p) => (
            <div key={p.student_id} className="cg-person cg-rollrow">
              <span className="cg-person-text"><b>{shortName(p.full_name)}</b></span>
              <button type="button" className={`cg-roll ${p.present === true ? "on" : ""}`} aria-pressed={p.present === true}
                onClick={() => void mark(p.student_id, p.present === true ? null : true)}>
                Есть
              </button>
              <button type="button" className={`cg-roll no ${p.present === false ? "on" : ""}`}
                aria-pressed={p.present === false}
                onClick={() => void mark(p.student_id, p.present === false ? null : false)}>
                Нет
              </button>
            </div>
          ))}
        </div>
        <div className="cg-stack cg-mt">
          {unmarked > 0 && (present > 0 || absent > 0) && (
            <Button size="large" stretched variant="secondary" loading={busy === "rest"} onClick={() => void restPresent()}>
              Остальные {unmarked} на месте
            </Button>
          )}
          <Button size="large" stretched onClick={() => setOpen(false)}>Готово</Button>
        </div>
      </Sheet>
    </Section>
  );
}

function CancelTrip({ excursionId, onDone }: { excursionId: number; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      const r = await api.cancelTrip(excursionId);
      toast(r.notified ? `Выезд отменён. Написали родителям: ${r.notified}.` : "Выезд отменён.", "info");
      setConfirming(false);
      onDone();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="cg-link cg-danger cg-center-link" onClick={() => setConfirming(true)}>
        Отменить выезд
      </button>
      <Sheet open={confirming} title="Отменить выезд?" onClose={() => setConfirming(false)}>
        <p className="cg-muted">
          Родители получат сообщение в MAX: выезд отменён, ребёнок остаётся на уроках. Отменённый выезд не вернуть —
          только создать заново.
        </p>
        <div className="cg-stack">
          <Button size="large" stretched variant="destructive" loading={busy} onClick={() => void cancel()}>
            Да, отменить выезд
          </Button>
          <Button size="large" stretched variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Не отменять
          </Button>
        </div>
      </Sheet>
    </>
  );
}
