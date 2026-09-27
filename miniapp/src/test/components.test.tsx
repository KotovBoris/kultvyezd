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
  currentChatId: () => null, // вне MAX id чата подставляется вручную
  platform: () => "web",
  deviceName: () => "browser",
  maxVersion: () => "test",
  startParam: () => null,
}));

const apiMock = vi.hoisted(() => ({
  dashboard: vi.fn(),
  remind: vi.fn(),
  generateOrder: vi.fn(),
  publish: vi.fn(),
  attachments: vi.fn(async () => ({ attachments: [] })),
  sendOrder: vi.fn(),
  exportOrderUrl: (id: number, fmt: string) => `/api/v1/excursions/${id}/export-order?fmt=${fmt}`,
  participantsCsvUrl: (id: number) => `/api/v1/excursions/${id}/participants.csv`,
  calendarIcsUrl: (id: number) => `/api/v1/excursions/${id}/calendar.ics`,
  emergencyContacts: vi.fn(),
  events: vi.fn(),
  createExcursion: vi.fn(),
  importClass: vi.fn(),
  consent: vi.fn(),
  ticket: vi.fn(),
  linkCode: vi.fn(),
  classes: vi.fn(),
  excursions: vi.fn(),
  health: vi.fn(),
  meta: vi.fn(),
}));
vi.mock("../api", () => ({ api: apiMock }));

import ImportScreen from "../screens/ImportScreen";

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

/** Дети родителя из parent_context (аддитивный контракт ST-1). */
const child1 = {
  student_id: 1, student_name: "Абдуллина Алия", parent_name: "Абдуллина Р.", parent_role: "Мама",
  parent_contact_id: 11,
  parents: [
    { id: 11, contact_id: 11, full_name: "Абдуллина Р.", phone_number: "+79001110011", role: "Мама", max_user_id: 424242 },
    { id: 12, contact_id: 12, full_name: "Абдуллин И.", phone_number: "+79001110012", role: "Папа", max_user_id: null },
  ],
  excursions: [
    { excursion_id: 1, title: "Экскурсия в Кремль", location_name: "Казанский Кремль", event_date: "2026-10-03",
      gathering_time: "08:30", return_time: "14:00", deadline: null, ticket_price: 500, ticket_sale_url: "",
      is_pushkin_card: false, status: "VOTING", traffic_light: "GREY", consent_status: "PENDING",
      ticket_status: "WAITING_PAYMENT", rejection_reason: null, signed_by_name: null, signed_by_phone: null,
      signed_at: null, signers: [] },
  ],
};

const child2 = { ...child1, student_id: 2, student_name: "Абдуллин Марат", excursions: [] };

/** Ребёнок, по которому уже подписал один из двух родителей. */
const signedChild = {
  ...child1,
  excursions: [
    { ...child1.excursions[0], consent_status: "APPROVED", traffic_light: "GREEN", signed_by_name: "Абдуллина Р.",
      signed_by_phone: "+79001110011", signed_at: "2026-09-26T10:00:00",
      signers: [
        { contact_id: 11, full_name: "Абдуллина Р.", phone_number: "+79001110011", role: "Мама", max_user_id: 424242, is_signer: true },
        { contact_id: 12, full_name: "Абдуллин И.", phone_number: "+79001110012", role: "Папа", max_user_id: null, is_signer: false },
      ] },
  ],
};

/** Событие каталога для тестов. */
const event1 = {
  id: 1, title: "Событие", venue: "Музей", city: "Казань", age_rating: "12+",
  event_date: "2026-10-03", duration_min: 60, price: 500, pushkin_eligible: true,
  is_free: false, ticket_url: "u", address: "a", description: "d", source: "s", age_min: 12,
};

