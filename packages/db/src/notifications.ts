import {
  addGregorianDays,
  firstOccurrenceOnOrAfter,
  formatGregorianDate,
  notificationTime,
  parseSendTime,
  todayInTimezone,
  type CalendarDate,
  type NotificationChannel,
  type ReminderType,
} from "@reminder/domain";
import type { Sql, TransactionSql } from "postgres";

import { NotFoundError, ProviderUnavailableError } from "./errors.js";
import { createSql } from "./index.js";

export type DeliveryStatus =
  | "pending"
  | "processing"
  | "retry"
  | "sent"
  | "failed"
  | "expired"
  | "cancelled"
  | "cancelled_global";
export type DeliveryKind = "occurrence" | "provider_test";

export type NotificationRuntimeConfig = {
  timeZone: string;
  sendTime: string;
  missedGraceHours: number;
  availability: Record<NotificationChannel, boolean>;
};

export type ProviderTestRecord = {
  id: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  attemptCount: number;
  createdAt: string;
  sentAt: string | null;
  error: { category: string; code: string; message: string } | null;
};

export type ClaimedDelivery = {
  id: string;
  kind: DeliveryKind;
  channel: NotificationChannel;
  scheduledFor: Date;
  attemptCount: number;
  title: string | null;
  description: string | null;
  type: ReminderType | null;
  customTypeLabel: string | null;
  recurrenceCalendar: "gregorian" | "jalali" | null;
  occurrenceDate: string | null;
  amountMinor: bigint | null;
  currency: "IRR" | "USD" | null;
  remindBeforeDays: number | null;
};

type SchedulerReminder = {
  id: string;
  state: "active";
  recurrence_calendar: "gregorian" | "jalali";
  anchor_year: number;
  anchor_month: number;
  anchor_day: number;
  anchor_was_last_day: boolean;
  frequency: "once" | "daily" | "weekly" | "monthly" | "yearly";
  recurrence_interval: number;
  next_occurrence_date: Date;
  next_notification_at: Date;
  remind_before_days: number;
  email_enabled: boolean;
  telegram_enabled: boolean;
  global_email_enabled: boolean;
  global_telegram_enabled: boolean;
};

type ClaimRow = {
  id: string;
  kind: DeliveryKind;
  channel: NotificationChannel;
  scheduled_for: Date;
  attempt_count: number;
  title: string | null;
  description: string | null;
  type: ReminderType | null;
  custom_type_label: string | null;
  recurrence_calendar: "gregorian" | "jalali" | null;
  occurrence_date: string | null;
  amount_minor: bigint | null;
  currency: "IRR" | "USD" | null;
  remind_before_days: number | null;
};

type DeliveryRow = {
  id: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempt_count: number;
  created_at: Date;
  sent_at: Date | null;
  last_error_code: string | null;
  last_error_detail: string | null;
};

type QueryClient = Sql | TransactionSql;
const SCHEDULER_LOCK = 4_819_071;
const SCHEDULER_BATCH = 100;
const CLAIM_BATCH = 20;
const LEASE_SECONDS = 90;

function iso(value: Date): string {
  return value.toISOString();
}

function publicError(code: string | null, detail: string | null): ProviderTestRecord["error"] {
  if (!code) return null;
  const category = code.includes("AUTH")
    ? "authentication"
    : code.includes("RECIPIENT")
      ? "recipient"
      : code.includes("RATE")
        ? "rate_limited"
        : code.includes("CONFIG") || code.includes("NOT_CONFIGURED")
          ? "configuration"
          : code.includes("NETWORK") || code.includes("UNAVAILABLE")
            ? "network"
            : "unknown";
  return {
    category,
    code,
    message: detail ?? "The provider could not send the test message.",
  };
}

function withinGrace(scheduledFor: Date, now: Date, missedGraceHours: number): boolean {
  return now.getTime() - scheduledFor.getTime() <= missedGraceHours * 3_600_000;
}

