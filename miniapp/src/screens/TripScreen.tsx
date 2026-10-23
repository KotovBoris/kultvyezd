import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@maxhub/max-ui";
import { api, type Dashboard, type Invite, type ParticipantRow } from "../api";
import { dayLong, deadlineText, formatPhone, initials, isPast, money, plural, quote, shortName, stamp } from "../format";
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
  call: "по телефону — отметил учитель",
  person: "лично — отметил учитель",
  demo: "кнопкой в чате MAX (демо)",
  api: "в ClassGo",
};

function rowTone(p: ParticipantRow): StatusTone {
  if (p.consent_status === "REJECTED") return "notgoing";
  if (p.consent_status === "PENDING") return "waiting";
  return p.ticket_status === "WAITING_PAYMENT" ? "ticket" : "going";
}

function rowStatus(p: ParticipantRow): string {
  if (p.consent_status === "REJECTED") return "Не сможет";
  if (p.consent_status === "PENDING") return "Ждём ответ";
  if (p.ticket_status === "WAITING_PAYMENT") return "Без билета";
  return "Отпускают";
}

function rowSubtitle(p: ParticipantRow): string {
  const role = p.parent_role && p.parent_role !== "Законный представитель" ? p.parent_role : "Родитель";
  if (p.consent_status === "PENDING") {
    return p.bot_activated ? `${role} · приглашение в MAX` : `${role} · не подключён к MAX`;
  }
  const manual = p.signed_source === "paper" || p.signed_source === "call" || p.signed_source === "person";
  const when = shortStamp(p.signed_at);
  if (p.consent_status === "REJECTED") return `${p.rejection_reason || "Без причины"} · ${when}`;
  const ticket = p.ticket_status === "PAID" ? " · билет есть" : "";
  return `${manual ? "Отметил учитель" : role} · ${when}${ticket}`;
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
    `Родители, ответьте, пожалуйста, в ClassGo — одной кнопкой: «Отпускаю» или «Не сможет».`;

  async function remind() {
    setBusy("remind");
    try {
      const r = await api.remind(id);
      haptic.ok();
      const rest = r.targeted - r.delivered;
      toast(
        r.delivered
          ? `Напоминание отправлено в MAX: ${r.delivered} ${plural(r.delivered, "родителю", "родителям", "родителям")}` +
              (rest > 0 ? `. Ещё ${rest} — без MAX: позвоните или отметьте вручную.` : ".")
          : "Родители, которые не ответили, ещё не подключены к MAX — отправьте ссылку в чат класса.",
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
        !allAnswered && stats.waiting > 0 ? (
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

      <Card className="cg-facts">
        <Fact icon="clock">
          Сбор в <b>{exc.gathering_time ?? "—"}</b> {exc.meeting_point}
          {exc.return_time && <>, вернёмся к <b>{exc.return_time}</b></>}
        </Fact>
        <Fact icon="pin">{exc.address || exc.location_name}</Fact>
        <Fact icon="ticket">
          {exc.ticket_price > 0 ? (
            <>
              Билет <b>{money(exc.ticket_price)}</b> — семьи платят сами в кассе
              {exc.is_pushkin_card && <> или «Пушкинской картой» (14+)</>}
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
            {isPast(exc.deadline) ? "Сбор ответов закрыт " : "Ответить до "}
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
          Едут {stats.going} из {stats.total}. Документы для директора готовы — их можно прислать в чат или скачать.
        </Notice>
      ) : !hasUnconnected ? null : (
        <Card className="cg-actions-card">
          <div className="cg-actions-title">Кто не подключён к MAX?</div>
          <p className="cg-muted">
            Отправьте ссылку в чат класса — родитель откроет её, подтвердит номер, и приглашение появится сразу.
          </p>
          <Button size="medium" variant="secondary" stretched disabled={!invite}
            iconBefore={<Icon name="share" size={18} />} onClick={() => void shareInvite()}>
            Отправить ссылку в чат класса
          </Button>
        </Card>
      )}

      <Section title="Документы для директора">
        <Card>
          <ul className="cg-doclist">
            <li><Icon name="doc" size={18} />Проект приказа о выезде</li>
            <li><Icon name="users" size={18} />Список группы с телефонами родителей</li>
            <li><Icon name="shield" size={18} />Реестр согласий: кто, когда и как ответил</li>
            <li><Icon name="check" size={18} />Ведомость инструктажа по безопасности</li>
            <li><Icon name="edit" size={18} />Бумажные бланки для тех, кто без MAX</li>
          </ul>
          {!allAnswered && (
            <p className="cg-muted cg-small">
              Сейчас в список попадут {stats.going} {plural(stats.going, "ученик", "ученика", "учеников")} — те, кого
              уже отпустили. Документы пересоберутся, когда ответят остальные.
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

      {exc.is_demo && !allAnswered && (
        <p className="cg-muted cg-small cg-live">
          <span className="cg-dot" /> Виртуальные родители демо-класса отвечают сами — список обновляется на глазах.
        </p>
      )}

      <StudentGroup title="Ещё не ответили" rows={groups.waiting} onOpen={setSelected} />
      <StudentGroup title="Отпускают" rows={groups.going} onOpen={setSelected} />
      <StudentGroup title="Не смогут" rows={groups.notGoing} onOpen={setSelected} />

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
              {tone === "ticket" && <Status tone="ticket">Без билета</Status>}
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
  const [method, setMethod] = useState<"paper" | "call" | "person">("paper");
  if (!row) return <Sheet open={false} title="" onClose={onClose}>{null}</Sheet>;
  const tel = telHref(row.parent_phone);

  async function mark(status: "APPROVED" | "REJECTED") {
    if (!row) return;
    setBusy(true);
    try {
      const labels = { paper: "бумажное согласие", call: "по телефону", person: "лично" };
      await api.consent(excursionId, {
        student_id: row.student_id,
        status,
        source: method,
        parent_name: `${row.parent_name || "Законный представитель"} (${labels[method]}, отметил учитель)`,
        reason: status === "REJECTED" ? "Сообщили учителю" : null,
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
      toast(r.changed ? "Отметка снята — ребёнок снова в списке «ждём ответ»." : r.message, r.changed ? "ok" : "info");
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
              {row.consent_status === "APPROVED" ? "Отпускаю" : `Не сможет: ${row.rejection_reason || "без причины"}`}
              <br />
              <span className="cg-muted">
                {stamp(row.signed_at)} · {SOURCE_LABEL[row.signed_source ?? "api"] ?? "в ClassGo"}
              </span>
            </dd>
            {row.signed_by_max_user_id && (
              <>
                <dt>Подпись</dt>
                <dd className="cg-muted">Простая электронная подпись: MAX ID {row.signed_by_max_user_id}</dd>
              </>
            )}
          </>
        )}
        {row.consent_status === "APPROVED" && row.ticket_status !== "NOT_REQUIRED" && (
          <>
            <dt>Билет</dt>
            <dd>{row.ticket_status === "PAID" ? "Куплен" : "Ещё не отмечен"}</dd>
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
          <div className="cg-actions-title">Ответили не в MAX? Отметьте вручную</div>
          <div className="cg-chips">
            {(["paper", "call", "person"] as const).map((m) => (
              <button key={m} type="button" className={`cg-chip ${method === m ? "active" : ""}`}
                aria-pressed={method === m} onClick={() => setMethod(m)}>
                {m === "paper" ? "Бумажное согласие" : m === "call" ? "По телефону" : "Лично"}
              </button>
            ))}
          </div>
          <div className="cg-row-buttons">
            <Button size="medium" disabled={busy} onClick={() => void mark("APPROVED")}>Отпускают</Button>
            <Button size="medium" variant="secondary" disabled={busy} onClick={() => void mark("REJECTED")}>
              Не сможет
            </Button>
          </div>
          <p className="cg-muted cg-small">В реестре согласий будет видно, что ответ получен не через MAX.</p>
        </div>
      ) : (
        <button type="button" className="cg-link cg-danger" disabled={busy} onClick={() => void reset()}>
          Снять отметку и ждать ответ заново
        </button>
      )}
    </Sheet>
  );
}
