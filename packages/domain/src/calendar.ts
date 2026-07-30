import jalaali from "jalaali-js";

import type { CalendarSystem } from "./types.js";

// jalaali-js is CommonJS. Its default import is the complete export object
// when this package is executed as native ESM and remains traceable by Next.
const {
  isLeapJalaaliYear,
  isValidJalaaliDate,
  jalaaliMonthLength,
  toGregorian: jalaaliToGregorian,
  toJalaali,
} = jalaali;

export type CalendarDate = {
  calendar: CalendarSystem;
  year: number;
  month: number;
  day: number;
};

export type GregorianDate = Omit<CalendarDate, "calendar"> & { calendar: "gregorian" };

export type LocalTime = {
  hour: number;
  minute: number;
};

const GREGORIAN_MIN: GregorianDate = { calendar: "gregorian", year: 1900, month: 1, day: 1 };
const GREGORIAN_MAX: GregorianDate = { calendar: "gregorian", year: 2400, month: 12, day: 31 };

export function isGregorianLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isJalaliLeapYear(year: number): boolean {
  return isLeapJalaaliYear(year);
}

export function daysInMonth(calendar: CalendarSystem, year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0;
  if (calendar === "gregorian") {
    return [4, 6, 9, 11].includes(month)
      ? 30
      : month === 2
        ? isGregorianLeapYear(year)
          ? 29
          : 28
        : 31;
  }
  return jalaaliMonthLength(year, month);
}

export function isValidCalendarDate(date: CalendarDate): boolean {
  if (!Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day))
    return false;
  if (date.calendar === "jalali") return isValidJalaaliDate(date.year, date.month, date.day);
  return (
    date.month >= 1 &&
    date.month <= 12 &&
    date.day >= 1 &&
    date.day <= daysInMonth("gregorian", date.year, date.month)
  );
}

export function toGregorian(date: CalendarDate): GregorianDate {
  if (!isValidCalendarDate(date)) throw new RangeError("The calendar date is not valid.");
  if (date.calendar === "gregorian")
    return { calendar: "gregorian", year: date.year, month: date.month, day: date.day };
  const converted = jalaaliToGregorian(date.year, date.month, date.day);
  return { calendar: "gregorian", year: converted.gy, month: converted.gm, day: converted.gd };
}

export function fromGregorian(date: GregorianDate, calendar: CalendarSystem): CalendarDate {
  if (!isValidCalendarDate(date)) throw new RangeError("The Gregorian date is not valid.");
  if (calendar === "gregorian") return { ...date };
  const converted = toJalaali(date.year, date.month, date.day);
  return { calendar: "jalali", year: converted.jy, month: converted.jm, day: converted.jd };
}

export function compareGregorianDates(left: GregorianDate, right: GregorianDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

export function isSupportedGregorianDate(date: GregorianDate): boolean {
  return (
    compareGregorianDates(date, GREGORIAN_MIN) >= 0 &&
    compareGregorianDates(date, GREGORIAN_MAX) <= 0
  );
}

export function addGregorianDays(date: GregorianDate, days: number): GregorianDate {
  if (!Number.isInteger(days)) throw new RangeError("Days must be an integer.");
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    calendar: "gregorian",
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  return fromGregorian(addGregorianDays(toGregorian(date), days), date.calendar);
}

export function formatGregorianDate(date: GregorianDate): string {
  return `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

export function parseSendTime(value: string): LocalTime {
  const match = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/.exec(value);
  if (!match?.groups) throw new RangeError("Send time must use HH:mm.");
  return { hour: Number(match.groups.hour), minute: Number(match.groups.minute) };
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const fields = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second),
  };
}

/** Converts a local wall-clock time to UTC. DST gaps move forward; overlaps select the earlier instant. */
export function localDateTimeToUtc(date: GregorianDate, time: LocalTime, timeZone: string): Date {
  let guess = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
  for (let index = 0; index < 4; index += 1) {
    const observed = zonedParts(new Date(guess), timeZone);
    const desired = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
    const actual = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const delta = desired - actual;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

export function todayInTimezone(now: Date, timeZone: string): GregorianDate {
  const parts = zonedParts(now, timeZone);
  return { calendar: "gregorian", year: parts.year, month: parts.month, day: parts.day };
}
