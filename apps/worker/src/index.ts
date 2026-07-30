import { hostname } from "node:os";

import { getConfig } from "@reminder/config";
import { createSql, pingDatabase } from "@reminder/db";

const WORKER_ID = process.env.HOSTNAME ?? hostname();

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      level: "info",
      event,
      workerId: WORKER_ID,
      ...fields,
    }),
  );
}

async function writeHeartbeat(databaseUrl: string): Promise<void> {
  const sql = await createSql(databaseUrl);
  try {
    await sql`
      insert into worker_heartbeats (worker_id, role, started_at, last_seen_at, updated_at)
      values (${WORKER_ID}, 'scheduler_delivery', now(), now(), now())
      on conflict (worker_id)
      do update set last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function tick(): Promise<void> {
  const config = getConfig();
  await pingDatabase(config.DATABASE_URL);
  await writeHeartbeat(config.DATABASE_URL);
  log("worker.heartbeat");
}

async function main(): Promise<void> {
  const config = getConfig();
  log("app.started", {
    pollIntervalSeconds: config.NOTIFICATION_POLL_INTERVAL_SECONDS,
  });

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log("worker.shutdown_started", { signal });
    clearInterval(timer);
    log("worker.shutdown_completed");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await tick();
  const timer = setInterval(() => {
    void tick().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "tick failed";
      console.error(
        JSON.stringify({
          level: "error",
          event: "worker.heartbeat_failed",
          workerId: WORKER_ID,
          message,
        }),
      );
    });
  }, config.NOTIFICATION_POLL_INTERVAL_SECONDS * 1000);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Worker failed to start";
  console.error(
    JSON.stringify({
      level: "error",
      event: "app.config_invalid",
      message,
    }),
  );
  process.exit(1);
});
