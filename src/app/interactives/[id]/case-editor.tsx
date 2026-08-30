"use client";

import { useCallback } from "react";
import {
  useDraftEditor, Section, Row, Field, TextField, SelectField, IdAdvanced, useRowKeys, inputCls,
  ExportButton, type AssetRef,
} from "./editor-shared";
// Light import (mirrors branching-editor.tsx's own rationale for
// runtime-config.ts): no zod/sanitize-html in this client bundle -- the
// editor never validates, only resolves/reshapes for preview. Validation
// happens server-side in saveInteractiveConfig (via adapterFor), and its
// errors flow back through useDraftEditor's `errors`.
import { toCaseRuntimeConfig, type CaseWorkspaceConfigLike } from "@/lib/engines/case-workspace/runtime-config";
// Light import (no zod/sanitize-html -- see rename.ts's own file comment):
// pure structural reference rewrites for the per-row "Rename to match label"
// Advanced affordance, and the destructive-but-consistent reference strip
// backing artifact/conclusion row delete.
import {
  renameArtifactId, renameConclusionId, renameReasonId, removeArtifactReferences, removeConclusionReferences,
  type RenameableCaseConfig,
} from "@/lib/engines/case-workspace/rename";
import { uniqueSlug } from "./slugify";
import { RDS_COLOR_NAMES, type TokenName } from "@/lib/design/tokens";

/* Editing shape mirrors schema.ts's CaseConfig (pre-validation). */
type EArtifactKind = "text" | "image" | "table";
type EImageRole = "decorative" | "informative";
type EArtifactTable = { caption?: string; headers: string[]; rows: string[][] };
type EArtifact = {
  id: string; title: string; sourceLine?: string; kind: EArtifactKind;
  body?: string; imageAssetId?: string; imageRole?: EImageRole; imageAlt?: string; table?: EArtifactTable;
};
type ECredit = "full" | "partial" | "none";
type EReason = { id: string; text: string; sound: boolean; flawNote?: string };
type EConclusion = { id: string; label: string; body?: string; credit: ECredit; expertRationale: string; reasons: EReason[] };
type EMapRole = "supports" | "contradicts";
type EMapEntry = { artifactId: string; conclusionId: string; role: EMapRole; strength: "strong" | "weak" };
type EScoringMode = "single" | "best-supported" | "argument-quality";
export type ECaseConfig = {
  title: string; intro: string; scoringMode: EScoringMode; headerColor?: TokenName;
  artifacts: EArtifact[]; conclusions: EConclusion[]; expertMap: EMapEntry[];
};

const HEADER_COLOR_OPTIONS = RDS_COLOR_NAMES.map((name) => ({ value: name, label: name }));
const PREVIEW_SRC = "/engines/case-workspace/1.0.0/preview.html";

const MODE_OPTIONS = [
  { value: "single", label: "Single right answer" },
  { value: "best-supported", label: "Best supported (partial credit)" },
  { value: "argument-quality", label: "Argument quality (reasoning only)" },
];
const KIND_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "table", label: "Table" },
];
const CREDIT_OPTIONS = [
  { value: "full", label: "Full credit" },
  { value: "partial", label: "Partial credit" },
  { value: "none", label: "No credit" },
];
const SOUNDNESS_OPTIONS = [
  { value: "sound", label: "Sound" },
  { value: "flawed", label: "Flawed" },
];
const MAP_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "irrelevant", label: "Irrelevant (not mapped)" },
  { value: "supports", label: "Supports" },
  { value: "contradicts", label: "Contradicts" },
];
const STRENGTH_OPTIONS = [
  { value: "strong", label: "Strong" },
  { value: "weak", label: "Weak" },
];

