"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveInteractiveConfig } from "@/app/actions";
import { colorRefToCss } from "@/lib/engines/param-sandbox/schema";

/* Editing shape mirrors the Zod input (pre-validation). */
type EInput = { id: string; label: string; type: "slider" | "number" | "toggle" | "select"; min?: number; max?: number; step?: number; defaultValue: number; units?: string; options?: Array<{ label: string; value: number }> };
type EOutput = { id: string; label: string; formula: string; units?: string; decimals?: number };
type EChart = { id: string; title: string; xInputId: string; yOutputId: string; samples: number };
/* Hybrid verifiable color model (schema.ts ColorRef): a named RDS token or a
 * verified custom hex. TODO(Task 7): color-field.tsx replaces this raw
 * TextField bridge with token swatches + a live contrast readout. */
type EColorRef = { token: string } | { hex: string };
type EOverlay =
  | { id: string; type: "fill"; outputId: string; inMin: number; inMax: number; color: EColorRef; box: Box }
  | { id: string; type: "swap"; outputId: string; box: Box; bands: Array<{ upTo: number; assetId: string }> }
  | { id: string; type: "transform"; outputId: string; box: Box; assetId: string; property: "translateY" | "translateX" | "rotate" | "scale" | "opacity"; inMin: number; inMax: number; outMin: number; outMax: number };
type Box = { x: number; y: number; w: number; h: number };
type EConfig = {
  title: string; intro?: string;
  inputs: EInput[]; outputs: EOutput[]; charts: EChart[];
  visual?: { backgroundAssetId?: string; overlays: EOverlay[] };
  challenges: Array<{ id: string; prompt: string; outputId: string; comparator: "gte" | "lte" | "between"; value?: number; min?: number; max?: number }>;
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
    const runtime = toPreviewRuntime(cfg);
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

        <InputsSection inputs={config.inputs} onChange={(inputs) => patch({ inputs })} />
        <OutputsSection outputs={config.outputs} onChange={(outputs) => patch({ outputs })} />
        <ChartsSection charts={config.charts} inputs={config.inputs} outputs={config.outputs} onChange={(charts) => patch({ charts })} />
        <VisualSection visual={config.visual} outputs={config.outputs} assets={assets}
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
        <iframe ref={iframeRef} src={PREVIEW_SRC} title="Preview"
          onLoad={() => { previewReady.current = true; postPreview(configRef.current); }}
          className="h-full w-full rounded border border-gray-300 bg-white" />
      </div>
    </div>
  );
}

