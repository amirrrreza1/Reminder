import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Load the repository-root `.env` when this entrypoint runs on the host.
 *
 * Containers get their environment from Compose `env_file:`, and Next.js loads
 * `apps/web/.env` itself — but `tsx`/`node` running this file directly get
 * nothing, which surfaces as `Invalid configuration: DATABASE_URL: Required`.
 *
 * The path is resolved from this module rather than `process.cwd()`, so it works
 * the same whether pnpm, an editor, or a bare `node dist/...` started the process.
 * Both guards below make this a no-op in production: real env wins, and the image
 * has no `.env` to find.
 */
export function loadRootEnv(): void {
  if (process.env.DATABASE_URL) {
    return;
  }
  const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

loadRootEnv();
