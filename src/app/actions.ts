"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { STARTERS, starterConfig, DEFAULT_STARTER_ID } from "@/lib/engines/param-sandbox/starter-configs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const MAX_DRAFT_BYTES = 200 * 1024;

export async function createProject(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  // Silent no-op on empty title: the client-side `required` attribute covers
  // the normal path, this is just a defensive backstop against direct posts.
  if (!title) return;
  const project = await prisma.project.create({ data: { title } });
  redirect(`/projects/${project.id}`);
}

export async function deleteProject(formData: FormData) {
  // TODO(follow-up, post Task 10): cascade delete is DB-only. Uploaded files
  // (src/lib/assets/store.ts, LocalDiskAssetStore) are keyed by contentHash
  // via assetKey() and may be shared across projects (dedup) — before
  // unlinking a project's assets from disk, query prisma.asset.count({
  // where: { contentHash, projectId: { not: id } } }) per asset to confirm
  // no other project still references that hash. v1 intentionally keeps all
  // uploaded files on disk (no deletion/GC) even after this delete.
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.project.delete({ where: { id } });
  revalidatePath("/");
}

export async function createInteractive(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  const title = String(formData.get("title") ?? "").trim().slice(0, 200) || "Untitled interactive";
  // Unknown/missing starter id falls back to the blank starter — a stray or
  // tampered form value must never 500 this action.
  const requestedStarter = String(formData.get("starter") ?? DEFAULT_STARTER_ID);
  const starterId = Object.prototype.hasOwnProperty.call(STARTERS, requestedStarter) ? requestedStarter : DEFAULT_STARTER_ID;
  const interactive = await prisma.interactive.create({
    data: {
      projectId,
      title,
      engineId: "param-sandbox",
      engineVersion: "1.0.0",
      configJson: JSON.stringify(starterConfig(starterId, title)),
    },
  });
  redirect(`/interactives/${interactive.id}`);
}

export async function deleteInteractive(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const row = await prisma.interactive.delete({ where: { id } });
  revalidatePath(`/projects/${row.projectId}`);
}

/** Saves a draft. Drafts may be invalid (per spec 9); returns validation state for the UI.
 *  Called on every editor change (debounced ~600ms), so this must be defensive: it never
 *  throws to the caller, it caps payload size, and it reports save failures the same way
 *  it reports validation failures ({ok:false, errors}) — the editor just shows the messages. */
export async function saveInteractiveConfig(id: string, rawConfig: unknown, title: string) {
  const result = validateSandboxConfig(rawConfig);

  let configJson: string;
  try {
    configJson = JSON.stringify(rawConfig);
  } catch {
    return { ok: false as const, errors: ["Draft could not be serialized"] };
  }

  if (Buffer.byteLength(configJson, "utf8") > MAX_DRAFT_BYTES) {
    return { ok: false as const, errors: ["Draft too large to save (limit 200 KB)"] };
  }

  try {
    await prisma.interactive.update({
      where: { id },
      data: {
        title: title.trim().slice(0, 200) || "Untitled interactive",
        configJson,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { ok: false as const, errors: ["This interactive no longer exists"] };
    }
    console.error("saveInteractiveConfig: failed to save draft", err);
    return { ok: false as const, errors: ["Draft could not be saved"] };
  }

  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
}
