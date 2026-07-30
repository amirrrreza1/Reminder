export type CalendarSystem = "gregorian" | "jalali";
export type CurrencyCode = "IRR" | "USD";
export type ReminderType =
  | "birthday"
  | "subscription"
  | "debt"
  | "rent"
  | "bill"
  | "insurance"
  | "membership"
  | "maintenance"
  | "medication_refill"
  | "tax_license"
  | "custom";
export type ReminderState = "active" | "paused" | "completed";
export type RecurrenceFrequency = "once" | "daily" | "weekly" | "monthly" | "yearly";
export type NotificationChannel = "email" | "telegram";
