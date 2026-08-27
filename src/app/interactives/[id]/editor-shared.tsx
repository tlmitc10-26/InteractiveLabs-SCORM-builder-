"use client";

// Shared small building blocks + the save/preview handshake hook used by
// BOTH per-engine editors (param-sandbox-editor.tsx, branching-editor.tsx).
// Extracted mechanically from the original single-engine editor.tsx (Task 7
// split) — no redesign, no behavior change. Anything used by only ONE
// engine's editor (FormulaField, PlacementField, splitFirstEquals, the
// stage-authoring wiring, color-field.tsx) stays local to that file.

import { useCallback, useEffect, useRef, useState } from "react";
import { saveInteractiveConfig } from "@/app/actions";

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
    const runtime = toPreviewRuntime(cfg);
    // Target the iframe's own origin explicitly (not "*"): preview.html only
    // accepts messages whose ev.origin matches its own origin, and since the
    // iframe is same-origin with this page, location.origin here is correct.
    iframeRef.current?.contentWindow?.postMessage({ type: "ilb-config", config: runtime }, location.origin);
  }, [toPreviewRuntime]);

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
