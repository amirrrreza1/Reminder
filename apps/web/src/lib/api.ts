import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getConfig } from "@reminder/config";
import {
  NotFoundError,
  NotificationRepository,
  ProviderUnavailableError,
  ReminderRepository,
  StaleWriteError,
} from "@reminder/db";

export function repository(): ReminderRepository {
  const config = getConfig();
  return new ReminderRepository(
    config.DATABASE_URL,
    config.APP_TIMEZONE,
    config.NOTIFICATION_SEND_TIME,
    { email: config.smtpConfigured, telegram: config.telegramConfigured },
    config.NOTIFICATION_MISSED_GRACE_HOURS,
  );
}

export function providerStatus() {
  const config = getConfig();
  return {
    email: {
      available: config.smtpConfigured,
      status: config.smtpConfigured ? "configured" : "not_configured",
    },
    telegram: {
      available: config.telegramConfigured,
      status: config.telegramConfigured ? "configured" : "not_configured",
    },
  } as const;
}

export function currencyConversionStatus() {
  const config = getConfig();
  return {
    available: config.nerkhConfigured,
    status: config.nerkhConfigured ? "configured" : "not_configured",
  } as const;
}

export function notificationRepository(): NotificationRepository {
  const config = getConfig();
  return new NotificationRepository(config.DATABASE_URL, {
    timeZone: config.APP_TIMEZONE,
    sendTime: config.NOTIFICATION_SEND_TIME,
    missedGraceHours: config.NOTIFICATION_MISSED_GRACE_HOURS,
    availability: { email: config.smtpConfigured, telegram: config.telegramConfigured },
  });
}

export function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join(".") || "body";
      (fields[path] ??= []).push(issue.message);
    }
    return noStore(
      NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request contains invalid fields.",
            fields,
            meta: null,
          },
        },
        { status: 400 },
      ),
    );
  }
  if (error instanceof NotFoundError)
    return noStore(
      NextResponse.json(
        { error: { code: "NOT_FOUND", message: error.message, meta: null } },
        { status: 404 },
      ),
    );
  if (error instanceof StaleWriteError)
    return noStore(
      NextResponse.json(
        {
          error: { code: "STALE_WRITE", message: error.message, meta: { current: error.current } },
        },
        { status: 409 },
      ),
    );
  if (error instanceof ProviderUnavailableError)
    return noStore(
      NextResponse.json(
        {
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: error.message,
            fields: { [`channels.${error.channel}`]: [error.message] },
            meta: null,
          },
        },
        { status: 409 },
      ),
    );
  if (error instanceof RangeError)
    return noStore(
      NextResponse.json(
        { error: { code: "SCHEDULE_UNCOMPUTABLE", message: error.message, meta: null } },
        { status: 422 },
      ),
    );
  return noStore(
    NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", meta: null } },
      { status: 500 },
    ),
  );
}

export async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new UnsupportedMediaTypeError();
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32_768) throw new PayloadTooLargeError();
  try {
    return await request.json();
  } catch {
    throw new InvalidJsonError();
  }
}

export class InvalidJsonError extends Error {}
export class UnsupportedMediaTypeError extends Error {}
export class PayloadTooLargeError extends Error {}

export function requestErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof InvalidJsonError)
    return noStore(
      NextResponse.json(
        {
          error: {
            code: "INVALID_JSON",
            message: "The request body is not valid JSON.",
            meta: null,
          },
        },
        { status: 400 },
      ),
    );
  if (error instanceof UnsupportedMediaTypeError)
    return noStore(
      NextResponse.json(
        {
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Requests must use application/json.",
            meta: null,
          },
        },
        { status: 415 },
      ),
    );
  if (error instanceof PayloadTooLargeError)
    return noStore(
      NextResponse.json(
        {
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "The request body is too large.",
            meta: null,
          },
        },
        { status: 413 },
      ),
    );
  return null;
}
