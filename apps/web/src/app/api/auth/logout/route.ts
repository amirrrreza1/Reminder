import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function POST(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "private, no-store");
  // Overwrite with an expired cookie rather than only deleting, so the browser
  // drops it even if the delete is ignored for a mismatched attribute set.
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
