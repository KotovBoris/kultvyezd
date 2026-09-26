/**
 * Требования BRG-* (docs/REQUIREMENTS.md) — поведение обёртки MAX Bridge.
 * Ключевой кейс: вне MAX нативный downloadFile/openLink не используется (иначе «ничего не происходит»).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  bridge,
  deviceName,
  downloadFile,
  isInsideMax,
  maxVersion,
  openLink,
  platform,
  startParam,
} from "../max";

function setWebApp(value: unknown) {
  (globalThis as any).WebApp = value;
}

describe("MAX Bridge", () => {
  beforeEach(() => {
    delete (globalThis as any).WebApp;
  });

  it("BRG-1: вне MAX isInsideMax=false", () => {
    expect(isInsideMax()).toBe(false);
  });

  it("BRG-1: внутри MAX (есть initData) isInsideMax=true", () => {
    setWebApp({ initData: "user=1&hash=abc" });
    expect(isInsideMax()).toBe(true);
  });

  it("BRG-2: вне MAX downloadFile НЕ вызывает нативный метод", () => {
    const native = vi.fn();
    setWebApp({ downloadFile: native, platform: "web" }); // метода нет, но библиотека «есть»
    downloadFile("http://x/order.docx", "order.docx");
    expect(native).not.toHaveBeenCalled(); // initData нет → не inside
  });

  it("BRG-3: внутри MAX downloadFile вызывает нативный метод", () => {
    const native = vi.fn();
    setWebApp({ initData: "user=1&hash=abc", downloadFile: native });
    downloadFile("http://x/order.docx", "order.docx");
    expect(native).toHaveBeenCalledWith("http://x/order.docx", "order.docx");
  });

  it("BRG-4: вне MAX openLink использует window.open", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    setWebApp({ openLink: vi.fn() });
    openLink("https://museum.ru");
    expect(openSpy).toHaveBeenCalled();
  });

  it("BRG-5: внутри MAX openLink вызывает WebApp.openLink", () => {
    const native = vi.fn();
    setWebApp({ initData: "user=1&hash=abc", openLink: native });
    openLink("https://museum.ru");
    expect(native).toHaveBeenCalledWith("https://museum.ru");
  });

  it("BRG-6: вне MAX platform()='web'", () => {
    expect(platform()).toBe("web");
  });

  it("BRG-7: внутри MAX platform() из WebApp", () => {
    setWebApp({ initData: "x", platform: "ios" });
    expect(platform()).toBe("ios");
  });

  it("BRG-8: startParam из query-параметра", () => {
    window.history.replaceState({}, "", "/?startapp=42");
    expect(startParam()).toBe("42");
  });

  it("BRG-8: startParam из Bridge имеет приоритет", () => {
    window.history.replaceState({}, "", "/?startapp=42");
    setWebApp({ initData: "x", initDataUnsafe: { start_param: "from-bridge" } });
    expect(startParam()).toBe("from-bridge");
  });

  it("BRG-9: отсутствие библиотеки — функции не падают", () => {
    expect(bridge()).toBeUndefined();
    expect(() => downloadFile("http://x", "f")).not.toThrow();
    expect(() => openLink("http://x")).not.toThrow();
    expect(platform()).toBe("web");
    expect(maxVersion()).toBe("unknown");
    expect(deviceName()).toBe("browser");
  });

  it("BRG-10: отсутствие метода внутри WebApp — graceful", () => {
    setWebApp({ initData: "x" });
    expect(() => downloadFile("http://x", "f")).not.toThrow();
    expect(() => openLink("http://x")).not.toThrow();
  });
});
