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
    ".next-smoke/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated shadcn primitives: restyled through tokens, not hand-edited (AGENTS.md).
    "components/ui/**",
    // Drizzle migrations are generated SQL snapshots.
    "drizzle/**",
    // Claude Code's agent worktrees: other checkouts of this repository, with their own builds.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
