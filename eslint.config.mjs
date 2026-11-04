import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_name` marks a value left unused on purpose (e.g. dropping a field with a rest destructure).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  globalIgnores([
    // Defaults of eslint-config-next.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated shadcn primitives: restyled through tokens, not hand-edited (AGENTS.md).
    "components/ui/**",
    // Drizzle migrations are generated SQL snapshots.
    "drizzle/**",
  ]),
]);

export default eslintConfig;
