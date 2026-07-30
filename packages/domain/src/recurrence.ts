import {
  addCalendarDays,
  addGregorianDays,
  compareGregorianDates,
  daysInMonth,
  localDateTimeToUtc,
  toGregorian,
  type CalendarDate,
  type GregorianDate,
  type LocalTime,
} from "./calendar.js";
import type { RecurrenceFrequency } from "./types.js";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
  anchorWasLastDay: boolean;
};

function assertRule(rule: RecurrenceRule): void {
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 99)
    throw new RangeError("Recurrence interval must be an integer from 1 to 99.");
}

function addMonths(anchor: CalendarDate, monthDelta: number, lastDay: boolean): CalendarDate {
  const absoluteMonth = anchor.year * 12 + (anchor.month - 1) + monthDelta;
  const year = Math.floor(absoluteMonth / 12);
  const month = (((absoluteMonth % 12) + 12) % 12) + 1;
  const last = daysInMonth(anchor.calendar, year, month);
  return {
    calendar: anchor.calendar,
    year,
    month,
    day: lastDay ? last : Math.min(anchor.day, last),
  };
}

export function occurrenceAt(
  anchor: CalendarDate,
  rule: RecurrenceRule,
  occurrenceIndex: number,
): CalendarDate {
  assertRule(rule);
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0)
    throw new RangeError("Occurrence index must be non-negative.");
  if (rule.frequency === "once") return anchor;
  if (rule.frequency === "daily") return addCalendarDays(anchor, occurrenceIndex * rule.interval);
  if (rule.frequency === "weekly")
    return addCalendarDays(anchor, occurrenceIndex * rule.interval * 7);
  if (rule.frequency === "monthly")
    return addMonths(anchor, occurrenceIndex * rule.interval, rule.anchorWasLastDay);
  return {
    ...addMonths(
      { ...anchor, month: anchor.month },
      occurrenceIndex * rule.interval * 12,
      rule.anchorWasLastDay,
    ),
  };
}

/** Finds the first occurrence on or after `onOrAfter`; bounded to guard corrupt persisted rules. */
export function firstOccurrenceOnOrAfter(
  anchor: CalendarDate,
  rule: RecurrenceRule,
  onOrAfter: GregorianDate,
): GregorianDate | null {
  assertRule(rule);
  const first = toGregorian(anchor);
  if (rule.frequency === "once") return compareGregorianDates(first, onOrAfter) >= 0 ? first : null;
  for (let index = 0; index < 10_000; index += 1) {
    const occurrence = toGregorian(occurrenceAt(anchor, rule, index));
    if (compareGregorianDates(occurrence, onOrAfter) >= 0) return occurrence;
  }
  throw new RangeError("Unable to calculate a future occurrence within the supported range.");
}

export function notificationTime(
  occurrence: GregorianDate,
  remindBeforeDays: number,
  sendTime: LocalTime,
  timeZone: string,
): Date {
  if (!Number.isInteger(remindBeforeDays) || remindBeforeDays < 0 || remindBeforeDays > 365)
    throw new RangeError("Reminder lead time must be an integer from 0 to 365.");
  const notificationDate = addGregorianDays(occurrence, -remindBeforeDays);
  return localDateTimeToUtc(notificationDate, sendTime, timeZone);
}
