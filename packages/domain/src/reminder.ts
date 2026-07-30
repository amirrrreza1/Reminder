import { z } from "zod";

import {
  daysInMonth,
  isSupportedGregorianDate,
  toGregorian,
  type CalendarDate,
  type GregorianDate,
} from "./calendar.js";
import { parseMinorAmount } from "./money.js";
import { firstOccurrenceOnOrAfter, notificationTime, type RecurrenceRule } from "./recurrence.js";
import type {
  CalendarSystem,
  CurrencyCode,
  NotificationChannel,
  RecurrenceFrequency,
  ReminderState,
  ReminderType,
} from "./types.js";

export const reminderTypes = [
  "birthday",
  "subscription",
  "debt",
  "rent",
  "bill",
  "insurance",
  "membership",
  "maintenance",
  "medication_refill",
  "tax_license",
  "custom",
] as const satisfies readonly ReminderType[];
export const recurrenceFrequencies = [
  "once",
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const satisfies readonly RecurrenceFrequency[];
export const calendarSystems = ["gregorian", "jalali"] as const satisfies readonly CalendarSystem[];
export const currencies = ["IRR", "USD"] as const satisfies readonly CurrencyCode[];
export const reminderStates = [
  "active",
  "paused",
  "completed",
] as const satisfies readonly ReminderState[];

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= max, `Must be at most ${max} characters.`);
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .transform((value) => (value === null ? null : value.trim() || null))
    .refine((value) => value === null || value.length <= max, `Must be at most ${max} characters.`);
const calendarDateSchema = z
  .object({ year: z.number().int(), month: z.number().int(), day: z.number().int() })
  .strict();
const scheduleSchema = z
  .object({
    calendar: z.enum(calendarSystems),
    anchorDate: calendarDateSchema,
    frequency: z.enum(recurrenceFrequencies),
    interval: z.number().int().min(1).max(99),
  })
  .strict();
export const schedulePreviewSchema = z
  .object({ schedule: scheduleSchema, remindBeforeDays: z.number().int().min(0).max(365) })
  .strict();
const amountSchema = z
  .object({
    currency: z.enum(currencies),
    minor: z.string().regex(/^\d+$/, "Must contain digits only."),
  })
  .strict();
const channelsSchema = z.object({ email: z.boolean(), telegram: z.boolean() }).strict();

const createReminderFields = z
  .object({
    title: text(120).refine((value) => value.length > 0, "Title is required."),
    description: optionalText(2000),
    type: z.enum(reminderTypes),
    customTypeLabel: optionalText(40),
    state: z.enum(reminderStates),
    schedule: scheduleSchema,
    amount: amountSchema.nullable(),
    remindBeforeDays: z.number().int().min(0).max(365),
    channels: channelsSchema,
  })
  .strict();

export const createReminderSchema = createReminderFields
  .superRefine((value, context) => {
    if (value.type === "custom" && !value.customTypeLabel)
      context.addIssue({
        code: "custom",
        path: ["customTypeLabel"],
        message: "A custom type label is required.",
      });
    if (value.type !== "custom" && value.customTypeLabel)
      context.addIssue({
        code: "custom",
        path: ["customTypeLabel"],
        message: "Only custom reminders can have a custom label.",
      });
    const date: CalendarDate = { calendar: value.schedule.calendar, ...value.schedule.anchorDate };
    if (value.schedule.anchorDate.day > daysInMonth(date.calendar, date.year, date.month))
      context.addIssue({
        code: "custom",
        path: ["schedule", "anchorDate", "day"],
        message: "Day is not valid for this month and year.",
      });
    else if (!isSupportedGregorianDate(toGregorian(date)))
      context.addIssue({
        code: "custom",
        path: ["schedule", "anchorDate"],
        message: "Date must convert between 1900-01-01 and 2400-12-31.",
      });
    if (value.amount) {
      try {
        parseMinorAmount(value.amount.minor);
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["amount", "minor"],
          message: error instanceof Error ? error.message : "Amount is invalid.",
        });
      }
    }
    if (value.state === "completed" && value.schedule.frequency !== "once")
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Only one-time reminders may be completed.",
      });
  })
  .transform((value) => ({
    ...value,
    customTypeLabel: value.type === "custom" ? value.customTypeLabel : null,
  }));

export const updateReminderSchema = createReminderFields
  .partial()
  .extend({ expectedUpdatedAt: z.string().datetime({ offset: true }) })
  .strict();

export const deleteReminderSchema = z
  .object({ expectedUpdatedAt: z.string().datetime({ offset: true }) })
  .strict();

export const updateSettingsSchema = z
  .object({
    calendarSystem: z.enum(calendarSystems),
    defaultCurrency: z.enum(currencies),
    emailEnabled: z.boolean(),
    telegramEnabled: z.boolean(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type CreateReminderInput = z.output<typeof createReminderSchema>;
export type ReminderSchedule = CreateReminderInput["schedule"];

export function anchorWasLastDay(schedule: ReminderSchedule): boolean {
  return (
    schedule.anchorDate.day ===
    daysInMonth(schedule.calendar, schedule.anchorDate.year, schedule.anchorDate.month)
  );
}

export function calculateSchedule(input: {
  schedule: ReminderSchedule;
  remindBeforeDays: number;
  timeZone: string;
  sendTime: { hour: number; minute: number };
  onOrAfter: GregorianDate;
}): { nextOccurrenceDate: GregorianDate; nextNotificationAt: Date; anchorWasLastDay: boolean } {
  const anchor: CalendarDate = { calendar: input.schedule.calendar, ...input.schedule.anchorDate };
  const rule: RecurrenceRule = {
    frequency: input.schedule.frequency,
    interval: input.schedule.interval,
    anchorWasLastDay: anchorWasLastDay(input.schedule),
  };
  const nextOccurrenceDate = firstOccurrenceOnOrAfter(anchor, rule, input.onOrAfter);
  if (!nextOccurrenceDate)
    throw new RangeError("A one-time reminder cannot be scheduled in the past.");
  return {
    nextOccurrenceDate,
    nextNotificationAt: notificationTime(
      nextOccurrenceDate,
      input.remindBeforeDays,
      input.sendTime,
      input.timeZone,
    ),
    anchorWasLastDay: rule.anchorWasLastDay,
  };
}

export type ReminderPreset = {
  frequency: RecurrenceFrequency;
  interval: number;
  amountVisible: boolean;
};
export const reminderPresets: Record<ReminderType, ReminderPreset> = {
  birthday: { frequency: "yearly", interval: 1, amountVisible: false },
  subscription: { frequency: "monthly", interval: 1, amountVisible: true },
  debt: { frequency: "monthly", interval: 1, amountVisible: true },
  rent: { frequency: "monthly", interval: 1, amountVisible: true },
  bill: { frequency: "monthly", interval: 1, amountVisible: true },
  insurance: { frequency: "yearly", interval: 1, amountVisible: true },
  membership: { frequency: "yearly", interval: 1, amountVisible: true },
  maintenance: { frequency: "monthly", interval: 3, amountVisible: false },
  medication_refill: { frequency: "monthly", interval: 1, amountVisible: false },
  tax_license: { frequency: "yearly", interval: 1, amountVisible: true },
  custom: { frequency: "monthly", interval: 1, amountVisible: false },
};

export function channelsUnavailable(
  channels: Record<NotificationChannel, boolean>,
  availability: Record<NotificationChannel, boolean>,
): NotificationChannel[] {
  return (Object.keys(channels) as NotificationChannel[]).filter(
    (channel) => channels[channel] && !availability[channel],
  );
}
