import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Editor } from "./editor";

export const dynamic = "force-dynamic";

export default async function InteractivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interactive = await prisma.interactive.findUnique({ where: { id } });
  if (!interactive) notFound();
  const assets = await prisma.asset.findMany({ where: { projectId: interactive.projectId }, orderBy: { createdAt: "desc" } });

  return (
    <main className="p-4">
      <div className="mb-3 flex items-center gap-4">
        <Link href={`/projects/${interactive.projectId}`} className="text-sm text-gray-500 hover:underline">&larr; Project</Link>
        <span className="text-sm text-gray-400">Parameter Sandbox v{interactive.engineVersion}</span>
      </div>
      <Editor
        interactiveId={interactive.id}
        initialTitle={interactive.title}
        initialConfig={JSON.parse(interactive.configJson)}
        assets={assets.map((a) => ({ id: a.id, filename: a.filename }))}
      />
    </main>
  );
}
