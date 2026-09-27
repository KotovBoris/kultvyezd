/** Клиент REST API ClassGo. По умолчанию — same-origin (в compose проксирует nginx). */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export interface Student {
  id: number;
  full_name: string;
  birth_date: string | null;
  parent_phones: string[];
}

export interface SchoolClass {
  id: number;
  title: string;
  school_number: string;
  school_name: string;
  teacher_name: string;
  students: Student[];
}

export interface CultureEvent {
  id: number;
  title: string;
  venue: string;
  city: string;
  age_rating: string;
  event_date: string | null;
  duration_min: number;
  price: number;
  pushkin_eligible: boolean;
  is_free: boolean;
  ticket_url: string;
  address: string;
  description: string;
  source: string;
  /** нижняя граница возрастного ценза (12 для «12+») — для авто-фильтра по классу */
  age_min: number;
}

export type EventSort = "date" | "price" | "duration";
export type SortOrder = "asc" | "desc";

export interface EmergencyContact {
  student_id: number;
  student_name: string;
  parent_name: string;
  role: string;
  phone: string;
}

export interface EmergencyContacts {
  excursion_id: number;
  title: string;
  responsible_teacher: string;
  total: number;
  contacts: EmergencyContact[];
}

export interface Excursion {
  id: number;
  class_id: number;
  title: string;
  location_name: string;
  address: string;
  event_date: string | null;
  gathering_time: string | null;
  return_time: string | null;
  deadline: string | null;
  ticket_price: number;
  ticket_sale_url: string;
  is_pushkin_card: boolean;
  status: string;
  school_name: string;
  responsible_teacher: string;
}

export interface ParticipantRow {
  student_id: number;
  full_name: string;
  traffic_light: "GREEN" | "YELLOW" | "GREY" | "RED";
  consent_status: "PENDING" | "APPROVED" | "REJECTED";
  ticket_status: "NOT_REQUIRED" | "WAITING_PAYMENT" | "PAID";
  signed_by_name: string | null;
  signed_by_phone: string | null;
  signed_at: string | null;
  rejection_reason: string | null;
  ticket_number: string | null;
  /** согласие законного представителя на обработку ПДн (152-ФЗ) */
  pdn_consent_at?: string | null;
  pdn_consent_by?: string | null;
}

/** Приложение пакета документов: ключ для запроса + человекочитаемый заголовок. */
export interface AttachmentOption {
  key: string;
  title: string;
}

/** Результат отправки приказа файлом в MAX-чат/личку. */
export interface SendOrderResult {
  delivered: boolean;
  chat_id: number | null;
  user_id: number | null;
  fmt: string;
  bot_enabled: boolean;
  download_url: string;
  message: string;
}

export interface Dashboard {
  excursion: Excursion;
  summary: { GREEN: number; YELLOW: number; GREY: number; RED: number };
  progress_percent: number;
  participants: ParticipantRow[];
}

export interface ConsentResponse {
  student_id: number;
  consent_status: string;
  ticket_status: string;
  changed: boolean;
  message: string;
  signed_by_name?: string | null;
  signed_at?: string | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Загрузка файла (multipart/form-data) — отдельно от req(), который
 * принудительно ставит Content-Type: application/json и ломает boundary.
 */
async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => req<{ status: string; bot_enabled: boolean }>("/healthz"),
  meta: () => req<any>("/api/v1/meta"),

