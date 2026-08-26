import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assetStore, assetKey } from "@/lib/assets/store";
import { EXT_BY_MIME, ImageMime } from "@/lib/assets/validate";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await assetStore.get(assetKey(asset.contentHash, EXT_BY_MIME[asset.mimeType as ImageMime]));
  } catch (err) {
    // Never let fs error messages (which embed absolute local paths) reach
    // the response body — a missing file on disk is indistinguishable from
    // an unknown id to the client.
    console.error("asset serve: failed to read file from store", err);
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    // The asset id maps to an immutable contentHash-keyed file fixed at
    // creation time (re-uploading different bytes produces a different id
    // and a different hash), so this response can be cached forever.
    headers: { "Content-Type": asset.mimeType, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
