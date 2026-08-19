/**
 * Session handling for the single-password login.
 *
 * Everything here uses only Web Crypto and standard globals so the exact same
 * module can run in `middleware.ts` (edge runtime), in route handlers, and under
 * vitest in Node. Reaching for `node:crypto` or `Buffer` would break the
 * middleware, which is the one place that must not be bypassable.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE_NAME = "reminder_session";

const TOKEN_VERSION = "v1";
const KEY_CONTEXT = "reminder.session.hmac.v1";

/**
 * The cookie itself is a session cookie, so a browser drops it on quit. This is
 * a server-side backstop for the case where a token is copied out of a browser
 * that is never closed: past this age the signature is refused regardless.
 */
const MAX_TOKEN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Tolerance for a client clock running slightly ahead of the server's. */
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * Read AUTH_PASSWORD without letting the bundler inline it.
 *
 * Webpack's DefinePlugin rewrites literal `process.env.AUTH_PASSWORD` member
 * expressions at build time. The Docker image is built with no `.env` present
 * and receives its environment at container start, so an inlined value would be
 * baked in as `undefined` and no password would ever match. A computed key
 * cannot be statically replaced, which forces a genuine runtime lookup.
 */
export function authPassword(): string {
  const key = "AUTH_PASSWORD";
  return process.env[key] ?? "";
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array | null {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/**
 * Compare two secrets without leaking a match prefix through timing. Both sides
 * are hashed first so the comparison always runs over 32 bytes and the length of
 * the submitted password never shows up in the response time either.
 */
export async function secretsMatch(candidate: string, expected: string): Promise<boolean> {
  if (expected.length === 0) return false;
  const [candidateDigest, expectedDigest] = await Promise.all([
    sha256(candidate),
    sha256(expected),
  ]);
  return constantTimeEqual(candidateDigest, expectedDigest);
}

/**
 * Signing keys are derived from the password rather than from a separate secret.
 * That keeps the setup to one env var and means changing AUTH_PASSWORD
 * immediately invalidates every session that was issued under the old one.
 */
const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(password: string): Promise<CryptoKey> {
  const cached = keyCache.get(password);
  if (cached) return cached;
  const pending = (async () => {
    const material = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`${KEY_CONTEXT}:${password}`),
    );
    return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
  })();
  keyCache.set(password, pending);
  return pending;
}

async function sign(payload: string, password: string): Promise<Uint8Array> {
  const key = await signingKey(password);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function createSessionToken(password: string, issuedAt = Date.now()): Promise<string> {
  const payload = `${TOKEN_VERSION}.${issuedAt}`;
  return `${payload}.${base64UrlEncode(await sign(payload, password))}`;
}

export async function verifySessionToken(
  token: string | undefined,
  password: string,
  now = Date.now(),
): Promise<boolean> {
  if (!token || password.length === 0) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, issuedAtText, signature] = parts as [string, string, string];
  if (version !== TOKEN_VERSION) return false;

  const issuedAt = Number(issuedAtText);
  if (!Number.isSafeInteger(issuedAt)) return false;
  if (issuedAt > now + CLOCK_SKEW_MS) return false;
  if (now - issuedAt > MAX_TOKEN_AGE_MS) return false;

  const provided = base64UrlDecode(signature);
  if (!provided) return false;

  // Signature verification happens last so a malformed token never reaches the
  // HMAC, but it is still the only thing that can accept a token.
  return constantTimeEqual(provided, await sign(`${version}.${issuedAtText}`, password));
}

/**
 * `secure` is derived from APP_BASE_URL rather than NODE_ENV: a self-hosted
 * instance is often production-mode behind plain http on the LAN, and a Secure
 * cookie would be silently dropped there, making login appear to do nothing.
 */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  path: string;
  secure: boolean;
} {
  const baseUrlKey = "APP_BASE_URL";
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: (process.env[baseUrlKey] ?? "").startsWith("https://"),
  };
}

/**
 * Only same-origin absolute paths are allowed back out of the `next` query
 * parameter, so a crafted login link cannot bounce someone to another host.
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.startsWith("/login")) return "/";
  return value;
}