  classes: () => req<SchoolClass[]>("/api/v1/classes"),
  events: (
    params: {
      city?: string;
      age?: string;
      pushkin?: boolean;
      free?: boolean;
      sort?: EventSort;
      order_by?: SortOrder;
      date_from?: string;
      date_to?: string;
      class_id?: number;
      age_fit?: boolean;
    } = {},
  ) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      // false — булев параметр (age_fit) шлём как "false"; пустые строки/undefined/null — нет
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    });
    return req<CultureEvent[]>(`/api/v1/culture-events?${q.toString()}`);
  },

  /** Импорт класса из CSV/XLSX (UC-1): файл → разбор → созданные ученики и родители. */
  importClass: (
    file: File,
    params: { grade?: string; letter?: string; school_number?: string; school_name?: string; teacher_name?: string } = {},
  ) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) q.set(k, String(v));
    });
    return upload<ImportResult>(`/api/v1/classes/import?${q.toString()}`, file);
  },

  excursions: () => req<Excursion[]>("/api/v1/excursions"),
  createExcursion: (payload: Record<string, unknown>) =>
    req<Excursion>("/api/v1/excursions", { method: "POST", body: JSON.stringify(payload) }),
  dashboard: (id: number) => req<Dashboard>(`/api/v1/excursions/${id}/dashboard`),

  /** Публикация карточки выезда в чат класса MAX (UC-3). */
  publish: (excursionId: number, chatId: number) =>
    req<{ ok: boolean; chat_id: number }>(
      `/api/v1/excursions/${excursionId}/publish?chat_id=${chatId}`,
      { method: "POST" },
    ),

  consent: (excursionId: number, payload: Record<string, unknown>) =>
    req<ConsentResponse>(`/api/v1/excursions/${excursionId}/consent`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ticket: (excursionId: number, payload: Record<string, unknown>) =>
    req<ConsentResponse>(`/api/v1/excursions/${excursionId}/ticket-confirm`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  remind: (excursionId: number) =>
    req<{ targeted: number; delivered: number; recipients: string[] }>(
      `/api/v1/excursions/${excursionId}/remind-unconfirmed`,
      { method: "POST" },
    ),
  generateOrder: (excursionId: number, attach?: string[]) => {
    const q = attach && attach.length ? `?attach=${attach.join(",")}` : "";
    return req<{ docx_url: string; pdf_url: string; version: number; attachments: string[] }>(
      `/api/v1/excursions/${excursionId}/export-order${q}`,
      { method: "POST" },
    );
  },
  exportOrderUrl: (excursionId: number, fmt: "docx" | "pdf", attach?: string[]) => {
    const suffix = attach && attach.length ? `&attach=${attach.join(",")}` : "";
    return `${BASE}/api/v1/excursions/${excursionId}/export-order?fmt=${fmt}${suffix}`;
  },

  /** Каталог доступных приложений пакета документов (для флагов перед генерацией). */
  attachments: () => req<{ attachments: AttachmentOption[] }>("/api/v1/documents/attachments"),

  /** Отправляет сгенерированный приказ файлом в MAX-чат/личку. */
  sendOrder: (
    excursionId: number,
    params: { chatId?: number | null; userId?: number | null; fmt?: "docx" | "pdf"; attach?: string[] },
  ) => {
    const q = new URLSearchParams();
    if (params.chatId != null) q.set("chat_id", String(params.chatId));
    if (params.userId != null) q.set("user_id", String(params.userId));
    if (params.fmt) q.set("fmt", params.fmt);
    if (params.attach && params.attach.length) q.set("attach", params.attach.join(","));
    return req<SendOrderResult>(`/api/v1/excursions/${excursionId}/send-order?${q.toString()}`, {
      method: "POST",
    });
  },

  /** Прямая ссылка на CSV списка участников (туроператору / в кассу). */
  participantsCsvUrl: (excursionId: number) =>
    `${BASE}/api/v1/excursions/${excursionId}/participants.csv`,

  /** Сводный список телефонов родителей по выезду (безопасность в день выезда). */
  emergencyContacts: (excursionId: number) =>
    req<EmergencyContacts>(`/api/v1/excursions/${excursionId}/emergency-contacts`),

  /** Прямая ссылка на календарь (.ics) по выезду — «добавить в календарь» родителю. */
  calendarIcsUrl: (excursionId: number) =>
    `${BASE}/api/v1/excursions/${excursionId}/calendar.ics`,
  linkCode: (studentId: number, params: { parent_phone?: string; role?: string } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    });
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return req<{ code: string; deep_link: string }>(
      `/api/v1/students/${studentId}/link-code${suffix}`,
      { method: "POST" },
    );
  },

  /** Контекст родителя по его MAX user_id (после привязки к боту). */
  parentContext: (maxUserId: number) =>
    req<ParentContext>(`/api/v1/parent/context?max_user_id=${maxUserId}`),

  /** Сброс демонстрационного выезда (для повторного прогона сценария). */
  resetDemo: () => req<{ excursion_id: number; reset_participants: number }>(
    "/api/v1/admin/reset-demo", { method: "POST" }),
};

export interface ParentContact {
  id: number;
  contact_id: number;
  full_name: string;
  phone_number: string;
  role: string;
  max_user_id: number | null;
}

/** Контакт-родитель выезда с признаком is_signer («кто подписал») — контракт ST-1. */
export interface Signer {
  contact_id: number;
  full_name: string;
  phone_number: string;
  role: string;
  max_user_id: number | null;
  is_signer: boolean;
}

export interface ImportResult {
  class_id: number;
  title: string;
  students_created: number;
  parents_created: number;
  skipped_rows: string[];
}

export interface ParentChild {
  student_id: number;
  student_name: string;
  parent_name: string;
  parent_role: string;
  /** контакт, под которым родитель вошёл в мини-апп (для выдачи кода привязки) */
  parent_contact_id: number;
  /** все контакты родителей ученика (мама и папа) */
  parents: ParentContact[];
  excursions: Array<{
    excursion_id: number;
    title: string;
    location_name: string;
    event_date: string | null;
    gathering_time: string | null;
    return_time: string | null;
    deadline: string | null;
    ticket_price: number;
    ticket_sale_url: string;
    is_pushkin_card: boolean;
    status: string;
    traffic_light: "GREEN" | "YELLOW" | "GREY" | "RED";
    consent_status: string;
    ticket_status: string;
    rejection_reason: string | null;
    signed_by_name: string | null;
    signed_by_phone: string | null;
    signed_at: string | null;
    /** контакты-родители с флагом «подписал именно он» */
    signers: Signer[];
  }>;
}

export interface ParentContext {
  max_user_id: number;
  children: ParentChild[];
  found: boolean;
}