export function CaseEditor({ interactiveId, initialTitle, initialConfig, assets }: {
  interactiveId: string; initialTitle: string; initialConfig: ECaseConfig; assets: AssetRef[];
}) {
  const postPreview = useCallback((cfg: ECaseConfig) => {
    // ECaseConfig (this file's editing shape) is structurally the same
    // authoring shape schema.ts's CaseConfig satisfies (CaseWorkspaceConfigLike)
    // -- a mid-edit draft can be structurally invalid (empty ids, dangling map
    // references, a kind/payload mismatch), but toCaseRuntimeConfig only
    // reshapes imageAssetId -> imageUrl and never asserts validity, so a
    // best-effort preview of an invalid draft is unaffected; this is the one
    // cast site (mirrors postPreview's cast in branching-editor.tsx).
    return toCaseRuntimeConfig(cfg as unknown as CaseWorkspaceConfigLike, (assetId) => `/api/assets/${assetId}`);
  }, []);

  const { title, config, setConfig, errors, saveState, iframeRef, handleTitleChange, patch, markSaving, onIframeLoad } =
    useDraftEditor<ECaseConfig>({ interactiveId, initialTitle, initialConfig, toPreviewRuntime: postPreview });

  // Backs each row's "Rename to match label" Advanced affordance for
  // artifacts/conclusions/reasons (the ids expertMap actually references --
  // see rename.ts). Rewrites every reference atomically in one setConfig
  // update, so the config is never briefly inconsistent. ECaseConfig
  // structurally satisfies RenameableCaseConfig (same shape rename.ts's pure
  // module already expects) -- cast the same way branching-editor.tsx does
  // for its own structural-superset reason.
  const renameArtifact = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameArtifactId(c as unknown as RenameableCaseConfig, oldId, newId) as unknown as ECaseConfig);
    markSaving();
  }, [setConfig, markSaving]);

  const renameConclusion = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameConclusionId(c as unknown as RenameableCaseConfig, oldId, newId) as unknown as ECaseConfig);
    markSaving();
  }, [setConfig, markSaving]);

  const renameReason = useCallback((conclusionId: string, oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameReasonId(c as unknown as RenameableCaseConfig, conclusionId, oldId, newId) as unknown as ECaseConfig);
    markSaving();
  }, [setConfig, markSaving]);

  // Backs the artifacts/conclusions section row delete: strips every
  // expertMap reference to the deleted id in the SAME setConfig update that
  // removes the row's own entry, so the config is never briefly inconsistent
  // (mirrors branching-editor.tsx's removeVariable -- see rename.ts's
  // removeArtifactReferences/removeConclusionReferences for the
  // destructive-but-consistent rationale).
  const removeArtifact = useCallback((artifactId: string) => {
    setConfig((c) => {
      const stripped = removeArtifactReferences(c as unknown as RenameableCaseConfig, artifactId) as unknown as ECaseConfig;
      return { ...stripped, artifacts: stripped.artifacts.filter((a) => a.id !== artifactId) };
    });
    markSaving();
  }, [setConfig, markSaving]);

  const removeConclusion = useCallback((conclusionId: string) => {
    setConfig((c) => {
      const stripped = removeConclusionReferences(c as unknown as RenameableCaseConfig, conclusionId) as unknown as ECaseConfig;
      return { ...stripped, conclusions: stripped.conclusions.filter((cn) => cn.id !== conclusionId) };
    });
    markSaving();
  }, [setConfig, markSaving]);

  const unmappedArtifacts = config.artifacts.filter((a) => !config.expertMap.some((m) => m.artifactId === a.id));

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
            {/* Neutral wording: `errors` covers both cross-field/validation
                failures (config won't export -- unmapped map references,
                missing sound reason, mode/credit mismatch) and save
                failures. */}
            <p className="font-semibold text-amber-900">Issues:</p>
            <ul className="mt-1 list-disc pl-5 text-amber-800">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        <CaseSection config={config} onChange={patch} />
        <ArtifactsSection
          artifacts={config.artifacts} assets={assets}
          onChange={(artifacts) => patch({ artifacts })}
          onRenameId={renameArtifact} onRemove={removeArtifact}
        />
        <ConclusionsSection
          conclusions={config.conclusions} scoringMode={config.scoringMode}
          onChange={(conclusions) => patch({ conclusions })}
          onRenameId={renameConclusion} onRenameReasonId={renameReason} onRemove={removeConclusion}
        />
        <ExpertMapSection
          artifacts={config.artifacts} conclusions={config.conclusions} expertMap={config.expertMap}
          onChange={(expertMap) => patch({ expertMap })}
        />
        {unmappedArtifacts.length > 0 && (
          // Advisory styling, not an error: unmapped artifacts (red herrings)
          // are explicitly legal per spec §2 -- this is a nudge to check the
          // omission was intentional, not a validation failure blocking
          // export.
          <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-semibold">Not mapped to any conclusion:</p>
            <p className="mt-1 text-blue-800">
              These artifacts are legal red herrings if that&apos;s intentional, but check the list below for anything you meant to map:
            </p>
            <ul className="mt-1 list-disc pl-5 text-blue-800">
              {unmappedArtifacts.map((a) => <li key={a.id}>{a.title || a.id}</li>)}
            </ul>
          </div>
        )}

        <ExportButton interactiveId={interactiveId} disabled={errors.length > 0} />
      </div>

      <div className="sticky top-4 h-[85vh]">
        <p className="mb-1 text-sm font-semibold text-gray-600">Live preview (actual engine runtime)</p>
        {/* Same handshake/no-`sandbox` rationale as branching-editor.tsx:
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

/* ---------- Case section ---------- */

function CaseSection({ config, onChange }: { config: ECaseConfig; onChange: (p: Partial<ECaseConfig>) => void }) {
  return (
    <Section title="Case">
      <Field label="Intro (basic formatting allowed; the learning objective lives here, learner-visible)">
        <textarea className={`${inputCls} font-mono`} rows={3} value={config.intro}
          onChange={(e) => onChange({ intro: e.target.value })} />
      </Field>
      <SelectField label="Scoring mode" value={config.scoringMode} options={MODE_OPTIONS}
        onChange={(scoringMode) => onChange({ scoringMode: scoringMode as EScoringMode })} />
      {/* Visible text (not a hover-only tooltip -- the WCAG gap this
          replaces, same doctrine as new-interactive-form.tsx's starter
          description): the "single" mode's grading consequence is stated
          plainly whenever it's the selected mode, not hidden behind an
          affordance a keyboard/screen-reader user might never trigger. */}
      {config.scoringMode === "single" && (
        <p className="text-xs" style={{ color: "var(--rds-dark-2)" }}>
          In this mode, process credit only counts with the correct conclusion — a wrong conclusion scores 0.
        </p>
      )}
      <SelectField label="Header color (brief step brand band)" value={config.headerColor ?? "primary"}
        options={HEADER_COLOR_OPTIONS}
        onChange={(headerColor) => onChange({ headerColor: headerColor as TokenName })} />
    </Section>
  );
}

/* ---------- Artifacts section ---------- */

function ArtifactsSection({ artifacts, assets, onChange, onRenameId, onRemove }: {
  artifacts: EArtifact[]; assets: AssetRef[]; onChange: (v: EArtifact[]) => void;
  onRenameId: (oldId: string, newId: string) => void; onRemove: (artifactId: string) => void;
}) {
  const rowKeys = useRowKeys(artifacts.length);
  const update = (i: number, p: Partial<EArtifact>) => onChange(artifacts.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const addArtifact = () => {
    rowKeys.add();
    const title = "New artifact";
    const id = uniqueSlug(title, new Set(artifacts.map((x) => x.id)), "artifact");
    onChange([...artifacts, { id, title, kind: "text", body: "<p></p>" }]);
  };

  return (
    <Section title="Artifacts" addLabel="artifact" onAdd={artifacts.length < 16 ? addArtifact : undefined}>
      {artifacts.map((a, i) => (
        <ArtifactRow key={rowKeys.keys[i]} artifact={a} assets={assets}
          otherIds={new Set(artifacts.filter((_, j) => j !== i).map((x) => x.id))}
          onChange={(p) => update(i, p)}
          onRemove={() => { rowKeys.remove(i); onRemove(a.id); }}
          onRename={(newId) => onRenameId(a.id, newId)}
        />
      ))}
      {artifacts.length === 0 && <p className="text-sm text-gray-500">Add at least two artifacts.</p>}
    </Section>
  );
}

function ArtifactRow({ artifact, assets, otherIds, onChange, onRemove, onRename }: {
  artifact: EArtifact; assets: AssetRef[]; otherIds: Set<string>;
  onChange: (p: Partial<EArtifact>) => void; onRemove: () => void; onRename: (newId: string) => void;
}) {
  const assetOptions = [{ value: "", label: "(choose an image)" }, ...assets.map((a) => ({ value: a.id, label: a.filename }))];

  const changeKind = (kind: EArtifactKind) => {
    // Kind-consistency (schema.ts): each kind requires its own payload and
    // forbids the others' -- switching kind clears the other kinds' fields
    // so the draft never carries stray payloads the validator would reject.
    if (kind === "text") {
      onChange({ kind, body: artifact.body ?? "<p></p>", imageAssetId: undefined, imageRole: undefined, imageAlt: undefined, table: undefined });
    } else if (kind === "image") {
      onChange({ kind, body: undefined, table: undefined });
    } else {
      onChange({
        kind, body: undefined, imageAssetId: undefined, imageRole: undefined, imageAlt: undefined,
        table: artifact.table ?? { headers: ["Column 1", "Column 2"], rows: [["", ""]] },
      });
    }
  };

  return (
    <Row onRemove={onRemove}>
      <TextField label="Title" value={artifact.title} onChange={(title) => onChange({ title })} />
      <TextField label="Source line (optional, e.g. “Deposition of R. Alvarez, p.4”)" value={artifact.sourceLine ?? ""}
        onChange={(sourceLine) => onChange({ sourceLine: sourceLine || undefined })} />
      <SelectField label="Kind" value={artifact.kind} options={KIND_OPTIONS} onChange={(kind) => changeKind(kind as EArtifactKind)} />

      {artifact.kind === "text" && (
        <Field label="Body (basic formatting allowed)">
          <textarea className={`${inputCls} font-mono`} rows={4} value={artifact.body ?? ""}
            onChange={(e) => onChange({ body: e.target.value })} />
        </Field>
      )}

      {artifact.kind === "image" && (
        <>
          <SelectField label="Image" value={artifact.imageAssetId ?? ""} options={assetOptions}
            onChange={(id) => onChange(id
              ? { imageAssetId: id, imageRole: artifact.imageRole ?? "decorative", imageAlt: artifact.imageRole === "informative" ? artifact.imageAlt : undefined }
              : { imageAssetId: undefined, imageRole: undefined, imageAlt: undefined })} />
          {artifact.imageAssetId && (
            <Field label="Image type">
              <div role="radiogroup" aria-label="Image type" className="mt-0.5 flex gap-3 text-sm">
                <label className="flex items-center gap-1">
                  <input type="radio" name={`image-role-${artifact.id}`} checked={artifact.imageRole === "decorative"}
                    onChange={() => onChange({ imageRole: "decorative", imageAlt: undefined })} />
                  Decorative
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name={`image-role-${artifact.id}`} checked={artifact.imageRole === "informative"}
                    onChange={() => onChange({ imageRole: "informative" })} />
                  Informative
                </label>
              </div>
            </Field>
          )}
          {artifact.imageAssetId && artifact.imageRole === "informative" && (
            <Field label="Image description (alt text)">
              <input className={inputCls} value={artifact.imageAlt ?? ""} onChange={(e) => onChange({ imageAlt: e.target.value })} />
              <span className="mt-0.5 block text-xs text-gray-500">
                Describe what the image conveys. When AI drafting arrives, it will suggest; a human always accepts.
              </span>
            </Field>
          )}
        </>
      )}

      {artifact.kind === "table" && artifact.table && (
        <TableEditor table={artifact.table} onChange={(table) => onChange({ table })} />
      )}

      <IdAdvanced id={artifact.id} onRename={() => {
        const newIdCandidate = uniqueSlug(artifact.title, otherIds, "artifact");
        if (newIdCandidate !== artifact.id) onRename(newIdCandidate);
      }} />
    </Row>
  );
}

function TableEditor({ table, onChange }: { table: EArtifactTable; onChange: (t: EArtifactTable) => void }) {
  const updateHeader = (i: number, value: string) => onChange({ ...table, headers: table.headers.map((h, j) => (j === i ? value : h)) });
  const updateCell = (r: number, c: number, value: string) =>
    onChange({ ...table, rows: table.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)) });

  const addColumn = () => {
    if (table.headers.length >= 5) return;
    onChange({ ...table, headers: [...table.headers, `Column ${table.headers.length + 1}`], rows: table.rows.map((row) => [...row, ""]) });
  };
  const removeColumn = (i: number) => {
    if (table.headers.length <= 2) return;
    onChange({ ...table, headers: table.headers.filter((_, j) => j !== i), rows: table.rows.map((row) => row.filter((_, j) => j !== i)) });
  };
  const addRow = () => {
    if (table.rows.length >= 8) return;
    onChange({ ...table, rows: [...table.rows, table.headers.map(() => "")] });
  };
  const removeRow = (i: number) => {
    if (table.rows.length <= 1) return;
    onChange({ ...table, rows: table.rows.filter((_, j) => j !== i) });
  };

  return (
    <div className="col-span-2 rounded border border-gray-200 p-2">
      <TextField label="Caption (optional; falls back to the artifact title)" value={table.caption ?? ""}
        onChange={(caption) => onChange({ ...table, caption: caption || undefined })} />
      <div className="mt-2">
        <span className="mb-1 block text-xs font-medium text-gray-600">Headers</span>
        <div className="flex flex-wrap items-center gap-1">
          {table.headers.map((h, i) => (
            <span key={i} className="flex items-center gap-1">
              <input aria-label={`Header ${i + 1}`} className={`${inputCls} w-28`} value={h} onChange={(e) => updateHeader(i, e.target.value)} />
              {table.headers.length > 2 && (
                <button type="button" className="btn-danger-link btn-sm" onClick={() => removeColumn(i)}>×</button>
              )}
            </span>
          ))}
          {table.headers.length < 5 && (
            <button type="button" className="btn btn-light-2 btn-sm" onClick={addColumn}>+ column</button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <span className="mb-1 block text-xs font-medium text-gray-600">Rows</span>
        {table.rows.map((row, r) => (
          <div key={r} className="flex flex-wrap items-center gap-1">
            {row.map((cell, c) => (
              <input key={c} aria-label={`Row ${r + 1}, ${table.headers[c] || `column ${c + 1}`}`} className={`${inputCls} w-28`}
                value={cell} onChange={(e) => updateCell(r, c, e.target.value)} />
            ))}
            {table.rows.length > 1 && (
              <button type="button" className="btn-danger-link btn-sm" onClick={() => removeRow(r)}>Remove row</button>
            )}
          </div>
        ))}
        {table.rows.length < 8 && (
          <button type="button" className="btn btn-light-2 btn-sm" onClick={addRow}>+ row</button>
        )}
      </div>
    </div>
  );
}

/* ---------- Conclusions section ---------- */

function ConclusionsSection({ conclusions, scoringMode, onChange, onRenameId, onRenameReasonId, onRemove }: {
  conclusions: EConclusion[]; scoringMode: EScoringMode; onChange: (v: EConclusion[]) => void;
  onRenameId: (oldId: string, newId: string) => void;
  onRenameReasonId: (conclusionId: string, oldId: string, newId: string) => void;
  onRemove: (conclusionId: string) => void;
}) {
  const rowKeys = useRowKeys(conclusions.length);
  const update = (i: number, p: Partial<EConclusion>) => onChange(conclusions.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const addConclusion = () => {
    rowKeys.add();
    const label = "New conclusion";
    const id = uniqueSlug(label, new Set(conclusions.map((x) => x.id)), "conclusion");
    onChange([...conclusions, {
      id, label, credit: "none", expertRationale: "<p></p>",
      reasons: [
        { id: uniqueSlug("sound reason", new Set(), "reason"), text: "A sound reason.", sound: true },
        { id: uniqueSlug("flawed reason", new Set(), "reason_2"), text: "A flawed reason.", sound: false, flawNote: "Explain the flaw here." },
      ],
    }]);
  };

  return (
    <Section title="Conclusions" addLabel="conclusion" onAdd={conclusions.length < 6 ? addConclusion : undefined}>
      {conclusions.map((c, i) => (
        <ConclusionRow key={rowKeys.keys[i]} conclusion={c} scoringMode={scoringMode}
          otherIds={new Set(conclusions.filter((_, j) => j !== i).map((x) => x.id))}
          onChange={(p) => update(i, p)}
          onRemove={() => { rowKeys.remove(i); onRemove(c.id); }}
          onRename={(newId) => onRenameId(c.id, newId)}
          onRenameReasonId={(oldId, newId) => onRenameReasonId(c.id, oldId, newId)}
        />
      ))}
      {conclusions.length === 0 && <p className="text-sm text-gray-500">Add at least two conclusions.</p>}
    </Section>
  );
}

function ConclusionRow({ conclusion, scoringMode, otherIds, onChange, onRemove, onRename, onRenameReasonId }: {
  conclusion: EConclusion; scoringMode: EScoringMode; otherIds: Set<string>;
  onChange: (p: Partial<EConclusion>) => void; onRemove: () => void; onRename: (newId: string) => void;
  onRenameReasonId: (oldId: string, newId: string) => void;
}) {
  const reasonRowKeys = useRowKeys(conclusion.reasons.length);
  const updateReason = (i: number, p: Partial<EReason>) =>
    onChange({ reasons: conclusion.reasons.map((r, j) => (j === i ? { ...r, ...p } : r)) });

  return (
    <div className="rounded border border-gray-100 bg-gray-50 p-3">
      <div className="flex justify-end">
        <button type="button" onClick={onRemove} className="btn-danger-link btn-sm">Remove conclusion</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Label" value={conclusion.label} onChange={(label) => onChange({ label })} />
        {/* Credit select is HIDDEN under argument-quality (spec §2/§5): that
            mode ignores credit entirely, and mode switches must never brick
            an otherwise-valid draft -- so the underlying value is left
            untouched here, only the control is not rendered. */}
        {scoringMode !== "argument-quality" && (
          <SelectField label="Credit" value={conclusion.credit} options={CREDIT_OPTIONS}
            onChange={(credit) => onChange({ credit: credit as ECredit })} />
        )}
        <Field label="Body (optional, basic formatting allowed)">
          <textarea className={`${inputCls} font-mono`} rows={2} value={conclusion.body ?? ""}
            onChange={(e) => onChange({ body: e.target.value || undefined })} />
        </Field>
        <Field label="Expert rationale (shown in the debrief; basic formatting allowed)">
          <textarea className={`${inputCls} font-mono`} rows={2} value={conclusion.expertRationale}
            onChange={(e) => onChange({ expertRationale: e.target.value })} />
        </Field>

        <div className="col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Reasons</h3>
            {conclusion.reasons.length < 6 && (
              <button type="button" className="btn btn-light-2 btn-sm"
                onClick={() => {
                  reasonRowKeys.add();
                  const id = uniqueSlug("reason", new Set(conclusion.reasons.map((r) => r.id)), "reason");
                  onChange({ reasons: [...conclusion.reasons, { id, text: "A new reason.", sound: true }] });
                }}>+ reason</button>
            )}
          </div>
          <div className="mt-2 space-y-2">
            {conclusion.reasons.map((reason, i) => (
              <div key={reasonRowKeys.keys[i]} className="rounded border border-gray-200 bg-white p-2">
                <div className="flex justify-end">
                  {conclusion.reasons.length > 2 && (
                    <button type="button" className="btn-danger-link btn-sm"
                      onClick={() => { reasonRowKeys.remove(i); onChange({ reasons: conclusion.reasons.filter((_, j) => j !== i) }); }}>
                      Remove reason
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Text" value={reason.text} onChange={(text) => updateReason(i, { text })} />
                  <SelectField label="Soundness" value={reason.sound ? "sound" : "flawed"} options={SOUNDNESS_OPTIONS}
                    onChange={(v) => updateReason(i, v === "sound" ? { sound: true, flawNote: undefined } : { sound: false, flawNote: reason.flawNote ?? "" })} />
                  {!reason.sound && (
                    <Field label="Flaw note (shown to the learner after they select this reason)">
                      <input className={inputCls} value={reason.flawNote ?? ""} onChange={(e) => updateReason(i, { flawNote: e.target.value })} />
                    </Field>
                  )}
                  <IdAdvanced id={reason.id} onRename={() => {
                    const others = new Set(conclusion.reasons.filter((_, j) => j !== i).map((r) => r.id));
                    const newIdCandidate = uniqueSlug(reason.text, others, "reason");
                    if (newIdCandidate !== reason.id) onRenameReasonId(reason.id, newIdCandidate);
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <IdAdvanced id={conclusion.id} onRename={() => {
          const newIdCandidate = uniqueSlug(conclusion.label, otherIds, "conclusion");
          if (newIdCandidate !== conclusion.id) onRename(newIdCandidate);
        }} />
      </div>
    </div>
  );
}

/* ---------- Expert map section ---------- */

function ExpertMapSection({ artifacts, conclusions, expertMap, onChange }: {
  artifacts: EArtifact[]; conclusions: EConclusion[]; expertMap: EMapEntry[]; onChange: (v: EMapEntry[]) => void;
}) {
  const setEntry = (artifactId: string, conclusionId: string, role: string, strength: "strong" | "weak") => {
    const without = expertMap.filter((m) => !(m.artifactId === artifactId && m.conclusionId === conclusionId));
    if (role === "irrelevant") {
      onChange(without);
    } else {
      onChange([...without, { artifactId, conclusionId, role: role as EMapRole, strength }]);
    }
  };

  return (
    <Section title="Expert map">
      {artifacts.length === 0 && <p className="text-sm text-gray-500">Add artifacts and conclusions to build the expert map.</p>}
      {artifacts.map((artifact) => (
        <details key={artifact.id} className="rounded border border-gray-200 bg-white p-2">
          <summary className="cursor-pointer text-sm font-medium">{artifact.title || artifact.id}</summary>
          <div className="mt-2 space-y-2">
            {conclusions.map((conclusion) => {
              const entry = expertMap.find((m) => m.artifactId === artifact.id && m.conclusionId === conclusion.id);
              const role = entry?.role ?? "irrelevant";
              return (
                <div key={conclusion.id} className="flex flex-wrap items-center gap-2 rounded border border-gray-100 bg-gray-50 p-2">
                  <span className="min-w-[8rem] flex-1 text-sm">{conclusion.label || conclusion.id}</span>
                  <SelectField label="Relationship" value={role} options={MAP_ROLE_OPTIONS}
                    onChange={(newRole) => setEntry(artifact.id, conclusion.id, newRole, entry?.strength ?? "weak")} />
                  {role !== "irrelevant" && (
                    <SelectField label="Strength" value={entry?.strength ?? "weak"} options={STRENGTH_OPTIONS}
                      onChange={(strength) => setEntry(artifact.id, conclusion.id, role, strength as "strong" | "weak")} />
                  )}
                </div>
              );
            })}
            {conclusions.length === 0 && <p className="text-xs text-gray-500">Add a conclusion to map this artifact against it.</p>}
          </div>
        </details>
      ))}
    </Section>
  );
}
