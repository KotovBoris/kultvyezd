export interface MaxInitUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface MaxInitData {
  query_id?: string;
  auth_date?: number;
  hash?: string;
  user?: MaxInitUser;
  chat?: { id: number; type: string };
  start_param?: string;
}

declare global {
  interface Window {
    WebApp?: any;
  }
}

export function bridge(): any | undefined {
  return typeof window !== "undefined" ? window.WebApp : undefined;
}

export function isInsideMax(): boolean {
  return Boolean(bridge() && bridge()?.initData);
}

export function platform(): "ios" | "android" | "desktop" | "web" {
  return (bridge()?.platform as any) ?? "web";
}

export function maxVersion(): string {
  return bridge()?.version ?? "unknown";
}

export function deviceName(): string {
  return bridge()?.deviceName ?? "browser";
}

export function initDataUnsafe(): MaxInitData | null {
  try {
    return bridge()?.initDataUnsafe ?? null;
  } catch {
    return null;
  }
}

export function startParam(): string | null {
  const fromBridge = initDataUnsafe()?.start_param;
  if (fromBridge) return fromBridge;
  const url = new URL(window.location.href);
  return url.searchParams.get("startapp") || url.searchParams.get("student_id");
}

export function currentUserId(): number | null {
  const fromBridge = initDataUnsafe()?.user?.id;
  if (fromBridge) return fromBridge;
  const url = new URL(window.location.href);
  const raw = url.searchParams.get("user_id");
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

export function effectiveUserId(): number {
  const known = currentUserId();
  if (known) return known;
  try {
    const stored = localStorage.getItem("classgo_demo_uid");
    if (stored && /^\d+$/.test(stored)) return Number(stored);
    const generated = 500000 + Math.floor(Math.random() * 400000);
    localStorage.setItem("classgo_demo_uid", String(generated));
    return generated;
  } catch {
    return 599999;
  }
}

export function downloadFile(url: string, fileName: string): void {
  const w = bridge();
  if (isInsideMax() && typeof w?.downloadFile === "function") {
    try {
      w.downloadFile(url, fileName);
      return;
    } catch {
      /* fallthrough */
    }
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function openLink(url: string): void {
  const w = bridge();
  if (isInsideMax() && typeof w?.openLink === "function") {
    try {
      w.openLink(url);
      return;
    } catch {
      /* fallthrough */
    }
  }
  window.open(url, "_blank", "noopener");
}

export function fileUrl(url: string): string {
  return url;
}

export async function requestContact(): Promise<{ phone: string; authDate: string; hash: string } | null> {
  const w = bridge();
  if (!w?.requestContact) return null;
  try {
    return await w.requestContact();
  } catch {
    return null;
  }
}

export function showBackButton(onClick: () => void): void {
  const w = bridge();
  if (!w?.BackButton) return;
  w.BackButton.onClick(onClick);
  w.BackButton.show();
}

export function hideBackButton(): void {
  bridge()?.BackButton?.hide();
}

export function haptic(): void {
  try {
    bridge()?.HapticFeedback?.impactOccurred?.("light");
  } catch {
    /* optional */
  }
}
