import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createSqliteAdapter } from "../src/lib/db-adapter";

const prisma = new PrismaClient({ adapter: createSqliteAdapter() });

async function main() {
  await prisma.policy.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 }, // schema defaults = strictest policy (empty allowlist)
  });
  console.log("Policy seeded");
}

main().finally(() => prisma.$disconnect());
