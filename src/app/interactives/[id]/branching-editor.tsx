"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDraftEditor, Section, Row, Field, TextField, NumField, SelectField, IdAdvanced, useRowKeys, inputCls,
  ExportButton, type AssetRef,
} from "./editor-shared";
// Light import on purpose (mirrors param-sandbox-editor.tsx's own rationale
// for runtime-config.ts): no zod/sanitize-html in this client bundle — the
// editor never validates, only resolves/reshapes for preview. Validation
// happens server-side in saveInteractiveConfig (via adapterFor), and its
// errors flow back through useDraftEditor's `errors`.
import { toBranchingRuntimeConfig, type BranchingConfigLike } from "@/lib/engines/branching-scenario/runtime-config";
// Light import (companion-doc.ts's own file comment: zero heavy deps, no
// zod/sanitize-html — same discipline as runtime-config.ts/rename.ts above).
// The parser's returned config is still just handed to setConfig like any
// hand-authored draft: validation happens the same server-side way, via
// saveInteractiveConfig's adapterFor call, on the very next debounced save.
import { parseCompanionDoc, serializeCompanionDoc, type ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { uniqueSlug } from "./slugify";
// Light import (no zod/sanitize-html — see rename.ts's own file comment):
// pure structural reference rewrites for the per-row "Rename to match label"
// Advanced affordance.
import {
  renameSceneId, renameEndingId, renameVariableId, renameChoiceId, removeVariableReferences,
  type RenameableBranchingConfig,
} from "@/lib/engines/branching-scenario/rename";
// Visual pass (2026-08-28, plan Task 2): the scenario-level header-color
// token select is the ONE approved editor change for this milestone. tokens
// is data (tokens.json) plus tiny pure helpers — no zod/sanitize-html — so
// importing it here doesn't compromise this file's otherwise-light bundle
// any more than runtime-config.ts's own import of it already does.
import { RDS_COLOR_NAMES, type TokenName } from "@/lib/design/tokens";

/* Editing shape mirrors schema.ts's BranchingConfig (pre-validation). */
type EComparator = "gte" | "lte" | "between";
type ECondition = { variableId: string; comparator: EComparator; value?: number; min?: number; max?: number };
type EEffect = { variableId: string; delta: number };
type EQuality = "best" | "acceptable" | "poor";
type EChoice = { id: string; label: string; quality: EQuality; effects: EEffect[]; feedback?: string; goTo: string; showIf?: ECondition };
type EScene = { id: string; title?: string; body: string; imageAssetId?: string; imageRole?: "decorative" | "informative"; imageAlt?: string; choices: EChoice[] };
type EVariable = { id: string; label: string; initial: number; min: number; max: number; visible: boolean };
type EEnding = { id: string; title: string; body: string };
type EFeedbackMode = "immediate" | "debrief";
export type EBranchingConfig = {
  title: string; intro?: string; role?: string; headerColor?: TokenName;
  variables: EVariable[]; scenes: EScene[]; startSceneId: string; endings: EEnding[];
  feedbackMode: EFeedbackMode; showPathInDebrief: boolean;
};

const HEADER_COLOR_OPTIONS = RDS_COLOR_NAMES.map((name) => ({ value: name, label: name }));

const PREVIEW_SRC = "/engines/branching-scenario/1.0.0/preview.html";

const QUALITY_OPTIONS = [
  { value: "best", label: "Best" },
  { value: "acceptable", label: "Acceptable" },
  { value: "poor", label: "Poor" },
];
const COMPARATOR_OPTIONS = [
  { value: "gte", label: "at least (≥)" },
  { value: "lte", label: "at most (≤)" },
  { value: "between", label: "between" },
];

export function BranchingEditor({ interactiveId, initialTitle, initialConfig, assets }: {
  interactiveId: string; initialTitle: string; initialConfig: EBranchingConfig; assets: AssetRef[];
}) {
  const postPreview = useCallback((cfg: EBranchingConfig) => {
    // EBranchingConfig (this file's editing shape) is structurally the same
    // authoring shape schema.ts's BranchingConfig satisfies
    // (BranchingConfigLike) — a mid-edit draft can be structurally invalid
    // (empty ids, dangling goTo, showIf on an unknown variable), but
    // toBranchingRuntimeConfig only reshapes imageAssetId -> imageUrl and
    // never asserts validity, so a best-effort preview of an invalid draft
    // is unaffected; this is the one cast site (mirrors postPreview's cast
    // in param-sandbox-editor.tsx).
    return toBranchingRuntimeConfig(cfg as unknown as BranchingConfigLike, (assetId) => `/api/assets/${assetId}`);
  }, []);

  const { title, config, setConfig, errors, saveState, iframeRef, handleTitleChange, patch, markSaving, onIframeLoad } =
    useDraftEditor<EBranchingConfig>({ interactiveId, initialTitle, initialConfig, toPreviewRuntime: postPreview });

  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const sceneIndex = config.scenes.length === 0 ? -1 : Math.min(activeSceneIndex, config.scenes.length - 1);

  // Bumped once per companion-doc import (never on ordinary edits). Passed
  // below as the `key` on VariablesSection/ScenesSection/EndingsSection so
  // an import forces those three subtrees to fully unmount and remount.
  // This is the fix for the rowKeys trap: useRowKeys (editor-shared.tsx)
  // seeds each row's stable React key from the row array's length ONLY in
  // its useState initializer, which runs once per mount — a setConfig that
  // replaces the whole array (this import) changes `scenes.length` etc.
  // without ever re-running that initializer, so the OLD keys would stay
  // paired with new, unrelated row data (wrong row expands/collapses,
  // Advanced-panel state and DOM identity smeared across rows that used to
  // be a different scene/choice/variable/ending). A full remount re-runs
  // every useRowKeys call from scratch against the freshly imported arrays
  // — including the ones nested inside ScenesSection (ScenePanel's
  // choiceRowKeys, EffectsEditor's own rowKeys), since those remount too as
  // a consequence — so it mirrors exactly how keys are seeded on first
  // mount, for every nesting level, without hand-plumbing a reset() call
  // through each intermediate component.
  const [importGeneration, setImportGeneration] = useState(0);

  const handleImport = useCallback((parsed: EBranchingConfig) => {
    setConfig(parsed);
    setActiveSceneIndex(0);
    setImportGeneration((g) => g + 1);
    markSaving();
  }, [setConfig, markSaving]);

  // Backs each row's "Rename to match label" Advanced affordance for
  // scenes/endings/variables (the ids goTo/effects/showIf/startSceneId
  // actually reference — see rename.ts). Rewrites every reference
  // atomically in one setConfig update, so the config is never briefly
  // inconsistent. EBranchingConfig structurally satisfies
  // RenameableBranchingConfig (same shape rename.ts's pure module already
  // expects) — cast the same way postPreview above does for its own
  // structural-superset reason.
  const renameScene = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameSceneId(c as unknown as RenameableBranchingConfig, oldId, newId) as unknown as EBranchingConfig);
    markSaving();
  }, [setConfig, markSaving]);

  const renameEnding = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameEndingId(c as unknown as RenameableBranchingConfig, oldId, newId) as unknown as EBranchingConfig);
    markSaving();
  }, [setConfig, markSaving]);

  const renameVariable = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameVariableId(c as unknown as RenameableBranchingConfig, oldId, newId) as unknown as EBranchingConfig);
    markSaving();
  }, [setConfig, markSaving]);

  const renameChoice = useCallback((sceneId: string, oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameChoiceId(c as unknown as RenameableBranchingConfig, sceneId, oldId, newId) as unknown as EBranchingConfig);
    markSaving();
  }, [setConfig, markSaving]);

  // Backs the variables section's row delete: strips every effects/showIf
  // reference to the deleted variable in the SAME setConfig update that
  // removes the variable's own entry, so the config is never briefly
  // inconsistent (mirrors the rename callbacks above — see rename.ts's
  // removeVariableReferences for the destructive-but-consistent rationale).
  const removeVariable = useCallback((variableId: string) => {
    setConfig((c) => {
      const stripped = removeVariableReferences(c as unknown as RenameableBranchingConfig, variableId) as unknown as EBranchingConfig;
      return { ...stripped, variables: stripped.variables.filter((v) => v.id !== variableId) };
    });
    markSaving();
  }, [setConfig, markSaving]);

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
        </div>

        {errors.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            {/* Neutral wording: `errors` covers both graph/validation
                failures (config won't export — dead ends, unreachable
                scenes, dangling goTo) and save failures. */}
            <p className="font-semibold text-amber-900">Issues:</p>
            <ul className="mt-1 list-disc pl-5 text-amber-800">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        <ScenarioSection config={config} onChange={patch} onImport={handleImport} />
        {/* Distinctly-prefixed keys, not just `importGeneration` on its own:
            these three are siblings in the same children array, and React
            requires keys to be unique among siblings regardless of element
            type — reusing the bare generation number on all three tripped
            "two children with the same key" (verified in the browser
            console during E2E), which is exactly what the code comment on
            `importGeneration` above warns the reset trick depends on NOT
            happening (duplicate keys make React's reconciliation drop or
            duplicate children, silently defeating the remount). */}
        <VariablesSection key={`variables-${importGeneration}`} variables={config.variables} onChange={(variables) => patch({ variables })} onRenameId={renameVariable} onRemove={removeVariable} />
        <ScenesSection
          key={`scenes-${importGeneration}`}
          scenes={config.scenes} endings={config.endings} variables={config.variables}
          startSceneId={config.startSceneId} assets={assets} errors={errors}
          activeIndex={sceneIndex} onSelectIndex={setActiveSceneIndex}
          onChange={(scenes) => patch({ scenes })}
          onRenameScene={renameScene} onRenameChoice={renameChoice}
        />
        <EndingsSection key={`endings-${importGeneration}`} endings={config.endings} onChange={(endings) => patch({ endings })} onRenameId={renameEnding} />

        <ExportButton interactiveId={interactiveId} disabled={errors.length > 0} />
      </div>

      <div className="sticky top-4 h-[85vh]">
        <p className="mb-1 text-sm font-semibold text-gray-600">Live preview (actual engine runtime)</p>
        {/* Same handshake/no-`sandbox` rationale as param-sandbox-editor.tsx:
            preview.html validates postMessage origin and posts its
            ready-ping to location.origin; sandboxing would give the iframe
            an opaque origin and break both checks. */}
        <iframe ref={iframeRef} src={PREVIEW_SRC} title="Preview"
          onLoad={onIframeLoad}
          className="h-full w-full rounded border border-gray-300 bg-white" />
      </div>
    </div>
  );
}

