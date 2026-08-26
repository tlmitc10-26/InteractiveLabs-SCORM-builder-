import { prisma } from "@/lib/db";
import { createInteractive, deleteInteractive } from "@/app/actions";
import { STARTERS, DEFAULT_STARTER_ID } from "@/lib/engines/param-sandbox/starter-configs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetPanel } from "./asset-panel";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { interactives: { orderBy: { updatedAt: "desc" } }, assets: { orderBy: { createdAt: "desc" } } },
  });
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href="/" className="app-link text-sm">&larr; Projects</Link>
      <h1 className="mt-2 app-h1">{project.title}</h1>

      <section className="mt-6">
        <h2 className="app-h2">Interactives</h2>
        <form action={createInteractive} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="projectId" value={project.id} />
          <input name="title" placeholder="New Parameter Sandbox title" maxLength={200}
            className="flex-1 rounded border border-gray-300 px-3 py-2" />
          <label htmlFor="ilb-starter-field" className="sr-only">Starter template</label>
          <select id="ilb-starter-field" name="starter" defaultValue={DEFAULT_STARTER_ID}
            className="rounded border border-gray-300 px-3 py-2 text-sm">
            {Object.entries(STARTERS).map(([id, starter]) => (
              <option key={id} value={id} title={starter.description}>{starter.label}</option>
            ))}
          </select>
          <button className="btn btn-primary">New Parameter Sandbox</button>
        </form>
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
