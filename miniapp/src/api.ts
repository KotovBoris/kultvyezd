/** Клиент REST API «КультВыезд». По умолчанию — same-origin (в compose проксирует nginx). */
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

export const api = {
  health: () => req<{ status: string; bot_enabled: boolean }>("/healthz"),
  meta: () => req<any>("/api/v1/meta"),

  classes: () => req<SchoolClass[]>("/api/v1/classes"),
  events: (params: { city?: string; age?: string; pushkin?: boolean; free?: boolean } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    });
    return req<CultureEvent[]>(`/api/v1/culture-events?${q.toString()}`);
  },

  excursions: () => req<Excursion[]>("/api/v1/excursions"),
  createExcursion: (payload: Record<string, unknown>) =>
    req<Excursion>("/api/v1/excursions", { method: "POST", body: JSON.stringify(payload) }),
  dashboard: (id: number) => req<Dashboard>(`/api/v1/excursions/${id}/dashboard`),

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
  generateOrder: (excursionId: number) =>
    req<{ docx_url: string; pdf_url: string; version: number }>(
      `/api/v1/excursions/${excursionId}/export-order`,
      { method: "POST" },
    ),
  exportOrderUrl: (excursionId: number, fmt: "docx" | "pdf") =>
    `${BASE}/api/v1/excursions/${excursionId}/export-order?fmt=${fmt}`,
  linkCode: (studentId: number) =>
    req<{ code: string; deep_link: string }>(`/api/v1/students/${studentId}/link-code`, { method: "POST" }),

  /** Контекст родителя по его MAX user_id (после привязки к боту). */
  parentContext: (maxUserId: number) =>
    req<ParentContext>(`/api/v1/parent/context?max_user_id=${maxUserId}`),

  /** Сброс демонстрационного выезда (для повторного прогона сценария). */
  resetDemo: () => req<{ excursion_id: number; reset_participants: number }>(
    "/api/v1/admin/reset-demo", { method: "POST" }),
};

export interface ParentChild {
  student_id: number;
  student_name: string;
  parent_name: string;
  parent_role: string;
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
    signed_at: string | null;
  }>;
}

export interface ParentContext {
  max_user_id: number;
  children: ParentChild[];
  found: boolean;
}
