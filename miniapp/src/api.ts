const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export interface ParentInfo {
  id: number;
  full_name: string;
  phone_number: string;
  role: string;
  confirmed: boolean;
  bot_activated: boolean;
  notifications_enabled: boolean;
}

export interface Student {
  id: number;
  full_name: string;
  birth_date: string | null;
  parent_phones: string[];
  parents: ParentInfo[];
}

export interface SchoolClass {
  id: number;
  title: string;
  school_id: number | null;
  school_number: string;
  school_name: string;
  teacher_name: string;
  chat_id: number | null;
  owner_user_id: number | null;
  can_edit: boolean;
  students: Student[];
}

export interface School {
  id: number;
  name: string;
  city: string;
  number: string;
  owner_user_id: number | null;
  classes_count: number;
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
  bot_activated: boolean;
  parent_status: "APPROVED" | "REJECTED" | "NO_ANSWER" | "BOT_INACTIVE";
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

export interface ParentChildExcursion {
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
}

export interface ParentChild {
  student_id: number;
  student_name: string;
  parent_name: string;
  parent_role: string;
  confirmed: boolean;
  notifications_enabled: boolean;
  excursions: ParentChildExcursion[];
}

export interface ParentContext {
  max_user_id: number;
  children: ParentChild[];
  found: boolean;
}

export interface ParentSearchRow {
  parent_id: number;
  parent_name: string;
  role: string;
  phone: string;
  student_id: number;
  student_name: string;
  class_title: string;
  claimed: boolean;
}

export interface StudentCreatePayload {
  full_name: string;
  birth_date?: string | null;
  parent_phone?: string;
  parent_name?: string;
  parent_role?: string;
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

function qs(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const api = {
  health: () => req<{ status: string; bot_enabled: boolean }>("/healthz"),
  meta: () => req<any>("/api/v1/meta"),

  schools: (query?: string) => req<School[]>(`/api/v1/schools${qs({ query })}`),
  createSchool: (payload: { name: string; city?: string; number?: string; user_id?: number | null }) =>
    req<School>("/api/v1/schools", { method: "POST", body: JSON.stringify(payload) }),
  shareSchool: (schoolId: number, userId: number | null, payload: { user_id: number; role: "EDIT" | "READ" }) =>
    req<{ user_id: number; role: string }>(`/api/v1/schools/${schoolId}/share${qs({ user_id: userId })}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  classes: (userId?: number | null) => req<SchoolClass[]>(`/api/v1/classes${qs({ user_id: userId })}`),
  roster: (classId: number, userId?: number | null) =>
    req<SchoolClass>(`/api/v1/classes/${classId}/roster${qs({ user_id: userId })}`),
  createClass: (payload: Record<string, unknown>) =>
    req<SchoolClass>("/api/v1/classes", { method: "POST", body: JSON.stringify(payload) }),
  updateClass: (classId: number, payload: Record<string, unknown>) =>
    req<SchoolClass>(`/api/v1/classes/${classId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  importClass: (file: File, params: Record<string, unknown>) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/api/v1/classes/import${qs(params)}`, { method: "POST", body: fd }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `${res.status}`);
      }
      return res.json() as Promise<{ class_id: number; title: string; students_created: number }>;
    });
  },
  addStudent: (classId: number, userId: number | null, payload: StudentCreatePayload) =>
    req<Student>(`/api/v1/classes/${classId}/students${qs({ user_id: userId })}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  removeStudent: (classId: number, studentId: number, userId: number | null) =>
    req<{ ok: boolean }>(`/api/v1/classes/${classId}/students/${studentId}${qs({ user_id: userId })}`, {
      method: "DELETE",
    }),
  shareClass: (classId: number, userId: number | null, payload: { user_id: number; role: "EDIT" | "READ" }) =>
    req<{ user_id: number; role: string }>(`/api/v1/classes/${classId}/share${qs({ user_id: userId })}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  events: (params: { city?: string; age?: string; pushkin?: boolean; free?: boolean } = {}) =>
    req<CultureEvent[]>(`/api/v1/culture-events${qs(params)}`),

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
  publish: (excursionId: number, chatId?: number | null) =>
    req<{ ok: boolean; chat_id: number; delivered: boolean }>(
      `/api/v1/excursions/${excursionId}/publish${qs({ chat_id: chatId })}`,
      { method: "POST" },
    ),
  tagUnactivated: (excursionId: number) =>
    req<{ ok: boolean; tagged: number; names: string[]; delivered: boolean }>(
      `/api/v1/excursions/${excursionId}/tag-unactivated`,
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

  parentContext: (maxUserId: number) =>
    req<ParentContext>(`/api/v1/parent/context?max_user_id=${maxUserId}`),
  searchParents: (query: string) =>
    req<ParentSearchRow[]>(`/api/v1/parents/search${qs({ query })}`),
  claimParent: (payload: { parent_id: number; max_user_id: number }) =>
    req<{ ok: boolean; parent_id: number; student_name: string }>("/api/v1/parent/claim", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  confirmLink: (payload: { student_id: number; max_user_id: number; accept: boolean }) =>
    req<{ ok: boolean; confirmed: boolean; linked: boolean }>("/api/v1/parent/confirm-link", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  setNotifications: (payload: { max_user_id: number; enabled: boolean }) =>
    req<{ ok: boolean; enabled: boolean; affected: number }>("/api/v1/parent/notifications", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  resetDemo: () =>
    req<{ excursion_id: number; reset_participants: number }>("/api/v1/admin/reset-demo", { method: "POST" }),
};
