import { updateSettingsSchema } from "@reminder/domain";

import {
  errorResponse,
  jsonBody,
  noStore,
  providerStatus,
  repository,
  requestErrorResponse,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return noStore(
      Response.json({ ...(await repository().getSettings()), providers: providerStatus() }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = updateSettingsSchema.parse(await jsonBody(request));
    const { expectedUpdatedAt, ...settings } = input;
    return noStore(
      Response.json({
        ...(await repository().updateSettings({
          ...settings,
          updatedAt: expectedUpdatedAt,
          expectedUpdatedAt,
        })),
        providers: providerStatus(),
      }),
    );
  } catch (error) {
    return requestErrorResponse(error) ?? errorResponse(error);
  }
}
