/**
 * Каталог: чистые вычисления без React — пресеты периода и авто-фильтр
 * «подходит моему классу по возрасту». Вынесено отдельно, чтобы покрыть vitest'ом.
 */
import type { CultureEvent, SchoolClass, Student } from "./api";

/** Локальная дата → «ГГГГ-ММ-ДД» (без UTC-сдвига, который даёт toISOString). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Диапазон дат для API. */
export interface DateRange {
  from: string;
  to: string;
}

/** Пресет «Ближайшие» — сегодня и следующие 6 дней. */
export function upcomingRange(now: Date = new Date()): DateRange {
  const from = new Date(now);
  const to = new Date(now);
  to.setDate(to.getDate() + 6);
  return { from: toISODate(from), to: toISODate(to) };
}

/**
 * Пресет «На этих выходных» — ближайшие суббота и воскресенье.
 * Если сегодня суббота/воскресенье, берём текущие выходные (включая сегодня).
 */
export function weekendRange(now: Date = new Date()): DateRange {
  const day = now.getDay(); // 0 — воскресенье, 6 — суббота
  const saturday = new Date(now);
  if (day === 6) {
    /* уже суббота — суббота сегодня */
  } else if (day === 0) {
    saturday.setDate(saturday.getDate() - 1); // воскресенье — суббота была вчера
  } else {
    saturday.setDate(saturday.getDate() + (6 - day));
  }
  const sunday = new Date(saturday);
  sunday.setDate(sunday.getDate() + 1);
  return { from: toISODate(saturday), to: toISODate(sunday) };
}

/** Полных лет на дату `on`; null, если дата рождения неизвестна. */
export function ageOn(birthDate: string | null, on: Date = new Date()): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  let years = on.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    on.getMonth() < birth.getMonth() ||
    (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate());
  if (beforeBirthday) years -= 1;
  return Math.max(years, 0);
}

/** Нижняя граница ценза события («12+» → 12). */
export function ratingMin(ageRating: string, fallback = 0): number {
  const digits = ageRating.replace(/\D/g, "");
  return digits ? Number(digits) : fallback;
}

/**
 * Возраст самого младшего ученика класса — по нему решаем, «подходит ли классу».
 * Событие 12+ нельзя показывать классу, где есть 10-летний: берём минимум.
 * Возвращает null, если класс пуст или у учеников нет дат рождения.
 */
export function youngestAge(students: Student[], on: Date = new Date()): number | null {
  const ages = students
    .map((s) => ageOn(s.birth_date, on))
    .filter((a): a is number => a !== null);
  return ages.length ? Math.min(...ages) : null;
}

/** Подходит ли событие классу: ценз события не выше возраста младшего ученика. */
export function eventFitsClass(ev: CultureEvent, youngest: number | null): boolean {
  if (youngest === null) return true;
  return ratingMin(ev.age_rating, ev.age_min ?? 0) <= youngest;
}

/** Разбивает список событий на «подходящие» и «не по возрасту» с причиной. */
export interface AgeSplit {
  fit: CultureEvent[];
  blocked: CultureEvent[];
  youngest: number | null;
}

export function splitByAge(events: CultureEvent[], klass: SchoolClass | null, on: Date = new Date()): AgeSplit {
  const youngest = klass ? youngestAge(klass.students, on) : null;
  if (youngest === null) return { fit: events, blocked: [], youngest: null };
  const fit: CultureEvent[] = [];
  const blocked: CultureEvent[] = [];
  for (const ev of events) (eventFitsClass(ev, youngest) ? fit : blocked).push(ev);
  return { fit, blocked, youngest };
}

/** Человекочитаемая причина отсева — показываем в UI, почему события нет в списке. */
export function ageBlockReason(ev: CultureEvent, youngest: number | null): string {
  if (youngest === null) return "";
  return `ценз ${ev.age_rating} — младшему ученику ${youngest} лет`;
}
