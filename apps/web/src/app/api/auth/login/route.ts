import { NextResponse } from "next/server";
import { z } from "zod";

import {
  SESSION_COOKIE_NAME,
  authPassword,
  createSessionToken,
  secretsMatch,
  sessionCookieOptions,
} from "@/lib/auth";
import { clientKey, recordFailure, recordSuccess, retryAfterSeconds } from "@/lib/rate-limit";

// Nothing here touches the database on purpose: signing in has to work even when
// Postgres is down, otherwise a database outage locks you out of the dashboard
// that would tell you about it.
export const dynamic = "force-dynamic";

const loginSchema = z.object({ password: z.string().min(1).max(512) });

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function failure(code: string, message: string, status: number): NextResponse {
  return noStore(NextResponse.json({ error: { code, message, meta: null } }, { status }));
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = authPassword();
  if (expected.length === 0) {
    return failure("AUTH_NOT_CONFIGURED", "AUTH_PASSWORD is not set on the server.", 503);
  }

  const client = clientKey(request);
  const retryAfter = retryAfterSeconds(client);
  if (retryAfter > 0) {
    const response = failure(
      "TOO_MANY_ATTEMPTS",
      "Too many failed attempts. Try again later.",
      429,
    );
    response.headers.set("Retry-After", String(retryAfter));
    return response;
  }

  let password: string;
  try {
    password = loginSchema.parse(await request.json()).password;
  } catch {
    return failure("VALIDATION_ERROR", "A password is required.", 400);
  }

  if (!(await secretsMatch(password, expected))) {
    recordFailure(client);
    // Same generic message either way — there is only one account, so there is
    // nothing to enumerate, but it keeps the response shape uniform.
    return failure("INVALID_CREDENTIALS", "That password is incorrect.", 401);
  }

  recordSuccess(client);

  const response = noStore(NextResponse.json({ ok: true }));
  // No maxAge or expires: this is a session cookie, so closing the browser ends
  // the session, which is what the deployment asked for.
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: await createSessionToken(expected),
    ...sessionCookieOptions(),
  });
  return response;
}
