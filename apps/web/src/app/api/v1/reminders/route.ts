import {
  addGregorianDays,
  createReminderSchema,
  formatGregorianDate,
  reminderTypes,
  todayInTimezone,
} from "@reminder/domain";
import { getConfig } from "@reminder/config";

import { errorResponse, jsonBody, noStore, repository, requestErrorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

function invalidQuery(message: string): Response {
  return noStore(
    Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid fields.",
          fields: { query: [message] },
          meta: null,
        },
      },
      { status: 400 },
    ),
  );
}

function decodeCursor(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      typeof parsed.id === "string"
      ? parsed.id
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "active";
    const sort = url.searchParams.get("sort") ?? "nextOccurrence";
    const direction =
      url.searchParams.get("direction") ?? (sort === "nextOccurrence" ? "asc" : "asc");
    const limitText = url.searchParams.get("limit") ?? "50";
    const limit = Number(limitText);
    if (!(["active", "paused", "completed", "all"] as const).includes(state as "active"))
      return invalidQuery("state is invalid.");
    if (!(["nextOccurrence", "title", "amount"] as const).includes(sort as "nextOccurrence"))
      return invalidQuery("sort is invalid.");
    if (!(["asc", "desc"] as const).includes(direction as "asc"))
      return invalidQuery("direction is invalid.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return invalidQuery("limit must be an integer from 1 to 100.");
    const q = url.searchParams.get("q")?.trim();
    if (q !== undefined && (q.length < 1 || q.length > 120))
      return invalidQuery("q must be 1 to 120 characters.");
    const requestedTypes = url.searchParams.get("type")?.split(",").filter(Boolean) ?? [];
    if (requestedTypes.some((type) => !(reminderTypes as readonly string[]).includes(type)))
      return invalidQuery("type is invalid.");
    const allItems = await repository().list();
    const active = allItems.filter((item) => item.state === "active");
    const localToday = todayInTimezone(new Date(), getConfig().APP_TIMEZONE);
    const today = formatGregorianDate(localToday);
    const inSevenDays = formatGregorianDate(addGregorianDays(localToday, 7));
    const amountsByCurrency = { IRR: 0n, USD: 0n };
    for (const item of active)
      if (item.amount) amountsByCurrency[item.amount.currency] += BigInt(item.amount.minor);
    let items = allItems.filter(
      (item) =>
        (state === "all" || item.state === state) &&
        (!q ||
          `${item.title} ${item.description ?? ""}`
            .toLocaleLowerCase()
            .includes(q.toLocaleLowerCase())) &&
        (requestedTypes.length === 0 || requestedTypes.includes(item.type)),
    );
    items.sort((left, right) => {
      const result =
        sort === "title"
          ? left.title.localeCompare(right.title)
          : sort === "amount"
            ? Number(BigInt(left.amount?.minor ?? "0") - BigInt(right.amount?.minor ?? "0"))
            : (left.schedule.nextOccurrenceDate ?? "9999-12-31").localeCompare(
                right.schedule.nextOccurrenceDate ?? "9999-12-31",
              );
      return (result || left.id.localeCompare(right.id)) * (direction === "asc" ? 1 : -1);
    });
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      const id = decodeCursor(cursor);
      if (!id) return invalidQuery("cursor is invalid.");
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return invalidQuery("cursor is invalid.");
      items = items.slice(index + 1);
    }
    const pageItems = items.slice(0, limit);
    const next = items.length > limit ? pageItems.at(-1) : undefined;
    return noStore(
      Response.json({
        items: pageItems,
        page: {
          nextCursor: next
            ? Buffer.from(JSON.stringify({ id: next.id })).toString("base64url")
            : null,
          hasMore: Boolean(next),
        },
        summary: {
          activeCount: active.length,
          dueWithinSevenDaysCount: active.filter(
            (item) =>
              item.schedule.nextOccurrenceDate !== null &&
              item.schedule.nextOccurrenceDate >= today &&
              item.schedule.nextOccurrenceDate <= inSevenDays,
          ).length,
          amountsByCurrency: {
            IRR: amountsByCurrency.IRR.toString(),
            USD: amountsByCurrency.USD.toString(),
          },
        },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await jsonBody(request);
    const input = createReminderSchema.parse(body);
    const reminder = await repository().create(input);
    return noStore(
      Response.json(reminder, {
        status: 201,
        headers: { Location: `/api/v1/reminders/${reminder.id}` },
      }),
    );
  } catch (error) {
    return requestErrorResponse(error) ?? errorResponse(error);
  }
}