function enabledChannels(
  reminder: SchedulerReminder,
  availability: Record<NotificationChannel, boolean>,
) {
  return (["email", "telegram"] as const).filter((channel) => {
    const globallyEnabled =
      channel === "email" ? reminder.global_email_enabled : reminder.global_telegram_enabled;
    const reminderEnabled =
      channel === "email" ? reminder.email_enabled : reminder.telegram_enabled;
    return availability[channel] && globallyEnabled && reminderEnabled;
  });
}

async function insertOccurrenceDelivery(
  tx: QueryClient,
  input: {
    reminderId: string;
    occurrenceDate: string;
    channel: NotificationChannel;
    remindBeforeDays: number;
    scheduledFor: Date;
    now: Date;
    missedGraceHours: number;
  },
): Promise<void> {
  const pending = withinGrace(input.scheduledFor, input.now, input.missedGraceHours);
  await tx`
    insert into notification_deliveries (
      reminder_id, kind, channel, occurrence_date, remind_before_days, scheduled_for,
      status, next_attempt_at
    ) values (
      ${input.reminderId}, 'occurrence', ${input.channel}, ${input.occurrenceDate},
      ${input.remindBeforeDays}, ${input.scheduledFor},
      ${pending ? "pending" : "expired"}, ${pending ? input.now : null}
    )
    on conflict do nothing
  `;
}

/**
 * PostgreSQL-backed scheduler and delivery queue. All provider communication
 * happens in the worker after this repository releases its short transaction.
 */
export class NotificationRepository {
  constructor(
    private readonly databaseUrl: string,
    private readonly runtime: NotificationRuntimeConfig,
  ) {}

