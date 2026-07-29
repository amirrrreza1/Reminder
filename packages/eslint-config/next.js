import reactConfig from "./react.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...reactConfig,
  {
    ignores: [".next/**", "out/**"],
  },
];
