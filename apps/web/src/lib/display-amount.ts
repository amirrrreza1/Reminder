import { getConfig } from "@reminder/config";
import { convertMinorAmount, type CurrencyCode } from "@reminder/domain";

import { repository } from "./api";
import { fetchUsdTomanRate } from "./nerkh";

export type MoneyAmount = { currency: CurrencyCode; minor: string };

export async function loadDisplayRate(): Promise<{
  displayCurrency: CurrencyCode;
  usdToman: bigint | null;
}> {
  const config = getConfig();
  const settings = await repository().getSettings();
  const displayCurrency = config.nerkhConfigured
    ? settings.defaultCurrency
    : config.DEFAULT_CURRENCY;
  if (!config.nerkhConfigured) return { displayCurrency, usdToman: null };
  try {
    return {
      displayCurrency,
      usdToman: await fetchUsdTomanRate(config.NERKH_API_TOKEN),
    };
  } catch {
    return { displayCurrency, usdToman: null };
  }
}

export function toDisplayAmount(
  amount: MoneyAmount | null,
  displayCurrency: CurrencyCode,
  usdToman: bigint | null,
): MoneyAmount | null {
  if (!amount) return null;
  if (!usdToman || amount.currency === displayCurrency) return amount;
  return {
    currency: displayCurrency,
    minor: convertMinorAmount(
      BigInt(amount.minor),
      amount.currency,
      displayCurrency,
      usdToman,
    ).toString(),
  };
}

export function sumDisplayAmount(
  amounts: Array<MoneyAmount | null | undefined>,
  displayCurrency: CurrencyCode,
  usdToman: bigint | null,
): MoneyAmount {
  let total = 0n;
  for (const amount of amounts) {
    if (!amount) continue;
    if (usdToman) {
      total += convertMinorAmount(
        BigInt(amount.minor),
        amount.currency,
        displayCurrency,
        usdToman,
      );
    } else if (amount.currency === displayCurrency) {
      total += BigInt(amount.minor);
    }
  }
  return { currency: displayCurrency, minor: total.toString() };
}
