import { prisma } from "@/lib/db";
import { deleteInteractive } from "@/app/actions";
import { ENGINE_ADAPTERS } from "@/lib/engines/dispatch";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetPanel } from "./asset-panel";
import { NewInteractiveForm } from "./new-interactive-form";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { interactives: { orderBy: { updatedAt: "desc" } }, assets: { orderBy: { createdAt: "desc" } } },
  });
  if (!project) notFound();

  // Serializable engine/starter metadata for the client-side picker (Task
  // 8) — sourced from dispatch.ts's ENGINE_ADAPTERS so this page and the
  // picker never hardcode a per-engine list of their own.
  const engines = Object.values(ENGINE_ADAPTERS).map((a) => ({
    id: a.engineId,
    label: a.label,
    blurb: a.blurb,
    starters: a.starters,
  }));

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href="/" className="app-link text-sm">&larr; Projects</Link>
      <h1 className="mt-2 app-h1">{project.title}</h1>

      <section className="mt-6">
        <h2 className="app-h2">Interactives</h2>
        <NewInteractiveForm projectId={project.id} engines={engines} />
        <ul className="mt-3 divide-y rounded border border-gray-200 bg-white">
          {project.interactives.map((it) => (
            <li key={it.id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/interactives/${it.id}`} className="app-link font-medium">{it.title}</Link>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <span>{it.engineId} v{it.engineVersion}</span>
                <form action={deleteInteractive}>
                  <input type="hidden" name="id" value={it.id} />
                  <button className="btn-danger-link btn-sm">Delete</button>
                </form>
              </div>
            </li>
          ))}
          {project.interactives.length === 0 && <li className="px-4 py-6 text-gray-500">No interactives yet.</li>}
        </ul>
      </section>

      <AssetPanel projectId={project.id}
        assets={project.assets.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, byteSize: a.byteSize }))} />
    </div>
  );
}
