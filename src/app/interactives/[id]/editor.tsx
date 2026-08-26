"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveInteractiveConfig } from "@/app/actions";
// Light, zod-free import on purpose: this is a client component, and
// runtime-config.ts pulls in only @/lib/design/tokens (no zod, no
// sanitize-html, no formula parser) — importing those from schema.ts here
// would drag their weight into this route's client bundle for no benefit,
// since the editor never validates, only resolves/reshapes for preview.
import { toRuntimeConfig, type SandboxConfigLike, type ColorRef } from "@/lib/engines/param-sandbox/runtime-config";
import { colorHex } from "@/lib/design/tokens";
import { ColorField } from "./color-field";
import { StageAuthoringLayer, type Target as StageTarget } from "./stage-authoring";
import { uniqueSlug } from "./slugify";
// Light import (no zod/sanitize-html — see runtime-config.ts's own file
// comment for why that matters for this client bundle): rename.ts only
// pulls in the formula parser to rewrite formula/chart/challenge/overlay
// references when a designer renames an id via a row's Advanced disclosure.
import { renameIdentifier, type RenameableConfig } from "@/lib/engines/param-sandbox/rename";

/* Editing shape mirrors the Zod input (pre-validation). */
/** Placement model (schema.ts's `placementSchema`, Task 11): where an
 *  input renders. Absent = implicit "panel" (legacy configs, and any new
 *  row until a designer explicitly moves it — that picker arrives in Task
 *  13). "stage" placement is what StageAuthoringLayer (Task 12, below)
 *  drags/resizes/nudges: its `box` is a percent-of-stage rect, same shape
 *  as an overlay's own `box`. */
type EPlacement = { zone: "panel" } | { zone: "below" } | { zone: "stage"; box: Box };
type EInput = { id: string; label: string; type: "slider" | "number" | "toggle" | "select"; min?: number; max?: number; step?: number; defaultValue: number; units?: string; options?: Array<{ label: string; value: number }>; placement?: EPlacement };
type EOutput = { id: string; label: string; formula: string; units?: string; decimals?: number; placement?: EPlacement };
type EChart = { id: string; title: string; xInputId: string; yOutputId: string; samples: number };
/* Hybrid verifiable color model (schema.ts ColorRef): a named RDS token or a
 * verified custom hex. Rendered/edited via color-field.tsx's token swatches
 * + live contrast readout (see VisualSection below). */
type EColorRef = { token: string } | { hex: string };
type EOverlay =
  | { id: string; type: "fill"; outputId: string; inMin: number; inMax: number; color: EColorRef; box: Box }
  | { id: string; type: "swap"; outputId: string; box: Box; bands: Array<{ upTo: number; assetId: string }> }
  | { id: string; type: "transform"; outputId: string; box: Box; assetId: string; property: "translateY" | "translateX" | "rotate" | "scale" | "opacity"; inMin: number; inMax: number; outMin: number; outMax: number };
type Box = { x: number; y: number; w: number; h: number };
type ELayout = "side" | "stacked" | "stage-focus";
type EConfig = {
  title: string; intro?: string;
  inputs: EInput[]; outputs: EOutput[]; charts: EChart[];
  visual?: { backgroundAssetId?: string; overlays: EOverlay[] };
  challenges: Array<{ id: string; prompt: string; outputId: string; comparator: "gte" | "lte" | "between"; value?: number; min?: number; max?: number }>;
  /* Layout preset (schema.ts's `sandboxConfigSchema.layout`, Task 11):
   * absent is treated as "side" everywhere it's read here (the schema
   * default) — a pre-Task-11 stored draft, or one read via the page's raw
   * JSON.parse (not re-validated), may not carry this field at all. */
  layout?: ELayout;
};
type AssetRef = { id: string; filename: string };

const PREVIEW_SRC = "/engines/param-sandbox/1.0.0/preview.html";

