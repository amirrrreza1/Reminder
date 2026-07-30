import type { CurrencyCode } from "./types.js";

const MAX_MINOR = 9_999_999_999_999n;

export function parseMinorAmount(value: string): bigint {
  if (!/^\d+$/.test(value))
    throw new RangeError("Amount must be a non-negative integer minor-unit string.");
  const amount = BigInt(value);
  if (amount > MAX_MINOR) throw new RangeError("Amount exceeds the maximum supported value.");
  return amount;
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
