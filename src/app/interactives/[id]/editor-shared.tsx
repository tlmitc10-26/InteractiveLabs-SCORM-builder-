"use client";

// Shared small building blocks + the save/preview handshake hook used by
// BOTH per-engine editors (param-sandbox-editor.tsx, branching-editor.tsx).
// Extracted mechanically from the original single-engine editor.tsx (Task 7
// split) — no redesign, no behavior change. Anything used by only ONE
// engine's editor (FormulaField, PlacementField, splitFirstEquals, the
// stage-authoring wiring, color-field.tsx) stays local to that file.

import { useCallback, useEffect, useRef, useState } from "react";
import { saveInteractiveConfig } from "@/app/actions";
// Type-only import (erased at build time — zero runtime weight either way,
// but this keeps the "light import" discipline both editors' own file
// comments describe explicit): ImportPanel below is engine-agnostic and
// reuses branching's ImportIssue shape rather than redeclaring it, exactly
// as companion-doc.ts (Task 1) does for the sandbox parser's own report
// type. Both engines' `parse` functions return this same shape.
import type { ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";

export type AssetRef = { id: string; filename: string };

/* ---------- save + preview handshake (judgment call: lifted to a hook) ----------
 *
 * This is a clean, behavior-preserving lift: every line below was already
 * fully generic over the editing config's shape (it only ever spreads,
 * JSON-stringifies via the server action, or hands the config to a
 * caller-supplied `toPreviewRuntime`) — nothing here ever read an
 * EConfig-specific field. Parameterizing over `TConfig` reproduces the
 * original param-sandbox editor.tsx behavior exactly:
 *   - save serialization: at most one saveInteractiveConfig request in
 *     flight; a debounce firing mid-flight queues instead of sending; the
 *     queued send fires the instant the in-flight one settles.
 *   - requestId gate: only the response to the most-recently-*sent* request
 *     may touch errors/saveState (defense in depth on top of the
 *     serialization above).
 *   - "latest ref" pattern (configRef) so the mount-only message listener
 *     always posts the freshest config to a preview that just announced
 *     ready.
 *   - three-leg preview-ready handshake: the "ilb-preview-ready" postMessage,
 *     the iframe's own `onLoad` (exposed here as `onIframeLoad`), and the
 *     synchronous already-loaded check run once when the listener attaches.
 *   - debounced (600ms) save + immediate preview repost on every
 *     config/title change once the preview is ready.
 */
/** `toPreviewRuntime` need NOT be memoized by the caller: it's captured in
 *  a ref (`toPreviewRuntimeRef` below), updated on every render, so
 *  `postPreview`'s own identity never depends on the caller's — a fresh
 *  closure passed in on every render behaves identically to a
 *  `useCallback`-memoized one. */
export function useDraftEditor<TConfig>({ interactiveId, initialTitle, initialConfig, toPreviewRuntime }: {
  interactiveId: string;
  initialTitle: string;
  initialConfig: TConfig;
  toPreviewRuntime: (cfg: TConfig) => unknown;
}) {
  const [title, setTitleState] = useState(initialTitle);
  const [config, setConfig] = useState<TConfig>(initialConfig);
  const [errors, setErrors] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "idle">("idle");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewReady = useRef(false);

  // "Latest ref" pattern: kept in sync with `config` via an effect (never
  // written during render) so the mount-only message-listener effect below
  // can always post the freshest config to a preview that only just
  // announced it's ready, instead of whatever `config` was in scope when
  // that effect first ran.
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  // Same "latest ref" pattern, for `toPreviewRuntime` itself: kept in sync
  // via an effect with NO dependency array (so it updates after every
  // render, not just when some memoized identity changes) — this is what
  // lets `postPreview` below have a permanently stable identity regardless
  // of whether the caller wraps its `toPreviewRuntime` in `useCallback`.
  const toPreviewRuntimeRef = useRef(toPreviewRuntime);
  useEffect(() => { toPreviewRuntimeRef.current = toPreviewRuntime; });

  // Save serialization: at most one saveInteractiveConfig request may be in
  // flight. A debounce firing while a save is in flight stashes its
  // {config,title} in queuedRef instead of sending; when the in-flight
  // request settles, the queued send (if any) fires immediately. requestId
  // gates state updates so only the response to the most recently *sent*
  // request may touch setErrors/setSaveState — defense in depth even though
  // full serialization already makes responses arrive in send order.
  const inFlightRef = useRef(false);
  const queuedRef = useRef<{ config: TConfig; title: string } | null>(null);
  const requestIdRef = useRef(0);

  // Named function expression (not an arrow assigned to the outer const) so
  // the recursive call inside `.finally()` resolves to this function's own
  // JS-level self-binding, not to the `useCallback`-produced outer binding —
  // referencing a Hook's own result inside its factory is flagged by the
  // hooks linter, plain recursive-NFE closures are not.
  const sendSave = useCallback(function runSave(cfg: TConfig, ttl: string) {
    inFlightRef.current = true;
    const id = ++requestIdRef.current;
    saveInteractiveConfig(interactiveId, cfg, ttl)
      .then((result) => {
        if (id === requestIdRef.current) {
          setErrors(result.ok ? [] : result.errors);
          setSaveState("saved");
        }
      })
      .catch(() => {
        if (id === requestIdRef.current) {
          setErrors(["Draft could not be saved"]);
          setSaveState("saved");
        }
      })
      .finally(() => {
        inFlightRef.current = false;
        const queued = queuedRef.current;
        if (queued) {
          queuedRef.current = null;
          runSave(queued.config, queued.title);
        }
      });
  }, [interactiveId]);

  const postPreview = useCallback((cfg: TConfig) => {
    const runtime = toPreviewRuntimeRef.current(cfg);
    // Target the iframe's own origin explicitly (not "*"): preview.html only
    // accepts messages whose ev.origin matches its own origin, and since the
    // iframe is same-origin with this page, location.origin here is correct.
    iframeRef.current?.contentWindow?.postMessage({ type: "ilb-config", config: runtime }, location.origin);
  }, []);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "ilb-preview-ready") { previewReady.current = true; postPreview(configRef.current); }
    };
    window.addEventListener("message", onMsg);

    // Third leg of the handshake, alongside the iframe's `onLoad` (exposed
    // below as `onIframeLoad`) and the "ilb-preview-ready" message above: on
    // a genuine full-page load (hard navigation, not a client-side route
    // transition), the server-rendered <iframe src="..."> can start — and
    // finish — loading before React finishes hydrating and attaches the
    // `onLoad` handler, so that leg's trigger is simply missed; and the
    // ready-ping preview.html posts on its own script executing can likewise
    // fire before this effect has run and attached the listener above. Both
    // legs can lose their race on the very same load. This synchronous check
    // closes that remaining window: if the iframe's document is already the
    // real preview.html (not the transient about:blank) and already fully
    // loaded by the time this effect runs, treat it as ready right now
    // instead of waiting for a signal that already happened.
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc && doc.readyState === "complete" && doc.getElementById("ilb-root")) {
        previewReady.current = true;
        postPreview(configRef.current);
      }
    } catch { /* cross-origin or transient access failure: the other two legs still cover this. */ }

    return () => window.removeEventListener("message", onMsg);
  }, [postPreview]);

  // Debounced save + preview refresh on every config/title change.
  // `saveState` transitions to "saving" from the event handlers that cause a
  // change (below), not synchronously inside this effect body — the effect
  // only performs the (already-debounced) side effect of persisting once
  // things settle, per the react-hooks/set-state-in-effect rule.
  useEffect(() => {
    if (previewReady.current) postPreview(config);
    const t = setTimeout(() => {
      if (inFlightRef.current) {
        queuedRef.current = { config, title };
      } else {
        sendSave(config, title);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [config, title, postPreview, sendSave]);

  const handleTitleChange = (v: string) => { setTitleState(v); setSaveState("saving"); };
  /** Marks the draft dirty without changing config/title itself — for
   *  callers (e.g. stage-authoring's box-drag commit) whose own setConfig
   *  call may be a conditional no-op yet must still surface "Saving…"
   *  unconditionally, matching the original inline behavior exactly. */
  const markSaving = useCallback(() => setSaveState("saving"), []);
  const patch = useCallback((p: Partial<TConfig>) => { setConfig((c) => ({ ...c, ...p })); setSaveState("saving"); }, []);
  const onIframeLoad = useCallback(() => { previewReady.current = true; postPreview(configRef.current); }, [postPreview]);

  return { title, config, setConfig, errors, saveState, iframeRef, handleTitleChange, patch, markSaving, onIframeLoad };
}

/* ---------- shared small components ---------- */

export function Section({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {onAdd && <button onClick={onAdd} className="btn btn-light-2 btn-sm">+ {addLabel}</button>}
      </div>
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}

/** `dataRowKey`/`highlighted` back param-sandbox's stage-authoring selection:
 *  when a designer selects an overlay/stage-input on the live preview,
 *  StageAuthoringLayer's `onSelect` scrolls the row whose `data-row-key`
 *  matches into view and this outlines it. Both params are optional/unused
 *  by the branching editor's rows. */
export function Row({ children, onRemove, dataRowKey, highlighted }: { children: React.ReactNode; onRemove: () => void; dataRowKey?: string; highlighted?: boolean }) {
  return (
    <div data-row-key={dataRowKey} className="rounded border border-gray-100 bg-gray-50 p-3"
      style={highlighted ? { outline: "2px solid var(--rds-info)", outlineOffset: "1px" } : undefined}>
      <div className="flex justify-end"><button onClick={onRemove} className="btn-danger-link btn-sm">Remove</button></div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs"><span className="font-medium text-gray-600">{label}</span>{children}</label>;
}

export const inputCls = "mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm";

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}><input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
export function NumField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return <Field label={label}>
    <input type="number" step="any" className={inputCls} value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
  </Field>;
}
export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return <Field label={label}>
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </Field>;
}

/** Per-row "Advanced" disclosure: ids disappear from the primary editing
 *  flow but stay inspectable/rewritable here. "Rename to match label"
 *  regenerates the id from the row's current display text via `onRename` —
 *  for ids other things reference (param-sandbox inputs/outputs; branching
 *  scenes/variables/endings) that rewrites every reference atomically; for
 *  ids nothing else references (charts/overlays/challenges; branching
 *  choices) it's a same-section/scene-only local rename. */
export function IdAdvanced({ id, onRename }: { id: string; onRename: () => void }) {
  return (
    <details className="col-span-2 mt-1">
      <summary className="cursor-pointer text-xs font-medium text-gray-500">Advanced</summary>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">ID:</span>
        <code className="rounded bg-gray-100 px-1.5 py-0.5">{id}</code>
        <button type="button" onClick={onRename} className="btn btn-light-2 btn-sm">Rename to match label</button>
      </div>
    </details>
  );
}

/** Stable React `key` per row, independent of the row's own (user-editable,
 *  duplicatable-while-typing) `id` field and independent of array index
 *  (which shifts on removal). Keys live in state (not a ref — reading a ref
 *  during render to build `key=` props is unsafe/disallowed) parallel to the
 *  row array, updated in lockstep: `add()` appends a new uuid, `remove(i)`
 *  splices the same index. Both calls happen synchronously in the same
 *  event handler as the row array's own onChange, so React batches them
 *  into the same re-render — keys and rows never go out of sync. Field
 *  edits go through `update()` in each section, which replaces the row
 *  object at a fixed index without touching the keys array, so mid-typing
 *  re-renders never remount the row. */
export function useRowKeys(initialLength: number) {
  const [keys, setKeys] = useState<string[]>(() => Array.from({ length: initialLength }, () => crypto.randomUUID()));
  const add = () => setKeys((k) => [...k, crypto.randomUUID()]);
  const remove = (index: number) => setKeys((k) => k.filter((_, i) => i !== index));
  // Reordering support (branching editor's scene rail "move up/down"): keeps
  // each row's key attached to its own row when the array is reordered, the
  // same way remove() keeps keys attached when a row is deleted. Callers
  // must apply the identical splice to their own row-data array in the same
  // event handler (see branching-editor.tsx's moveScene) so keys and rows
  // never go out of sync, exactly like add()/remove() already require.
  const move = (from: number, to: number) => setKeys((k) => {
    if (to < 0 || to >= k.length || from === to) return k;
    const next = [...k];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });
  return { keys, add, remove, move };
}

/** "Import from companion doc" disclosure (companion-doc import milestone;
 *  extracted from branching-editor.tsx's original inline component — plan
 *  Task 2 — to be shared with param-sandbox-editor.tsx's own companion-doc
 *  format). Deterministic paste-in path for the plain-text formats each
 *  engine's own companion-doc.ts parses/serializes — see
 *  docs/superpowers/specs/2026-08-27-companion-doc-import-design.md (the
 *  original branching design) and 2026-08-28-exemplar-library-design.md §5
 *  (the sandbox grammar this panel is now reused for). Import is a wholesale
 *  replace (confirmed via `confirmText`), so this panel owns none of the
 *  config itself — it only ever calls `onApply` with a freshly parsed config
 *  and reports what `parse` flagged. Generic over the caller's editing
 *  config shape `TConfig`: `parse`/`serialize` are the two engine-specific
 *  companion-doc functions (or a thin wrapper casting to that engine's own
 *  `*ConfigLike` type, mirroring every other structural cast already used in
 *  each editor), and `templateHref`/`confirmText` are the two other
 *  per-engine differences (a static download link, and the replace-warning
 *  copy — identical text for both engines today, but callers own the exact
 *  wording rather than this component hard-coding it). */
export function ImportPanel<TConfig>({ config, parse, serialize, templateHref, confirmText, onApply }: {
  config: TConfig;
  parse: (text: string) => { config: unknown; report: ImportIssue[] };
  serialize: (config: TConfig) => string;
  templateHref: string;
  confirmText: string;
  onApply: (config: TConfig) => void;
}) {
  const [text, setText] = useState("");
  const [emptyWarning, setEmptyWarning] = useState(false);
  const [report, setReport] = useState<ImportIssue[] | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const reportHeadingRef = useRef<HTMLHeadingElement>(null);

  // Announcement contract: focus moves to the report heading once a report
  // exists (fresh import OR the zero-issue "Imported cleanly." case, both
  // set `report` to a non-null array) so a screen-reader user lands
  // directly on the outcome instead of having to hunt for it.
  useEffect(() => {
    if (report !== null) reportHeadingRef.current?.focus();
  }, [report]);

  const handleImportClick = () => {
    if (text.trim() === "") {
      setEmptyWarning(true);
      return;
    }
    setEmptyWarning(false);
    const parsed = parse(text);
    const proceed = window.confirm(confirmText);
    if (!proceed) return;
    onApply(parsed.config as TConfig);
    setReport(parsed.report);
  };

  const handleCopyClick = async () => {
    const doc = serialize(config);
    let succeeded = true;
    try {
      await navigator.clipboard.writeText(doc);
    } catch {
      // Fallback for browsers/contexts without a Clipboard API permission
      // (e.g. no secure context, or the permission prompt was denied): a
      // hidden textarea + the legacy execCommand path.
      const ta = document.createElement("textarea");
      ta.value = doc;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.setAttribute("aria-hidden", "true");
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        succeeded = document.execCommand("copy");
      } catch {
        succeeded = false;
      }
      document.body.removeChild(ta);
    }
    setCopyStatus(succeeded ? "copied" : "failed");
    setTimeout(() => setCopyStatus("idle"), 2000);
  };

  return (
    // `col-span-2` was inert here (opus review, item 12): neither caller
    // renders this inside a grid — param-sandbox-editor's Title/intro card
    // is a plain block, and branching-editor's <Section> wraps children in
    // a `space-y-3` stack — so the class did nothing in either usage.
    <details className="mt-2 rounded border border-gray-200 p-2">
      <summary className="cursor-pointer text-sm font-medium text-gray-600">Import from companion doc</summary>
      <div className="mt-2 space-y-2">
        <Field label="Paste a companion doc">
          <textarea className={`${inputCls} font-mono`} rows={10}
            value={text}
            onChange={(e) => { setText(e.target.value); setEmptyWarning(false); }} />
        </Field>
        {emptyWarning && <p className="text-xs" style={{ color: "var(--rds-danger)" }}>Paste a companion doc before importing.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleImportClick}>Import</button>
          <button type="button" className="btn btn-light-2 btn-sm" onClick={handleCopyClick}>Copy as companion doc</button>
          <span role="status" className="text-xs text-gray-500" style={copyStatus === "failed" ? { color: "var(--rds-danger)" } : undefined}>
            {copyStatus === "copied" ? "Copied." : copyStatus === "failed" ? "Copy failed." : ""}
          </span>
          <a href={templateHref} download className="app-link text-xs">Download the template</a>
        </div>

        {report !== null && (
          <div className="rounded border border-gray-200 bg-gray-50 p-2">
            <h3 tabIndex={-1} ref={reportHeadingRef} className="text-sm font-semibold outline-none">Import report</h3>
            {report.length === 0 ? (
              <p className="mt-1 text-sm">Imported cleanly.</p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-sm">
                {report.map((issue, i) => (
                  <li key={i} style={{ color: issue.severity === "error" ? "var(--rds-danger)" : "var(--rds-dark-2)" }}>
                    Line {issue.line}: {issue.message}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-light-2 btn-sm mt-2" onClick={() => setReport(null)}>Dismiss</button>
          </div>
        )}
      </div>
    </details>
  );
}

/** Identical between both engines' editors: POSTs the export route, saves
 *  the returned zip via a synthetic download link, and degrades a missing
 *  route / non-JSON error body to a generic message. */
export function ExportButton({ interactiveId, disabled }: { interactiveId: string; disabled: boolean }) {
  const [report, setReport] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function doExport() {
    setBusy(true); setReport(null);
    try {
      const res = await fetch(`/api/interactives/${interactiveId}/export`, { method: "POST" });
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = res.headers.get("X-Filename") ?? "package.zip";
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      }
      // A missing route (or any other non-JSON error response) returns
      // Next's HTML 404 page, not JSON. Parse defensively so that case
      // degrades to a generic message instead of throwing inside this
      // handler.
      try {
        const body = await res.json();
        setReport(body.violations?.map((v: { file: string; rule: string; detail: string }) => `${v.rule} in ${v.file}: ${v.detail}`) ?? [body.error ?? "Export failed"]);
      } catch {
        setReport([`Export failed (HTTP ${res.status})`]);
      }
    } catch {
      setReport(["Export failed (network error)"]);
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <button onClick={doExport} disabled={disabled || busy}
        className="btn btn-primary">
        {busy ? "Exporting…" : "Export SCORM package"}
      </button>
      {disabled && <p className="mt-1 text-xs text-gray-500">Fix validation issues above to enable export.</p>}
      {report && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Export blocked by compliance scan:</p>
          <ul className="mt-1 list-disc pl-5">{report.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
