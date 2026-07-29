import { NextResponse } from "next/server";

import { getConfig } from "@reminder/config";
import { areMigrationsCurrent, pingDatabase } from "@reminder/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getConfig();
    await pingDatabase(config.DATABASE_URL);
    const migrationsCurrent = await areMigrationsCurrent(config.DATABASE_URL);

    if (!migrationsCurrent) {
      return NextResponse.json({ status: "not_ready", reason: "migrations" }, { status: 503 });
    }

    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "not_ready", reason: "dependency" }, { status: 503 });
  }
}
