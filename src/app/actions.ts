"use server";

import { prisma } from "@/lib/db";
import { emptySandboxConfig, validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createProject(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) return;
  const project = await prisma.project.create({ data: { title } });
  redirect(`/projects/${project.id}`);
}

export async function deleteProject(formData: FormData) {
  await prisma.project.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/");
}

export async function createInteractive(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const title = String(formData.get("title") ?? "").trim().slice(0, 200) || "Untitled interactive";
  const interactive = await prisma.interactive.create({
    data: {
      projectId,
      title,
      engineId: "param-sandbox",
      engineVersion: "1.0.0",
      configJson: JSON.stringify(emptySandboxConfig(title)),
    },
  });
  redirect(`/interactives/${interactive.id}`);
}

export async function deleteInteractive(formData: FormData) {
  const id = String(formData.get("id"));
  const row = await prisma.interactive.delete({ where: { id } });
  revalidatePath(`/projects/${row.projectId}`);
}

/** Saves a draft. Drafts may be invalid (per spec 9); returns validation state for the UI. */
export async function saveInteractiveConfig(id: string, rawConfig: unknown, title: string) {
  const result = validateSandboxConfig(rawConfig);
  await prisma.interactive.update({
    where: { id },
    data: {
      title: title.trim().slice(0, 200) || "Untitled interactive",
      configJson: JSON.stringify(rawConfig),
    },
  });
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
}
