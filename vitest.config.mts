import { defineConfig } from "vitest/config";
import path from "node:path";
// tests/editor-import-panel.test.tsx (Task 3) imports editor-shared.tsx,
// which imports the "@/app/actions" server-action module for
// saveInteractiveConfig -- that module's top-level `import { prisma } from
// "@/lib/db"` throws immediately if DATABASE_URL isn't set (src/lib/db-
// adapter.ts), which it never is under plain `vitest run` (Next's own
// tooling is what normally loads .env, not Vite/Vitest). Loading .env here,
// the same file `next dev`/`next build` already read, keeps that import
// chain from throwing without hardcoding a value or touching db.ts itself;
// no test in this suite touches the database directly.
import "dotenv/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
