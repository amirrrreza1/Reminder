import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const settings = {
  calendarSystem: "gregorian",
  defaultCurrency: "IRR",
  emailEnabled: true,
  telegramEnabled: false,
  updatedAt: "2026-07-30T10:00:00.000Z",
  providers: {
    email: { available: true, status: "configured" },
    telegram: { available: false, status: "not_configured" },
  },
};

const reminder = {
  id: "2c6f610d-5157-4ce9-97ca-7a81dd8e4ddd",
  title: "Internet subscription",
  description: "Renew the home connection before it lapses.",
  type: "subscription",
  customTypeLabel: null,
  state: "active",
  schedule: {
    calendar: "gregorian",
    anchorDate: { year: 2026, month: 8, day: 15 },
    frequency: "monthly",
    interval: 1,
    nextOccurrenceDate: "2026-08-15",
  },
  amount: { currency: "IRR", minor: "1250000" },
  remindBeforeDays: 2,
  channels: { email: true, telegram: false },
  updatedAt: "2026-07-30T10:00:00.000Z",
};

function list(items: (typeof reminder)[]) {
  return {
    items,
    summary: {
      activeCount: items.filter((item) => item.state === "active").length,
      dueWithinSevenDaysCount: 0,
      amountsByCurrency: { IRR: "1250000", USD: "0" },
    },
  };
}

async function mockApi(page: Page) {
  let items = [reminder];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/settings") return json(settings);
    if (url.pathname === "/api/v1/reminders/preview")
      return json({
        nextOccurrenceDate: "2026-08-15",
        nextNotificationAt: "2026-08-13T09:00:00.000Z",
      });
    if (url.pathname === "/api/v1/reminders" && request.method() === "GET")
      return json(list(items));
    if (url.pathname === "/api/v1/reminders" && request.method() === "POST") {
      const input = request.postDataJSON() as typeof reminder;
      const created = { ...reminder, ...input, id: "3a0d8b12-fac1-4e52-8a06-0983e73e65f0" };
      items = [created, ...items];
      return json(created, 201);
    }
    if (url.pathname === `/api/v1/reminders/${reminder.id}` && request.method() === "PATCH")
      return json(
        {
          error: {
            code: "STALE_WRITE",
            message: "This reminder has changed since you opened it.",
            meta: {
              current: {
                ...reminder,
                title: "Updated elsewhere",
                updatedAt: "2026-07-30T10:05:00.000Z",
              },
            },
          },
        },
        409,
      );
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Edit Internet subscription" })).toBeVisible();
});

test("shows enabled notification channels as icons on reminder cards", async ({ page }) => {
  const card = page.locator(".reminder-card", { hasText: "Internet subscription" });

  await expect(card.getByRole("img", { name: "Email enabled" })).toBeVisible();
  await expect(card.getByText("Email", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("img", { name: "Telegram enabled" })).toHaveCount(0);
});

test("omits Settings helper copy from the reminder modal", async ({ page }) => {
  await page.getByRole("button", { name: "Add reminder" }).click();
  const dialog = page.getByRole("dialog", { name: "Add reminder" });

  await expect(
    dialog.getByText(
      "Calendar and currency come from Settings when a reminder is created and are locked here.",
    ),
  ).toHaveCount(0);
  await expect(dialog.getByText(/calendar, set in Settings/)).toHaveCount(0);
});

test("keeps reminder modal actions on one row", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Internet subscription" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit reminder" });
  const [deleteButton, cancelButton, saveButton] = await Promise.all([
    dialog.getByRole("button", { name: "Delete reminder" }).boundingBox(),
    dialog.getByRole("button", { name: "Cancel" }).boundingBox(),
    dialog.getByRole("button", { name: "Save changes" }).boundingBox(),
  ]);

  expect(deleteButton?.y).toBe(cancelButton?.y);
  expect(cancelButton?.y).toBe(saveButton?.y);
});

test("aligns dashboard actions with the reminder controls", async ({ page }) => {
  const [settingsButton, addButton, searchInput] = await Promise.all([
    page.getByRole("button", { name: "Open settings" }).boundingBox(),
    page.getByRole("button", { name: "Add reminder" }).boundingBox(),
    page.locator(".dashboard-controls .search-field").boundingBox(),
  ]);

  expect(settingsButton?.y).toBe(searchInput?.y);
  expect(addButton?.y).toBe(searchInput?.y);
});

