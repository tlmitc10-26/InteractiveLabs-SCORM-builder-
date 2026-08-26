import { prisma } from "@/lib/db";
import { createProject, deleteProject } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { interactives: true } } },
  });
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="app-h1">Interactive Lesson Builder</h1>
      <p className="mt-1 text-sm text-gray-600">Build concept-experimentation interactives and export SCORM packages for Canvas.</p>

      <form action={createProject} className="mt-6 flex gap-2">
        <input name="title" placeholder="New project title" required maxLength={200}
          className="flex-1 rounded border border-gray-300 px-3 py-2" />
        <button className="btn btn-primary">Create project</button>
      </form>

      <ul className="mt-6 divide-y rounded border border-gray-200 bg-white">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-3">
            <Link href={`/projects/${p.id}`} className="app-link font-medium">
              {p.title}
            </Link>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{p._count.interactives} interactive{p._count.interactives === 1 ? "" : "s"}</span>
              <form action={deleteProject}>
                <input type="hidden" name="id" value={p.id} />
                <button className="btn-danger-link btn-sm">Delete</button>
              </form>
            </div>
          </li>
        ))}
        {projects.length === 0 && <li className="px-4 py-6 text-gray-500">No projects yet.</li>}
      </ul>
    </div>
  );
}
