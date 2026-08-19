import { afterEach, describe, expect, it, vi } from "vitest";

import { NERKH_USD_URL, fetchUsdTomanRate, resetUsdTomanRateCache } from "./nerkh.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetUsdTomanRateCache();
});

describe("fetchUsdTomanRate", () => {
  it("sends the token as a Bearer Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { message: "Success", status: 200, prices: { current: "81088" } },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock;

    await expect(fetchUsdTomanRate("test-token")).resolves.toBe(81088n);
    expect(fetchMock).toHaveBeenCalledWith(
      NERKH_USD_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("reuses a fresh cached rate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { prices: { current: "81088" } },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock;

    await fetchUsdTomanRate("test-token", 1_000);
    await expect(fetchUsdTomanRate("test-token", 1_000 + 60_000)).resolves.toBe(81088n);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
