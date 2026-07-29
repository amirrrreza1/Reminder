import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(packageRoot, "migrations");

export type MigrationResult = {
  applied: string[];
  alreadyApplied: string[];
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
