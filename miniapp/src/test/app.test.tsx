/** Требования UI-1, UI-2, UI-14 (docs/REQUIREMENTS.md). */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../max", () => ({
  downloadFile: vi.fn(),
  openLink: vi.fn(),
  haptic: vi.fn(),
  requestContact: vi.fn(async () => null),
  isInsideMax: () => false,
  platform: () => "web",
  deviceName: () => "browser",
  maxVersion: () => "test",
  startParam: () => null,
  currentUserId: () => null,
}));

const apiMock = vi.hoisted(() => ({
  excursions: vi.fn(),
  classes: vi.fn(),
  events: vi.fn(),
  dashboard: vi.fn(),
  health: vi.fn(),
  meta: vi.fn(),
  remind: vi.fn(),
  generateOrder: vi.fn(),
  parentContext: vi.fn(async () => ({ max_user_id: 0, children: [], found: false })),
  resetDemo: vi.fn(async () => ({ excursion_id: 1, reset_participants: 0 })),
  exportOrderUrl: (id: number, fmt: string) => `/x/${id}/${fmt}`,
}));
vi.mock("../api", () => ({ api: apiMock }));

import App from "../App";

const excursion = {
  id: 1, class_id: 1, title: "Экскурсия в Кремль", location_name: "Кремль", address: "a",
  event_date: "2026-10-03", gathering_time: "08:30", return_time: "14:00", deadline: null,
  ticket_price: 0, ticket_sale_url: "", is_pushkin_card: false, status: "VOTING",
  school_name: "Ш", responsible_teacher: "У",
};

describe("App", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UI-1: загрузка — запрашивает выезды и классы, рендерит шапку", async () => {
    apiMock.excursions.mockResolvedValue([excursion]);
    apiMock.classes.mockResolvedValue([]);
    apiMock.dashboard.mockResolvedValue({ excursion, summary: { GREEN: 0, YELLOW: 0, GREY: 0, RED: 0 }, progress_percent: 0, participants: [] });
    render(<App />);
    expect(screen.getByText("КультВыезд")).toBeInTheDocument();
    await waitFor(() => expect(apiMock.excursions).toHaveBeenCalled());
    expect(await screen.findByText("Экскурсия в Кремль")).toBeInTheDocument();
  });

  it("UI-2: клик по «Каталог событий» запрашивает каталог", async () => {
    apiMock.excursions.mockResolvedValue([]);
    apiMock.classes.mockResolvedValue([]);
    apiMock.events.mockResolvedValue([]);
    render(<App />);
    await waitFor(() => expect(apiMock.classes).toHaveBeenCalled());
    await userEvent.click(screen.getByText("Каталог событий"));
    await waitFor(() => expect(apiMock.events).toHaveBeenCalled());
  });

  it("UI-14: ошибка загрузки показывается пользователю", async () => {
    apiMock.excursions.mockRejectedValue(new Error("бэкенд недоступен"));
    apiMock.classes.mockRejectedValue(new Error("бэкенд недоступен"));
    render(<App />);
    expect(await screen.findByText(/Не удалось загрузить данные/i)).toBeInTheDocument();
  });
});
