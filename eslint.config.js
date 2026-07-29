import eslintConfigPrettier from "eslint-config-prettier";
import { baseConfig } from "@reminder/eslint-config/base";

export default [...baseConfig, eslintConfigPrettier];