export function Editor({ interactiveId, initialTitle, initialConfig, assets }: {
  interactiveId: string; initialTitle: string; initialConfig: EConfig; assets: AssetRef[];
}) {
  const [title, setTitle] = useState(initialTitle);
  const [config, setConfig] = useState<EConfig>(initialConfig);
  const [errors, setErrors] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "idle">("idle");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewReady = useRef(false);

  // Stage authoring (Task 12): which overlay/stage-input is selected for
  // drag/resize/nudge, keyed "overlay:<id>" / "input:<id>" — see `targets`
  // and `handleBoxChange`/`handleSelect` below.
  const [selected, setSelected] = useState<string | null>(null);

  // "Latest ref" pattern: kept in sync with `config` via an effect (never
  // written during render) so the mount-only message-listener effect below
  // (fix #2) can always post the freshest config to a preview that only
  // just announced it's ready, instead of whatever `config` was in scope
  // when that effect first ran.
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  // Save serialization (fix #1): at most one saveInteractiveConfig request
  // may be in flight. A debounce firing while a save is in flight stashes
  // its {config,title} in queuedRef instead of sending; when the in-flight
  // request settles, the queued send (if any) fires immediately. requestId
  // gates state updates so only the response to the most recently *sent*
  // request may touch setErrors/setSaveState — defense in depth even though
  // full serialization already makes responses arrive in send order.
  const inFlightRef = useRef(false);
  const queuedRef = useRef<{ config: EConfig; title: string } | null>(null);
  const requestIdRef = useRef(0);

  // Named function expression (not an arrow assigned to the outer const) so
  // the recursive call inside `.finally()` resolves to this function's own
  // JS-level self-binding, not to the `useCallback`-produced outer binding —
  // referencing a Hook's own result inside its factory is flagged by the
  // hooks linter, plain recursive-NFE closures are not.
  const sendSave = useCallback(function runSave(cfg: EConfig, ttl: string) {
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

  const postPreview = useCallback((cfg: EConfig) => {
    // EConfig (this file's editing shape) is structurally the same authoring
    // shape schema.ts's SandboxConfig satisfies (SandboxConfigLike), except
    // its fill-overlay `color.token` is a plain `string` (not the narrower
    // `TokenName`) since the editor doesn't validate token names as the
    // designer types — and a mid-edit draft can be structurally invalid in
    // other ways too (empty ids, out-of-range values). toRuntimeConfig only
    // reshapes assetIds/colors and never asserts validity, so a best-effort
    // preview of an invalid draft is unaffected; this is the one cast site.
    const runtime = toRuntimeConfig(cfg as unknown as SandboxConfigLike, (assetId) => `/api/assets/${assetId}`);
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

    // Third leg of the handshake, alongside the iframe's `onLoad` prop and
    // the "ilb-preview-ready" message above: on a genuine full-page load
    // (hard navigation, not a client-side route transition), the
    // server-rendered <iframe src="..."> can start — and finish — loading
    // before React finishes hydrating and attaches the `onLoad` handler, so
    // that leg's trigger is simply missed; and the ready-ping preview.html
    // posts on its own script executing can likewise fire before this
    // effect has run and attached the listener above. Both legs can lose
    // their race on the very same load. This synchronous check closes that
    // remaining window: if the iframe's document is already the real
    // preview.html (not the transient about:blank) and already fully
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

  const handleTitleChange = (v: string) => { setTitle(v); setSaveState("saving"); };
  const patch = (p: Partial<EConfig>) => { setConfig((c) => ({ ...c, ...p })); setSaveState("saving"); };

  // Backs each row's "Rename to match label" Advanced affordance for inputs
  // and outputs (the only ids formulas/charts/challenges/overlays actually
  // reference — see rename.ts). Rewrites every reference atomically in one
  // setConfig update, so the config is never briefly inconsistent. EConfig
  // structurally satisfies RenameableConfig (same shape rename.ts's pure
  // module already expects) — cast the same way postPreview above does for
  // its own structural-superset reason.
  const renameId = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameIdentifier(c as unknown as RenameableConfig, oldId, newId) as unknown as EConfig);
    setSaveState("saving");
  }, []);

  // ---------- stage authoring (Task 12) ----------

  // Targets = overlays (fill/swap/transform, always stage-placed by nature)
  // plus any input/output whose placement.zone is "stage" — Task 13's "Where
  // it appears" picker (below) is what now sets that field going forward,
  // but a config can already carry a stage placement from hand-authoring or
  // a future starter, so this reads it defensively either way. Outputs are
  // wired symmetrically to inputs (key "output:<id>", routing through
  // output.placement.box) so a stage-placed output drags/resizes/nudges
  // exactly like a stage-placed input.
  const overlays = config.visual?.overlays ?? [];
  const stageInputs = config.inputs.filter((inp): inp is EInput & { placement: { zone: "stage"; box: Box } } => inp.placement?.zone === "stage");
  const stageOutputs = config.outputs.filter((out): out is EOutput & { placement: { zone: "stage"; box: Box } } => out.placement?.zone === "stage");
  const targets: StageTarget[] = [
    ...overlays.map((ov) => ({
      key: `overlay:${ov.id}`,
      label: `${ov.type} → ${config.outputs.find((o) => o.id === ov.outputId)?.label ?? ov.outputId}`,
      box: ov.box,
    })),
    ...stageInputs.map((inp) => ({ key: `input:${inp.id}`, label: inp.label, box: inp.placement.box })),
    ...stageOutputs.map((out) => ({ key: `output:${out.id}`, label: out.label, box: out.placement.box })),
  ];

  // Routes a drag/resize/nudge commit from the stage layer into the same
  // config slot the numeric Box fields already write to (overlay.box, or
  // input/output.placement.box) — both paths converge on the same setConfig
  // call, so the fields and the on-stage outline never disagree.
  const handleBoxChange = useCallback((key: string, box: Box) => {
    if (key.startsWith("overlay:")) {
      const id = key.slice("overlay:".length);
      setConfig((c) => (c.visual
        ? { ...c, visual: { ...c.visual, overlays: c.visual.overlays.map((o) => (o.id === id ? { ...o, box } : o)) } }
        : c));
    } else if (key.startsWith("input:")) {
      const id = key.slice("input:".length);
      setConfig((c) => ({
        ...c,
        inputs: c.inputs.map((i) => (i.id === id && i.placement?.zone === "stage" ? { ...i, placement: { ...i.placement, box } } : i)),
      }));
    } else if (key.startsWith("output:")) {
      const id = key.slice("output:".length);
      setConfig((c) => ({
        ...c,
        outputs: c.outputs.map((o) => (o.id === id && o.placement?.zone === "stage" ? { ...o, placement: { ...o.placement, box } } : o)),
      }));
    }
    setSaveState("saving");
  }, []);

  // Selecting a target on the stage also scrolls its form row into view —
  // rows carry a matching `data-row-key` (see Row, below). Deferred one
  // frame since a fresh selection can itself cause the row's section to
  // re-render (e.g. a highlight style), and scrollIntoView is most reliable
  // against final layout.
  const handleSelect = useCallback((key: string | null) => {
    setSelected(key);
    if (key) {
      requestAnimationFrame(() => {
        document.querySelector(`[data-row-key="${key}"]`)?.scrollIntoView({ block: "nearest" });
      });
    }
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="max-h-[85vh] space-y-4 overflow-y-auto pr-2">
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <label htmlFor="ilb-title-field" className="block text-sm font-semibold">Title</label>
            <span className="text-xs text-gray-400">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}</span>
          </div>
          <input id="ilb-title-field" value={title} onChange={(e) => handleTitleChange(e.target.value)} maxLength={200}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2" />
          <label htmlFor="ilb-intro-field" className="mt-3 block text-sm font-semibold">Intro (basic formatting allowed)</label>
          <textarea id="ilb-intro-field" value={config.intro ?? ""} onChange={(e) => patch({ intro: e.target.value })} rows={3}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm" />
        </div>

        {errors.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            {/* Neutral wording: `errors` covers both validation failures (config
                won't export) and save failures (size cap, deleted record,
                serialization) — "not exportable yet" would misdescribe the latter. */}
            <p className="font-semibold text-amber-900">Issues:</p>
            <ul className="mt-1 list-disc pl-5 text-amber-800">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        <InputsSection inputs={config.inputs} otherIds={new Set(config.outputs.map((o) => o.id))} selected={selected}
          hasVisual={!!config.visual} onChange={(inputs) => patch({ inputs })} onRenameId={renameId} />
        <OutputsSection outputs={config.outputs} inputs={config.inputs} otherIds={new Set(config.inputs.map((i) => i.id))}
          selected={selected} hasVisual={!!config.visual} onChange={(outputs) => patch({ outputs })} onRenameId={renameId} />
        <ChartsSection charts={config.charts} inputs={config.inputs} outputs={config.outputs} onChange={(charts) => patch({ charts })} />
        <VisualSection visual={config.visual} outputs={config.outputs} assets={assets} selected={selected}
          layout={config.layout ?? "side"} onLayoutChange={(layout) => patch({ layout })}
          onChange={(visual) => patch({ visual })} />
        <ChallengesSection challenges={config.challenges} outputs={config.outputs} onChange={(challenges) => patch({ challenges })} />

        <ExportButton interactiveId={interactiveId} disabled={errors.length > 0} />
      </div>

      <div className="sticky top-4 h-[85vh]">
        <p className="mb-1 text-sm font-semibold text-gray-600">Live preview (actual engine runtime)</p>
        {/* No `sandbox` attribute: preview.html validates postMessage origin
            (ev.origin === location.origin && ev.source === window.parent) and
            posts its ready-ping to location.origin. `sandbox="allow-scripts"`
            would give the iframe an opaque ("null") origin, which fails both
            checks and breaks the handshake entirely. The iframe content is our
            own audited engine bundle served from this same origin
            (/engines/param-sandbox/...), so there is no isolation benefit to
            sandboxing it here — verified empirically that omitting `sandbox`
            is required for the ready-ping/config handshake to work. */}
        {/* Belt-and-suspenders for the handshake: preview.html's own inline
            listener + ready-ping is registered as soon as it's parsed, but
            in practice (esp. dev-mode hydration racing a much lighter static
            iframe load) that ready-ping can arrive before this page's message
            listener effect has attached. The iframe's `load` event fires
            once its document (including that inline script) has finished
            executing, so posting the current config here reaches a listener
            that's already live either way. Also flips `previewReady` (same
            as the message handler) so later edits keep posting live updates
            through the debounce effect even on a run where the ready-ping
            message is never received at all — this is a superset of the
            message-based path, not a replacement for it. */}
        {/* Task 12: StageAuthoringLayer is a plain sibling of the iframe inside
            this `relative` wrapper, absolutely positioned to cover it exactly
            (`inset-0`). It measures `.ilb-stage` inside the iframe's own
            contentDocument itself (same-origin, read-only) and never touches
            the save/preview handshake above — it only ever calls
            `handleBoxChange`, which goes through the same `setConfig` path as
            the Box form fields, so the preview repost + debounced save
            already wired up run exactly as they would for a typed edit. */}
        <div className="relative h-full w-full">
          <iframe ref={iframeRef} src={PREVIEW_SRC} title="Preview"
            onLoad={() => { previewReady.current = true; postPreview(configRef.current); }}
            className="h-full w-full rounded border border-gray-300 bg-white" />
          <StageAuthoringLayer iframeRef={iframeRef} selected={selected} onSelect={handleSelect}
            onBoxChange={handleBoxChange} targets={targets} />
        </div>
      </div>
    </div>
  );
}

/* ---------- shared small components ---------- */

function Section({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: React.ReactNode }) {
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

/** `dataRowKey`/`highlighted` back Task 12's stage-authoring selection:
 *  when a designer selects an overlay/stage-input on the live preview,
 *  StageAuthoringLayer's `onSelect` scrolls the row whose `data-row-key`
 *  matches into view (see `handleSelect` above) and this outlines it. */
function Row({ children, onRemove, dataRowKey, highlighted }: { children: React.ReactNode; onRemove: () => void; dataRowKey?: string; highlighted?: boolean }) {
  return (
    <div data-row-key={dataRowKey} className="rounded border border-gray-100 bg-gray-50 p-3"
      style={highlighted ? { outline: "2px solid var(--rds-info)", outlineOffset: "1px" } : undefined}>
      <div className="flex justify-end"><button onClick={onRemove} className="btn-danger-link btn-sm">Remove</button></div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs"><span className="font-medium text-gray-600">{label}</span>{children}</label>;
}

const inputCls = "mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm";

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}><input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function NumField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return <Field label={label}>
    <input type="number" step="any" className={inputCls} value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
  </Field>;
}
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return <Field label={label}>
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </Field>;
}

/** Splits on the FIRST "=" only, so a label/value containing "=" doesn't get
 *  silently truncated or shifted (used for "label=value" and "upTo=assetId"
 *  textarea lines). Returns ["", ""] worth of slack when there's no "=". */
function splitFirstEquals(line: string): [string, string] {
  const idx = line.indexOf("=");
  if (idx === -1) return [line, ""];
  return [line.slice(0, idx), line.slice(idx + 1)];
}

/** Per-row "Advanced" disclosure: ids disappear from the primary editing
 *  flow (per Task 9's humanization contract) but stay inspectable/rewritable
 *  here. "Rename to match label" regenerates the id from the row's current
 *  display text via `onRename` — for inputs/outputs that rewrites every
 *  formula/chart/challenge/overlay reference atomically (see `renameId` in
 *  the top-level Editor component); for charts/overlays/challenges nothing
 *  else references their id, so it's a same-section-only local rename. */
function IdAdvanced({ id, onRename }: { id: string; onRename: () => void }) {
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

/** Per-row "Where it appears" placement picker (Task 13), shared by
 *  inputs and outputs. Panel (default) and "Below the scene" just set the
 *  matching zone directly. "On the scene" needs a visual scene to render
 *  into: when `hasVisual` is false this shows inline guidance instead of
 *  setting anything (the select itself snaps back to the row's actual
 *  current zone on the next render, since `onChange` was never called).
 *  When a visual scene DOES exist, choosing "On the scene" seeds a default
 *  box — the designer then drags/resizes it via StageAuthoringLayer, or
 *  edits the numeric fields Task 12 already wired up for other stage
 *  targets (overlays don't have per-row numeric box fields themselves; a
 *  stage-placed input/output's box is authored on-stage or by re-dragging).
 *  Switching away from "stage" drops the box entirely — the new placement
 *  object never carries one, matching the strict panel/below schema shape. */
function PlacementField({ placement, hasVisual, onChange }: {
  placement: EPlacement | undefined; hasVisual: boolean; onChange: (p: EPlacement) => void;
}) {
  const zone = placement?.zone ?? "panel";
  const [showHint, setShowHint] = useState(false);
  return (
    <Field label="Where it appears">
      <select className={inputCls} value={zone}
        onChange={(e) => {
          const next = e.target.value as "panel" | "below" | "stage";
          if (next === "stage") {
            if (!hasVisual) { setShowHint(true); return; }
            setShowHint(false);
            onChange({ zone: "stage", box: { x: 60, y: 70, w: 30, h: 12 } });
          } else {
            setShowHint(false);
            onChange({ zone: next });
          }
        }}>
        <option value="panel">Panel</option>
        <option value="below">Below the scene</option>
        <option value="stage">On the scene</option>
      </select>
      {showHint && <span className="mt-0.5 block text-xs text-amber-700">Add a visual scene first</span>}
    </Field>
  );
}

/** Formula input with a same-row "insert name" picker: choosing an
 *  available identifier (inputs + earlier outputs) inserts it at the
 *  input's current cursor position (falls back to appending when the
 *  cursor position isn't available, e.g. before the element has ever been
 *  focused). The picker is a controlled select that always resets back to
 *  its placeholder — it's an action trigger, not a persisted choice. */
function FormulaField({ value, identifiers, onChange }: {
  value: string; identifiers: Array<{ id: string; label: string }>; onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const insertAtCursor = (name: string) => {
    const el = ref.current;
    const start = el && typeof el.selectionStart === "number" ? el.selectionStart : value.length;
    const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : start;
    const next = `${value.slice(0, start)}${name}${value.slice(end)}`;
    onChange(next);
    const caret = start + name.length;
    // Cursor restoration needs the element's value to already reflect
    // `next` (a controlled input only re-renders after this handler
    // returns), so defer one frame rather than calling setSelectionRange
    // synchronously against the still-stale DOM value.
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(caret, caret); });
  };

  return (
    <Field label="Formula">
      <div className="flex gap-1">
        <input ref={ref} className={`${inputCls} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} />
        <select aria-label="Insert name" className={`${inputCls} w-28 flex-none`} value=""
          onChange={(e) => { const name = e.target.value; if (name) insertAtCursor(name); e.target.value = ""; }}>
          <option value="">Insert name…</option>
          {identifiers.map((idf) => <option key={idf.id} value={idf.id}>{idf.label}</option>)}
        </select>
      </div>
      <span className="mt-0.5 block text-xs text-gray-500">Use the names of things learners adjust, e.g. mass / density * 1000</span>
    </Field>
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
function useRowKeys(initialLength: number) {
  const [keys, setKeys] = useState<string[]>(() => Array.from({ length: initialLength }, () => crypto.randomUUID()));
  const add = () => setKeys((k) => [...k, crypto.randomUUID()]);
  const remove = (index: number) => setKeys((k) => k.filter((_, i) => i !== index));
  return { keys, add, remove };
}

/* ---------- sections ---------- */

function InputsSection({ inputs, otherIds, selected, hasVisual, onChange, onRenameId }: {
  inputs: EInput[]; otherIds: Set<string>; selected: string | null; hasVisual: boolean; onChange: (v: EInput[]) => void; onRenameId: (oldId: string, newId: string) => void;
}) {
  const rowKeys = useRowKeys(inputs.length);
  const update = (i: number, p: Partial<EInput>) => onChange(inputs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="What learners adjust" addLabel="input"
      onAdd={() => {
        rowKeys.add();
        const label = "New input";
        const id = uniqueSlug(label, new Set([...inputs.map((x) => x.id), ...otherIds]));
        onChange([...inputs, { id, label, type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }]);
      }}>
      {inputs.map((inp, i) => (
        <Row key={rowKeys.keys[i]} dataRowKey={`input:${inp.id}`} highlighted={selected === `input:${inp.id}`}
          onRemove={() => { rowKeys.remove(i); onChange(inputs.filter((_, j) => j !== i)); }}>
          <TextField label="Label" value={inp.label} onChange={(label) => update(i, { label })} />
          <SelectField label="Type" value={inp.type}
            options={["slider", "number", "toggle", "select"].map((t) => ({ value: t, label: t }))}
            onChange={(type) => update(i, { type: type as EInput["type"] })} />
          <TextField label="Units" value={inp.units ?? ""} onChange={(units) => update(i, { units: units || undefined })} />
          {(inp.type === "slider" || inp.type === "number") && (<>
            <NumField label="Min" value={inp.min} onChange={(min) => update(i, { min })} />
            <NumField label="Max" value={inp.max} onChange={(max) => update(i, { max })} />
            <NumField label="Step" value={inp.step} onChange={(step) => update(i, { step })} />
          </>)}
          <NumField label="Default" value={inp.defaultValue} onChange={(defaultValue) => update(i, { defaultValue: defaultValue ?? 0 })} />
          <PlacementField placement={inp.placement} hasVisual={hasVisual} onChange={(placement) => update(i, { placement })} />
          {inp.type === "select" && (
            <Field label="Options (label=value, one per line)">
              <textarea className={inputCls} rows={3}
                value={(inp.options ?? []).map((o) => `${o.label}=${o.value}`).join("\n")}
                onChange={(e) => update(i, {
                  options: e.target.value.split("\n").filter(Boolean).map((line) => {
                    const [label, value] = splitFirstEquals(line);
                    return { label, value: Number(value || 0) };
                  }),
                })} />
            </Field>
          )}
          <IdAdvanced id={inp.id} onRename={() => {
            const others = new Set([...inputs.filter((_, j) => j !== i).map((x) => x.id), ...otherIds]);
            const newIdCandidate = uniqueSlug(inp.label, others);
            if (newIdCandidate !== inp.id) onRenameId(inp.id, newIdCandidate);
          }} />
        </Row>
      ))}
    </Section>
  );
}

function OutputsSection({ outputs, inputs, otherIds, selected, hasVisual, onChange, onRenameId }: {
  outputs: EOutput[]; inputs: EInput[]; otherIds: Set<string>; selected: string | null; hasVisual: boolean; onChange: (v: EOutput[]) => void; onRenameId: (oldId: string, newId: string) => void;
}) {
  const rowKeys = useRowKeys(outputs.length);
  const update = (i: number, p: Partial<EOutput>) => onChange(outputs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="What gets calculated" addLabel="output"
      onAdd={() => {
        rowKeys.add();
        const label = "New output";
        const id = uniqueSlug(label, new Set([...outputs.map((x) => x.id), ...otherIds]));
        onChange([...outputs, { id, label, formula: "1" }]);
      }}>
      {outputs.map((out, i) => {
        // Formulas may reference inputs plus any EARLIER output only (schema.ts's
        // validateSandboxConfig builds its "known" identifier set the same way,
        // incrementally, top to bottom) — later outputs are deliberately excluded
        // from this row's insert picker.
        const identifiers = [
          ...inputs.map((inp) => ({ id: inp.id, label: inp.label })),
          ...outputs.slice(0, i).map((o) => ({ id: o.id, label: o.label })),
        ];
        return (
          <Row key={rowKeys.keys[i]} dataRowKey={`output:${out.id}`} highlighted={selected === `output:${out.id}`}
            onRemove={() => { rowKeys.remove(i); onChange(outputs.filter((_, j) => j !== i)); }}>
            <TextField label="Label" value={out.label} onChange={(label) => update(i, { label })} />
            <FormulaField value={out.formula} identifiers={identifiers} onChange={(formula) => update(i, { formula })} />
            <TextField label="Units" value={out.units ?? ""} onChange={(units) => update(i, { units: units || undefined })} />
            <NumField label="Decimals" value={out.decimals} onChange={(decimals) => update(i, { decimals })} />
            <PlacementField placement={out.placement} hasVisual={hasVisual} onChange={(placement) => update(i, { placement })} />
            <IdAdvanced id={out.id} onRename={() => {
              const others = new Set([...outputs.filter((_, j) => j !== i).map((x) => x.id), ...otherIds]);
              const newIdCandidate = uniqueSlug(out.label, others);
              if (newIdCandidate !== out.id) onRenameId(out.id, newIdCandidate);
            }} />
          </Row>
        );
      })}
    </Section>
  );
}

function ChartsSection({ charts, inputs, outputs, onChange }: { charts: EChart[]; inputs: EInput[]; outputs: EOutput[]; onChange: (v: EChart[]) => void }) {
  const rowKeys = useRowKeys(charts.length);
  const update = (i: number, p: Partial<EChart>) => onChange(charts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Charts" addLabel="chart"
      onAdd={() => {
        rowKeys.add();
        const title = "New chart";
        const id = uniqueSlug(title, new Set(charts.map((x) => x.id)), "chart");
        onChange([...charts, { id, title, xInputId: inputs[0]?.id ?? "", yOutputId: outputs[0]?.id ?? "", samples: 40 }]);
      }}>
      {charts.map((c, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onChange(charts.filter((_, j) => j !== i)); }}>
          <TextField label="Title" value={c.title} onChange={(title) => update(i, { title })} />
          <SelectField label="X axis (input)" value={c.xInputId}
            options={inputs.map((x) => ({ value: x.id, label: x.label }))} onChange={(xInputId) => update(i, { xInputId })} />
          <SelectField label="Y axis (output)" value={c.yOutputId}
            options={outputs.map((o) => ({ value: o.id, label: o.label }))} onChange={(yOutputId) => update(i, { yOutputId })} />
          <NumField label="Samples" value={c.samples} onChange={(samples) => update(i, { samples: samples ?? 40 })} />
          {/* Chart ids aren't referenced anywhere else (schema.ts only checks
              them for duplicates within this section), so unlike inputs/outputs
              this is a same-section-only local rename — no config-wide rewrite
              needed. */}
          <IdAdvanced id={c.id} onRename={() => {
            const others = new Set(charts.filter((_, j) => j !== i).map((x) => x.id));
            const newIdCandidate = uniqueSlug(c.title, others, "chart");
            if (newIdCandidate !== c.id) update(i, { id: newIdCandidate });
          }} />
        </Row>
      ))}
    </Section>
  );
}

function VisualSection({ visual, outputs, assets, selected, layout, onLayoutChange, onChange }: {
  visual: EConfig["visual"]; outputs: EOutput[]; assets: AssetRef[]; selected: string | null;
  layout: ELayout; onLayoutChange: (v: ELayout) => void; onChange: (v: EConfig["visual"]) => void;
}) {
  const v = visual ?? { overlays: [] };
  const rowKeys = useRowKeys(v.overlays.length);
  const assetOptions = [{ value: "", label: "(none)" }, ...assets.map((a) => ({ value: a.id, label: a.filename }))];
  const outputOptions = outputs.map((o) => ({ value: o.id, label: o.label }));
  const updateOverlay = (i: number, p: Partial<EOverlay>) =>
    onChange({ ...v, overlays: v.overlays.map((x, j) => (j === i ? ({ ...x, ...p } as EOverlay) : x)) });
  const boxFields = (i: number, box: Box) => (
    <Field label="Box x,y,w,h (% of stage)">
      <div className="flex gap-1">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <input key={k} type="number" min={0} max={100} className={inputCls} value={box[k]} aria-label={`Box ${k}`}
            onChange={(e) => updateOverlay(i, { box: { ...box, [k]: Number(e.target.value) } } as Partial<EOverlay>)} />
        ))}
      </div>
    </Field>
  );
  return (
    <Section title="Visual scene" addLabel="overlay"
      onAdd={() => {
        rowKeys.add();
        const outputId = outputs[0]?.id ?? "";
        const id = uniqueSlug(`fill_${outputId}`, new Set(v.overlays.map((x) => x.id)), "overlay");
        onChange({ ...v, overlays: [...v.overlays, { id, type: "fill", outputId, inMin: 0, inMax: 100, color: { token: "info" }, box: { x: 10, y: 10, w: 80, h: 80 } }] });
      }}>
      <SelectField label="Lesson layout" value={layout}
        options={[
          { value: "side", label: "Side by side" },
          { value: "stacked", label: "Stacked" },
          { value: "stage-focus", label: "Stage focus" },
        ]}
        onChange={(v) => onLayoutChange(v as ELayout)} />
      <SelectField label="Background image" value={v.backgroundAssetId ?? ""}
        options={assetOptions} onChange={(id) => onChange({ ...v, backgroundAssetId: id || undefined })} />
      {v.overlays.map((ov, i) => (
        <Row key={rowKeys.keys[i]} dataRowKey={`overlay:${ov.id}`} highlighted={selected === `overlay:${ov.id}`}
          onRemove={() => { rowKeys.remove(i); onChange({ ...v, overlays: v.overlays.filter((_, j) => j !== i) }); }}>
          <SelectField label="Type" value={ov.type}
            options={[{ value: "fill", label: "fill (rising level)" }, { value: "swap", label: "swap (image per range)" }, { value: "transform", label: "transform (move/rotate/scale/fade)" }]}
            onChange={(type) => {
              const box = ov.box;
              // Replace the row wholesale rather than going through
              // updateOverlay's `{...x, ...p}` merge: merging would leave
              // the OLD type's fields (e.g. fill's inMin/inMax/color)
              // sitting alongside the new type's fields, and the strict
              // discriminated-union schema rejects that as unrecognized
              // keys. A direct replace at the same index keeps the row's
              // React key (tracked separately in `rowKeys`) stable while
              // fully swapping the object's shape.
              const fresh: EOverlay =
                type === "fill" ? { id: ov.id, type: "fill", outputId: ov.outputId, inMin: 0, inMax: 100, color: { token: "info" }, box }
                : type === "swap" ? { id: ov.id, type: "swap", outputId: ov.outputId, box, bands: [] }
                : { id: ov.id, type: "transform", outputId: ov.outputId, box, assetId: "", property: "translateY", inMin: 0, inMax: 100, outMin: 0, outMax: 100 };
              onChange({ ...v, overlays: v.overlays.map((x, j) => (j === i ? fresh : x)) });
            }} />
          <SelectField label="Driven by output" value={ov.outputId} options={outputOptions} onChange={(outputId) => updateOverlay(i, { outputId })} />
          {boxFields(i, ov.box)}
          {ov.type === "fill" && (<>
            <NumField label="Value at empty" value={ov.inMin} onChange={(inMin) => updateOverlay(i, { inMin } as Partial<EOverlay>)} />
            <NumField label="Value at full" value={ov.inMax} onChange={(inMax) => updateOverlay(i, { inMax } as Partial<EOverlay>)} />
            <div className="col-span-2">
              <span className="mb-1 block text-xs font-medium text-gray-600">Fill color</span>
              {/* ov.color's `token` field is a plain (unvalidated-as-typed)
                  string here, per this file's EColorRef; ColorField takes the
                  narrower runtime-config ColorRef (token: TokenName) since it
                  only ever offers the 16 real token names via its own
                  swatches/onChange — this cast is a supertype-to-subtype
                  narrowing, safe for the same reason the postPreview cast
                  above is: a mid-edit draft can't violate it through this
                  component's own UI. */}
              <ColorField value={ov.color as ColorRef} backgroundHex={colorHex("light-1")} imagePresent={!!v.backgroundAssetId}
                onChange={(color) => updateOverlay(i, { color } as Partial<EOverlay>)} />
            </div>
          </>)}
          {ov.type === "swap" && (
            <Field label="Bands (upTo=assetId, one per line; ascending)">
              <textarea className={inputCls} rows={3}
                value={ov.bands.map((b) => `${b.upTo}=${b.assetId}`).join("\n")}
                onChange={(e) => updateOverlay(i, {
                  bands: e.target.value.split("\n").filter(Boolean).map((line) => {
                    const [upTo, assetId] = splitFirstEquals(line);
                    return { upTo: Number(upTo || 0), assetId };
                  }),
                } as Partial<EOverlay>)} />
            </Field>
          )}
          {ov.type === "transform" && (<>
            <SelectField label="Image" value={ov.assetId} options={assetOptions} onChange={(assetId) => updateOverlay(i, { assetId } as Partial<EOverlay>)} />
            <SelectField label="Property" value={ov.property}
              options={["translateY", "translateX", "rotate", "scale", "opacity"].map((p) => ({ value: p, label: p }))}
              onChange={(property) => updateOverlay(i, { property } as Partial<EOverlay>)} />
            <NumField label="Output min" value={ov.inMin} onChange={(inMin) => updateOverlay(i, { inMin } as Partial<EOverlay>)} />
            <NumField label="Output max" value={ov.inMax} onChange={(inMax) => updateOverlay(i, { inMax } as Partial<EOverlay>)} />
            <NumField label="Effect at min" value={ov.outMin} onChange={(outMin) => updateOverlay(i, { outMin } as Partial<EOverlay>)} />
            <NumField label="Effect at max" value={ov.outMax} onChange={(outMax) => updateOverlay(i, { outMax } as Partial<EOverlay>)} />
          </>)}
          {/* Overlays have no free-text label to rename toward, and (like
              charts) nothing else references an overlay's own id — build the
              rename basis from its type + driving output instead, and rename
              locally within this section. */}
          <IdAdvanced id={ov.id} onRename={() => {
            const others = new Set(v.overlays.filter((_, j) => j !== i).map((x) => x.id));
            const newIdCandidate = uniqueSlug(`${ov.type}_${ov.outputId}`, others, "overlay");
            if (newIdCandidate !== ov.id) updateOverlay(i, { id: newIdCandidate });
          }} />
        </Row>
      ))}
    </Section>
  );
}

function ChallengesSection({ challenges, outputs, onChange }: {
  challenges: EConfig["challenges"]; outputs: EOutput[]; onChange: (v: EConfig["challenges"]) => void;
}) {
  const rowKeys = useRowKeys(challenges.length);
  const update = (i: number, p: Partial<EConfig["challenges"][number]>) =>
    onChange(challenges.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Challenges & completion" addLabel="challenge"
      onAdd={() => {
        rowKeys.add();
        const prompt = "New challenge";
        const id = uniqueSlug(prompt, new Set(challenges.map((x) => x.id)), "challenge");
        onChange([...challenges, { id, prompt, outputId: outputs[0]?.id ?? "", comparator: "gte", value: 0 }]);
      }}>
      {challenges.map((ch, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onChange(challenges.filter((_, j) => j !== i)); }}>
          <TextField label="Prompt" value={ch.prompt} onChange={(prompt) => update(i, { prompt })} />
          <SelectField label="Output" value={ch.outputId} options={outputs.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(outputId) => update(i, { outputId })} />
          <SelectField label="Condition" value={ch.comparator}
            options={[{ value: "gte", label: "at least (≥)" }, { value: "lte", label: "at most (≤)" }, { value: "between", label: "between" }]}
            onChange={(comparator) => update(i, { comparator: comparator as "gte" | "lte" | "between" })} />
          {ch.comparator !== "between" && <NumField label="Value" value={ch.value} onChange={(value) => update(i, { value })} />}
          {ch.comparator === "between" && (<>
            <NumField label="Min" value={ch.min} onChange={(min) => update(i, { min })} />
            <NumField label="Max" value={ch.max} onChange={(max) => update(i, { max })} />
          </>)}
          {/* Same as charts/overlays: nothing else references a challenge's
              own id, so this is a same-section-only local rename. */}
          <IdAdvanced id={ch.id} onRename={() => {
            const others = new Set(challenges.filter((_, j) => j !== i).map((x) => x.id));
            const newIdCandidate = uniqueSlug(ch.prompt, others, "challenge");
            if (newIdCandidate !== ch.id) update(i, { id: newIdCandidate });
          }} />
        </Row>
      ))}
    </Section>
  );
}

function ExportButton({ interactiveId, disabled }: { interactiveId: string; disabled: boolean }) {
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
      // The export route doesn't exist yet (Task 13): a missing route returns
      // Next's HTML 404 page, not JSON. Parse defensively so that case (and
      // any other non-JSON error response) degrades to a generic message
      // instead of throwing inside this handler.
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
