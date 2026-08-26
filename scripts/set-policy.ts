/** Admin-only policy maintenance CLI (v1 has no admin UI — see spec section 7).
 *
 * Usage:
 *    npx tsx scripts/set-policy.ts show
 *    npx tsx scripts/set-policy.ts allowlist add youtube.com
 *    npx tsx scripts/set-policy.ts allowlist remove youtube.com
 *    npx tsx scripts/set-policy.ts max-bytes 10485760
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createSqliteAdapter } from "../src/lib/db-adapter";

const prisma = new PrismaClient({ adapter: createSqliteAdapter() });

async function main() {
  const [cmd, arg1, arg2] = process.argv.slice(2);
  const policy = await prisma.policy.findUniqueOrThrow({ where: { id: 1 } });
  const allowlist: string[] = JSON.parse(policy.allowlistJson);

  if (cmd === "show" || !cmd) {
    console.log(JSON.stringify({ ...policy, allowlist }, null, 2));
    return;
  }
  if (cmd === "allowlist" && arg1 === "add" && arg2) {
    const host = arg2.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (!allowlist.includes(host)) allowlist.push(host);
  } else if (cmd === "allowlist" && arg1 === "remove" && arg2) {
    const i = allowlist.indexOf(arg2.toLowerCase());
    if (i >= 0) allowlist.splice(i, 1);
  } else if (cmd === "max-bytes" && arg1) {
    await prisma.policy.update({ where: { id: 1 }, data: { maxAssetBytes: Number(arg1), version: { increment: 1 } } });
    console.log("updated");
    return;
  } else {
    console.error("unknown command"); process.exit(1);
  }
  await prisma.policy.update({
    where: { id: 1 },
    data: { allowlistJson: JSON.stringify(allowlist), version: { increment: 1 } },
  });
  console.log("allowlist:", allowlist);
}

main().finally(() => prisma.$disconnect());
