import { defineConfig } from "@playwright/test";

import { TEST_PASSWORD } from "./apps/web/e2e/auth-helpers";

export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4310",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @reminder/web exec next dev --port 4310",
    url: "http://127.0.0.1:4310",
    // Next never overrides a value already in process.env, so this wins over
    // apps/web/.env and the suite never needs the real dashboard password.
    // Note that `reuseExistingServer` means an already-running dev server on 4310
    // keeps its own password; stop it first if the auth specs start failing.
    env: { AUTH_PASSWORD: TEST_PASSWORD },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
