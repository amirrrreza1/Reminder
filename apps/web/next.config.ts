import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const configDir = path.dirname(fileURLToPath(import.meta.url));

// Next.js loads apps/web/.env first. Empty keys there (like NERKH_API_TOKEN=)
// hide the same key from the repo-root .env, so fill blanks from the root file.
const rootEnvPath = path.join(configDir, "../../.env");
if (existsSync(rootEnvPath)) {
  for (const line of readFileSync(rootEnvPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    let value = trimmed.slice(separator + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}

const nextConfig: NextConfig = {
  // Standalone is required for the multi-stage image. Local Windows builds often
  // lack symlink privileges, so enable it only when explicitly requested.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(configDir, "../.."),
  transpilePackages: ["@reminder/ui", "@reminder/domain", "@reminder/config", "@reminder/db"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;

const nextConfig: NextConfig = {
  // Standalone is required for the multi-stage image. Local Windows builds often
  // lack symlink privileges, so enable it only when explicitly requested.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(configDir, "../.."),
  transpilePackages: ["@reminder/ui", "@reminder/domain", "@reminder/config", "@reminder/db"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