describe("DashboardScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UI-13: рендерит «Светофор» и таблицу участников", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    expect(await screen.findByText(/Готов: 1/)).toBeInTheDocument();
    expect(screen.getByText("Абдуллина Алия")).toBeInTheDocument();
    expect(screen.getByText("Бикмуллин Тимур")).toBeInTheDocument();
  });

  it("ST-3: во время загрузки — скелетон, а не текст «Загрузка»", async () => {
    let resolve!: (v: unknown) => void;
    apiMock.dashboard.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    expect(container.querySelector(".kv-skeleton")).toBeTruthy();
    resolve(dashboard());
    expect(await screen.findByText(/Готов: 1/)).toBeInTheDocument();
  });

  it("UI-6: клик «Напомнить не ответившим» вызывает api.remind", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.remind.mockResolvedValue({ targeted: 2, delivered: 0, recipients: [] });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Напомнить не ответившим/i }));
    await waitFor(() => expect(apiMock.remind).toHaveBeenCalledWith(1));
  });

  it("ST-3: busy — состояние конкретной кнопки, остальные действия доступны", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    // remind не завершается: проверяем именно состояние «в процессе»
    apiMock.remind.mockReturnValue(new Promise(() => {}));
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Напомнить не ответившим/i }));
    // кнопка конкретного действия подписана своим состоянием и задизейблена
    const remindBtn = await screen.findByRole("button", { name: /Напоминаем/i });
    expect(remindBtn).toBeDisabled();
    expect(remindBtn).toHaveAttribute("aria-busy", "true");
    // остальные действия не «умирают»: приказ и публикация остаются нажимаемыми
    expect(screen.getByRole("button", { name: /Сформировать приказ/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Опубликовать в чат класса/i })).toBeEnabled();
  });

  it("UI-7: «Сформировать приказ» вызывает export и downloadFile", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.generateOrder.mockResolvedValue({ version: 1, docx_url: "u", pdf_url: "p" });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Сформировать приказ/i }));
    // вторым аргументом — выбранный состав приложений
    await waitFor(() => expect(apiMock.generateOrder).toHaveBeenCalledWith(1, expect.any(Array)));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
  });

  it("ST-6: состав приложений загружается с бэкенда и снимается галочкой", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.attachments.mockResolvedValue({
      attachments: [
        { key: "students", title: "Список участников группы" },
        { key: "route", title: "Маршрутный лист (ПП РФ №1527)" },
        { key: "gibdd", title: "Уведомление в ГИБДД (ПП РФ №1527)" },
        { key: "pdn", title: "Согласие на обработку ПДн (152-ФЗ)" },
      ],
    });
    apiMock.generateOrder.mockResolvedValue({ version: 1, docx_url: "u", pdf_url: "p", attachments: [] });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await waitFor(() => expect(apiMock.attachments).toHaveBeenCalled());
    // раскрываем блок выбора приложений — видны маршрутный лист, ГИБДД и ПДн
    await userEvent.click(await screen.findByRole("button", { name: /Приложения:/i }));
    expect(await screen.findByLabelText(/Маршрутный лист/i)).toBeChecked();
    // снимаем «уведомление в ГИБДД» — в запрос уходит состав без него
    await userEvent.click(screen.getByLabelText(/Уведомление в ГИБДД/i));
    await userEvent.click(screen.getByRole("button", { name: /Сформировать приказ/i }));
    await waitFor(() => expect(apiMock.generateOrder).toHaveBeenCalled());
    const sent = apiMock.generateOrder.mock.calls[0][1] as string[];
    expect(sent).toContain("route");
    expect(sent).not.toContain("gibdd");
  });

  it("ST-6: «Отправить приказ в чат» доставляет файл в MAX (send-order)", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.sendOrder.mockResolvedValue({
      delivered: true, chat_id: -700, user_id: null, fmt: "docx", bot_enabled: true,
      download_url: "/api/v1/excursions/1/export-order?fmt=docx", message: "Приказ отправлен файлом в MAX.",
    });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Отправить приказ в чат/i }));
    const input = await screen.findByLabelText(/id чата класса/i);
    await userEvent.type(input, "-7000000001");
    await userEvent.click(screen.getByRole("button", { name: /^Отправить файл$/i }));
    await waitFor(() =>
      expect(apiMock.sendOrder).toHaveBeenCalledWith(1, expect.objectContaining({ chatId: -7000000001 })),
    );
    expect(await screen.findByText(/Приказ отправлен файлом в MAX/i)).toBeInTheDocument();
  });

  it("ST-3: результат действия озвучивается (role=status / aria-live)", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.remind.mockResolvedValue({ targeted: 2, delivered: 2, recipients: [] });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Напомнить не ответившим/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Напоминания отправлены/i);
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

  it("UC-3: «Опубликовать в чат класса» вне MAX спрашивает id и вызывает api.publish", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.publish.mockResolvedValue({ ok: true, chat_id: -7123456789 });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    // вне MAX chat_id неизвестен — кнопка раскрывает поле ввода
    await userEvent.click(screen.getByRole("button", { name: /Опубликовать в чат класса/i }));
    const input = await screen.findByLabelText(/id чата класса/i);
    await userEvent.type(input, "-7123456789");
    await userEvent.click(screen.getByRole("button", { name: /^Опубликовать$/i }));
    await waitFor(() => expect(apiMock.publish).toHaveBeenCalledWith(1, -7123456789));
    expect(await screen.findByText(/опубликована в чат класса/i)).toBeInTheDocument();
  });

  it("UC-3: ошибка публикации показывается пользователю", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.publish.mockRejectedValue(new Error("Выезд не найден"));
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Опубликовать в чат класса/i }));
    const input = await screen.findByLabelText(/id чата класса/i);
    await userEvent.type(input, "5");
    await userEvent.click(screen.getByRole("button", { name: /^Опубликовать$/i }));
    expect(await screen.findByText(/Ошибка публикации: Выезд не найден/i)).toBeInTheDocument();
  });

  it("ST-5: обратный отсчёт до дедлайна считается от exc.deadline", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    // в моке dashboard дедлайн 2026-10-01T12:00:00; в тестах «сейчас» — 2026-09-26,
    // поэтому счётчик показывает оставшиеся дни, а при прошедшем дедлайне — «истёк»
    expect(screen.getByText(/Осталось \d+ дн|Срок сбора ответов истёк/)).toBeInTheDocument();
  });

  it("ST-5: поиск по имени сужает список класса", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.type(screen.getByLabelText(/Поиск ученика по имени/i), "Тимур");
    expect(screen.queryByText("Абдуллина Алия")).not.toBeInTheDocument();
    expect(screen.getByText("Бикмуллин Тимур")).toBeInTheDocument();
    expect(screen.getByText("Показано 1 из 2")).toBeInTheDocument();
  });

  it("ST-5: фильтр списка по статусу (Нет ответа) оставляет только GREY", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.selectOptions(screen.getByLabelText(/Фильтр списка по статусу/i), "GREY");
    expect(screen.queryByText("Абдуллина Алия")).not.toBeInTheDocument();
    expect(screen.queryByText("Бикмуллин Тимур")).not.toBeInTheDocument();
    expect(screen.getByText(/Под фильтр никто не подошёл/i)).toBeInTheDocument();
  });

  it("ST-5: CSV списка участников — прямая ссылка с download", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    const csv = screen.getByRole("link", { name: /Список для туроператора \(CSV\)/i });
    expect(csv).toHaveAttribute("href", "/api/v1/excursions/1/participants.csv");
  });

  it("ST-5: экстренные телефоны загружаются по кнопке и выводятся сводно", async () => {
    apiMock.dashboard.mockResolvedValue(dashboard());
    apiMock.emergencyContacts.mockResolvedValue({
      excursion_id: 1, title: "Экскурсия в Кремль", responsible_teacher: "Учитель", total: 1,
      contacts: [{ student_id: 1, student_name: "Абдуллина Алия", parent_name: "Абдуллина Р.", role: "Мама", phone: "+79001110011" }],
    });
    render(<DashboardScreen excursionId={1} onChange={() => {}} />);
    await screen.findByText(/Готов: 1/);
    await userEvent.click(screen.getByRole("button", { name: /Экстренные телефоны/i }));
    await waitFor(() => expect(apiMock.emergencyContacts).toHaveBeenCalledWith(1));
    expect(await screen.findByText("+79001110011")).toBeInTheDocument();
    expect(screen.getByText(/Экстренные телефоны · 1/)).toBeInTheDocument();
  });
});

