import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assetStore, assetKey } from "@/lib/assets/store";
import { EXT_BY_MIME, ImageMime } from "@/lib/assets/validate";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) return new NextResponse("Not found", { status: 404 });
  const data = await assetStore.get(assetKey(asset.contentHash, EXT_BY_MIME[asset.mimeType as ImageMime]));
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": asset.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
