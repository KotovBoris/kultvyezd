import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MaxUI } from "@maxhub/max-ui";
import "./styles.css";
import App from "./App";
import { platform } from "./max";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <StrictMode>
    <MaxUI platform={platform() === "web" ? undefined : (platform() as "ios" | "android")}>
      <App />
    </MaxUI>
  </StrictMode>,
);