/* Maps assetId fields to preview URLs; mirrors toRuntimeConfig server-side. */
function toPreviewRuntime(cfg: EConfig) {
  const url = (assetId: string) => `/api/assets/${assetId}`;
  const { visual, ...rest } = cfg;
  if (!visual) return rest;
  return {
    ...rest,
    visual: {
      backgroundUrl: visual.backgroundAssetId ? url(visual.backgroundAssetId) : undefined,
      overlays: visual.overlays.map((ov) => {
        if (ov.type === "fill") return { ...ov, color: colorRefToCss(ov.color as Parameters<typeof colorRefToCss>[0]) };
        if (ov.type === "swap") return { ...ov, bands: ov.bands.map((b) => ({ upTo: b.upTo, url: url(b.assetId) })) };
        const { assetId, ...o } = ov;
        return { ...o, url: url(assetId) };
      }),
    },
  };
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

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="rounded border border-gray-100 bg-gray-50 p-3">
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

/** Collision-safe id generator: increments until `prefix_N` isn't already in
 *  the caller's current id set (callers pass their section's own ids). No
 *  Date.now() suffix, so ids stay clean (input_1, input_2, ...). */
function newId(prefix: string, existingIds: Set<string>): string {
  let n = 1;
  let id = `${prefix}_${n}`;
  while (existingIds.has(id)) {
    n += 1;
    id = `${prefix}_${n}`;
  }
  return id;
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

function InputsSection({ inputs, onChange }: { inputs: EInput[]; onChange: (v: EInput[]) => void }) {
  const rowKeys = useRowKeys(inputs.length);
  const update = (i: number, p: Partial<EInput>) => onChange(inputs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Inputs (what learners manipulate)" addLabel="input"
      onAdd={() => {
        rowKeys.add();
        onChange([...inputs, { id: newId("input", new Set(inputs.map((x) => x.id))), label: "New input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }]);
      }}>
      {inputs.map((inp, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onChange(inputs.filter((_, j) => j !== i)); }}>
          <TextField label="ID (used in formulas)" value={inp.id} onChange={(id) => update(i, { id })} />
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
        </Row>
      ))}
    </Section>
  );
}

function OutputsSection({ outputs, onChange }: { outputs: EOutput[]; onChange: (v: EOutput[]) => void }) {
  const rowKeys = useRowKeys(outputs.length);
  const update = (i: number, p: Partial<EOutput>) => onChange(outputs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Outputs (computed by formulas)" addLabel="output"
      onAdd={() => {
        rowKeys.add();
        onChange([...outputs, { id: newId("out", new Set(outputs.map((x) => x.id))), label: "New output", formula: "1" }]);
      }}>
      {outputs.map((out, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onChange(outputs.filter((_, j) => j !== i)); }}>
          <TextField label="ID" value={out.id} onChange={(id) => update(i, { id })} />
          <TextField label="Label" value={out.label} onChange={(label) => update(i, { label })} />
          <Field label="Formula (inputs + earlier outputs; e.g. mass / density * 1000)">
            <input className={`${inputCls} font-mono`} value={out.formula} onChange={(e) => update(i, { formula: e.target.value })} />
          </Field>
          <TextField label="Units" value={out.units ?? ""} onChange={(units) => update(i, { units: units || undefined })} />
          <NumField label="Decimals" value={out.decimals} onChange={(decimals) => update(i, { decimals })} />
        </Row>
      ))}
    </Section>
  );
}

function ChartsSection({ charts, inputs, outputs, onChange }: { charts: EChart[]; inputs: EInput[]; outputs: EOutput[]; onChange: (v: EChart[]) => void }) {
  const rowKeys = useRowKeys(charts.length);
  const update = (i: number, p: Partial<EChart>) => onChange(charts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Charts (pattern across an input's range)" addLabel="chart"
      onAdd={() => {
        rowKeys.add();
        onChange([...charts, { id: newId("chart", new Set(charts.map((x) => x.id))), title: "New chart", xInputId: inputs[0]?.id ?? "", yOutputId: outputs[0]?.id ?? "", samples: 40 }]);
      }}>
      {charts.map((c, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onChange(charts.filter((_, j) => j !== i)); }}>
          <TextField label="ID" value={c.id} onChange={(id) => update(i, { id })} />
          <TextField label="Title" value={c.title} onChange={(title) => update(i, { title })} />
          <SelectField label="X axis (input)" value={c.xInputId}
            options={inputs.map((x) => ({ value: x.id, label: x.label }))} onChange={(xInputId) => update(i, { xInputId })} />
          <SelectField label="Y axis (output)" value={c.yOutputId}
            options={outputs.map((o) => ({ value: o.id, label: o.label }))} onChange={(yOutputId) => update(i, { yOutputId })} />
          <NumField label="Samples" value={c.samples} onChange={(samples) => update(i, { samples: samples ?? 40 })} />
        </Row>
      ))}
    </Section>
  );
}

function VisualSection({ visual, outputs, assets, onChange }: {
  visual: EConfig["visual"]; outputs: EOutput[]; assets: AssetRef[]; onChange: (v: EConfig["visual"]) => void;
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
    <Section title="Visual stage (background + state overlays)" addLabel="overlay"
      onAdd={() => {
        rowKeys.add();
        onChange({ ...v, overlays: [...v.overlays, { id: newId("ov", new Set(v.overlays.map((x) => x.id))), type: "fill", outputId: outputs[0]?.id ?? "", inMin: 0, inMax: 100, color: { token: "info" }, box: { x: 10, y: 10, w: 80, h: 80 } }] });
      }}>
      <SelectField label="Background image" value={v.backgroundAssetId ?? ""}
        options={assetOptions} onChange={(id) => onChange({ ...v, backgroundAssetId: id || undefined })} />
      {v.overlays.map((ov, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onChange({ ...v, overlays: v.overlays.filter((_, j) => j !== i) }); }}>
          <TextField label="ID" value={ov.id} onChange={(id) => updateOverlay(i, { id })} />
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
            {/* Crude bridge onto the hybrid ColorRef shape ({token} | {hex});
                Task 7's ColorField (token swatches + live contrast readout)
                replaces this raw text input. */}
            <TextField label="Color (#rrggbb or token:name)"
              value={"token" in ov.color ? `token:${ov.color.token}` : ov.color.hex}
              onChange={(val) => updateOverlay(i, {
                color: val.startsWith("token:") ? { token: val.slice(6) } : { hex: val },
              } as Partial<EOverlay>)} />
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
    <Section title="Challenges (drive completion + score)" addLabel="challenge"
      onAdd={() => {
        rowKeys.add();
        onChange([...challenges, { id: newId("ch", new Set(challenges.map((x) => x.id))), prompt: "New challenge", outputId: outputs[0]?.id ?? "", comparator: "gte", value: 0 }]);
      }}>
      {challenges.map((ch, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onChange(challenges.filter((_, j) => j !== i)); }}>
          <TextField label="ID" value={ch.id} onChange={(id) => update(i, { id })} />
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
