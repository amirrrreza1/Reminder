import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createReminderSchema } from "@reminder/domain";

import {
  areMigrationsCurrent,
  ensureSettings,
  ReminderRepository,
  runMigrations,
} from "./index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("Phase 2 PostgreSQL persistence", () => {
  const repository = new ReminderRepository(databaseUrl!, "Asia/Tehran", "09:00", {
    email: true,
    telegram: true,
  });

  beforeAll(async () => {
    await runMigrations(databaseUrl!);
    await ensureSettings(databaseUrl!, {
      calendarSystem: "jalali",
      defaultCurrency: "IRR",
      emailEnabled: false,
      telegramEnabled: false,
    });
  });

  afterAll(async () => {
    const reminders = await repository.list();
    await Promise.all(
      reminders.map((reminder) => repository.delete(reminder.id, reminder.updatedAt)),
    );
  });

  it("migrates a clean database and preserves CRUD concurrency", async () => {
    expect(await areMigrationsCurrent(databaseUrl!)).toBe(true);
    const input = createReminderSchema.parse({
      title: "Integration birthday",
      description: "Synthetic test data",
      type: "birthday",
      customTypeLabel: null,
      state: "active",
      schedule: {
        calendar: "jalali",
        anchorDate: { year: 1405, month: 8, day: 12 },
        frequency: "yearly",
        interval: 1,
      },
      amount: { currency: "IRR", minor: "1250000" },
      remindBeforeDays: 3,
      channels: { email: false, telegram: false },
    });
    const created = await repository.create(input, new Date("2026-07-30T00:00:00.000Z"));
    expect(created.schedule.nextOccurrenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(created.amount).toEqual({ currency: "IRR", minor: "1250000" });

    const updated = await repository.update(
      created.id,
      created.updatedAt,
      { title: "Updated integration birthday" },
      new Date("2026-07-30T00:00:00.000Z"),
    );
    expect(updated.title).toBe("Updated integration birthday");
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    await expect(
      repository.update(created.id, created.updatedAt, { title: "Stale write" }),
    ).rejects.toThrow("changed since it was loaded");

    await repository.delete(updated.id, updated.updatedAt);
    await expect(repository.get(updated.id)).rejects.toThrow("not found");
  });
});
