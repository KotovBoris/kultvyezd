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
  const [manualPhone, setManualPhone] = useState("");
  const inside = isInsideMax();

  useEffect(() => {
    api.joinInfo(code).then(setInfo).catch((e) => setError(errorText(e)));
  }, [code]);

  async function confirm() {
    setBusy(true);
    setProblem(null);
    try {
      let phone = manualPhone;
      let authDate: string | undefined;
      let hash: string | undefined;
      if (inside) {
        const contact = await requestContact();
        if (!contact) {
          setProblem("Номер не получен. Нажмите кнопку ещё раз и разрешите MAX передать номер.");
          return;
        }
        ({ phone, authDate, hash } = contact);
      }
      const r = await api.join({ code, phone, auth_date: authDate, hash });
      if (r.status === "linked") {
        haptic.ok();
        await refreshMe("parent");
        toast(`Готово! ${r.children.map(firstName).join(", ")} — теперь приглашения будут приходить вам.`);
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

  return (
    <Page
      bottom={
        <Button size="large" stretched loading={busy} iconBefore={<Icon name="shield" size={20} />}
          disabled={!inside && manualPhone.replace(/\D/g, "").length < 10} onClick={() => void confirm()}>
          Подтвердить номер телефона
        </Button>
      }
    >
      <Hero overline="Приглашение от классного руководителя" title={`Класс ${info.class_title}`} subtitle={info.school_name} />
      <Card className="cg-join">
        <span className="cg-join-icon"><Icon name="school" size={26} /></span>
        <p>
          <b>{info.teacher_name || "Классный руководитель"}</b> приглашает родителей {info.class_title} в ClassGo:
          здесь приходят приглашения на экскурсии и выезды, ответить можно одной кнопкой.
        </p>
        <p className="cg-muted">
          В списке класса {info.students_count} {plural(info.students_count, "ученик", "ученика", "учеников")}. Нажмите
          кнопку — MAX передаст ваш номер, и мы найдём вашего ребёнка. Никаких паролей.
        </p>
        {!inside && (
          <input className="cg-input" inputMode="tel" placeholder="+7 900 123-45-67"
            value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
        )}
      </Card>
      {problem && <Notice tone="warn" icon="info" title="Не нашли ваш номер">{problem}</Notice>}
    </Page>
  );
}