test("creates a reminder and keeps query-driven dashboard controls accessible", async ({
  page,
}) => {
  await expect(page.getByText("Active reminders")).toBeVisible();
  await page.getByRole("button", { name: "Add reminder" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Water bill");
  await page
    .getByRole("dialog", { name: "Add reminder" })
    .getByLabel("Type", { exact: true })
    .click();
  await page.getByRole("option", { name: "Bill / utility", exact: true }).click();
  await expect(page.getByText("Next occurrence:")).toBeVisible();
  await page.getByRole("button", { name: "Create reminder" }).click();
  await expect(page.getByRole("heading", { name: "Water bill" })).toBeVisible();

  await page.getByLabel("Search", { exact: true }).fill("water");
  await expect(page).toHaveURL(/(?:\?|&)q=water/);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((issue) => ["critical", "serious"].includes(issue.impact ?? "")),
  ).toEqual([]);
});

test("uses custom dropdowns and applies reminder type defaults", async ({ page }) => {
  await page.getByRole("button", { name: "Add reminder" }).click();
  const dialog = page.getByRole("dialog", { name: "Add reminder" });

  await dialog.getByLabel("Month", { exact: true }).click();
  await expect(page.getByRole("option", { name: "September", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "November", exact: true })).toBeVisible();
  const september = page.getByRole("option", { name: "September", exact: true });
  await september.hover();
  await expect(september).toHaveCSS("background-color", "rgb(255, 196, 128)");
  await september.click();

  await dialog.getByLabel("Type", { exact: true }).click();
  await page.getByRole("option", { name: "Birthday", exact: true }).click();
  await expect(dialog.getByLabel("Repeats", { exact: true })).toHaveText("Yearly");
  await expect(dialog.locator('input[inputmode="decimal"]')).toHaveCount(0);

  await dialog.getByLabel("Type", { exact: true }).click();
  await page.getByRole("option", { name: "Rent", exact: true }).click();
  await expect(dialog.getByLabel("Repeats", { exact: true })).toHaveText("Monthly");
  await expect(dialog.locator('input[inputmode="decimal"]')).toHaveCount(1);
});

test("protects unsaved edits and recovers from a stale write", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Internet subscription" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Changed locally");
  await page.getByRole("button", { name: "Close" }).click();
  const confirmation = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Edit reminder" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Reload the latest version before saving.")).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Updated elsewhere");
});

test("uses in-app verification modals for destructive and provider actions", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Internet subscription" }).click();
  await page.getByRole("button", { name: "Delete reminder" }).click();
  const deleteConfirmation = page.getByRole("dialog", { name: "Delete reminder?" });
  await expect(deleteConfirmation).toBeVisible();
  await deleteConfirmation.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  const sendTest = settingsDialog.locator("button:not(:disabled)", { hasText: "Send test" });
  await expect(sendTest).toHaveCount(1);
  await sendTest.click();
  const testConfirmation = page.getByRole("dialog", { name: "Send Email test?" });
  await expect(testConfirmation).toBeVisible();
  await testConfirmation.getByRole("button", { name: "Cancel" }).click();
});

test("keeps keyboard focus and essential controls usable at 200% zoom and RTL", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add reminder" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Close" }).press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.setViewportSize({ width: 640, height: 800 });
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
    document.body.style.zoom = "2";
  });
  await expect(page.getByRole("button", { name: "Add reminder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Internet subscription" })).toBeVisible();
  expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
});

test("uses a full-screen dialog at mobile sizes", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "Add reminder" }).click();
  const bounds = await page.getByRole("dialog", { name: "Add reminder" }).boundingBox();

  expect(bounds).toMatchObject({ x: 0, y: 0, width: 360, height: 800 });
});

test("@visual dashboard stays usable at desktop and mobile widths", async ({ page }) => {
  await expect(page).toHaveScreenshot("dashboard-desktop.png", {
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page).toHaveScreenshot("dashboard-mobile.png", {
    fullPage: true,
    animations: "disabled",
  });
});
