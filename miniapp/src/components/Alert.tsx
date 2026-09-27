import type { CSSProperties, ReactNode } from "react";

/**
 * Единый алерт для всех экранов. Сообщения об успехе/инфо озвучиваются
 * скринридером вежливо (`role="status"` + `aria-live="polite"`), ошибки —
 * немедленно (`role="alert"` + `aria-live="assertive"`), как требует §4.10
 * плейбука: смена текста не должна теряться для невизуальных пользователей.
 */
export type AlertTone = "info" | "ok" | "err";

export default function Alert({
  tone = "info",
  children,
  style,
}: {
  tone?: AlertTone;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const assertive = tone === "err";
  return (
    <div
      className={`kv-alert ${tone}`}
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      style={style}
    >
      {children}
    </div>
  );
}