describe("ImportScreen (UC-1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UI-16: файл отправляется в api.importClass, показывается результат и пропуски", async () => {
    apiMock.importClass.mockResolvedValue({
      class_id: 9,
      title: "9-А",
      students_created: 24,
      parents_created: 26,
      skipped_rows: ["строка 5: нет ФИО"],
    });
    const onImported = vi.fn();
    render(<ImportScreen onImported={onImported} />);
    // кнопка выключена, пока файл не выбран
    expect(screen.getByRole("button", { name: /Загрузить класс/i })).toBeDisabled();
    const file = new File(["ФИО\n..."], "class.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/Выбрать файл списка класса/i), file);
    await userEvent.click(screen.getByRole("button", { name: /Загрузить класс/i }));
    await waitFor(() => expect(apiMock.importClass).toHaveBeenCalled());
    expect(apiMock.importClass.mock.calls[0][0]).toBe(file);
    expect(await screen.findByText("24")).toBeInTheDocument();
    expect(await screen.findByText(/строка 5: нет ФИО/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /К каталогу событий/i }));
    expect(onImported).toHaveBeenCalledWith(9);
  });

  it("UI-14: ошибка импорта показывается, а не молчит", async () => {
    apiMock.importClass.mockRejectedValue(new Error("В файле не найдено строк данных"));
    render(<ImportScreen onImported={() => {}} />);
    const file = new File(["x"], "bad.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/Выбрать файл списка класса/i), file);
    await userEvent.click(screen.getByRole("button", { name: /Загрузить класс/i }));
    expect(await screen.findByText(/Не удалось загрузить класс/i)).toBeInTheDocument();
  });
});

