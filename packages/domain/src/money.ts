import type { CurrencyCode } from "./types.js";

const MAX_MINOR = 9_999_999_999_999n;

export function parseMinorAmount(value: string): bigint {
  if (!/^\d+$/.test(value))
    throw new RangeError("Amount must be a non-negative integer minor-unit string.");
  const amount = BigInt(value);
  if (amount > MAX_MINOR) throw new RangeError("Amount exceeds the maximum supported value.");
  return amount;
}

/**
 * Nerkh quotes 1 USD in Iranian toman. Reminder stores IRR (rial);
 * 1 toman is 10 rial. `usdToman` is therefore toman per 1 USD major unit.
 */
export function convertMinorAmount(
  minor: bigint,
  from: CurrencyCode,
  to: CurrencyCode,
  usdToman: bigint,
): bigint {
  if (from === to) return minor;
  if (minor < 0n || minor > MAX_MINOR)
    throw new RangeError("Amount is outside the supported range.");
  if (usdToman <= 0n) throw new RangeError("USD rate must be a positive toman amount.");

  const converted =
    from === "USD"
      ? divRoundNearest(minor * usdToman, 10n)
      : divRoundNearest(minor * 10n, usdToman);
  return converted > MAX_MINOR ? MAX_MINOR : converted;
}

export function parseUsdTomanRate(payload: unknown): bigint {
  const prices = readPrices(payload);
  const current =
    readCurrent(prices) ??
    (typeof prices === "object" && prices && "USD" in prices
      ? readCurrent(prices.USD)
      : undefined);
  if (!current) throw new RangeError("Nerkh USD rate is missing.");
  return current;
}

function readPrices(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || !("data" in payload))
    throw new RangeError("Nerkh response is missing data.");
  const data = payload.data;
  if (typeof data !== "object" || data === null || !("prices" in data))
    throw new RangeError("Nerkh response is missing prices.");
  return data.prices;
}

function readCurrent(value: unknown): bigint | undefined {
  if (typeof value !== "object" || value === null || !("current" in value)) return undefined;
  const current = value.current;
  if (typeof current === "string" && /^\d+$/.test(current) && current !== "0")
    return BigInt(current);
  if (typeof current === "number" && Number.isInteger(current) && current > 0)
    return BigInt(current);
  return undefined;
}

function divRoundNearest(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function formatMoney(minor: bigint, currency: CurrencyCode, locale = "en-US"): string {
  if (minor < 0n || minor > MAX_MINOR)
    throw new RangeError("Amount is outside the supported range.");
  const fractionDigits = currency === "USD" ? 2 : 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(minor) / 10 ** fractionDigits);
}

export const MAX_AMOUNT_MINOR = MAX_MINOR;
