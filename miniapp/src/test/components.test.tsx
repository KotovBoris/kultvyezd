/** Требования UI-* (docs/REQUIREMENTS.md): экраны и клики. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardScreen from "../screens/DashboardScreen";
import CatalogScreen from "../screens/CatalogScreen";
import ParentScreen from "../screens/ParentScreen";

// ---- моки MAX Bridge и api (vi.hoisted — фабрики vi.mock поднимаются наверх) ----
const { downloadFile, openLink } = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  openLink: vi.fn(),
}));
vi.mock("../max", () => ({
  downloadFile: (...a: unknown[]) => downloadFile(...a),
  openLink: (...a: unknown[]) => openLink(...a),
  haptic: vi.fn(),
  requestContact: vi.fn(async () => null),
  isInsideMax: () => false,
  platform: () => "web",
  deviceName: () => "browser",
  maxVersion: () => "test",
  startParam: () => null,
}));

const apiMock = vi.hoisted(() => ({
  dashboard: vi.fn(),
  remind: vi.fn(),
  generateOrder: vi.fn(),
  exportOrderUrl: (id: number, fmt: string) => `/api/v1/excursions/${id}/export-order?fmt=${fmt}`,
  events: vi.fn(),
  createExcursion: vi.fn(),
  consent: vi.fn(),
  ticket: vi.fn(),
  linkCode: vi.fn(),
  classes: vi.fn(),
  excursions: vi.fn(),
  health: vi.fn(),
  meta: vi.fn(),
}));
vi.mock("../api", () => ({ api: apiMock }));

const excursion = {
  id: 1, class_id: 1, title: "Экскурсия в Кремль", location_name: "Казанский Кремль",
  address: "Кремль, 1", event_date: "2026-10-03", gathering_time: "08:30", return_time: "14:00",
  deadline: "2026-10-01T12:00:00", ticket_price: 500, ticket_sale_url: "https://museum.ru",
  is_pushkin_card: true, status: "VOTING", school_name: "Школа", responsible_teacher: "Учитель",
};

function dashboard(green = 1) {
  return {
    excursion,
    summary: { GREEN: green, YELLOW: 1, GREY: 2, RED: 0 },
    progress_percent: 50,
    participants: [
      { student_id: 1, full_name: "Абдуллина Алия", traffic_light: "GREEN", consent_status: "APPROVED",
        ticket_status: "PAID", signed_by_name: "Мама", signed_by_phone: "+7", signed_at: "2026-09-26T10:00:00",
        rejection_reason: null, ticket_number: "KZ-1" },
      { student_id: 2, full_name: "Бикмуллин Тимур", traffic_light: "YELLOW", consent_status: "APPROVED",
        ticket_status: "WAITING_PAYMENT", signed_by_name: "Папа", signed_by_phone: "+7", signed_at: null,
        rejection_reason: null, ticket_number: null },
    ],
  };
}

/** Дашборд, где ребёнок родителя (student_id=1) ещё НЕ определился — для экрана родителя. */
function parentDashboard() {
  return {
    excursion,
    summary: { GREEN: 0, YELLOW: 0, GREY: 2, RED: 0 },
    progress_percent: 0,
    participants: [
      { student_id: 1, full_name: "Абдуллина Алия", traffic_light: "GREY", consent_status: "PENDING",
        ticket_status: "WAITING_PAYMENT", signed_by_name: null, signed_by_phone: null, signed_at: null,
        rejection_reason: null, ticket_number: null },
    ],
  };
}

