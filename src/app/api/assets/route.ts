import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateAsset, EXT_BY_MIME } from "@/lib/assets/validate";
import { assetStore, assetKey } from "@/lib/assets/store";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const projectId = String(form.get("projectId") ?? "");
  const file = form.get("file");
  if (!projectId || !(file instanceof File)) {
    return NextResponse.json({ error: "projectId and file are required" }, { status: 400 });
  }
  const policy = await prisma.policy.findUniqueOrThrow({ where: { id: 1 } });
  const buf = Buffer.from(await file.arrayBuffer());
  const result = await validateAsset(buf, {
    maxAssetBytes: policy.maxAssetBytes,
    allowedTypes: policy.allowedAssetTypes.split(","),
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });

  await assetStore.put(assetKey(result.contentHash, EXT_BY_MIME[result.mimeType]), result.data);
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
}
