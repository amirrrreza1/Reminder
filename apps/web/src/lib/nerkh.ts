import { parseUsdTomanRate } from "@reminder/domain";

export const NERKH_USD_URL = "https://api.nerkh.io/v1/prices/json/currency/USD";

const CACHE_MS = 5 * 60 * 1000;

let cache: { value: bigint; expiresAt: number } | undefined;

export function resetUsdTomanRateCache(): void {
  cache = undefined;
}

export async function fetchUsdTomanRate(
  token: string,
  now = Date.now(),
): Promise<bigint> {
  if (!token) throw new Error("Nerkh API token is not configured.");
  if (cache && cache.expiresAt > now) return cache.value;

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    const response = await fetch(NERKH_USD_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: abort.signal,
    });
    if (!response.ok) throw new Error("Nerkh USD rate request failed.");
    const value = parseUsdTomanRate(await response.json());
    cache = { value, expiresAt: now + CACHE_MS };
    return value;
  } finally {
    clearTimeout(timeout);
  }
}
