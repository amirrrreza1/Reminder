import { hostname } from "node:os";

import { getConfig } from "@reminder/config";
import { createSql, NotificationRepository, type ClaimedDelivery } from "@reminder/db";
import { formatMoney } from "@reminder/domain";
import {
  isProviderError,
  NotificationProviderError,
  retryDelayMs,
  SmtpNotificationProvider,
  TelegramNotificationProvider,
  type NotificationMessage,
  type NotificationProvider,
} from "@reminder/notifications";

const WORKER_ID = process.env.HOSTNAME ?? hostname();
const SEND_CONCURRENCY = 3;

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, workerId: WORKER_ID, ...fields }));
}

function logError(event: string, fields: Record<string, unknown> = {}): void {
  // Never serialize Error objects: provider errors can carry credential-bearing URLs or response bodies.
  console.error(JSON.stringify({ level: "error", event, workerId: WORKER_ID, ...fields }));
}

async function writeHeartbeat(databaseUrl: string): Promise<void> {
  const sql = await createSql(databaseUrl);
  try {
    await sql`
      insert into worker_heartbeats (worker_id, role, started_at, last_seen_at, updated_at)
      values (${WORKER_ID}, 'scheduler_delivery', now(), now(), now())
      on conflict (worker_id)
      do update set last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function messageFor(delivery: ClaimedDelivery): NotificationMessage {
  if (delivery.kind === "provider_test") {
    return {
      reminderId: delivery.id,
      title: "Reminder provider test",
      body: "This is a test message from Reminder. Your provider configuration can send notifications.",
    };
  }

  const type = (delivery.customTypeLabel ?? delivery.type ?? "Reminder").replaceAll("_", " ");
  const occurrence = formatOccurrence(delivery.occurrenceDate, delivery.recurrenceCalendar);
  const lead =
    delivery.remindBeforeDays === 0
      ? "on the occurrence day"
      : `${delivery.remindBeforeDays} days before`;
  const amount =
    delivery.amountMinor !== null && delivery.currency !== null
      ? `\nAmount: ${formatMoney(delivery.amountMinor, delivery.currency)}`
      : "";
  const description = delivery.description ? `\n\n${delivery.description}` : "";
  return {
    reminderId: delivery.id,
    title: `Reminder: ${delivery.title ?? "Reminder"}`,
    body: `${type}\nOccurrence: ${occurrence}\nNotification: ${lead}${amount}${description}`,
  };
}

function formatOccurrence(
  occurrenceDate: string | null,
  calendar: ClaimedDelivery["recurrenceCalendar"],
): string {
  if (!occurrenceDate) return "Unknown date";
  const date = new Date(`${occurrenceDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return occurrenceDate;
  return new Intl.DateTimeFormat("en-US", {
    calendar: calendar === "jalali" ? "persian" : "gregory",
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function providerFailure(error: unknown): NotificationProviderError {
  if (isProviderError(error)) return error;
  return new NotificationProviderError(
    "unknown",
    "PROVIDER_UNKNOWN_ERROR",
    "The provider could not send the notification.",
    true,
  );
}

async function mapConcurrent<T>(
  values: readonly T[],
  limit: number,
  work: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runner = async () => {
    while (true) {
      const current = next;
      next += 1;
      if (current >= values.length) return;
      const value = values[current];
      if (value) await work(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, runner));
}

async function main(): Promise<void> {
  const config = getConfig();
  const providers: Record<"email" | "telegram", NotificationProvider> = {
    email: new SmtpNotificationProvider({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      user: config.SMTP_USER,
      password: config.SMTP_PASSWORD,
      from: config.EMAIL_FROM,
      to: config.EMAIL_TO,
    }),
    telegram: new TelegramNotificationProvider({
      botToken: config.TELEGRAM_BOT_TOKEN,
      chatId: config.TELEGRAM_CHAT_ID,
    }),
  };
  const queue = new NotificationRepository(config.DATABASE_URL, {
    timeZone: config.APP_TIMEZONE,
    sendTime: config.NOTIFICATION_SEND_TIME,
    missedGraceHours: config.NOTIFICATION_MISSED_GRACE_HOURS,
    availability: { email: config.smtpConfigured, telegram: config.telegramConfigured },
  });

  let shuttingDown = false;
  let running: Promise<void> | undefined;

  const processDelivery = async (delivery: ClaimedDelivery): Promise<void> => {
    if (delivery.kind === "occurrence" && !queue.isWithinGrace(delivery.scheduledFor)) {
      await queue.markExpired(delivery.id, WORKER_ID);
      log("notification.expired", { deliveryId: delivery.id, channel: delivery.channel });
      return;
    }
    const provider = providers[delivery.channel];
    if (!provider.readiness().configured) {
      await queue.markFailure({
        id: delivery.id,
        workerId: WORKER_ID,
        retry: false,
        code: "PROVIDER_NOT_CONFIGURED",
        detail: `${delivery.channel} is not configured by the server.`,
      });
      logError("notification.failed", {
        deliveryId: delivery.id,
        channel: delivery.channel,
        code: "PROVIDER_NOT_CONFIGURED",
      });
      return;
    }
    try {
      const receipt = await provider.send(messageFor(delivery));
      await queue.markSent(delivery.id, WORKER_ID, receipt);
      log(delivery.kind === "provider_test" ? "provider.test_succeeded" : "notification.sent", {
        deliveryId: delivery.id,
        channel: delivery.channel,
      });
    } catch (error) {
      const failure = providerFailure(error);
      const canRetry =
        failure.retryable &&
        delivery.attemptCount < config.NOTIFICATION_MAX_ATTEMPTS &&
        (delivery.kind === "provider_test" || queue.isWithinGrace(delivery.scheduledFor));
      await queue.markFailure({
        id: delivery.id,
        workerId: WORKER_ID,
        retry: canRetry,
        ...(canRetry
          ? {
              nextAttemptAt: new Date(
                Date.now() + retryDelayMs(delivery.attemptCount, Math.random, failure.retryAfterMs),
              ),
            }
          : {}),
        code: failure.code,
        detail: failure.message,
      });
      logError(canRetry ? "notification.retry_scheduled" : "notification.failed", {
        deliveryId: delivery.id,
        channel: delivery.channel,
        code: failure.code,
      });
    }
  };

  const tick = async (): Promise<void> => {
    if (shuttingDown) return;
    const schedule = await queue.schedule();
    const claimed = await queue.claim(WORKER_ID);
    await mapConcurrent(claimed, SEND_CONCURRENCY, processDelivery);
    await writeHeartbeat(config.DATABASE_URL);
    log("worker.heartbeat", {
      scheduled: schedule.scheduled,
      advanced: schedule.advanced,
      claimed: claimed.length,
    });
  };

  const startTick = (): void => {
    if (shuttingDown || running) return;
    running = tick()
      .catch(() => logError("worker.tick_failed", { code: "WORKER_TICK_FAILED" }))
      .finally(() => {
        running = undefined;
      });
  };

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("worker.shutdown_started", { signal });
    clearInterval(timer);
    if (running)
      await Promise.race([running, new Promise((resolve) => setTimeout(resolve, 30_000))]);
    await Promise.all(Object.values(providers).map((provider) => provider.close?.()));
    log("worker.shutdown_completed");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("app.started", { pollIntervalSeconds: config.NOTIFICATION_POLL_INTERVAL_SECONDS });
  startTick();
  const timer = setInterval(startTick, config.NOTIFICATION_POLL_INTERVAL_SECONDS * 1000);
}

main().catch(() => {
  logError("app.config_invalid", { code: "INVALID_CONFIGURATION" });
  process.exit(1);
});
