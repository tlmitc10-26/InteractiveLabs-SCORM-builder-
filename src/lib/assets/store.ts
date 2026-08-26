import { mkdir, readFile, writeFile, unlink, rename, stat } from "node:fs/promises";
import path from "node:path";

export interface AssetStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

// assetKey() always produces exactly this shape: a 64-char lowercase hex
// sha256 contentHash, a literal ".", and one of the three allowed image
// extensions. Matching the real shape (rather than a loose charset) means
// no path-traversal-ish key (e.g. "..", "../x") or unexpected extension
// (e.g. "x.exe") can ever resolve, even accidentally.
const KEY_RE = /^[a-f0-9]{64}\.(png|jpg|webp)$/;

/** v1: local uploads/ folder. v2 swaps this for an S3-compatible store. */
export class LocalDiskAssetStore implements AssetStore {
  constructor(private baseDir = path.join(process.cwd(), "uploads")) {}
  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("invalid asset key");
    return path.join(this.baseDir, key);
  }
  async put(key: string, data: Buffer): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const dest = this.resolve(key);
    // Write-then-rename: rename is atomic on both Windows and POSIX, so a
    // reader can never observe a partially-written file, and two concurrent
    // uploads of the same bytes (same contentHash key) can't corrupt each
    // other's write.
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await writeFile(tmp, data);
    try {
      await rename(tmp, dest);
    } catch (err) {
      // Windows throws EEXIST/EPERM when renaming a temp file over an
      // already-existing destination (POSIX would just replace it). Since
      // the destination is keyed by contentHash, if it already exists its
      // content is identical to what we just wrote — a concurrent upload of
      // the same image won the race. Clean up our temp file and treat this
      // as success; only re-throw if the destination turns out not to
      // exist after all (a genuinely different failure).
      await unlink(tmp).catch(() => {});
      try {
        await stat(dest);
      } catch {
        throw err;
      }
    }
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
