import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated/bundled engine runtime output (esbuild), committed as
    // checksummed audited artifacts, not authored source.
    "public/engines/**",
    // Claude Code working state (worktrees, build output from parallel
    // sessions) — not project source.
    ".claude/**",
  ]),
]);

export default eslintConfig;
