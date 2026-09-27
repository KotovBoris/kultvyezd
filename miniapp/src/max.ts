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

/**
 * id чата MAX, из которого открыт мини-апп: нужен, чтобы опубликовать карточку
 * выезда именно в чат класса (UC-3). Внутри MAX берём из initDataUnsafe().chat,
 * вне MAX (веб-проверка) — из ?chat_id=..., иначе null (кнопка публикации
 * предложит ввести id вручную).
 */
export function currentChatId(): number | null {
  const fromBridge = initDataUnsafe()?.chat?.id;
  if (fromBridge) return fromBridge;
  const url = new URL(window.location.href);
  const q = url.searchParams.get("chat_id");
  return q && /^-?\d+$/.test(q) ? Number(q) : null;
}

/**
 * Скачивание файла.
 * ВАЖНО: нативный WebApp.downloadFile существует и в обычном браузере (библиотека
 * MAX Bridge подключена всегда), но по документации MAX «в браузере метод не работает»
 * — вызов молча ничего не делает. Поэтому используем его ТОЛЬКО внутри мессенджера,
 * а в браузере — обычную ссылку с атрибутом download.
 */
export function downloadFile(url: string, fileName: string): void {
  const w = bridge();
  if (isInsideMax() && typeof w?.downloadFile === "function") {
    try {
      w.downloadFile(url, fileName);
      return;
    } catch {
      /* fallthrough — попробуем браузерный способ */
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

/** Открытие внешней ссылки (например, билетного шлюза музея). */
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

/** Прямая HTTPS-ссылка на файл — используется как запасной вариант в интерфейсе. */
export function fileUrl(url: string): string {
  return url;
}

/**
 * Запрос номера телефона у пользователя (для привязки родителя к ученику).
 *
 * ВАЖНО: нативный диалог MAX может не ответить вовсе (в браузере, при отказе,
 * при сбое моста) — тогда промис никогда не завершается. Раньше это подвешивало
 * отправку согласия в состоянии «Отправляем…» навсегда. Телефон здесь
 * необязателен, поэтому ограничиваем ожидание и возвращаем null.
 */
export async function requestContact(
  timeoutMs = 5000,
): Promise<{ phone: string; authDate: string; hash: string } | null> {
  const w = bridge();
  if (!w?.requestContact) return null;
  try {
    return await Promise.race([
      w.requestContact(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
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
