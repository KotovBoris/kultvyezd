import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MaxUI } from "@maxhub/max-ui";
import "./styles.css";
import App from "./App";
import { platform } from "./max";
import { setSession } from "./store";

// Если мини-приложение открыто по контексту родителя (?startapp=<student_id>) —
// переключаемся в роль «родитель» и запоминаем ученика.
const url = new URL(window.location.href);
const studentParam = url.searchParams.get("startapp") || url.searchParams.get("student_id");
if (studentParam && /^\d+$/.test(studentParam)) {
  setSession({ role: "parent", studentId: Number(studentParam) });
}

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <StrictMode>
    <MaxUI platform={platform() === "web" ? undefined : (platform() as "ios" | "android")}>
      <App />
    </MaxUI>
  </StrictMode>,
);
