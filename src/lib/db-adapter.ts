import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/**
 * Prisma 7 requires an explicit driver adapter, even for local SQLite.
 * Shared by `src/lib/db.ts` (app runtime) and `prisma/seed.ts` (CLI) so both
 * construct the adapter the same way and fail with the same guidance if
 * `DATABASE_URL` is missing.
 */
export function createSqliteAdapter(): PrismaBetterSqlite3 {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env.");
  }
  return new PrismaBetterSqlite3({ url });
}
