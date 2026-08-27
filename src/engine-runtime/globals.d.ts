/** Shared ambient Window augmentation for every engine-runtime bundle.
 *
 * Each engine (param-sandbox/main.ts, branching-scenario/main.ts, ...) is
 * built by esbuild as its own separate entry point (scripts/build-
 * engines.mjs), but all of them are part of the SAME TypeScript program at
 * `tsc --noEmit` time. Previously each main.ts declared its own `declare
 * global { interface Window { ILBEngine?: { mount: typeof mountX } } }` —
 * fine for one engine, but a second engine's differently-typed `mount`
 * property on the same ambient `Window.ILBEngine` interface fails
 * TypeScript's declaration-merging (two incompatible types for the same
 * property). Consolidated here as the single source of truth instead.
 *
 * `config: never` is deliberate, not a mistake: this ambient declaration
 * describes the SHAPE callers see through `window.ILBEngine.mount(...)`
 * (untyped call sites in practice — preview.html/index.html are plain JS),
 * not a signature meant to be called from typed TS code. Because the
 * property is declared with METHOD-SHORTHAND syntax (`mount(...): void`,
 * not `mount: (...) => void`), TypeScript checks assignability to it
 * BIVARIANTLY rather than under strictFunctionTypes' normal contravariant
 * parameter checking. Bivariant checking accepts a source function if
 * EITHER direction of parameter-type comparison succeeds — and `never` is a
 * subtype of every type, so "target param (never) assignable to source
 * param" is trivially true no matter what real config type a given engine's
 * mount function actually declares. The upshot: `window.ILBEngine = {
 * mount: mountBranchingScenario }` (or `mountSandbox`, or any future
 * engine's own precisely-typed mount function) type-checks against this
 * ambient declaration with no cast, from any engine, without this file
 * needing to know about any engine's specific runtime-config type.
 */
import type { ScormSession } from "./scorm-adapter";

declare global {
  interface Window {
    ILBEngine?: { mount(root: HTMLElement, config: never): void };
    ILBScorm?: ScormSession;
  }
}
