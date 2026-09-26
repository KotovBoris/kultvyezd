/**
 * Обёртка над MAX Bridge (window.WebApp).
 * Во всех методах есть graceful fallback: если мини-приложение открыто в обычном
 * браузере (например, при автоматизированной проверке), вызовы не падают,
 * а ведут себя как обычные веб-операции.
 */
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

/** Значение из ?startapp=... (передаётся в мини-приложение из бота). */
export function startParam(): string | null {
  const fromBridge = initDataUnsafe()?.start_param;
  if (fromBridge) return fromBridge;
  // Fallback для веб-проверки: query-параметры
  const url = new URL(window.location.href);
  return url.searchParams.get("startapp") || url.searchParams.get("student_id");
}

export function currentUserId(): number | null {
  return initDataUnsafe()?.user?.id ?? null;
}

/** Скачивание файла: нативно через MAX Bridge, иначе обычная ссылка. */
export function downloadFile(url: string, fileName: string): void {
  const w = bridge();
  if (w?.downloadFile) {
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
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Открытие внешней ссылки (например, билетного шлюза музея). */
export function openLink(url: string): void {
  const w = bridge();
  if (w?.openLink) {
    try {
      w.openLink(url);
      return;
    } catch {
      /* fallthrough */
    }
  }
  window.open(url, "_blank");
}

/** Запрос номера телефона у пользователя (для привязки родителя к ученику). */
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
    /* необязательно */
  }
}
