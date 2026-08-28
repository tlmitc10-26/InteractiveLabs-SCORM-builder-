/**
 * Pure, dependency-free id-from-label helpers for the humanized editor. IDs
 * must satisfy schema.ts's `safeId` pattern (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`,
 * 1-40 chars): lowercase letters/digits/underscore, starting with a letter
 * or underscore. `slugify` produces a raw (possibly colliding, possibly
 * empty-fallback) candidate; `uniqueSlug` appends the caller's own
 * `newId`-style numeric-suffix collision handling on top of it.
 *
 * Lives under src/lib/engines/ (not src/app/) so light lib modules — e.g.
 * companion-doc.ts — can depend on it without a lib->app import direction.
 * Originally at src/app/interactives/[id]/slugify.ts, which now re-exports
 * this module so existing imports keep working.
 */

const FALLBACK_PREFIX = "n";
/** Ids cap at 40 chars (schema.ts's safeId); leave room for a "_NN" collision
 *  suffix appended by uniqueSlug without ever exceeding that cap. */
const MAX_ID_LENGTH = 40;
const MAX_BASE_LENGTH = 32;

/** Lowercases, replaces every run of non [a-z0-9_] with a single "_",
 *  trims leading/trailing "_", collapses repeated "_", and — since ids must
 *  start with a letter/underscore, never a digit — prefixes a leading digit
 *  with `n_`. An input that slugifies to nothing at all falls back to
 *  `fallback` so callers never see an empty string. */
export function slugify(label: string, fallback = "input"): string {
  let s = label
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (s === "") return fallback;
  if (/^[0-9]/.test(s)) s = `${FALLBACK_PREFIX}_${s}`;
  s = s.slice(0, MAX_BASE_LENGTH).replace(/_+$/g, "");
  return s === "" ? fallback : s;
}

/** Appends `_2`, `_3`, ... until the candidate isn't already in
 *  `existingIds` (mirrors editor.tsx's `newId` collision strategy, but
 *  starting from a label-derived base instead of a fixed prefix). Never
 *  returns the empty string, and never exceeds the 40-char id cap even after
 *  a numeric suffix is appended (the base is already capped shorter than
 *  that to leave room). */
export function uniqueSlug(label: string, existingIds: Set<string>, fallback = "input"): string {
  const base = slugify(label, fallback);
  if (!existingIds.has(base)) return base;
  let n = 2;
  let candidate = `${base}_${n}`.slice(0, MAX_ID_LENGTH);
  while (existingIds.has(candidate)) {
    n += 1;
    candidate = `${base}_${n}`.slice(0, MAX_ID_LENGTH);
  }
  return candidate;
}
