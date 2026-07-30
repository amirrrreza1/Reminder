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
  await expect(page.getByRole("heading", { name: "Never miss what comes around." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Internet subscription" })).toBeVisible();
});

test("creates a reminder and keeps query-driven dashboard controls accessible", async ({
  page,
}) => {
  await expect(page.getByText("Active reminders")).toBeVisible();
  await page.getByRole("button", { name: "Add reminder" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Water bill");
  await page.getByLabel("Type", { exact: true }).selectOption("bill");
  await expect(page.getByText("Next occurrence:")).toBeVisible();
  await page.getByRole("button", { name: "Create reminder" }).click();
  await expect(page.getByRole("heading", { name: "Water bill" })).toBeVisible();

  await page.getByLabel("Search reminders").fill("water");
  await expect(page).toHaveURL(/\?q=water/);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((issue) => ["critical", "serious"].includes(issue.impact ?? "")),
  ).toEqual([]);
});

test("protects unsaved edits and recovers from a stale write", async ({ page }) => {
  await page.getByRole("button", { name: "Edit Internet subscription" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Changed locally");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Edit reminder" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Reload the latest version before saving.")).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Updated elsewhere");
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
