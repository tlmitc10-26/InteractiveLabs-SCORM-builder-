import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

export interface AssetStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** v1: local uploads/ folder. v2 swaps this for an S3-compatible store. */
export class LocalDiskAssetStore implements AssetStore {
  constructor(private baseDir = path.join(process.cwd(), "uploads")) {}
  private resolve(key: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error("invalid asset key");
    return path.join(this.baseDir, key);
  }
  async put(key: string, data: Buffer): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.resolve(key), data);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key));
  }
}

export const assetStore: AssetStore = new LocalDiskAssetStore();

export function assetKey(contentHash: string, ext: string): string {
  return `${contentHash}.${ext}`;
}
