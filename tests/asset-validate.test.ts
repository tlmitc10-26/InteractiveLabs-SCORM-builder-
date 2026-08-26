import { describe, it, expect } from "vitest";
import { sniffImageType, validateAsset } from "@/lib/assets/validate";
import sharp from "sharp";

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: "#ff0000" } }).png().toBuffer();
}

describe("sniffImageType", () => {
  it("detects png / jpeg / webp from magic bytes", async () => {
    expect(sniffImageType(await png())).toBe("image/png");
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#00ff00" } }).jpeg().toBuffer();
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#0000ff" } }).webp().toBuffer();
    expect(sniffImageType(webp)).toBe("image/webp");
  });
  it("rejects SVG and other content regardless of claimed name", () => {
    expect(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(Buffer.from("#!/bin/sh\necho hi"))).toBeNull();
  });
});

describe("validateAsset", () => {
  const policy = { maxAssetBytes: 5 * 1024 * 1024, allowedTypes: ["image/png", "image/jpeg", "image/webp"] };
  it("accepts a valid png and re-encodes it (metadata stripped)", async () => {
    const r = await validateAsset(await png(), policy);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mimeType).toBe("image/png");
      expect(r.data.length).toBeGreaterThan(0);
      expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("rejects oversized files with a specific reason", async () => {
    const r = await validateAsset(await png(), { ...policy, maxAssetBytes: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/size/i);
  });
  it("rejects disallowed types", async () => {
    const r = await validateAsset(Buffer.from("<svg/>"), policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/type/i);
  });
});
