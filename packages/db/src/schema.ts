import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const calendarSystem = pgEnum("calendar_system", ["gregorian", "jalali"]);
export const currency = pgEnum("currency", ["IRR", "USD"]);
export const reminderType = pgEnum("reminder_type", [
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
]);
export const reminderState = pgEnum("reminder_state", ["active", "paused", "completed"]);
export const recurrenceFrequency = pgEnum("recurrence_frequency", [
  "once",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
export const notificationChannel = pgEnum("notification_channel", ["email", "telegram"]);
export const deliveryKind = pgEnum("delivery_kind", ["occurrence", "provider_test"]);
export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "processing",
  "retry",
  "sent",
  "failed",
  "expired",
  "cancelled",
  "cancelled_global",
]);

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true, mode: "date" })
  .notNull()
  .defaultNow();

export const settings = pgTable(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    calendarSystem: calendarSystem("calendar_system").notNull(),
    defaultCurrency: currency("default_currency").notNull(),
    emailEnabled: boolean("email_enabled").notNull(),
    telegramEnabled: boolean("telegram_enabled").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [check("settings_singleton", sql`${table.id} = 1`)],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description"),
    type: reminderType("type").notNull(),
    customTypeLabel: varchar("custom_type_label", { length: 40 }),
    state: reminderState("state").notNull().default("active"),
    recurrenceCalendar: calendarSystem("recurrence_calendar").notNull(),
    anchorYear: smallint("anchor_year").notNull(),
    anchorMonth: smallint("anchor_month").notNull(),
    anchorDay: smallint("anchor_day").notNull(),
    anchorWasLastDay: boolean("anchor_was_last_day").notNull(),
    frequency: recurrenceFrequency("frequency").notNull(),
    recurrenceInterval: smallint("recurrence_interval").notNull(),
    nextOccurrenceDate: date("next_occurrence_date"),
    nextNotificationAt: timestamp("next_notification_at", { withTimezone: true, mode: "date" }),
    remindBeforeDays: smallint("remind_before_days").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }),
    currency: currency("currency"),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    telegramEnabled: boolean("telegram_enabled").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "reminders_amount_currency_check",
      sql`(${table.amountMinor} is null) = (${table.currency} is null)`,
    ),
    index("reminders_dashboard_order").on(table.state, table.nextOccurrenceDate, table.id),
    index("reminders_scheduler_due")
      .on(table.nextNotificationAt, table.id)
      .where(sql`${table.state} = 'active'`),
    index("reminders_occurrence_due")
      .on(table.nextOccurrenceDate, table.id)
      .where(sql`${table.state} = 'active'`),
    index("reminders_type_filter").on(table.type, table.state, table.nextOccurrenceDate),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reminderId: uuid("reminder_id").references(() => reminders.id, { onDelete: "cascade" }),
    kind: deliveryKind("kind").notNull(),
    channel: notificationChannel("channel").notNull(),
    occurrenceDate: date("occurrence_date"),
    remindBeforeDays: smallint("remind_before_days"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "date" }).notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    attemptCount: smallint("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }),
    leaseOwner: varchar("lease_owner", { length: 100 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    lastErrorDetail: varchar("last_error_detail", { length: 500 }),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("notification_deliveries_occurrence_unique")
      .on(table.reminderId, table.occurrenceDate, table.channel, table.remindBeforeDays)
      .where(sql`${table.kind} = 'occurrence'`),
    index("notification_deliveries_claim")
      .on(table.nextAttemptAt, table.createdAt, table.id)
      .where(sql`${table.status} in ('pending', 'retry')`),
    index("notification_deliveries_lease_recovery")
      .on(table.leaseExpiresAt, table.id)
      .where(sql`${table.status} = 'processing'`),
    index("notification_deliveries_reminder_history").on(table.reminderId, table.createdAt),
  ],
);
