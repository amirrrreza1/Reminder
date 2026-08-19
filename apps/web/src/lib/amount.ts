export type Currency = "IRR" | "USD";

export function parseAmount(
  value: string,
  currency: Currency,
): { currency: Currency; minor: string } | null {
  const clean = value.trim().replaceAll(",", "").replaceAll(" ", "");
  if (!clean) return null;
  if (/[^0-9.]/.test(clean))
    throw new Error("Enter a non-negative amount with no currency symbol.");
  if ((clean.match(/\./g) ?? []).length > 1)
    throw new Error("Enter a non-negative amount with no currency symbol.");

  if (currency === "IRR") {
    if (clean.includes("."))
      throw new Error("IRR amounts must be a whole number, like 125000.");
    if (!/^\d+$/.test(clean))
      throw new Error("Enter a non-negative amount with no currency symbol.");
    if (BigInt(clean) > 9_999_999_999_999n)
      throw new Error("Amount exceeds the maximum supported value.");
    return { currency, minor: clean };
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(clean))
    throw new Error("USD amounts can have at most two decimal places, like 12.50.");
  const [whole = "", fraction = ""] = clean.split(".");
  const minor = `${whole}${fraction.padEnd(2, "0")}` || "0";
  if (BigInt(minor) > 9_999_999_999_999n)
    throw new Error("Amount exceeds the maximum supported value.");
  return { currency, minor };
}
