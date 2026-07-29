import { describe, expect, it } from "vitest";

import { loadConfig, resetConfigCache } from "./index.js";

const baseEnv = {
  NODE_ENV: "test",
  APP_PORT: "3000",
  APP_BASE_URL: "http://localhost:3000",
  APP_TIMEZONE: "Asia/Tehran",
  NOTIFICATION_SEND_TIME: "09:00",
  NOTIFICATION_POLL_INTERVAL_SECONDS: "60",
  NOTIFICATION_MISSED_GRACE_HOURS: "72",
  NOTIFICATION_MAX_ATTEMPTS: "5",
  DATABASE_URL: "postgresql://reminder:secret@localhost:5432/reminder",
  DEFAULT_CALENDAR_SYSTEM: "jalali",
  DEFAULT_CURRENCY: "IRR",
  DEFAULT_EMAIL_ENABLED: "false",
  DEFAULT_TELEGRAM_ENABLED: "false",
} as const;

describe("loadConfig", () => {
  it("parses required values and marks providers unavailable when empty", () => {
    resetConfigCache();
    const config = loadConfig({ ...baseEnv });
    expect(config.APP_TIMEZONE).toBe("Asia/Tehran");
    expect(config.smtpConfigured).toBe(false);
    expect(config.telegramConfigured).toBe(false);
  });

  it("rejects an invalid timezone", () => {
    resetConfigCache();
    expect(() => loadConfig({ ...baseEnv, APP_TIMEZONE: "Not/AZone" })).toThrow(/APP_TIMEZONE/);
  });
});
