/**
 * Throttle for failed login attempts.
 *
 * Deliberately in-memory: the app is a single web container with no Redis, and a
 * process restart clearing the counters is an acceptable trade for zero new
 * infrastructure. The goal is to make online password guessing impractical, not to
 * be a distributed rate limiter.
 *
 * Two counters run together. The per-client one keeps one noisy source from
 * locking out everyone else, and the global one is the backstop for the fact that
 * `X-Forwarded-For` is attacker-controlled unless a trusted proxy rewrites it —
 * rotating that header defeats the per-client counter but not this one.
 */

const CLIENT_MAX_FAILURES = 5;
const CLIENT_WINDOW_MS = 15 * 60 * 1000;
const CLIENT_LOCKOUT_MS = 15 * 60 * 1000;

const GLOBAL_MAX_FAILURES = 20;
const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_LOCKOUT_MS = 5 * 60 * 1000;

/** Bounds memory so spoofed client keys cannot grow the map without limit. */
const MAX_TRACKED_CLIENTS = 1024;

type Attempts = { failures: number; windowStartedAt: number; blockedUntil: number };

const attemptsByClient = new Map<string, Attempts>();
const global: Attempts = { failures: 0, windowStartedAt: 0, blockedUntil: 0 };

function prune(now: number): void {
  for (const [client, attempts] of attemptsByClient) {
    const stale = now - attempts.windowStartedAt > CLIENT_WINDOW_MS;
    if (stale && attempts.blockedUntil <= now) attemptsByClient.delete(client);
  }
  if (attemptsByClient.size <= MAX_TRACKED_CLIENTS) return;
  // Map iterates in insertion order, so this drops the oldest entries first.
  let toDrop = attemptsByClient.size - MAX_TRACKED_CLIENTS;
  for (const client of attemptsByClient.keys()) {
    if (toDrop <= 0) break;
    attemptsByClient.delete(client);
    toDrop -= 1;
  }
}

function registerFailure(
  attempts: Attempts,
  now: number,
  maxFailures: number,
  windowMs: number,
  lockoutMs: number,
): void {
  if (now - attempts.windowStartedAt > windowMs) {
    attempts.failures = 1;
    attempts.windowStartedAt = now;
    return;
  }
  attempts.failures += 1;
  if (attempts.failures < maxFailures) return;
  attempts.blockedUntil = now + lockoutMs;
  attempts.failures = 0;
  attempts.windowStartedAt = now;
}

function remainingSeconds(blockedUntil: number, now: number): number {
  return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : 0;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

/** Seconds the caller must wait, or 0 when the attempt may proceed. */
export function retryAfterSeconds(client: string, now = Date.now()): number {
  prune(now);
  const clientWait = remainingSeconds(attemptsByClient.get(client)?.blockedUntil ?? 0, now);
  return Math.max(clientWait, remainingSeconds(global.blockedUntil, now));
}

export function recordFailure(client: string, now = Date.now()): void {
  const existing = attemptsByClient.get(client);
  if (existing) {
    registerFailure(existing, now, CLIENT_MAX_FAILURES, CLIENT_WINDOW_MS, CLIENT_LOCKOUT_MS);
  } else {
    attemptsByClient.set(client, { failures: 1, windowStartedAt: now, blockedUntil: 0 });
  }
  registerFailure(global, now, GLOBAL_MAX_FAILURES, GLOBAL_WINDOW_MS, GLOBAL_LOCKOUT_MS);
}

export function recordSuccess(client: string): void {
  attemptsByClient.delete(client);
}

/** Test-only reset; these counters are module state that would leak between cases. */
export function resetRateLimit(): void {
  attemptsByClient.clear();
  global.failures = 0;
  global.windowStartedAt = 0;
  global.blockedUntil = 0;
}
