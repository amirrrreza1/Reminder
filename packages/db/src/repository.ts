import {
  calculateSchedule,
  createReminderSchema,
  formatGregorianDate,
  parseSendTime,
  todayInTimezone,
  type CreateReminderInput,
  type CurrencyCode,
  type NotificationChannel,
  type ReminderState,
  type ReminderType,
} from "@reminder/domain";
import type { Sql, TransactionSql } from "postgres";

import { NotFoundError, ProviderUnavailableError } from "./errors.js";
import { createSql } from "./index.js";

export type ProviderAvailability = Record<NotificationChannel, boolean>;
type QueryClient = Sql | TransactionSql;

export type ReminderRecord = {
  id: string;
  title: string;
  description: string | null;
  type: ReminderType;
  customTypeLabel: string | null;
  state: ReminderState;
  schedule: CreateReminderInput["schedule"] & {
    anchorWasLastDay: boolean;
    nextOccurrenceDate: string | null;
    nextNotificationAt: string | null;
  };
  amount: { currency: CurrencyCode; minor: string } | null;
  remindBeforeDays: number;
  channels: Record<NotificationChannel, boolean>;
  createdAt: string;
  updatedAt: string;
};

export type SettingsRecord = {
  calendarSystem: "gregorian" | "jalali";
  defaultCurrency: CurrencyCode;
  emailEnabled: boolean;
  telegramEnabled: boolean;
  updatedAt: string;
};

