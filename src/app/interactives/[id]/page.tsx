import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Editor } from "./editor";
import { emptySandboxConfig, migrateLegacyColors, SandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";
import { caseStarterConfig } from "@/lib/engines/case-workspace/starters";
import { processStarterConfig } from "@/lib/engines/process-simulator/starters";
import { ENGINE_ADAPTERS } from "@/lib/engines/dispatch";

export const dynamic = "force-dynamic";

export default async function InteractivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interactive = await prisma.interactive.findUnique({ where: { id } });
  if (!interactive) notFound();
  const assets = await prisma.asset.findMany({ where: { projectId: interactive.projectId }, orderBy: { createdAt: "desc" } });

  // A corrupt configJson row (bad data, manual DB edit, etc.) must not crash
  // the editor page outright — fall back to a fresh, valid config of the
  // interactive's OWN engine so the editor still loads and the designer can
  // keep working. The export route (src/app/api/interactives/[id]/export/
  // route.ts) already guards this same JSON.parse; this keeps the editor
  // consistent with it. migrateLegacyColors applies ONLY on the
  // param-sandbox path — it rewrites that engine's pre-hybrid-color-model
  // fill-overlay shape and has no branching-scenario equivalent.
  let initialConfig: unknown;
  if (interactive.engineId === "param-sandbox") {
    try {
      initialConfig = migrateLegacyColors(JSON.parse(interactive.configJson)) as SandboxConfig;
    } catch (err) {
      console.error(`interactives/${interactive.id}: configJson is not valid JSON, falling back to an empty config`, err);
      initialConfig = emptySandboxConfig(interactive.title);
    }
  } else if (interactive.engineId === "branching-scenario") {
    try {
      initialConfig = JSON.parse(interactive.configJson);
    } catch (err) {
      console.error(`interactives/${interactive.id}: configJson is not valid JSON, falling back to a blank scenario`, err);
      initialConfig = branchingStarterConfig("blank", interactive.title);
    }
  } else if (interactive.engineId === "case-workspace") {
    try {
      initialConfig = JSON.parse(interactive.configJson);
    } catch (err) {
      console.error(`interactives/${interactive.id}: configJson is not valid JSON, falling back to a blank case`, err);
      initialConfig = caseStarterConfig("blank", interactive.title);
    }
  } else if (interactive.engineId === "process-simulator") {
    try {
      initialConfig = JSON.parse(interactive.configJson);
    } catch (err) {
      console.error(`interactives/${interactive.id}: configJson is not valid JSON, falling back to a blank procedure`, err);
      initialConfig = processStarterConfig("blank", interactive.title);
    }
  } else {
    // Unrecognized engineId (data-integrity problem, not a normal path) —
    // Editor's own dispatcher shows a plain message for this case.
    initialConfig = null;
  }

  const engineLabel = ENGINE_ADAPTERS[interactive.engineId]?.label ?? interactive.engineId;

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-4">
        <Link href={`/projects/${interactive.projectId}`} className="app-link text-sm">&larr; Project</Link>
        <span className="text-sm text-gray-400">{engineLabel} v{interactive.engineVersion}</span>
      </div>
      <Editor
        engineId={interactive.engineId}
        interactiveId={interactive.id}
        initialTitle={interactive.title}
        initialConfig={initialConfig}
        assets={assets.map((a) => ({ id: a.id, filename: a.filename }))}
      />
    </div>
  );
}
