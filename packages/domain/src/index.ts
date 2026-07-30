export * from "./calendar.js";
export * from "./money.js";
export * from "./recurrence.js";
export * from "./reminder.js";
export * from "./types.js";

export const APP_NAME = "Reminder" as const;

export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}
