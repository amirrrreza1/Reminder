import { deleteReminderSchema, updateReminderSchema } from "@reminder/domain";

import { errorResponse, jsonBody, noStore, repository, requestErrorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    return noStore(Response.json(await repository().get((await context.params).id)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const input = updateReminderSchema.parse(await jsonBody(request));
    const { expectedUpdatedAt, ...changes } = input;
    return noStore(
      Response.json(
        await repository().update((await context.params).id, expectedUpdatedAt, changes),
      ),
    );
  } catch (error) {
    return requestErrorResponse(error) ?? errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const input = deleteReminderSchema.parse(await jsonBody(request));
    await repository().delete((await context.params).id, input.expectedUpdatedAt);
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return requestErrorResponse(error) ?? errorResponse(error);
  }
}
