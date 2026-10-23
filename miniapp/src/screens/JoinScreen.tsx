import { useEffect, useState } from "react";
import { Button } from "@maxhub/max-ui";
import { api, type JoinInfo } from "../api";
import { refreshMe } from "../App";
import { firstName, plural } from "../format";
import { haptic, isInsideMax, requestContact } from "../max";
import { errorText, resetTo, toast } from "../store";
import { Card, Hero, Icon, Loader, Notice, Page } from "../ui";

export default function JoinScreen({ code }: { code: string }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inside = isInsideMax();

  useEffect(() => {
    api.joinInfo(code).then(setInfo).catch((e) => setError(errorText(e)));
  }, [code]);

  async function confirm() {
    setBusy(true);
    setProblem(null);
    try {
      let payload: { code: string; phone: string; auth_date?: string; hash?: string } = { code, phone: "" };
      if (!info?.is_demo) {
        const contact = await requestContact();
        if (!contact) {
          setProblem("Номер не получен. Нажмите кнопку ещё раз и разрешите MAX передать номер.");
          return;
        }
        payload = { code, phone: contact.phone, auth_date: contact.authDate, hash: contact.hash };
      }
      const r = await api.join(payload);
      if (r.status === "linked") {
        haptic.ok();
        await refreshMe("parent");
        toast(
          info?.is_demo
            ? `Вы родитель ученика демо-класса: ${r.children.join(", ")}. Приглашение уже в чате с ботом.`
            : `Готово! ${r.children.map(firstName).join(", ")} — теперь приглашения будут приходить вам.`,
        );
        resetTo({ name: "home" });
      } else {
        setProblem(r.message);
      }
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Page>
        <Notice tone="error" icon="info" title="Ссылка не работает">
          {error}. Попросите классного руководителя прислать ссылку ещё раз.
        </Notice>
      </Page>
    );
  }
  if (!info) return <Page><Loader /></Page>;

  const canConfirm = info.is_demo || inside;

  return (
    <Page
      bottom={
        canConfirm ? (
          <Button size="large" stretched loading={busy} iconBefore={<Icon name={info.is_demo ? "check" : "shield"} size={20} />}
            onClick={() => void confirm()}>
            {info.is_demo ? "Стать родителем ученика" : "Подтвердить номер телефона"}
          </Button>
        ) : undefined
      }
    >
      <Hero
        overline={info.is_demo ? "Живое демо ClassGo" : "Приглашение от классного руководителя"}
        title={`Класс ${info.class_title}`}
        subtitle={info.school_name}
      />
      <Card className="cg-join">
        <span className="cg-join-icon"><Icon name={info.is_demo ? "spark" : "school"} size={26} /></span>
        {info.is_demo ? (
          <>
            <p>
              Это демо-класс <b>{info.teacher_name}</b>. Нажмите кнопку — вы станете родителем одного из учеников, и
              приглашение на выезд сразу придёт вам в чат с ботом.
            </p>
            <p className="cg-muted">Ответьте «Да» — и у учителя на экране появится ваше имя. Телефон не нужен.</p>
          </>
        ) : (
          <>
            <p>
              <b>{info.teacher_name || "Классный руководитель"}</b> приглашает родителей {info.class_title} в ClassGo:
              здесь приходят приглашения на экскурсии, ответить можно одной кнопкой.
            </p>
            <p className="cg-muted">
              В списке класса {info.students_count} {plural(info.students_count, "ученик", "ученика", "учеников")}.
              Нажмите кнопку — MAX передаст ваш номер с подписью платформы, и мы найдём вашего ребёнка.
            </p>
          </>
        )}
        {!canConfirm && (
          <Notice tone="info" icon="info">
            Подключение работает внутри MAX: откройте эту ссылку в приложении MAX.
          </Notice>
        )}
      </Card>
      {problem && <Notice tone="warn" icon="info" title="Не получилось подключиться">{problem}</Notice>}
    </Page>
  );
}
