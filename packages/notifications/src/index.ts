import type { Transporter } from "nodemailer";

export type NotificationChannel = "email" | "telegram";

export type ProviderReadiness = {
  channel: NotificationChannel;
  configured: boolean;
  reason?: string;
};

export type NotificationMessage = {
  reminderId: string;
  title: string;
  body: string;
};

export type ProviderReceipt = {
  providerMessageId?: string;
  acceptedAt: string;
};

export type ProviderFailureCategory =
  "configuration" | "authentication" | "recipient" | "rate_limited" | "network" | "unknown";

/** A redacted provider error which is safe to store and return to the settings UI. */
export class NotificationProviderError extends Error {
  constructor(
    readonly category: ProviderFailureCategory,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "NotificationProviderError";
  }
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  readiness(): ProviderReadiness;
  send(message: NotificationMessage): Promise<ProviderReceipt>;
  close?(): Promise<void> | void;
}

const retryDelaysMs = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000] as const;

/**
 * Calculates a bounded exponential retry delay. `attemptCount` is the number
 * of sends already attempted, so a first failure waits roughly one minute.
 */
export function retryDelayMs(
  attemptCount: number,
  random: () => number = Math.random,
  retryAfterMs?: number,
): number {
  const index = Math.max(0, Math.min(retryDelaysMs.length - 1, attemptCount - 1));
  const base = retryDelaysMs[index] ?? 28_800_000;
  const jittered = Math.round(base * (0.8 + Math.max(0, Math.min(1, random())) * 0.4));
  return Math.max(jittered, retryAfterMs ?? 0);
}

export function isProviderError(error: unknown): error is NotificationProviderError {
  return error instanceof NotificationProviderError;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&#39;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}

function safeSubject(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
}

export type SmtpProviderOptions = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  to: string;
};

function smtpFailure(error: unknown): NotificationProviderError {
  const code =
    typeof error === "object" && error && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const responseCode =
    typeof error === "object" &&
    error &&
    "responseCode" in error &&
    typeof error.responseCode === "number"
      ? error.responseCode
      : 0;

  if (["EAUTH", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code) || responseCode === 535)
    return new NotificationProviderError(
      "authentication",
      "PROVIDER_AUTH_FAILED",
      "Email authentication failed. Check the server environment.",
      false,
    );
  if (responseCode >= 400 && responseCode < 500)
    return new NotificationProviderError(
      "recipient",
      "PROVIDER_RECIPIENT_REJECTED",
      "The email provider rejected the configured recipient.",
      false,
    );
  if (responseCode >= 500 && responseCode < 600)
    return new NotificationProviderError(
      "network",
      "PROVIDER_SMTP_UNAVAILABLE",
      "The email provider is temporarily unavailable.",
      true,
    );
  return new NotificationProviderError(
    "network",
    "PROVIDER_NETWORK_ERROR",
    "The email provider could not be reached.",
    true,
  );
}

export class SmtpNotificationProvider implements NotificationProvider {
  readonly channel = "email" as const;
  private transport: Transporter | undefined;

  constructor(private readonly options: SmtpProviderOptions) {}

  readiness(): ProviderReadiness {
    const configured = Boolean(this.options.host && this.options.from && this.options.to);
    return {
      channel: this.channel,
      configured,
      ...(configured ? {} : { reason: "Email is not configured by the server." }),
    };
  }

  private async getTransport(): Promise<Transporter> {
    if (this.transport) return this.transport;
    const nodemailer = await import("nodemailer");
    this.transport = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      pool: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      ...(this.options.user
        ? { auth: { user: this.options.user, pass: this.options.password ?? "" } }
        : {}),
    });
    return this.transport;
  }

  async send(message: NotificationMessage): Promise<ProviderReceipt> {
    if (!this.readiness().configured)
      throw new NotificationProviderError(
        "configuration",
        "PROVIDER_NOT_CONFIGURED",
        "Email is not configured by the server.",
        false,
      );
    try {
      const result = await (
        await this.getTransport()
      ).sendMail({
        from: this.options.from,
        to: this.options.to,
        subject: safeSubject(message.title),
        text: message.body,
        html: `<div style="white-space:pre-wrap">${escapeHtml(message.body)}</div>`,
      });
      return {
        ...(result.messageId ? { providerMessageId: result.messageId } : {}),
        acceptedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw smtpFailure(error);
    }
  }

  close(): void {
    this.transport?.close();
  }
}

export type TelegramProviderOptions = {
  botToken: string;
  chatId: string;
};

function telegramFailure(status: number, retryAfterMs?: number): NotificationProviderError {
  if (status === 401 || status === 403)
    return new NotificationProviderError(
      "authentication",
      "PROVIDER_AUTH_FAILED",
      "Telegram rejected the configured bot credentials. Check the server environment.",
      false,
    );
  if (status === 400)
    return new NotificationProviderError(
      "recipient",
      "PROVIDER_RECIPIENT_REJECTED",
      "Telegram rejected the configured recipient.",
      false,
    );
  if (status === 429)
    return new NotificationProviderError(
      "rate_limited",
      "PROVIDER_RATE_LIMITED",
      "Telegram is rate limiting requests. The message will be retried.",
      true,
      retryAfterMs,
    );
  if (status >= 500)
    return new NotificationProviderError(
      "network",
      "PROVIDER_TELEGRAM_UNAVAILABLE",
      "Telegram is temporarily unavailable.",
      true,
    );
  return new NotificationProviderError(
    "unknown",
    "PROVIDER_TELEGRAM_REJECTED",
    "Telegram rejected the message.",
    false,
  );
}

export class TelegramNotificationProvider implements NotificationProvider {
  readonly channel = "telegram" as const;

  constructor(private readonly options: TelegramProviderOptions) {}

  readiness(): ProviderReadiness {
    const configured = Boolean(this.options.botToken && this.options.chatId);
    return {
      channel: this.channel,
      configured,
      ...(configured ? {} : { reason: "Telegram is not configured by the server." }),
    };
  }

  async send(message: NotificationMessage): Promise<ProviderReceipt> {
    if (!this.readiness().configured)
      throw new NotificationProviderError(
        "configuration",
        "PROVIDER_NOT_CONFIGURED",
        "Telegram is not configured by the server.",
        false,
      );

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10_000);
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.options.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: this.options.chatId,
            text: `<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.body)}`,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          }),
          signal: abort.signal,
        },
      );
      const retryAfter = Number(response.headers.get("retry-after"));
      if (!response.ok)
        throw telegramFailure(
          response.status,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        );

      const payload: unknown = await response.json().catch(() => null);
      const messageId =
        typeof payload === "object" &&
        payload &&
        "result" in payload &&
        typeof payload.result === "object" &&
        payload.result &&
        "message_id" in payload.result &&
        typeof payload.result.message_id === "number"
          ? String(payload.result.message_id)
          : undefined;
      return {
        ...(messageId ? { providerMessageId: messageId } : {}),
        acceptedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (isProviderError(error)) throw error;
      throw new NotificationProviderError(
        "network",
        "PROVIDER_NETWORK_ERROR",
        "Telegram could not be reached.",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
