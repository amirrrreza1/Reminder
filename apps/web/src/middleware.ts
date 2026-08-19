import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, authPassword, verifySessionToken } from "@/lib/auth";

/**
 * Fail-closed gate for the whole app. Doing this in middleware rather than in each
 * page and route handler means a new route is protected the moment it is added —
 * forgetting a guard cannot silently expose data.
 */

/** Public because the container healthcheck and any external monitor must reach them unauthenticated. */
const PUBLIC_PREFIXES = ["/api/health/"];

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/favicon.ico",
  "/icon.png",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function unauthorized(): NextResponse {
  const response = NextResponse.json(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication is required.",
        meta: null,
      },
    },
    { status: 401 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isApiRequest = pathname.startsWith("/api/");
  const password = authPassword();

  // No password configured means the app cannot be secured, so it serves nothing
  // rather than defaulting to open access.
  if (password.length === 0) {
    if (isApiRequest && !isPublic(pathname)) {
      const response = NextResponse.json(
        {
          error: {
            code: "AUTH_NOT_CONFIGURED",
            message: "AUTH_PASSWORD is not set on the server.",
            meta: null,
          },
        },
        { status: 503 },
      );
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (!isPublic(pathname) || pathname === "/login" || pathname === "/api/auth/login") {
      return new NextResponse("AUTH_PASSWORD is not set. Add it to .env and restart the server.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.next();
  }

  const authenticated = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
    password,
  );

  // Someone already signed in has no reason to see the form again.
  if (pathname === "/login") {
    if (!authenticated) return NextResponse.next();
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    return NextResponse.redirect(target);
  }

  if (isPublic(pathname) || authenticated) return NextResponse.next();
  if (isApiRequest) return unauthorized();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  // Preserve where they were headed so a bookmarked deep link survives the detour.
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // All of `_next/` and the dev-overlay endpoints are excluded: they serve build
  // assets and tooling, never application data. Client-side navigations request the
  // page URL itself (with an `_rsc` query parameter), so RSC payloads are still
  // matched and still gated.
  matcher: ["/((?!_next/|__nextjs).*)"],
};
