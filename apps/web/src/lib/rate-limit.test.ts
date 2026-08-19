import { beforeEach, describe, expect, it } from "vitest";

import {
  clientKey,
  recordFailure,
  recordSuccess,
  resetRateLimit,
  retryAfterSeconds,
} from "./rate-limit.js";

const CLIENT = "203.0.113.7";
const NOW = 1_760_000_000_000;

describe("rate limiting failed logins", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("allows attempts below the threshold", () => {
    for (let attempt = 0; attempt < 4; attempt += 1) recordFailure(CLIENT, NOW);
    expect(retryAfterSeconds(CLIENT, NOW)).toBe(0);
  });

  it("locks the client out on the fifth failure", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordFailure(CLIENT, NOW);
    expect(retryAfterSeconds(CLIENT, NOW)).toBeGreaterThan(0);
  });

  it("releases the lockout once it expires", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordFailure(CLIENT, NOW);
    const fifteenMinutesLater = NOW + 15 * 60 * 1000 + 1;
    expect(retryAfterSeconds(CLIENT, fifteenMinutesLater)).toBe(0);
  });

  it("does not punish a different client", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordFailure(CLIENT, NOW);
    expect(retryAfterSeconds("198.51.100.4", NOW)).toBe(0);
  });

  it("clears the client's failures after a success", () => {
    for (let attempt = 0; attempt < 4; attempt += 1) recordFailure(CLIENT, NOW);
    recordSuccess(CLIENT);
    recordFailure(CLIENT, NOW);
    expect(retryAfterSeconds(CLIENT, NOW)).toBe(0);
  });

  it("still throttles when the client key is rotated on every attempt", () => {
    // X-Forwarded-For is attacker-controlled, so the global backstop has to catch this.
    for (let attempt = 0; attempt < 20; attempt += 1) recordFailure(`10.0.0.${attempt}`, NOW);
    expect(retryAfterSeconds("10.0.0.200", NOW)).toBeGreaterThan(0);
  });

  it("resets the window when failures are spread far apart", () => {
    recordFailure(CLIENT, NOW);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      recordFailure(CLIENT, NOW + 20 * 60 * 1000);
    }
    expect(retryAfterSeconds(CLIENT, NOW + 20 * 60 * 1000)).toBe(0);
  });
});

describe("clientKey", () => {
  it("prefers the first X-Forwarded-For hop", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": " 203.0.113.7 , 10.0.0.1 " },
    });
    expect(clientKey(request)).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP and then a constant", () => {
    const withRealIp = new Request("http://localhost/api/auth/login", {
      headers: { "x-real-ip": "203.0.113.9" },
    });
    expect(clientKey(withRealIp)).toBe("203.0.113.9");
    expect(clientKey(new Request("http://localhost/api/auth/login"))).toBe("unknown");
  });
});
