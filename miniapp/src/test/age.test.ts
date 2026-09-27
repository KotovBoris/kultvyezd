/** ST-4: чистые вычисления каталога — пресеты дат и авто-фильтр по возрасту. */
import { describe, expect, it } from "vitest";
import {
  ageBlockReason,
  ageOn,
  eventFitsClass,
  ratingMin,
  splitByAge,
  toISODate,
  upcomingRange,
  weekendRange,
  youngestAge,
} from "../age";
import type { CultureEvent, SchoolClass } from "../api";

const ev = (over: Partial<CultureEvent>): CultureEvent => ({
  id: 1, title: "Событие", venue: "Музей", city: "Казань", age_rating: "12+",
  event_date: "2026-10-03", duration_min: 60, price: 500, pushkin_eligible: true,
  is_free: false, ticket_url: "u", address: "a", description: "d", source: "s", age_min: 12,
  ...over,
});

const klass = (students: SchoolClass["students"]): SchoolClass => ({
  id: 5, title: "8Б", school_number: "", school_name: "", teacher_name: "", students,
});

describe("age: пресеты периода", () => {
  it("toISODate не смещает дату по UTC", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toISODate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("«Ближайшие» — неделя вперёд от сегодня (7 дней включительно)", () => {
    const { from, to } = upcomingRange(new Date(2026, 8, 27));
    expect(from).toBe("2026-09-27");
    expect(to).toBe("2026-10-03");
  });

  it("«На этих выходных» от воскресенья — прошедшая суббота и сегодня", () => {
    // 2026-09-27 — воскресенье
    const { from, to } = weekendRange(new Date(2026, 8, 27));
    expect(from).toBe("2026-09-26"); // суббота
    expect(to).toBe("2026-09-27"); // воскресенье
  });

  it("«На этих выходных» от субботы — текущие выходные", () => {
    const sat = new Date(2026, 8, 26);
    expect(sat.getDay()).toBe(6);
    const { from, to } = weekendRange(sat);
    expect(from).toBe("2026-09-26");
    expect(to).toBe("2026-09-27");
  });

  it("«На этих выходных» от середины недели — ближайшая суббота и воскресенье", () => {
    const wed = new Date(2026, 8, 23); // среда
    expect(wed.getDay()).toBe(3);
    const { from, to } = weekendRange(wed);
    expect(from).toBe("2026-09-26");
    expect(to).toBe("2026-09-27");
  });
});

describe("age: расчёт возраста", () => {
  it("ratingMin разбирает ценз и устойчив к мусору", () => {
    expect(ratingMin("0+")).toBe(0);
    expect(ratingMin("16+")).toBe(16);
    expect(ratingMin("неизвестно")).toBe(0);
    expect(ratingMin("неизвестно", 6)).toBe(6);
  });

  it("ageOn округляет вниз и учитывает день рождения", () => {
    expect(ageOn("2010-03-12", new Date(2026, 2, 11))).toBe(15);
    expect(ageOn("2010-03-12", new Date(2026, 2, 12))).toBe(16);
    expect(ageOn(null)).toBeNull();
    expect(ageOn("не-дата")).toBeNull();
  });

  it("youngestAge берёт минимум по классу, игнорируя неизвестные даты", () => {
    const students = [
      { id: 1, full_name: "А", birth_date: "2012-01-01", parent_phones: [] },
      { id: 2, full_name: "Б", birth_date: "2010-01-01", parent_phones: [] },
      { id: 3, full_name: "В", birth_date: null, parent_phones: [] },
    ];
    expect(youngestAge(students, new Date(2026, 5, 1))).toBe(14);
    expect(youngestAge([], new Date())).toBeNull();
    expect(youngestAge([{ id: 1, full_name: "А", birth_date: null, parent_phones: [] }])).toBeNull();
  });

  it("eventFitsClass пропускает событие только при достаточном цензе", () => {
    expect(eventFitsClass(ev({ age_rating: "12+" }), 12)).toBe(true);
    expect(eventFitsClass(ev({ age_rating: "12+" }), 11)).toBe(false);
    expect(eventFitsClass(ev({ age_rating: "16+" }), 14)).toBe(false);
    expect(eventFitsClass(ev({ age_rating: "0+" }), 8)).toBe(true);
    expect(eventFitsClass(ev({ age_rating: "16+" }), null)).toBe(true); // неизвестно — не режем
  });

  it("splitByAge делит список и возвращает возраст младшего", () => {
    const events = [ev({ id: 1, age_rating: "0+", age_min: 0 }), ev({ id: 2, age_rating: "12+", age_min: 12 })];
    const students = [{ id: 1, full_name: "Мал", birth_date: "2016-05-01", parent_phones: [] }];
    const split = splitByAge(events, klass(students), new Date(2026, 5, 1));
    expect(split.youngest).toBe(10);
    expect(split.fit.map((e) => e.id)).toEqual([1]);
    expect(split.blocked.map((e) => e.id)).toEqual([2]);
  });

  it("splitByAge без класса/дат ничего не снимает", () => {
    const events = [ev({ id: 1 })];
    expect(splitByAge(events, null).fit).toHaveLength(1);
    expect(splitByAge(events, klass([])).blocked).toHaveLength(0);
  });

  it("ageBlockReason объясняет отсев по возрасту", () => {
    expect(ageBlockReason(ev({ age_rating: "12+" }), 10)).toBe("ценз 12+ — младшему ученику 10 лет");
    expect(ageBlockReason(ev({ age_rating: "12+" }), null)).toBe("");
  });
});