/* ---------- Scenario section ---------- */

function ScenarioSection({ config, onChange, onImport }: {
  config: EBranchingConfig; onChange: (p: Partial<EBranchingConfig>) => void;
  onImport: (config: EBranchingConfig) => void;
}) {
  return (
    <Section title="Scenario">
      <Field label="Role (shown to the learner on the opening scene)">
        <input className={inputCls} value={config.role ?? ""} onChange={(e) => onChange({ role: e.target.value || undefined })} />
      </Field>
      <Field label="Intro (basic formatting allowed)">
        <textarea className={`${inputCls} font-mono`} rows={3} value={config.intro ?? ""}
          onChange={(e) => onChange({ intro: e.target.value })} />
      </Field>
      <SelectField label="Feedback" value={config.feedbackMode}
        options={[
          { value: "debrief", label: "Show a debrief at the end" },
          { value: "immediate", label: "Show feedback after every choice" },
        ]}
        onChange={(feedbackMode) => onChange({ feedbackMode: feedbackMode as EFeedbackMode })} />
      {/* Visual pass (2026-08-28), the sole editor change for this milestone:
          which brand color paints a scene's header band when that scene has
          no uploaded image (spec 2's header rule — an image always wins over
          this). Default "primary" matches main.ts's `?? "primary"` fallback
          exactly, so leaving this untouched behaves identically to before
          this control existed. */}
      <SelectField label="Header color (when no scene image)" value={config.headerColor ?? "primary"}
        options={HEADER_COLOR_OPTIONS}
        onChange={(headerColor) => onChange({ headerColor: headerColor as TokenName })} />
      <Field label="Debrief path">
        <label className="mt-0.5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.showPathInDebrief}
            onChange={(e) => onChange({ showPathInDebrief: e.target.checked })} />
          Show the learner&apos;s path through the scenario in the debrief
        </label>
      </Field>
      {config.scenes.length > 0 && (
        <SelectField label="Starting scene" value={config.startSceneId}
          options={config.scenes.map((s, i) => ({ value: s.id, label: s.title || `Part ${i + 1}` }))}
          onChange={(startSceneId) => onChange({ startSceneId })} />
      )}
      <ImportPanel config={config} onImport={onImport} />
    </Section>
  );
}