type ReminderRow = {
  id: string;
  title: string;
  description: string | null;
  type: ReminderType;
  custom_type_label: string | null;
  state: ReminderState;
  recurrence_calendar: "gregorian" | "jalali";
  anchor_year: number;
  anchor_month: number;
  anchor_day: number;
  anchor_was_last_day: boolean;
  frequency: CreateReminderInput["schedule"]["frequency"];
  recurrence_interval: number;
  next_occurrence_date: string | null;
  next_notification_at: Date | null;
  remind_before_days: number;
  amount_minor: bigint | null;
  currency: CurrencyCode | null;
  email_enabled: boolean;
  telegram_enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

export class StaleWriteError extends Error {
  constructor(readonly current: ReminderRecord | SettingsRecord) {
    super("The resource has changed since it was loaded.");
  }
}
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function dateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1).toString().padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}`;
}
function toRecord(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    customTypeLabel: row.custom_type_label,
    state: row.state,
    schedule: {
      calendar: row.recurrence_calendar,
      anchorDate: { year: row.anchor_year, month: row.anchor_month, day: row.anchor_day },
      anchorWasLastDay: row.anchor_was_last_day,
      frequency: row.frequency,
      interval: row.recurrence_interval,
      nextOccurrenceDate: dateOnly(row.next_occurrence_date),
      nextNotificationAt: row.next_notification_at ? iso(row.next_notification_at) : null,
    },
    amount:
      row.amount_minor === null || row.currency === null
        ? null
        : { currency: row.currency, minor: row.amount_minor.toString() },
    remindBeforeDays: row.remind_before_days,
    channels: { email: row.email_enabled, telegram: row.telegram_enabled },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function dbInput(record: ReminderRecord): CreateReminderInput {
  return {
    title: record.title,
    description: record.description,
    type: record.type,
    customTypeLabel: record.customTypeLabel,
    state: record.state,
    schedule: {
      calendar: record.schedule.calendar,
      anchorDate: record.schedule.anchorDate,
      frequency: record.schedule.frequency,
      interval: record.schedule.interval,
    },
    amount: record.amount,
    remindBeforeDays: record.remindBeforeDays,
    channels: record.channels,
  };
}

function assertChannels(
  channels: Record<NotificationChannel, boolean>,
  availability: ProviderAvailability,
): void {
  for (const channel of ["email", "telegram"] as const)
    if (channels[channel] && !availability[channel]) throw new ProviderUnavailableError(channel);
}

const returningReminder = `returning id, title, description, type, custom_type_label, state, recurrence_calendar, anchor_year, anchor_month, anchor_day, anchor_was_last_day, frequency, recurrence_interval, next_occurrence_date, next_notification_at, remind_before_days, amount_minor, currency, email_enabled, telegram_enabled, created_at, updated_at`;

export class ReminderRepository {
  constructor(
    private readonly databaseUrl: string,
    private readonly timeZone: string,
    private readonly sendTime: string,
    private readonly availability: ProviderAvailability,
    private readonly missedGraceHours = 72,
  ) {}

  private async withSql<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    const sql = await createSql(this.databaseUrl);
    try {
      return await work(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  async list(): Promise<ReminderRecord[]> {
    return this.withSql(async (sql) =>
      (
        await sql<
          ReminderRow[]
        >`select ${sql.unsafe(returningReminder.replace("returning ", ""))} from reminders order by next_occurrence_date asc nulls last, id asc`
      ).map(toRecord),
    );
  }

  async get(id: string): Promise<ReminderRecord> {
    return this.withSql((sql) => this.getWithSql(sql, id));
  }

  private async getWithSql(sql: QueryClient, id: string): Promise<ReminderRecord> {
    const rows = await sql<
      ReminderRow[]
    >`select ${sql.unsafe(returningReminder.replace("returning ", ""))} from reminders where id = ${id}`;
    if (!rows[0]) throw new NotFoundError("Reminder was not found.");
    return toRecord(rows[0]);
  }

  /** Inserts only an already-due occurrence; future rows are materialized by the scheduler. */
  private async enqueueDueDeliveries(
    tx: QueryClient,
    reminder: ReminderRecord,
    now: Date,
  ): Promise<void> {
    const scheduledFor = reminder.schedule.nextNotificationAt;
    if (reminder.state !== "active" || !scheduledFor) return;
    const scheduledAt = new Date(scheduledFor);
    if (scheduledAt.getTime() > now.getTime()) return;
    const settingsRows = await tx<
      { email_enabled: boolean; telegram_enabled: boolean }[]
    >`select email_enabled, telegram_enabled from settings where id = 1`;
    const settings = settingsRows[0];
    if (!settings || !reminder.schedule.nextOccurrenceDate) return;
    const status =
      now.getTime() - scheduledAt.getTime() <= this.missedGraceHours * 3_600_000
        ? "pending"
        : "expired";
    for (const channel of ["email", "telegram"] as const) {
      const globallyEnabled =
        channel === "email" ? settings.email_enabled : settings.telegram_enabled;
      if (!this.availability[channel] || !globallyEnabled || !reminder.channels[channel]) continue;
      await tx`
        insert into notification_deliveries (
          reminder_id, kind, channel, occurrence_date, remind_before_days, scheduled_for,
          status, next_attempt_at
        ) values (
          ${reminder.id}, 'occurrence', ${channel}, ${reminder.schedule.nextOccurrenceDate},
          ${reminder.remindBeforeDays}, ${scheduledAt}, ${status}, ${
            status === "pending" ? now : null
          }
        ) on conflict do nothing
      `;
    }
  }

  async create(input: CreateReminderInput, now = new Date()): Promise<ReminderRecord> {
    assertChannels(input.channels, this.availability);
    if (input.state === "completed") throw new RangeError("Completed reminders cannot be created.");
    const schedule = calculateSchedule({
      schedule: input.schedule,
      remindBeforeDays: input.remindBeforeDays,
      timeZone: this.timeZone,
      sendTime: parseSendTime(this.sendTime),
      onOrAfter: todayInTimezone(now, this.timeZone),
    });
    return this.withSql(async (sql) => {
      const rows = await sql.unsafe<ReminderRow[]>(
        `insert into reminders (title, description, type, custom_type_label, state, recurrence_calendar, anchor_year, anchor_month, anchor_day, anchor_was_last_day, frequency, recurrence_interval, next_occurrence_date, next_notification_at, remind_before_days, amount_minor, currency, email_enabled, telegram_enabled) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ${returningReminder}`,
        [
          input.title,
          input.description,
          input.type,
          input.customTypeLabel,
          input.state,
          input.schedule.calendar,
          input.schedule.anchorDate.year,
          input.schedule.anchorDate.month,
          input.schedule.anchorDate.day,
          schedule.anchorWasLastDay,
          input.schedule.frequency,
          input.schedule.interval,
          formatGregorianDate(schedule.nextOccurrenceDate),
          schedule.nextNotificationAt,
          input.remindBeforeDays,
          input.amount?.minor ?? null,
          input.amount?.currency ?? null,
          input.channels.email,
          input.channels.telegram,
        ],
      );
      if (!rows[0]) throw new Error("Reminder insertion returned no row.");
      const record = toRecord(rows[0]);
      await this.enqueueDueDeliveries(sql, record, now);
      return record;
    });
  }

  async update(
    id: string,
    expectedUpdatedAt: string,
    changes: Partial<CreateReminderInput>,
    now = new Date(),
  ): Promise<ReminderRecord> {
    return this.withSql(async (sql) =>
      sql.begin(async (tx) => {
        const current = await this.getWithSql(tx, id);
        if (current.updatedAt !== expectedUpdatedAt) throw new StaleWriteError(current);
        const parsed = createReminderSchema.safeParse({ ...dbInput(current), ...changes });
        if (!parsed.success) throw parsed.error;
        const input = parsed.data;
        assertChannels(input.channels, this.availability);
        const completed = input.state === "completed";
        const schedule = completed
          ? null
          : calculateSchedule({
              schedule: input.schedule,
              remindBeforeDays: input.remindBeforeDays,
              timeZone: this.timeZone,
              sendTime: parseSendTime(this.sendTime),
              onOrAfter: todayInTimezone(now, this.timeZone),
            });
        const rows = await tx.unsafe<ReminderRow[]>(
          `update reminders set title=$2, description=$3, type=$4, custom_type_label=$5, state=$6, recurrence_calendar=$7, anchor_year=$8, anchor_month=$9, anchor_day=$10, anchor_was_last_day=$11, frequency=$12, recurrence_interval=$13, next_occurrence_date=$14, next_notification_at=$15, remind_before_days=$16, amount_minor=$17, currency=$18, email_enabled=$19, telegram_enabled=$20 where id=$1 ${returningReminder}`,
          [
            id,
            input.title,
            input.description,
            input.type,
            input.customTypeLabel,
            input.state,
            input.schedule.calendar,
            input.schedule.anchorDate.year,
            input.schedule.anchorDate.month,
            input.schedule.anchorDate.day,
            schedule?.anchorWasLastDay ?? current.schedule.anchorWasLastDay,
            input.schedule.frequency,
            input.schedule.interval,
            schedule ? formatGregorianDate(schedule.nextOccurrenceDate) : null,
            schedule?.nextNotificationAt ?? null,
            input.remindBeforeDays,
            input.amount?.minor ?? null,
            input.amount?.currency ?? null,
            input.channels.email,
            input.channels.telegram,
          ],
        );
        if (!rows[0]) throw new NotFoundError("Reminder was not found.");
        await tx`update notification_deliveries set status = 'cancelled', next_attempt_at = null where reminder_id = ${id} and status in ('pending', 'retry')`;
        const record = toRecord(rows[0]);
        await this.enqueueDueDeliveries(tx, record, now);
        return record;
      }),
    );
  }

  async delete(id: string, expectedUpdatedAt: string): Promise<void> {
    await this.withSql(async (sql) =>
      sql.begin(async (tx) => {
        const current = await this.getWithSql(tx, id);
        if (current.updatedAt !== expectedUpdatedAt) throw new StaleWriteError(current);
        await tx`delete from reminders where id = ${id}`;
      }),
    );
  }

  async getSettings(): Promise<SettingsRecord> {
    return this.withSql(async (sql) => {
      const rows = await sql<
        {
          calendar_system: SettingsRecord["calendarSystem"];
          default_currency: CurrencyCode;
          email_enabled: boolean;
          telegram_enabled: boolean;
          updated_at: Date;
        }[]
      >`select calendar_system, default_currency, email_enabled, telegram_enabled, updated_at from settings where id = 1`;
      const row = rows[0];
      if (!row) throw new NotFoundError("Settings were not initialized.");
      return {
        calendarSystem: row.calendar_system,
        defaultCurrency: row.default_currency,
        emailEnabled: row.email_enabled,
        telegramEnabled: row.telegram_enabled,
        updatedAt: iso(row.updated_at),
      };
    });
  }

  async updateSettings(
    input: SettingsRecord & { expectedUpdatedAt: string },
  ): Promise<SettingsRecord> {
    if (input.emailEnabled && !this.availability.email) throw new ProviderUnavailableError("email");
    if (input.telegramEnabled && !this.availability.telegram)
      throw new ProviderUnavailableError("telegram");
    return this.withSql(async (sql) =>
      sql.begin(async (tx) => {
        const current = await this.getSettingsWithSql(tx);
        if (current.updatedAt !== input.expectedUpdatedAt) throw new StaleWriteError(current);
        const rows = await tx<
          {
            calendar_system: SettingsRecord["calendarSystem"];
            default_currency: CurrencyCode;
            email_enabled: boolean;
            telegram_enabled: boolean;
            updated_at: Date;
          }[]
        >`update settings set calendar_system=${input.calendarSystem}, default_currency=${input.defaultCurrency}, email_enabled=${input.emailEnabled}, telegram_enabled=${input.telegramEnabled} where id=1 returning calendar_system, default_currency, email_enabled, telegram_enabled, updated_at`;
        const row = rows[0];
        if (!row) throw new NotFoundError("Settings were not initialized.");
        if (!input.emailEnabled)
          await tx.unsafe(
            "update notification_deliveries set status = 'cancelled_global', next_attempt_at = null where channel = $1 and status in ('pending', 'retry')",
            ["email"],
          );
        if (!input.telegramEnabled)
          await tx.unsafe(
            "update notification_deliveries set status = 'cancelled_global', next_attempt_at = null where channel = $1 and status in ('pending', 'retry')",
            ["telegram"],
          );
        return {
          calendarSystem: row.calendar_system,
          defaultCurrency: row.default_currency,
          emailEnabled: row.email_enabled,
          telegramEnabled: row.telegram_enabled,
          updatedAt: iso(row.updated_at),
        };
      }),
    );
  }

  private async getSettingsWithSql(sql: QueryClient): Promise<SettingsRecord> {
    const rows = await sql<
      {
        calendar_system: SettingsRecord["calendarSystem"];
        default_currency: CurrencyCode;
        email_enabled: boolean;
        telegram_enabled: boolean;
        updated_at: Date;
      }[]
    >`select calendar_system, default_currency, email_enabled, telegram_enabled, updated_at from settings where id = 1`;
    const row = rows[0];
    if (!row) throw new NotFoundError("Settings were not initialized.");
    return {
      calendarSystem: row.calendar_system,
      defaultCurrency: row.default_currency,
      emailEnabled: row.email_enabled,
      telegramEnabled: row.telegram_enabled,
      updatedAt: iso(row.updated_at),
    };
  }
}
