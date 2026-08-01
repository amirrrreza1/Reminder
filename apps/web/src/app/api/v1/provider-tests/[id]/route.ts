import { z } from "zod";

import {
  errorResponse,
  jsonBody,
  noStore,
  notificationRepository,
  requestErrorResponse,
} from "@/lib/api";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

function confirmationRequired(): Response {
  return noStore(
    Response.json(
      {
        error: {
          code: "CONFIRMATION_REQUIRED",
          message: "Confirm before sending a provider test message.",
          meta: null,
        },
      },
      { status: 400 },
    ),
  );
}

function notFound(): Response {
  return noStore(
    Response.json(
      { error: { code: "NOT_FOUND", message: "Provider test was not found.", meta: null } },
      { status: 404 },
    ),
  );
}

export async function POST(request: Request, context: Context) {
  try {
    const channel = (await context.params).id;
    if (channel !== "email" && channel !== "telegram") return notFound();
    const body = z
      .object({ confirmed: z.unknown().optional() })
      .strict()
      .parse(await jsonBody(request));
    if (body.confirmed !== true) return confirmationRequired();
    const test = await notificationRepository().createProviderTest(channel);
    return noStore(
      Response.json(
        {
          id: test.id,
          channel: test.channel,
          status: test.status,
          statusUrl: `/api/v1/provider-tests/${test.id}`,
        },
        { status: 202 },
      ),
    );
  } catch (error) {
    return requestErrorResponse(error) ?? errorResponse(error);
  }
}

export async function GET(_request: Request, context: Context) {
  try {
    return noStore(
      Response.json(await notificationRepository().getProviderTest((await context.params).id)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
