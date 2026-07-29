/**
 * Allowlisted client projection. Never include secrets or connection strings.
 */
export type ClientConfig = {
  smtpConfigured: boolean;
  telegramConfigured: boolean;
  defaultCalendarSystem: "gregorian" | "jalali";
  defaultCurrency: "IRR" | "USD";
};

export function toClientConfig(input: {
  smtpConfigured: boolean;
  telegramConfigured: boolean;
  DEFAULT_CALENDAR_SYSTEM: "gregorian" | "jalali";
  DEFAULT_CURRENCY: "IRR" | "USD";
}): ClientConfig {
  return {
    smtpConfigured: input.smtpConfigured,
    telegramConfigured: input.telegramConfigured,
    defaultCalendarSystem: input.DEFAULT_CALENDAR_SYSTEM,
    defaultCurrency: input.DEFAULT_CURRENCY,
  };
}
