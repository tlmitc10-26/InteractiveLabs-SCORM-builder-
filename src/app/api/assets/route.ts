import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateAsset, EXT_BY_MIME } from "@/lib/assets/validate";
import { assetStore, assetKey } from "@/lib/assets/store";

/** Content-Length precheck allows this many bytes of multipart/form-data
 *  overhead (boundaries, headers, the projectId field) on top of the
 *  policy's raw file size cap before rejecting outright. */
const CONTENT_LENGTH_OVERHEAD_ALLOWANCE = 1024 * 1024;

export async function POST(req: NextRequest) {
  let policy;
  try {
    policy = await prisma.policy.findUniqueOrThrow({ where: { id: 1 } });
  } catch (err) {
    console.error("asset upload: failed to load policy", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }

  // Content-Length precheck BEFORE parsing the multipart body at all: a
  // request that is already too large per its declared length is rejected
  // without ever calling req.formData(). NOTE: once past this check,
  // req.formData() + Buffer.from(await file.arrayBuffer()) below still
  // buffers the whole decoded file into process memory — acceptable for
  // local v1 single-process usage, but must be revisited (streaming parse,
  // or a hard byte-range abort mid-stream) before this runs on Railway
  // under concurrent multi-tenant load.
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > policy.maxAssetBytes + CONTENT_LENGTH_OVERHEAD_ALLOWANCE) {
      return NextResponse.json({ error: "upload too large" }, { status: 413 });
    }
  }

  const form = await req.formData();
  const projectId = String(form.get("projectId") ?? "");
  const file = form.get("file");
  if (!projectId || !(file instanceof File)) {
    return NextResponse.json({ error: "projectId and file are required" }, { status: 400 });
  }

  // Verify the project exists BEFORE reading/decoding the file body — no
  // point buffering and re-encoding an upload that can never be attached.
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await validateAsset(buf, {
    maxAssetBytes: policy.maxAssetBytes,
    allowedTypes: policy.allowedAssetTypes.split(","),
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });

  try {
    await assetStore.put(assetKey(result.contentHash, EXT_BY_MIME[result.mimeType]), result.data);
  } catch (err) {
    // Never let fs error messages (which embed absolute local paths) reach
    // the response body.
    console.error("asset upload: failed to write file to store", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }

  try {
    const asset = await prisma.asset.create({
      data: {
        projectId,
        filename: file.name.replace(/[^a-zA-Z0-9._ -]/g, "").slice(0, 120) || "image",
        mimeType: result.mimeType,
        byteSize: result.data.length,
        contentHash: result.contentHash,
      },
    });
    return NextResponse.json({ id: asset.id, filename: asset.filename });
  } catch (err) {
    // P2003 = foreign key constraint failed: the project was deleted in the
    // race window between the findUnique check above and this create.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json({ error: "project not found" }, { status: 400 });
    }
    console.error("asset upload: failed to create asset record", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
