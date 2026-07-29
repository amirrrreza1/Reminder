/**
 * Shared domain types for Phase 1 scaffolding.
 * Calendar, recurrence, and money logic land in Phase 2.
 */

export type CalendarSystem = "gregorian" | "jalali";

export type CurrencyCode = "IRR" | "USD";

export const APP_NAME = "Reminder" as const;

export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}