describe("DashboardScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UI-13: рендерит «Светофор» и таблицу участников", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    expect(await screen.findByText(/Готов: 1/)).toBeInTheDocument();
    expect(screen.getByText("Абдуллина Алия")).toBeInTheDocument();
    expect(screen.getByText("Бикмуллин Тимур")).toBeInTheDocument();
  });

  it("UI-6: клик «Напомнить не ответившим» вызывает api.remind", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.remind.mockResolvedValue({ targeted: 2, delivered: 0, recipients: [] });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Напомнить не ответившим/i }));
    await waitFor(() => expect(apiMock.remind).toHaveBeenCalledWith(1));
  });

  it("UI-7: «Сформировать приказ» вызывает export и downloadFile", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.generateOrder.mockResolvedValue({ version: 1, docx_url: "u", pdf_url: "p" });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Сформировать приказ/i }));
    await waitFor(() => expect(apiMock.generateOrder).toHaveBeenCalledWith(1));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
  });

  it("UI-8: присутствуют прямые ссылки на DOCX и PDF", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    const docx = screen.getByRole("link", { name: /DOCX \(прямая ссылка\)/i });
    const pdf = screen.getByRole("link", { name: /PDF \(прямая ссылка\)/i });
    expect(docx).toHaveAttribute("href", "/api/v1/excursions/1/export-order?fmt=docx");
    expect(pdf).toHaveAttribute("href", "/api/v1/excursions/1/export-order?fmt=pdf");
  });
});

describe("CatalogScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UI-3: чекбокс «Пушкинская карта» перезапрашивает каталог с фильтром", async () => {
    apiMock.events.mockResolvedValue([
      { id: 1, title: "Событие", venue: "Музей", city: "Казань", age_rating: "12+",
        event_date: "2026-10-03", duration_min: 60, price: 500, pushkin_eligible: true,
        is_free: false, ticket_url: "u", address: "a", description: "d", source: "s" },
    ]);
    render(<CatalogScreen classes={[{ id: 1, title: "8Б", school_number: "", school_name: "", teacher_name: "", students: [] }]} onCreated={() => {}} />);
    await screen.findByText("Событие");
    // первый чекбокс фильтра — «Пушкинская карта»
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() => {
      const calls = apiMock.events.mock.calls;
      const last = calls[calls.length - 1][0];
      expect(last.pushkin).toBe(true);
    });
  });

  it("UI-4/UI-5: выбор события и создание выезда", async () => {
    apiMock.events.mockResolvedValue([
      { id: 7, title: "Событие", venue: "Музей", city: "Казань", age_rating: "12+",
        event_date: "2026-10-03", duration_min: 60, price: 0, pushkin_eligible: true,
        is_free: true, ticket_url: "u", address: "a", description: "d", source: "s" },
    ]);
    apiMock.createExcursion.mockResolvedValue({ ...excursion, id: 42, title: "Событие" });
    const onCreated = vi.fn();
    render(<CatalogScreen classes={[{ id: 1, title: "8Б", school_number: "", school_name: "", teacher_name: "", students: [] }]} onCreated={onCreated} />);
    await screen.findByText("Событие");
    // выбираем событие из списка «Выбор события»
    const pickers = screen.getAllByRole("combobox");
    const picker = pickers[pickers.length - 1];
    await userEvent.selectOptions(picker, "7");
    await userEvent.click(await screen.findByRole("button", { name: /Создать выезд/i }));
    await waitFor(() => expect(apiMock.createExcursion).toHaveBeenCalled());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(42));
  });
});

describe("ParentScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  function renderParent() {
    apiMock.dashboard.mockResolvedValue(parentDashboard());
    render(<ParentScreen studentId={1} excursions={[excursion]} />);
  }

  it("UI-10: «Отпускаю ребёнка» отправляет согласие APPROVED", async () => {
    apiMock.consent.mockResolvedValue({ message: "Согласие подписано", changed: true });
    renderParent();
    await userEvent.click(await screen.findByRole("button", { name: /Отпускаю ребёнка/i }));
    await waitFor(() => expect(apiMock.consent).toHaveBeenCalled());
    expect(apiMock.consent.mock.calls[0][1]).toMatchObject({ student_id: 1, status: "APPROVED" });
  });

  it("UI-11: «Не сможет поехать» отправляет REJECTED с причиной", async () => {
    apiMock.consent.mockResolvedValue({ message: "Отказ зафиксирован", changed: true });
    renderParent();
    await userEvent.click(await screen.findByRole("button", { name: /Не сможет поехать/i }));
    await waitFor(() => expect(apiMock.consent).toHaveBeenCalled());
    expect(apiMock.consent.mock.calls[0][1]).toMatchObject({ student_id: 1, status: "REJECTED" });
  });
});
