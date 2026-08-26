import { describe, it, expect } from "vitest";
import { LocalDiskAssetStore, assetKey } from "@/lib/assets/store";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

describe("LocalDiskAssetStore key validation", () => {
  // A throwaway base dir under the OS temp folder — these tests never
  // write, so nothing is created here, but a real store still needs a
  // baseDir to resolve keys against.
  const store = new LocalDiskAssetStore(path.join(os.tmpdir(), "ilb-asset-store-key-test"));
  const validKey = assetKey(createHash("sha256").update("x").digest("hex"), "png");

  it("accepts a well-formed contentHash.ext key (fails only because the file doesn't exist on disk)", async () => {
    await expect(store.get(validKey)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["../x", "..", "x.exe"])("rejects %s as an invalid asset key", async (bad) => {
    await expect(store.get(bad)).rejects.toThrow("invalid asset key");
  });
});
