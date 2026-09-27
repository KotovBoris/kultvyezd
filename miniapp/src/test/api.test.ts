/** Требования к REST-клиенту (docs/REQUIREMENTS.md): корректные вызовы и обработка ошибок. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("health: GET /healthz", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ status: "ok" }));
    const r = await api.health();
    expect(r.status).toBe("ok");
    expect((fetch as any).mock.calls[0][0]).toBe("/healthz");
  });

  it("parentContext: GET /api/v1/parent/context с max_user_id", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ max_user_id: 42, children: [], found: false }));
    await api.parentContext(42);
    expect((fetch as any).mock.calls[0][0]).toBe("/api/v1/parent/context?max_user_id=42");
  });

  it("resetDemo: POST /api/v1/admin/reset-demo", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ excursion_id: 1, reset_participants: 24 }));
    const r = await api.resetDemo();
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("/api/v1/admin/reset-demo");
    expect(init.method).toBe("POST");
    expect(r.reset_participants).toBe(24);
  });

  it("events: собирает query-параметры и пропускает пустые", async () => {
    (fetch as any).mockResolvedValue(jsonResponse([]));
    await api.events({ city: "Казань", pushkin: true, age: "" });
    const url = (fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/culture-events?");
    expect(url).toContain("city=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C");
    expect(url).toContain("pushkin=true");
    expect(url).not.toContain("age=");
  });

  it("consent: POST с телом", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ consent_status: "APPROVED" }));
    await api.consent(5, { student_id: 1, status: "APPROVED" });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("/api/v1/excursions/5/consent");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ student_id: 1, status: "APPROVED" });
  });

  it("exportOrderUrl: формирует ссылку с fmt", () => {
    expect(api.exportOrderUrl(3, "docx")).toBe("/api/v1/excursions/3/export-order?fmt=docx");
    expect(api.exportOrderUrl(3, "pdf")).toBe("/api/v1/excursions/3/export-order?fmt=pdf");
  });

  it("exportOrderUrl: добавляет выбранный состав приложений (attach)", () => {
    expect(api.exportOrderUrl(3, "docx", ["route", "gibdd"]))
      .toBe("/api/v1/excursions/3/export-order?fmt=docx&attach=route,gibdd");
  });

  it("attachments: GET каталог приложений пакета документов", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ attachments: [{ key: "students", title: "Список" }] }));
    const r = await api.attachments();
    expect((fetch as any).mock.calls[0][0]).toBe("/api/v1/documents/attachments");
    expect(r.attachments[0].key).toBe("students");
  });

  it("sendOrder: POST send-order с chat_id/fmt/attach", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ delivered: true, message: "ok" }));
    const r = await api.sendOrder(5, { chatId: -700, fmt: "pdf", attach: ["route"] });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("/api/v1/excursions/5/send-order?chat_id=-700&fmt=pdf&attach=route");
    expect(init.method).toBe("POST");
    expect(r.delivered).toBe(true);
  });

  it("importClass: POST multipart на /classes/import с query-параметрами класса", async () => {
    (fetch as any).mockResolvedValue(
      jsonResponse({ class_id: 9, title: "9-А", students_created: 24, parents_created: 26, skipped_rows: [] }),
    );
    const file = new File(["ФИО"], "class.csv", { type: "text/csv" });
    const r = await api.importClass(file, { grade: "9", letter: "А", school_number: "12" });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain("/api/v1/classes/import?");
    expect(url).toContain("grade=9");
    expect(url).toContain("school_number=12");
    expect(init.method).toBe("POST");
    // FormData, а не JSON: иначе ломается multipart-boundary
    expect(init.body).toBeInstanceOf(FormData);
    expect(r.students_created).toBe(24);
  });

  it("publish: POST /excursions/{id}/publish?chat_id=...", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ ok: true, chat_id: -700 }));
    const r = await api.publish(5, -700);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("/api/v1/excursions/5/publish?chat_id=-700");
    expect(init.method).toBe("POST");
    expect(r.ok).toBe(true);
  });

  it("linkCode: необязательные parent_phone/role попадают в query, пустые опускаются", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ code: "c", deep_link: "d" }));
    await api.linkCode(4, { parent_phone: "+79001110011", role: "Мама" });
    expect((fetch as any).mock.calls[0][0]).toBe(
      "/api/v1/students/4/link-code?parent_phone=%2B79001110011&role=%D0%9C%D0%B0%D0%BC%D0%B0",
    );
    await api.linkCode(4);
    expect((fetch as any).mock.calls[1][0]).toBe("/api/v1/students/4/link-code");
  });

  it("ошибка: non-ok выбрасывает с detail", async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ detail: "Выезд не найден" }, 404));
    await expect(api.dashboard(999)).rejects.toThrow("Выезд не найден");
  });

  it("ошибка без JSON: выбрасывает со статусом", async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("не json");
      },
    });
    await expect(api.classes()).rejects.toThrow("500");
  });
});
