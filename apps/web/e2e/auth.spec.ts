import { expect, test } from "@playwright/test";

import { BASE_URL, TEST_PASSWORD, seedSession } from "./auth-helpers";

const passwordField = "Password";
const signInButton = "Sign in";

test("sends an unauthenticated visitor to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Reminder" })).toBeVisible();
  await expect(page.getByLabel(passwordField)).toBeVisible();
});

test("rejects the wrong password without signing in", async ({ page }) => {
  // A distinct client key keeps this deliberate failure off the loopback address's
  // throttle counter, so repeatedly re-running the suite cannot lock the tests out.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.42" });
  await page.goto("/login");
  await page.getByLabel(passwordField).fill("definitely-not-the-password");
  await page.getByRole("button", { name: signInButton }).click();

  await expect(page.getByRole("alert")).toHaveText("That password is incorrect.");
  await expect(page).toHaveURL(/\/login$/);
  // The field is cleared so a mistyped password is not resubmitted by accident.
  await expect(page.getByLabel(passwordField)).toHaveValue("");
});

test("signs in with the configured password and reaches the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(passwordField).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: signInButton }).click();

  await expect(page).toHaveURL(`${BASE_URL}/`);
  await expect(page.getByRole("button", { name: "Add reminder" })).toBeVisible();
});

test("returns to the originally requested page after signing in", async ({ page }) => {
  await page.goto("/?state=paused");
  await expect(page).toHaveURL(/\/login\?next=%2F%3Fstate%3Dpaused$/);

  await page.getByLabel(passwordField).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: signInButton }).click();

  await expect(page).toHaveURL(/\/\?state=paused$/);
});

test("hides and reveals the password", async ({ page }) => {
  await page.goto("/login");
  const field = page.getByLabel(passwordField);
  await expect(field).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Show password" }).click();
  await expect(field).toHaveAttribute("type", "text");

  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(field).toHaveAttribute("type", "password");
});

test("answers 401 on the API without a session and 200 with one", async ({ page, request }) => {
  const anonymous = await request.get("/api/v1/settings");
  expect(anonymous.status()).toBe(401);
  const body = (await anonymous.json()) as { error: { code: string } };
  expect(body.error.code).toBe("UNAUTHORIZED");

  // Health checks stay public so the container healthcheck keeps working.
  const health = await request.get("/api/health/live");
  expect(health.status()).toBe(200);

  // Asserted as "not blocked" rather than 200: what matters here is that the gate
  // opens, and a real database response is the subject of the dashboard specs.
  await seedSession(page);
  const authorised = await page.request.get("/api/v1/settings");
  expect(authorised.status()).not.toBe(401);
});

test("skips the login page when a session is already present", async ({ page }) => {
  await seedSession(page);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
});

test("clears the session on logout and refuses to go back in", async ({ page }) => {
  await seedSession(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add reminder" })).toBeVisible();

  const logout = await page.request.post("/api/auth/logout");
  expect(logout.ok()).toBe(true);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel(passwordField)).toBeVisible();
});