/** "Import from companion doc" disclosure (companion-doc import milestone).
 *  Deterministic paste-in path for the plain-text format `companion-doc.ts`
 *  parses/serializes — see that file's header comment and
 *  docs/superpowers/specs/2026-08-27-companion-doc-import-design.md. Import
 *  is a wholesale replace (confirmed), so this panel owns none of the
 *  config itself — it only ever calls `onImport` with a freshly parsed
 *  config and reports what the parser flagged. */
function ImportPanel({ config, onImport }: {
  config: EBranchingConfig; onImport: (config: EBranchingConfig) => void;
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
    const parsed = parseCompanionDoc(text);
    const proceed = window.confirm(
      "This replaces everything in this interactive. The current draft cannot be recovered. Continue?",
    );
    if (!proceed) return;
    onImport(parsed.config as EBranchingConfig);
    setReport(parsed.report);
  };

  const handleCopyClick = async () => {
    const doc = serializeCompanionDoc(config as unknown as BranchingConfigLike);
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
    <details className="col-span-2 mt-2 rounded border border-gray-200 p-2">
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
          <a href="/companion-doc-template.txt" download className="app-link text-xs">Download the template</a>
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

/* ---------- Variables section ---------- */

function VariablesSection({ variables, onChange, onRenameId, onRemove }: {
  variables: EVariable[]; onChange: (v: EVariable[]) => void; onRenameId: (oldId: string, newId: string) => void;
  onRemove: (variableId: string) => void;
}) {
  const rowKeys = useRowKeys(variables.length);
  const update = (i: number, p: Partial<EVariable>) => onChange(variables.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="What changes as they decide" addLabel="variable"
      onAdd={() => {
        rowKeys.add();
        const label = "New variable";
        const id = uniqueSlug(label, new Set(variables.map((x) => x.id)), "variable");
        onChange([...variables, { id, label, initial: 0, min: 0, max: 100, visible: false }]);
      }}>
      {variables.map((v, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onRemove(v.id); }}>
          <TextField label="Label" value={v.label} onChange={(label) => update(i, { label })} />
          <NumField label="Initial" value={v.initial} onChange={(initial) => update(i, { initial: initial ?? 0 })} />
          <NumField label="Min" value={v.min} onChange={(min) => update(i, { min: min ?? 0 })} />
          <NumField label="Max" value={v.max} onChange={(max) => update(i, { max: max ?? 0 })} />
          <Field label="Visible to learner">
            <label className="mt-0.5 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.visible} onChange={(e) => update(i, { visible: e.target.checked })} />
              Show a live status line
            </label>
          </Field>
          <IdAdvanced id={v.id} onRename={() => {
            const others = new Set(variables.filter((_, j) => j !== i).map((x) => x.id));
            const newIdCandidate = uniqueSlug(v.label, others, "variable");
            if (newIdCandidate !== v.id) onRenameId(v.id, newIdCandidate);
          }} />
        </Row>
      ))}
    </Section>
  );
}

