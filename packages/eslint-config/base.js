import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "domain", pattern: "packages/domain/**" },
        { type: "config", pattern: "packages/config/**" },
        { type: "db", pattern: "packages/db/**" },
        { type: "notifications", pattern: "packages/notifications/**" },
        { type: "ui", pattern: "packages/ui/**" },
        { type: "web", pattern: "apps/web/**" },
        { type: "worker", pattern: "apps/worker/**" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: "domain",
              allow: ["domain"],
            },
            {
              from: "config",
              allow: ["config", "domain"],
            },
            {
              from: "db",
              allow: ["db", "domain", "config"],
            },
            {
              from: "notifications",
              allow: ["notifications", "domain", "config"],
            },
            {
              from: "ui",
              allow: ["ui"],
            },
            {
              from: "web",
              allow: ["web", "ui", "domain", "config", "db"],
            },
            {
              from: "worker",
              allow: ["worker", "domain", "config", "db", "notifications"],
            },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/node_modules/**"],
  },
];

export default baseConfig;