describe("CatalogScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  const classes = [{ id: 1, title: "8Б", school_number: "", school_name: "", teacher_name: "", students: [] }];

  it("ST-3: поле поиска имеет доступное имя (§4.1/§4.10)", async () => {
    apiMock.events.mockResolvedValue([event1]);
    render(<CatalogScreen classes={classes} onCreated={() => {}} />);
    expect(await screen.findByLabelText(/Поиск по названию или площадке/i)).toBeInTheDocument();
  });

  it("ST-3: во время загрузки — скелетон, «ничего не подошло» только после загрузки", async () => {
    let resolve!: (v: unknown) => void;
    apiMock.events.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = render(<CatalogScreen classes={classes} onCreated={() => {}} />);
    // пока грузится — скелетон и статус «Загружаем…», без пустого состояния
    expect(container.querySelector(".kv-skeleton")).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(/Загружаем каталог/i);
    expect(screen.queryByText(/ничего не подошло/i)).not.toBeInTheDocument();
    resolve([]);
    // после загрузки пустой результат честно сообщается
    expect(await screen.findByText(/ничего не подошло/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Найдено событий: 0/i);
  });

  it("UI-3: чекбокс «Пушкинская карта» перезапрашивает каталог с фильтром", async () => {
    apiMock.events.mockResolvedValue([event1]);
    render(<CatalogScreen classes={classes} onCreated={() => {}} />);
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
      { ...event1, id: 7, title: "Событие", price: 0, is_free: true },
    ]);
    apiMock.createExcursion.mockResolvedValue({ ...excursion, id: 42, title: "Событие" });
    const onCreated = vi.fn();
    render(<CatalogScreen classes={classes} onCreated={onCreated} />);
    await screen.findByText("Событие");
    // выбираем событие из списка «Выбор события»
    const pickers = screen.getAllByRole("combobox");
    const picker = pickers[pickers.length - 1];
    await userEvent.selectOptions(picker, "7");
    await userEvent.click(await screen.findByRole("button", { name: /Создать выезд/i }));
    await waitFor(() => expect(apiMock.createExcursion).toHaveBeenCalled());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(42));
  });

  it("ST-4: смена сортировки и направления перезапрашивает каталог (sort/order_by)", async () => {
    apiMock.events.mockResolvedValue([event1]);
    render(<CatalogScreen classes={classes} onCreated={() => {}} />);
    await screen.findByText("Событие");
    // по умолчанию — по дате, возрастание
    const last = () => {
      const calls = apiMock.events.mock.calls;
      return calls[calls.length - 1][0];
    };
    expect(last()).toMatchObject({ sort: "date", order_by: "asc" });
    await userEvent.selectOptions(screen.getByLabelText("Сортировка"), "price");
    await waitFor(() => expect(last()).toMatchObject({ sort: "price", order_by: "asc" }));
    await userEvent.click(screen.getByRole("button", { name: /Направление/i }));
    await waitFor(() => expect(last()).toMatchObject({ sort: "price", order_by: "desc" }));
  });

  it("ST-4: пресет «На этих выходных» ставит диапазон сб/вс", async () => {
    apiMock.events.mockResolvedValue([event1]);
    render(<CatalogScreen classes={classes} onCreated={() => {}} />);
    await screen.findByText("Событие");
    await userEvent.click(screen.getByRole("button", { name: /На этих выходных/i }));
    await waitFor(() => {
      const calls = apiMock.events.mock.calls;
      const p = calls[calls.length - 1][0];
      expect(p.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const from = new Date(`${p.date_from}T00:00:00`);
      const to = new Date(`${p.date_to}T00:00:00`);
      expect([6, 0]).toContain(from.getDay()); // суббота
      expect((to.getTime() - from.getTime()) / 86400000).toBe(1); // воскресенье следом
    });
  });

  it("ST-4: диапазон дат отправляется как date_from/date_to", async () => {
    apiMock.events.mockResolvedValue([event1]);
    render(<CatalogScreen classes={classes} onCreated={() => {}} />);
    await screen.findByText("Событие");
    await userEvent.type(screen.getByLabelText(/Дата, с которой/i), "2026-10-01");
    await waitFor(() => {
      const calls = apiMock.events.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ date_from: "2026-10-01" });
    });
    await userEvent.type(screen.getByLabelText(/Дата, до которой/i), "2026-10-05");
    await waitFor(() => {
      const calls = apiMock.events.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-05" });
    });
  });

  it("ST-4: авто-фильтр по возрасту снимает 12+ для младшего класса и объясняет", async () => {
    apiMock.events.mockResolvedValue([
      { ...event1, id: 1, title: "Дошкольное", age_rating: "0+", age_min: 0 },
      { ...event1, id: 2, title: "Взрослое", age_rating: "12+", age_min: 12 },
    ]);
    const young = [
      {
        id: 5, title: "2А", school_number: "", school_name: "", teacher_name: "",
        students: [{ id: 1, full_name: "Мал Ярослав", birth_date: "2016-05-01", parent_phones: [] }],
      },
    ];
    render(<CatalogScreen classes={young} onCreated={() => {}} />);
    await screen.findByText("Дошкольное");
    // без фильтра видно оба события
    expect(screen.getByText("Взрослое")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /по возрасту класса/i }));
    // 12+ уходит из таблицы и попадает в объяснимый блок «снято по возрасту»
    await waitFor(() => expect(screen.queryByText("Взрослое")).not.toBeInTheDocument());
    expect(screen.getByText("Дошкольное")).toBeInTheDocument();
    expect(await screen.findByText("Снято по возрасту класса")).toBeInTheDocument();
    expect(screen.getByText(/Взрослое — ценз 12\+ — младшему ученику \d+ лет/)).toBeInTheDocument();
  });
});

