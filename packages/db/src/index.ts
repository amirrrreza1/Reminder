import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

export * from "./schema.js";
export * from "./errors.js";
export * from "./repository.js";
export * from "./notifications.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(packageRoot, "migrations");

export type MigrationResult = {
  applied: string[];
  alreadyApplied: string[];
};

export type SettingsDefaults = {
  calendarSystem: "gregorian" | "jalali";
  defaultCurrency: "IRR" | "USD";
  emailEnabled: boolean;
  telegramEnabled: boolean;
};

export type PersistedSettings = SettingsDefaults & {
  updatedAt: Date;
};

export async function createSql(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  });
}

export async function pingDatabase(databaseUrl: string): Promise<void> {
  const sql = await createSql(databaseUrl);
  try {
    await sql`select 1`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runMigrations(databaseUrl: string): Promise<MigrationResult> {
  const sql = await createSql(databaseUrl);
  try {
    await sql`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    const appliedRows = await sql<{ id: string }[]>`select id from schema_migrations order by id`;
    const appliedSet = new Set(appliedRows.map((row) => row.id));

    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        alreadyApplied.push(file);
        continue;
      }

      const contents = await readFile(path.join(migrationsDir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`insert into schema_migrations (id) values (${file})`;
      });
      applied.push(file);
    }

    return { applied, alreadyApplied };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function areMigrationsCurrent(databaseUrl: string): Promise<boolean> {
  const sql = await createSql(databaseUrl);
  try {
    const table = await sql`
      select to_regclass('public.schema_migrations') as name
    `;
    if (!table[0]?.name) {
      return false;
    }

    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));
    const appliedRows = await sql<{ id: string }[]>`select id from schema_migrations`;
    const appliedSet = new Set(appliedRows.map((row) => row.id));
    return files.every((file) => appliedSet.has(file));
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Inserts the singleton exactly once; subsequent starts preserve user edits. */
export async function ensureSettings(
  databaseUrl: string,
  defaults: SettingsDefaults,
): Promise<PersistedSettings> {
  const sql = await createSql(databaseUrl);
  try {
    await sql`
      insert into settings (id, calendar_system, default_currency, email_enabled, telegram_enabled)
      values (1, ${defaults.calendarSystem}, ${defaults.defaultCurrency}, ${defaults.emailEnabled}, ${defaults.telegramEnabled})
      on conflict (id) do nothing
    `;
    const rows = await sql<
      {
        calendar_system: SettingsDefaults["calendarSystem"];
        default_currency: SettingsDefaults["defaultCurrency"];
        email_enabled: boolean;
        telegram_enabled: boolean;
        updated_at: Date;
      }[]
    >`
      select calendar_system, default_currency, email_enabled, telegram_enabled, updated_at from settings where id = 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Settings singleton was not created.");
    return {
      calendarSystem: row.calendar_system,
      defaultCurrency: row.default_currency,
      emailEnabled: row.email_enabled,
      telegramEnabled: row.telegram_enabled,
      updatedAt: row.updated_at,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
