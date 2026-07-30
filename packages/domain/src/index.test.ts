import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  calculateSchedule,
  firstOccurrenceOnOrAfter,
  formatGregorianDate,
  formatMoney,
  fromGregorian,
  parseMinorAmount,
  toGregorian,
  type CalendarDate,
  type GregorianDate,
} from "./index.js";

const gregorian = (year: number, month: number, day: number): GregorianDate => ({
  calendar: "gregorian",
  year,
  month,
  day,
});

describe("domain", () => {
  it("exports the application name", () => {
    expect(APP_NAME).toBe("Reminder");
  });

  it("round-trips known Gregorian and Jalali new year dates", () => {
    const jalali: CalendarDate = { calendar: "jalali", year: 1405, month: 1, day: 1 };
    expect(toGregorian(jalali)).toEqual(gregorian(2026, 3, 21));
    expect(fromGregorian(gregorian(2026, 3, 21), "jalali")).toEqual(jalali);
  });

  it("keeps a Gregorian month-end anchor without permanently clamping it", () => {
    const occurrence = firstOccurrenceOnOrAfter(
      { calendar: "gregorian", year: 2025, month: 1, day: 31 },
      { frequency: "monthly", interval: 1, anchorWasLastDay: true },
      gregorian(2025, 3, 1),
    );
    expect(occurrence).toEqual(gregorian(2025, 3, 31));
  });

  it("uses the last valid Jalali day in non-leap years and returns to Esfand 30", () => {
    const anchor: CalendarDate = { calendar: "jalali", year: 1399, month: 12, day: 30 };
    const nonLeap = firstOccurrenceOnOrAfter(
      anchor,
      { frequency: "yearly", interval: 1, anchorWasLastDay: true },
      gregorian(2021, 3, 22),
    );
    const laterLeap = firstOccurrenceOnOrAfter(
      anchor,
      { frequency: "yearly", interval: 1, anchorWasLastDay: true },
      gregorian(2024, 3, 20),
    );
    expect(fromGregorian(nonLeap!, "jalali")).toEqual({
      calendar: "jalali",
      year: 1399 + 1,
      month: 12,
      day: 29,
    });
    expect(fromGregorian(laterLeap!, "jalali")).toEqual({
      calendar: "jalali",
      year: 1403,
      month: 12,
      day: 30,
    });
  });

  it("materializes a notification instant from local calendar time", () => {
    const schedule = calculateSchedule({
      schedule: {
        calendar: "gregorian",
        anchorDate: { year: 2026, month: 11, day: 15 },
        frequency: "yearly",
        interval: 1,
      },
      remindBeforeDays: 7,
      timeZone: "Asia/Tehran",
      sendTime: { hour: 9, minute: 0 },
      onOrAfter: gregorian(2026, 1, 1),
    });
    expect(formatGregorianDate(schedule.nextOccurrenceDate)).toBe("2026-11-15");
    expect(schedule.nextNotificationAt.toISOString()).toBe("2026-11-08T05:30:00.000Z");
  });

  it("parses exact money minor units and formats each supported currency", () => {
    expect(parseMinorAmount("1250")).toBe(1250n);
    expect(() => parseMinorAmount("12.50")).toThrow();
    expect(formatMoney(1250n, "USD")).toBe("$12.50");
    expect(formatMoney(1_250_000n, "IRR")).toContain("1,250,000");
  });
});