  private async withSql<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    const sql = await createSql(this.databaseUrl);
    try {
      return await work(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  async createProviderTest(
    channel: NotificationChannel,
    now = new Date(),
  ): Promise<ProviderTestRecord> {
    if (!this.runtime.availability[channel]) throw new ProviderUnavailableError(channel);
    return this.withSql(async (sql) => {
      const rows = await sql<DeliveryRow[]>`
        insert into notification_deliveries (
          kind, channel, scheduled_for, status, next_attempt_at
        ) values ('provider_test', ${channel}, ${now}, 'pending', ${now})
        returning id, channel, status, attempt_count, created_at, sent_at, last_error_code, last_error_detail
      `;
      const row = rows[0];
      if (!row) throw new Error("Provider test insertion returned no row.");
      return this.toProviderTest(row);
    });
  }

  async getProviderTest(id: string): Promise<ProviderTestRecord> {
    return this.withSql(async (sql) => {
      const rows = await sql<DeliveryRow[]>`
        select id, channel, status, attempt_count, created_at, sent_at, last_error_code, last_error_detail
        from notification_deliveries
        where id = ${id} and kind = 'provider_test'
      `;
      const row = rows[0];
      if (!row) throw new NotFoundError("Provider test was not found.");
      return this.toProviderTest(row);
    });
  }

  private toProviderTest(row: DeliveryRow): ProviderTestRecord {
    return {
      id: row.id,
      channel: row.channel,
      status: row.status,
      attemptCount: row.attempt_count,
      createdAt: iso(row.created_at),
      sentAt: row.sent_at ? iso(row.sent_at) : null,
      error: publicError(row.last_error_code, row.last_error_detail),
    };
  }

  /** Schedules due reminders and rolls over occurrences only while holding one advisory lock. */
  async schedule(now = new Date()): Promise<{ scheduled: number; advanced: number }> {
    const localToday = formatGregorianDate(todayInTimezone(now, this.runtime.timeZone));
    return this.withSql(async (sql) =>
      sql.begin(async (tx) => {
        const lock = await tx<{ acquired: boolean }[]>`
          select pg_try_advisory_xact_lock(${SCHEDULER_LOCK}) as acquired
        `;
        if (!lock[0]?.acquired) return { scheduled: 0, advanced: 0 };

        await tx`
          update notification_deliveries as delivery
          set status = 'cancelled', next_attempt_at = null
          from reminders as reminder, settings
          where delivery.reminder_id = reminder.id
            and delivery.status in ('pending', 'retry')
            and (
              reminder.state <> 'active'
              or (delivery.channel = 'email' and (not reminder.email_enabled or not settings.email_enabled))
              or (delivery.channel = 'telegram' and (not reminder.telegram_enabled or not settings.telegram_enabled))
            )
        `;

        const reminders = await tx<SchedulerReminder[]>`
          select
            reminder.id, reminder.state, reminder.recurrence_calendar, reminder.anchor_year,
            reminder.anchor_month, reminder.anchor_day, reminder.anchor_was_last_day,
            reminder.frequency, reminder.recurrence_interval, reminder.next_occurrence_date,
            reminder.next_notification_at, reminder.remind_before_days, reminder.email_enabled,
            reminder.telegram_enabled, settings.email_enabled as global_email_enabled,
            settings.telegram_enabled as global_telegram_enabled
          from reminders as reminder
          cross join settings
          where reminder.state = 'active'
            and (reminder.next_notification_at <= ${now} or reminder.next_occurrence_date < ${localToday}::date)
          order by reminder.next_notification_at asc, reminder.id asc
          for update of reminder skip locked
          limit ${SCHEDULER_BATCH}
        `;

        let scheduled = 0;
        let advanced = 0;
        for (const reminder of reminders) {
          const occurrenceDate = reminder.next_occurrence_date.toISOString().slice(0, 10);
          for (const channel of enabledChannels(reminder, this.runtime.availability)) {
            await insertOccurrenceDelivery(tx, {
              reminderId: reminder.id,
              occurrenceDate,
              channel,
              remindBeforeDays: reminder.remind_before_days,
              scheduledFor: reminder.next_notification_at,
              now,
              missedGraceHours: this.runtime.missedGraceHours,
            });
            scheduled += 1;
          }

          if (occurrenceDate >= localToday) continue;
          const anchor: CalendarDate = {
            calendar: reminder.recurrence_calendar,
            year: reminder.anchor_year,
            month: reminder.anchor_month,
            day: reminder.anchor_day,
          };
          const [year, month, day] = occurrenceDate.split("-").map(Number);
          if (!year || !month || !day) throw new Error("Stored occurrence date is invalid.");
          const next = firstOccurrenceOnOrAfter(
            anchor,
            {
              frequency: reminder.frequency,
              interval: reminder.recurrence_interval,
              anchorWasLastDay: reminder.anchor_was_last_day,
            },
            addGregorianDays({ calendar: "gregorian", year, month, day }, 1),
          );
          if (!next) {
            await tx`
              update reminders
              set state = 'completed', next_occurrence_date = null, next_notification_at = null
              where id = ${reminder.id}
            `;
          } else {
            await tx`
              update reminders
              set next_occurrence_date = ${formatGregorianDate(next)},
                  next_notification_at = ${notificationTime(
                    next,
                    reminder.remind_before_days,
                    parseSendTime(this.runtime.sendTime),
                    this.runtime.timeZone,
                  )}
              where id = ${reminder.id}
            `;
          }
          advanced += 1;
        }
        return { scheduled, advanced };
      }),
    );
  }

  /** Releases abandoned leases, then claims a disjoint batch using SKIP LOCKED. */
  async claim(workerId: string, now = new Date()): Promise<ClaimedDelivery[]> {
    return this.withSql(async (sql) =>
      sql.begin(async (tx) => {
        await tx`
          update notification_deliveries
          set status = 'retry', next_attempt_at = ${now}, lease_owner = null, lease_expires_at = null,
              last_error_code = 'LEASE_EXPIRED',
              last_error_detail = 'A previous worker lease expired before the provider confirmed delivery.'
          where status = 'processing' and lease_expires_at <= ${now}
        `;
        const rows = await tx<ClaimRow[]>`
          with candidates as (
            select
              delivery.id, reminder.title, reminder.description, reminder.type,
              reminder.custom_type_label, reminder.recurrence_calendar, delivery.occurrence_date,
              reminder.amount_minor, reminder.currency, delivery.remind_before_days
            from notification_deliveries as delivery
            left join reminders as reminder on reminder.id = delivery.reminder_id
            cross join settings
            where delivery.status in ('pending', 'retry')
              and delivery.next_attempt_at <= ${now}
              and (
                delivery.kind = 'provider_test'
                or (
                  reminder.state = 'active'
                  and ((delivery.channel = 'email' and reminder.email_enabled and settings.email_enabled)
                    or (delivery.channel = 'telegram' and reminder.telegram_enabled and settings.telegram_enabled))
                )
              )
            order by delivery.next_attempt_at asc, delivery.created_at asc, delivery.id asc
            for update of delivery skip locked
            limit ${CLAIM_BATCH}
          )
          update notification_deliveries as delivery
          set status = 'processing', attempt_count = delivery.attempt_count + 1,
              lease_owner = ${workerId}, lease_expires_at = ${new Date(now.getTime() + LEASE_SECONDS * 1000)}
          from candidates
          where delivery.id = candidates.id
          returning delivery.id, delivery.kind, delivery.channel, delivery.scheduled_for,
                    delivery.attempt_count, candidates.title, candidates.description, candidates.type,
                    candidates.custom_type_label, candidates.recurrence_calendar, candidates.occurrence_date,
                    candidates.amount_minor, candidates.currency, candidates.remind_before_days
        `;
        return rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          channel: row.channel,
          scheduledFor: row.scheduled_for,
          attemptCount: row.attempt_count,
          title: row.title,
          description: row.description,
          type: row.type,
          customTypeLabel: row.custom_type_label,
          recurrenceCalendar: row.recurrence_calendar,
          occurrenceDate: row.occurrence_date,
          amountMinor: row.amount_minor,
          currency: row.currency,
          remindBeforeDays: row.remind_before_days,
        }));
      }),
    );
  }

  async markSent(
    id: string,
    workerId: string,
    receipt: { providerMessageId?: string; acceptedAt: string },
  ): Promise<void> {
    await this.withSql(async (sql) => {
      await sql`
        update notification_deliveries
        set status = 'sent', sent_at = ${new Date(receipt.acceptedAt)},
            provider_message_id = ${receipt.providerMessageId ?? null}, next_attempt_at = null,
            lease_owner = null, lease_expires_at = null, last_error_code = null, last_error_detail = null
        where id = ${id} and status = 'processing' and lease_owner = ${workerId}
      `;
    });
  }

  async markFailure(input: {
    id: string;
    workerId: string;
    retry: boolean;
    nextAttemptAt?: Date;
    code: string;
    detail: string;
  }): Promise<void> {
    await this.withSql(async (sql) => {
      await sql`
        update notification_deliveries
        set status = ${input.retry ? "retry" : "failed"},
            next_attempt_at = ${input.retry ? (input.nextAttemptAt ?? new Date()) : null},
            lease_owner = null, lease_expires_at = null,
            last_error_code = ${input.code}, last_error_detail = ${input.detail.slice(0, 500)}
        where id = ${input.id} and status = 'processing' and lease_owner = ${input.workerId}
      `;
    });
  }

  async markExpired(id: string, workerId: string): Promise<void> {
    await this.withSql(async (sql) => {
      await sql`
        update notification_deliveries
        set status = 'expired', next_attempt_at = null, lease_owner = null, lease_expires_at = null,
            last_error_code = 'MISSED_GRACE_EXPIRED',
            last_error_detail = 'The reminder was outside the configured missed-notification grace window.'
        where id = ${id} and status = 'processing' and lease_owner = ${workerId}
      `;
    });
  }

  isWithinGrace(scheduledFor: Date, now = new Date()): boolean {
    return withinGrace(scheduledFor, now, this.runtime.missedGraceHours);
  }
}
