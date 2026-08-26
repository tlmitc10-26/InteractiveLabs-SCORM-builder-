import { PrismaClient } from "@prisma/client";
import { createSqliteAdapter } from "./db-adapter";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 removed the zero-config `new PrismaClient()` path; a driver
// adapter is now required even for local SQLite. See prisma.config.ts for
// the equivalent adapter-free config used by the Prisma CLI (migrate/generate).
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: createSqliteAdapter() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