/* ---------- Scenes section: rail + panel ---------- */

function ScenesSection({ scenes, endings, variables, startSceneId, assets, errors, activeIndex, onSelectIndex, onChange, onRenameScene, onRenameChoice }: {
  scenes: EScene[]; endings: EEnding[]; variables: EVariable[]; startSceneId: string; assets: AssetRef[]; errors: string[];
  activeIndex: number; onSelectIndex: (i: number) => void;
  onChange: (v: EScene[]) => void;
  onRenameScene: (oldId: string, newId: string) => void; onRenameChoice: (sceneId: string, oldId: string, newId: string) => void;
}) {
  const rowKeys = useRowKeys(scenes.length);
  const updateScene = (i: number, p: Partial<EScene>) => onChange(scenes.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const addScene = () => {
    rowKeys.add();
    const title = "New scene";
    const id = uniqueSlug(title, new Set(scenes.map((x) => x.id)));
    const defaultGoTo = endings[0] ? `ending:${endings[0].id}` : `scene:${id}`;
    const scene: EScene = {
      id, title, body: "<p></p>",
      choices: [{ id: "continue", label: "Continue", quality: "acceptable", effects: [], goTo: defaultGoTo }],
    };
    onChange([...scenes, scene]);
    onSelectIndex(scenes.length);
  };

  const removeScene = (i: number) => {
    rowKeys.remove(i);
    onChange(scenes.filter((_, j) => j !== i));
    if (activeIndex >= i) onSelectIndex(Math.max(0, activeIndex - 1));
  };

  const moveScene = (i: number, to: number) => {
    if (to < 0 || to >= scenes.length) return;
    rowKeys.move(i, to);
    const next = [...scenes];
    const [item] = next.splice(i, 1);
    next.splice(to, 0, item);
    onChange(next);
    onSelectIndex(to);
  };

  // Matches both the common `scene "<id>" ...` shape (unreachable/dead-end/
  // goTo/showIf/effect errors — schema.ts) and `duplicate scene id "<id>"`,
  // which puts "id" between "scene" and the quoted id so it doesn't contain
  // the plain `scene "<id>"` substring.
  const sceneHasError = (id: string) => errors.some((e) => e.includes(`scene "${id}"`) || e.includes(`duplicate scene id "${id}"`));

  const active = activeIndex >= 0 ? scenes[activeIndex] : undefined;

  return (
    <Section title="Scenes" addLabel="scene" onAdd={addScene}>
      <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3">
        <ul className="space-y-1">
          {scenes.map((s, i) => (
            <li key={rowKeys.keys[i]}>
              <div className={`flex items-center gap-1 rounded border p-1 text-xs ${i === activeIndex ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white"}`}>
                <button type="button" className="flex-1 truncate text-left" onClick={() => onSelectIndex(i)}>
                  {sceneHasError(s.id) && <span aria-hidden="true" title="Has issues" className="mr-1 text-amber-600">⚠</span>}
                  {s.title || `Part ${i + 1}`}
                  {s.id === startSceneId && <span className="ml-1 text-gray-400">(start)</span>}
                </button>
                <button type="button" aria-label={`Move ${s.title || `Part ${i + 1}`} up`} className="btn btn-light-2 btn-sm px-1"
                  disabled={i === 0} onClick={() => moveScene(i, i - 1)}>↑</button>
                <button type="button" aria-label={`Move ${s.title || `Part ${i + 1}`} down`} className="btn btn-light-2 btn-sm px-1"
                  disabled={i === scenes.length - 1} onClick={() => moveScene(i, i + 1)}>↓</button>
              </div>
            </li>
          ))}
        </ul>

        {active ? (
          <ScenePanel
            key={rowKeys.keys[activeIndex]}
            scene={active} scenes={scenes} endings={endings} variables={variables} assets={assets}
            onChange={(p) => updateScene(activeIndex, p)}
            onRemove={() => removeScene(activeIndex)}
            onRenameScene={(newId) => onRenameScene(active.id, newId)}
            onRenameChoice={(oldId, newId) => onRenameChoice(active.id, oldId, newId)}
          />
        ) : (
          <p className="text-sm text-gray-500">Add a scene to get started.</p>
        )}
      </div>
      {scenes.length === 0 && startSceneId && (
        // Defensive UI-only guard: startSceneId is otherwise edited from
        // ScenarioSection's select, which only renders once scenes exist.
        <p className="text-xs text-gray-500">Add at least one scene, then choose a starting scene above.</p>
      )}
    </Section>
  );
}

function ScenePanel({ scene, scenes, endings, variables, assets, onChange, onRemove, onRenameScene, onRenameChoice }: {
  scene: EScene; scenes: EScene[]; endings: EEnding[]; variables: EVariable[]; assets: AssetRef[];
  onChange: (p: Partial<EScene>) => void; onRemove: () => void;
  onRenameScene: (newId: string) => void; onRenameChoice: (oldId: string, newId: string) => void;
}) {
  const assetOptions = [{ value: "", label: "(none)" }, ...assets.map((a) => ({ value: a.id, label: a.filename }))];
  const choiceRowKeys = useRowKeys(scene.choices.length);
  const updateChoice = (i: number, p: Partial<EChoice>) => onChange({ choices: scene.choices.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="flex justify-end">
        <button type="button" onClick={onRemove} className="btn-danger-link btn-sm">Remove scene</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Title" value={scene.title ?? ""} onChange={(v) => onChange({ title: v })} />
        <Field label="Body (basic formatting allowed)">
          <textarea className={`${inputCls} font-mono`} rows={4} value={scene.body} onChange={(e) => onChange({ body: e.target.value })} />
        </Field>

        <SelectField label="Image" value={scene.imageAssetId ?? ""} options={assetOptions}
          onChange={(id) => onChange(id
            ? { imageAssetId: id, imageRole: scene.imageRole ?? "decorative", imageAlt: scene.imageRole === "informative" ? scene.imageAlt : undefined }
            : { imageAssetId: undefined, imageRole: undefined, imageAlt: undefined })} />

        {scene.imageAssetId && (
          <Field label="Image type">
            <div role="radiogroup" aria-label="Image type" className="mt-0.5 flex gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" name={`image-role-${scene.id}`} checked={scene.imageRole === "decorative"}
                  onChange={() => onChange({ imageRole: "decorative", imageAlt: undefined })} />
                Decorative
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name={`image-role-${scene.id}`} checked={scene.imageRole === "informative"}
                  onChange={() => onChange({ imageRole: "informative" })} />
                Informative
              </label>
            </div>
          </Field>
        )}
        {scene.imageAssetId && scene.imageRole === "informative" && (
          <Field label="Image description (alt text)">
            <input className={inputCls} value={scene.imageAlt ?? ""} onChange={(e) => onChange({ imageAlt: e.target.value })} />
            <span className="mt-0.5 block text-xs text-gray-500">
              Describe what the image conveys. When AI drafting arrives, it will suggest; a human always accepts.
            </span>
          </Field>
        )}

        <IdAdvanced id={scene.id} onRename={() => {
          const others = new Set(scenes.filter((s) => s.id !== scene.id).map((s) => s.id));
          const newIdCandidate = uniqueSlug(scene.title || scene.id, others);
          if (newIdCandidate !== scene.id) onRenameScene(newIdCandidate);
        }} />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Choices</h3>
          {scene.choices.length < 6 && (
            <button type="button" className="btn btn-light-2 btn-sm"
              onClick={() => {
                choiceRowKeys.add();
                const label = "New choice";
                const id = uniqueSlug(label, new Set(scene.choices.map((c) => c.id)), "choice");
                const defaultGoTo = endings[0] ? `ending:${endings[0].id}` : `scene:${scene.id}`;
                onChange({ choices: [...scene.choices, { id, label, quality: "acceptable", effects: [], goTo: defaultGoTo }] });
              }}>+ choice</button>
          )}
        </div>
        <div className="mt-2 space-y-2">
          {scene.choices.map((choice, i) => (
            <ChoiceRow key={choiceRowKeys.keys[i]} choice={choice} scenes={scenes} endings={endings} variables={variables}
              onChange={(p) => updateChoice(i, p)}
              onRemove={() => { choiceRowKeys.remove(i); onChange({ choices: scene.choices.filter((_, j) => j !== i) }); }}
              onRename={(newId) => onRenameChoice(choice.id, newId)}
              otherChoiceIds={new Set(scene.choices.filter((_, j) => j !== i).map((c) => c.id))} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChoiceRow({ choice, scenes, endings, variables, onChange, onRemove, onRename, otherChoiceIds }: {
  choice: EChoice; scenes: EScene[]; endings: EEnding[]; variables: EVariable[];
  onChange: (p: Partial<EChoice>) => void; onRemove: () => void; onRename: (newId: string) => void;
  otherChoiceIds: Set<string>;
}) {
  return (
    <div className="rounded border border-gray-100 bg-gray-50 p-2">
      <div className="flex justify-end">
        <button type="button" onClick={onRemove} className="btn-danger-link btn-sm">Remove choice</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Label" value={choice.label} onChange={(label) => onChange({ label })} />
        <SelectField label="Quality" value={choice.quality} options={QUALITY_OPTIONS}
          onChange={(quality) => onChange({ quality: quality as EQuality })} />
        <Field label="Goes to">
          <select className={inputCls} value={choice.goTo} onChange={(e) => onChange({ goTo: e.target.value })}>
            <optgroup label="Scenes">
              {scenes.map((s, i) => <option key={s.id} value={`scene:${s.id}`}>{s.title || `Part ${i + 1}`}</option>)}
            </optgroup>
            <optgroup label="Endings">
              {endings.map((e) => <option key={e.id} value={`ending:${e.id}`}>{e.title || e.id}</option>)}
            </optgroup>
          </select>
        </Field>
        <Field label="Feedback (shown per feedback mode)">
          <textarea className={`${inputCls} font-mono`} rows={2} value={choice.feedback ?? ""}
            onChange={(e) => onChange({ feedback: e.target.value || undefined })} />
        </Field>

        <EffectsEditor effects={choice.effects} variables={variables} onChange={(effects) => onChange({ effects })} />
        {variables.length > 0 && (
          <ConditionEditor condition={choice.showIf} variables={variables} onChange={(showIf) => onChange({ showIf })} />
        )}

        <IdAdvanced id={choice.id} onRename={() => {
          const newIdCandidate = uniqueSlug(choice.label, otherChoiceIds, "choice");
          if (newIdCandidate !== choice.id) onRename(newIdCandidate);
        }} />
      </div>
    </div>
  );
}

function EffectsEditor({ effects, variables, onChange }: {
  effects: EEffect[]; variables: EVariable[]; onChange: (v: EEffect[]) => void;
}) {
  const rowKeys = useRowKeys(effects.length);
  const update = (i: number, p: Partial<EEffect>) => onChange(effects.map((x, j) => (j === i ? { ...x, ...p } : x)));
  if (variables.length === 0) {
    return <p className="col-span-2 text-xs text-gray-500">Add a variable above to give choices an effect.</p>;
  }
  return (
    <div className="col-span-2">
      <span className="mb-1 block text-xs font-medium text-gray-600">Effects on variables</span>
      <div className="space-y-1">
        {effects.map((ef, i) => (
          <div key={rowKeys.keys[i]} className="flex items-center gap-2">
            <select aria-label="Variable" className={inputCls} value={ef.variableId} onChange={(e) => update(i, { variableId: e.target.value })}>
              {variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <input type="number" aria-label="Change amount" className={`${inputCls} w-20`} value={ef.delta}
              onChange={(e) => update(i, { delta: Number(e.target.value) })} />
            <button type="button" className="btn-danger-link btn-sm"
              onClick={() => { rowKeys.remove(i); onChange(effects.filter((_, j) => j !== i)); }}>Remove</button>
          </div>
        ))}
      </div>
      {effects.length < 4 && (
        <button type="button" className="btn btn-light-2 btn-sm mt-1"
          onClick={() => { rowKeys.add(); onChange([...effects, { variableId: variables[0].id, delta: 0 }]); }}>+ effect</button>
      )}
    </div>
  );
}

function ConditionEditor({ condition, variables, onChange }: {
  condition: ECondition | undefined; variables: EVariable[]; onChange: (c: ECondition | undefined) => void;
}) {
  const enabled = !!condition;
  return (
    <div className="col-span-2 rounded border border-gray-200 p-2">
      <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
        <input type="checkbox" checked={enabled}
          onChange={(e) => onChange(e.target.checked ? { variableId: variables[0].id, comparator: "gte", value: 0 } : undefined)} />
        Only show this choice if…
      </label>
      {enabled && condition && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <SelectField label="Variable" value={condition.variableId} options={variables.map((v) => ({ value: v.id, label: v.label }))}
            onChange={(variableId) => onChange({ ...condition, variableId })} />
          <SelectField label="Comparator" value={condition.comparator} options={COMPARATOR_OPTIONS}
            onChange={(comparator) => onChange({ ...condition, comparator: comparator as EComparator })} />
          {condition.comparator !== "between" && (
            <NumField label="Value" value={condition.value} onChange={(value) => onChange({ ...condition, value })} />
          )}
          {condition.comparator === "between" && (<>
            <NumField label="Min" value={condition.min} onChange={(min) => onChange({ ...condition, min })} />
            <NumField label="Max" value={condition.max} onChange={(max) => onChange({ ...condition, max })} />
          </>)}
        </div>
      )}
    </div>
  );
}

/* ---------- Endings section ---------- */

function EndingsSection({ endings, onChange, onRenameId }: {
  endings: EEnding[]; onChange: (v: EEnding[]) => void; onRenameId: (oldId: string, newId: string) => void;
}) {
  const rowKeys = useRowKeys(endings.length);
  const update = (i: number, p: Partial<EEnding>) => onChange(endings.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Endings" addLabel="ending"
      onAdd={() => {
        rowKeys.add();
        const title = "New ending";
        const id = uniqueSlug(title, new Set(endings.map((x) => x.id)), "ending");
        onChange([...endings, { id, title, body: "<p></p>" }]);
      }}>
      {endings.map((e, i) => (
        <Row key={rowKeys.keys[i]} onRemove={() => { rowKeys.remove(i); onChange(endings.filter((_, j) => j !== i)); }}>
          <TextField label="Title" value={e.title} onChange={(title) => update(i, { title })} />
          <Field label="Body (basic formatting allowed)">
            <textarea className={`${inputCls} font-mono`} rows={3} value={e.body} onChange={(ev) => update(i, { body: ev.target.value })} />
          </Field>
          <IdAdvanced id={e.id} onRename={() => {
            const others = new Set(endings.filter((_, j) => j !== i).map((x) => x.id));
            const newIdCandidate = uniqueSlug(e.title, others, "ending");
            if (newIdCandidate !== e.id) onRenameId(e.id, newIdCandidate);
          }} />
        </Row>
      ))}
    </Section>
  );
}
