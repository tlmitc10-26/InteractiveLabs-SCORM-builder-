import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Editor } from "./editor";
import { emptySandboxConfig, migrateLegacyColors, SandboxConfig } from "@/lib/engines/param-sandbox/schema";

export const dynamic = "force-dynamic";

export default async function InteractivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interactive = await prisma.interactive.findUnique({ where: { id } });
  if (!interactive) notFound();
  const assets = await prisma.asset.findMany({ where: { projectId: interactive.projectId }, orderBy: { createdAt: "desc" } });

  // A corrupt configJson row (bad data, manual DB edit, etc.) must not crash
  // the editor page outright — fall back to a fresh, valid empty config so
  // the editor still loads and the designer can keep working. The export
  // route (src/app/api/interactives/[id]/export/route.ts) already guards
  // this same JSON.parse; this keeps the editor consistent with it.
  let initialConfig: SandboxConfig;
  try {
    // migrateLegacyColors rewrites any fill overlay's bare-hex-string color
    // (pre-hybrid-color-model drafts) into { hex } before this raw parse
    // result is handed to the editor as SandboxConfig — this JSON is never
    // run through validateSandboxConfig on read, so without this the
    // editor would receive a plain string where the type says {token}|{hex}.
    initialConfig = migrateLegacyColors(JSON.parse(interactive.configJson)) as SandboxConfig;
  } catch (err) {
    console.error(`interactives/${interactive.id}: configJson is not valid JSON, falling back to an empty config`, err);
    initialConfig = emptySandboxConfig(interactive.title);
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-4">
        <Link href={`/projects/${interactive.projectId}`} className="app-link text-sm">&larr; Project</Link>
        <span className="text-sm text-gray-400">Parameter Sandbox v{interactive.engineVersion}</span>
      </div>
      <Editor
        interactiveId={interactive.id}
        initialTitle={interactive.title}
        initialConfig={initialConfig}
        assets={assets.map((a) => ({ id: a.id, filename: a.filename }))}
      />
    </div>
  );
}
