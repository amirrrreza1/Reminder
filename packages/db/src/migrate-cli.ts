import { loadConfig } from "@reminder/config";

import { ensureSettings, runMigrations } from "./index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const result = await runMigrations(config.DATABASE_URL);
  await ensureSettings(config.DATABASE_URL, {
    calendarSystem: config.DEFAULT_CALENDAR_SYSTEM,
    defaultCurrency: config.DEFAULT_CURRENCY,
    emailEnabled: config.DEFAULT_EMAIL_ENABLED,
    telegramEnabled: config.DEFAULT_TELEGRAM_ENABLED,
  });
  console.log(
    JSON.stringify({
      level: "info",
      event: "db.migration_completed",
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Migration failed";
  console.error(
    JSON.stringify({
      level: "error",
      event: "db.migration_failed",
      message,
    }),
  );
  process.exitCode = 1;
});
