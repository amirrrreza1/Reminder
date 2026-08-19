import { getConfig } from "@reminder/config";
import { updateSettingsSchema } from "@reminder/domain";

import {
  currencyConversionStatus,
  errorResponse,
  jsonBody,
  noStore,
  providerStatus,
  repository,
  requestErrorResponse,
} from "@/lib/api";

export const dynamic = "force-dynamic";

function presentSettings<T extends { defaultCurrency: "IRR" | "USD" }>(settings: T) {
  const config = getConfig();
  return {
    ...settings,
    defaultCurrency: config.nerkhConfigured
      ? settings.defaultCurrency
      : config.DEFAULT_CURRENCY,
    providers: providerStatus(),
    currencyConversion: currencyConversionStatus(),
  };
}

export async function GET() {
  try {
    return noStore(Response.json(presentSettings(await repository().getSettings())));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = updateSettingsSchema.parse(await jsonBody(request));
    const { expectedUpdatedAt, ...settings } = input;
    const config = getConfig();
    return noStore(
      Response.json(
        presentSettings(
          await repository().updateSettings({
            ...settings,
            defaultCurrency: config.nerkhConfigured
              ? settings.defaultCurrency
              : config.DEFAULT_CURRENCY,
            updatedAt: expectedUpdatedAt,
            expectedUpdatedAt,
          }),
        ),
      ),
    );
  } catch (error) {
    return requestErrorResponse(error) ?? errorResponse(error);
  }
}
