import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

// Prisma 7 requires an explicit driver adapter, even for local SQLite.
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.policy.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 }, // schema defaults = strictest policy (empty allowlist)
  });
  console.log("Policy seeded");
}

main().finally(() => prisma.$disconnect());
