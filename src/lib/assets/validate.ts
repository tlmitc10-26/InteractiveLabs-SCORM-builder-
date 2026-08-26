import sharp from "sharp";
import { createHash } from "node:crypto";

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export function sniffImageType(buf: Buffer): ImageMime | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export interface AssetPolicy { maxAssetBytes: number; allowedTypes: string[] }

export type AssetValidation =
  | { ok: true; data: Buffer; mimeType: ImageMime; contentHash: string }
  | { ok: false; reason: string };

/** Sniff type, enforce policy, re-encode via sharp (strips EXIF/metadata), hash. */
export async function validateAsset(buf: Buffer, policy: AssetPolicy): Promise<AssetValidation> {
  if (buf.length > policy.maxAssetBytes) {
    return { ok: false, reason: `file size ${buf.length} exceeds maximum ${policy.maxAssetBytes} bytes` };
  }
  const mime = sniffImageType(buf);
  if (!mime || !policy.allowedTypes.includes(mime)) {
    return { ok: false, reason: "file type not allowed (PNG, JPEG, or WebP required; type is detected from content, not filename)" };
  }
  try {
    const pipeline = sharp(buf, { limitInputPixels: 30_000_000 }).rotate();
    const data =
      mime === "image/png" ? await pipeline.png().toBuffer()
      : mime === "image/jpeg" ? await pipeline.jpeg({ quality: 90 }).toBuffer()
      : await pipeline.webp({ quality: 90 }).toBuffer();
    const contentHash = createHash("sha256").update(data).digest("hex");
    return { ok: true, data, mimeType: mime, contentHash };
  } catch {
    return { ok: false, reason: "image could not be decoded" };
  }
}

export const EXT_BY_MIME: Record<ImageMime, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
};
