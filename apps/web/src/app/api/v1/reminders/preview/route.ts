import { calculateSchedule, schedulePreviewSchema, todayInTimezone } from "@reminder/domain";
import { getConfig } from "@reminder/config";

import { errorResponse, jsonBody, noStore } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Computes the same preview used by persistence without creating a reminder. */
export async function POST(request: Request) {
  try {
    const input = schedulePreviewSchema.parse(await jsonBody(request));
    const config = getConfig();
    const [hour, minute] = config.NOTIFICATION_SEND_TIME.split(":").map(Number);
    const result = calculateSchedule({
      ...input,
      timeZone: config.APP_TIMEZONE,
      sendTime: { hour: hour!, minute: minute! },
      onOrAfter: todayInTimezone(new Date(), config.APP_TIMEZONE),
    });
    return noStore(
      Response.json({
        nextOccurrenceDate: `${result.nextOccurrenceDate.year.toString().padStart(4, "0")}-${result.nextOccurrenceDate.month.toString().padStart(2, "0")}-${result.nextOccurrenceDate.day.toString().padStart(2, "0")}`,
        nextNotificationAt: result.nextNotificationAt.toISOString(),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
