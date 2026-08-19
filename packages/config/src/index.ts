import { z } from "zod";

const booleanFromEnv = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");

const sendTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "NOTIFICATION_SEND_TIME must be HH:mm");

/** Refused outright, so a copied template can never become the live password. */
const PLACEHOLDER_PASSWORDS = new Set([
  "change_me",
  "change-me",
  "changeme",
  "change_me_login_password",
  "password",
]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.string().url(),
  APP_TIMEZONE: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NOTIFICATION_SEND_TIME: sendTimeSchema,
  NOTIFICATION_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  NOTIFICATION_MISSED_GRACE_HOURS: z.coerce.number().int().min(0).max(720).default(72),
  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  DATABASE_URL: z.string().min(1),
  // The single dashboard password. Required rather than optional so a deployment
  // can never start up silently unauthenticated.
  AUTH_PASSWORD: z
    .string()
    .min(8, "AUTH_PASSWORD must be at least 8 characters")
    .refine((value) => !PLACEHOLDER_PASSWORDS.has(value.toLowerCase()), {
      message: "AUTH_PASSWORD is still set to a placeholder value",
    }),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional().default(587),
  SMTP_SECURE: booleanFromEnv.optional().default(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  EMAIL_FROM: z.string().optional().default(""),
  EMAIL_TO: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
  // Optional. Live USD/IRR dashboard conversion. Empty keeps currency locked
  // to DEFAULT_CURRENCY. Get a token at https://nerkh.io/
  NERKH_API_TOKEN: z.string().optional().default(""),
  DEFAULT_CALENDAR_SYSTEM: z.enum(["gregorian", "jalali"]).default("jalali"),
  DEFAULT_CURRENCY: z.enum(["IRR", "USD"]).default("IRR"),
  DEFAULT_EMAIL_ENABLED: booleanFromEnv.default(false),
  DEFAULT_TELEGRAM_ENABLED: booleanFromEnv.default(false),
});

export type AppConfig = z.infer<typeof envSchema> & {
  smtpConfigured: boolean;
  telegramConfigured: boolean;
  nerkhConfigured: boolean;
};

function isSmtpConfigured(env: z.infer<typeof envSchema>): boolean {
  return Boolean(env.SMTP_HOST && env.EMAIL_FROM && env.EMAIL_TO);
}

function isTelegramConfigured(env: z.infer<typeof envSchema>): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

function assertValidTimezone(timezone: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new Error(`APP_TIMEZONE is not a valid IANA timezone: ${timezone}`);
  }
}

let cachedConfig: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }

  assertValidTimezone(parsed.data.APP_TIMEZONE);

  const smtpConfigured = isSmtpConfigured(parsed.data);
  const telegramConfigured = isTelegramConfigured(parsed.data);
  const nerkhConfigured = Boolean(parsed.data.NERKH_API_TOKEN.trim());

  return {
    ...parsed.data,
    DEFAULT_EMAIL_ENABLED: parsed.data.DEFAULT_EMAIL_ENABLED && smtpConfigured,
    DEFAULT_TELEGRAM_ENABLED: parsed.data.DEFAULT_TELEGRAM_ENABLED && telegramConfigured,
    smtpConfigured,
    telegramConfigured,
    nerkhConfigured,
  };
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = undefined;
}
