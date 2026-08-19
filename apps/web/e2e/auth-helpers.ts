import type { Page } from "@playwright/test";

import { SESSION_COOKIE_NAME, createSessionToken } from "../src/lib/auth";

/**
 * Injected into the dev server by `playwright.config.ts` (`webServer.env`). Next
 * does not override values already present in `process.env`, so this wins over
 * whatever `apps/web/.env` holds and the suite never depends on a real password.
 */
export const TEST_PASSWORD = "playwright-test-password";

export const BASE_URL = "http://127.0.0.1:4310";

/**
 * Mint a valid session cookie directly instead of driving the form. Tests about
 * the dashboard should not pay for a login round trip, and the token format is
 * covered by the unit tests plus `auth.spec.ts`.
 */
export async function seedSession(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: await createSessionToken(TEST_PASSWORD),
      url: BASE_URL,
    },
  ]);
}