describe("ParentScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  function renderParent() {
    apiMock.dashboard.mockResolvedValue(parentDashboard());
    render(<ParentScreen studentId={1} excursions={[excursion]} />);
  }

  it("ST-3: согласие требует подтверждения перед отправкой (ПЭП)", async () => {
    apiMock.consent.mockResolvedValue({ message: "Согласие подписано", changed: true });
    renderParent();
    // первый клик — только шаг подтверждения, согласие ещё не уходит
    await userEvent.click(await screen.findByRole("button", { name: /Отпускаю ребёнка/i }));
    expect(screen.getByText(/Отправляю согласие\?/i)).toBeInTheDocument();
    expect(apiMock.consent).not.toHaveBeenCalled();
    // отмена возвращает к исходному состоянию без запроса
    await userEvent.click(screen.getByRole("button", { name: /^Отмена$/i }));
    expect(screen.queryByText(/Отправляю согласие\?/i)).not.toBeInTheDocument();
    expect(apiMock.consent).not.toHaveBeenCalled();
    // подтверждение отправляет APPROVED (после отметки согласия на ПДн)
    await userEvent.click(screen.getByRole("button", { name: /Отпускаю ребёнка/i }));
    await userEvent.click(await screen.findByLabelText(/обработку персональных данных/i));
    await userEvent.click(await screen.findByRole("button", { name: /Да, отправляю согласие/i }));
    await waitFor(() => expect(apiMock.consent).toHaveBeenCalled());
    expect(apiMock.consent.mock.calls[0][1]).toMatchObject({ student_id: 1, status: "APPROVED" });
  });

  it("ST-6: согласие не уходит без отметки о ПДн (152-ФЗ)", async () => {
    apiMock.consent.mockResolvedValue({ message: "Согласие подписано", changed: true });
    renderParent();
    await userEvent.click(await screen.findByRole("button", { name: /Отпускаю ребёнка/i }));
    // кнопка подтверждения заблокирована, пока не отмечено согласие на ПДн
    const confirmBtn = await screen.findByRole("button", { name: /Да, отправляю согласие/i });
    expect(confirmBtn).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/обработку персональных данных/i));
    expect(confirmBtn).toBeEnabled();
    await userEvent.click(confirmBtn);
    await waitFor(() => expect(apiMock.consent).toHaveBeenCalled());
    expect(apiMock.consent.mock.calls[0][1]).toMatchObject({ status: "APPROVED", pdn_consent: true });
  });

  it("UI-10: «Отпускаю ребёнка» отправляет согласие APPROVED после подтверждения", async () => {
    apiMock.consent.mockResolvedValue({ message: "Согласие подписано", changed: true });
    renderParent();
    await userEvent.click(await screen.findByRole("button", { name: /Отпускаю ребёнка/i }));
    await userEvent.click(await screen.findByLabelText(/обработку персональных данных/i));
    await userEvent.click(await screen.findByRole("button", { name: /Да, отправляю согласие/i }));
    await waitFor(() => expect(apiMock.consent).toHaveBeenCalled());
    expect(apiMock.consent.mock.calls[0][1]).toMatchObject({ student_id: 1, status: "APPROVED" });
  });

  it("ST-6: номер билета (необязательный) уходит в ticket-confirm", async () => {
    apiMock.dashboard.mockResolvedValue({
      excursion,
      summary: { GREEN: 1, YELLOW: 0, GREY: 0, RED: 0 },
      progress_percent: 100,
      participants: [
        { student_id: 1, full_name: "Абдуллина Алия", traffic_light: "YELLOW", consent_status: "APPROVED",
          ticket_status: "WAITING_PAYMENT", signed_by_name: "Мама", signed_by_phone: "+7",
          signed_at: "2026-09-26T10:00:00", rejection_reason: null, ticket_number: null },
      ],
    });
    apiMock.ticket.mockResolvedValue({ message: "Билет отмечен как купленный.", changed: true });
    render(<ParentScreen studentId={1} excursions={[excursion]} />);
    await screen.findByText(/Билет куплен/i);
    await userEvent.type(await screen.findByLabelText(/Номер электронного билета/i), "KZ-777");
    await userEvent.click(screen.getByRole("button", { name: /Билет куплен/i }));
    await waitFor(() => expect(apiMock.ticket).toHaveBeenCalled());
    expect(apiMock.ticket.mock.calls[0][1]).toMatchObject({ student_id: 1, ticket_number: "KZ-777" });
  });

  it("UI-11: «Не сможет поехать» отправляет REJECTED с причиной без подтверждения", async () => {
    apiMock.consent.mockResolvedValue({ message: "Отказ зафиксирован", changed: true });
    renderParent();
    await userEvent.click(await screen.findByRole("button", { name: /Не сможет поехать/i }));
    await waitFor(() => expect(apiMock.consent).toHaveBeenCalled());
    expect(apiMock.consent.mock.calls[0][1]).toMatchObject({ student_id: 1, status: "REJECTED" });
  });

  it("ST-3: результат согласия озвучивается (role=status)", async () => {
    apiMock.consent.mockResolvedValue({ message: "Согласие подписано", changed: true });
    renderParent();
    await userEvent.click(await screen.findByRole("button", { name: /Отпускаю ребёнка/i }));
    await userEvent.click(await screen.findByLabelText(/обработку персональных данных/i));
    await userEvent.click(await screen.findByRole("button", { name: /Да, отправляю согласие/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Согласие подписано/i);
  });

  it("BUG-3 (мультидети): переключатель показывает всех детей и переключает ребёнка", async () => {
    apiMock.dashboard.mockResolvedValue(parentDashboard());
    const onSelectChild = vi.fn();
    render(
      <ParentScreen
        studentId={1}
        studentName="Абдуллина Алия"
        excursions={[excursion]}
        children={[child1 as any, child2 as any]}
        onSelectChild={onSelectChild}
      />,
    );
    // видны оба ребёнка, а не только первый
    expect(await screen.findByRole("button", { name: "Абдуллина Алия" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Абдуллин Марат" }));
    expect(onSelectChild).toHaveBeenCalledWith(2, "Абдуллин Марат");
  });

  it("BUG-3: один ребёнок — переключателя нет", async () => {
    apiMock.dashboard.mockResolvedValue(parentDashboard());
    render(<ParentScreen studentId={1} studentName="Абдуллина Алия" excursions={[excursion]} children={[child1 as any]} />);
    await waitFor(() => expect(apiMock.dashboard).toHaveBeenCalled());
    expect(screen.queryByRole("group", { name: "Выбор ребёнка" })).not.toBeInTheDocument();
  });

  it("BUG-4 (два родителя): видно, кто из представителей подписал", async () => {
    apiMock.dashboard.mockResolvedValue(parentDashboard());
    render(<ParentScreen studentId={1} studentName="Абдуллина Алия" excursions={[excursion]} children={[signedChild as any]} />);
    await waitFor(() => expect(apiMock.dashboard).toHaveBeenCalled());
    expect(await screen.findByText("Абдуллина Р.")).toBeInTheDocument();
    expect(screen.getByText("Абдуллин И.")).toBeInTheDocument();
    expect(screen.getByText("подписал(а)")).toBeInTheDocument();
    expect(screen.getByText("ждём ответа")).toBeInTheDocument();
  });

  it("ST-5: «Добавить в календарь» скачивает .ics по ссылке бэкенда", async () => {
    renderParent();
    await userEvent.click(await screen.findByRole("button", { name: /Добавить в календарь/i }));
    expect(downloadFile).toHaveBeenCalledWith("/api/v1/excursions/1/calendar.ics", "Выезд_1.ics");
  });

  it("ST-5: родитель видит памятку «Что взять с собой»", async () => {
    renderParent();
    expect(await screen.findByText("Что взять с собой")).toBeInTheDocument();
    expect(screen.getByText(/перекус и бутылка воды/i)).toBeInTheDocument();
  });
});
