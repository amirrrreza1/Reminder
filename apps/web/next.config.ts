import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const configDir = path.dirname(fileURLToPath(import.meta.url));

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
