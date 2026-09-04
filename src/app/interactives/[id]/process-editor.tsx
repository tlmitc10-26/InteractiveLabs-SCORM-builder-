"use client";

import { useCallback, useMemo } from "react";
import {
  useDraftEditor, Section, Row, Field, TextField, SelectField, IdAdvanced, useRowKeys, inputCls,
  ExportButton, type AssetRef,
} from "./editor-shared";
// Light import (mirrors case-editor.tsx's own rationale for runtime-config.ts):
// no zod/sanitize-html in this client bundle -- the editor never validates,
// only resolves/reshapes for preview. Validation happens server-side in
// saveInteractiveConfig (via adapterFor), and its errors flow back through
// useDraftEditor's `errors`.
import { toProcessRuntimeConfig, type ProcessRuntimeConfigLike } from "@/lib/engines/process-simulator/runtime-config";
// Light import (no zod/sanitize-html -- see rename.ts's own file comment):
// pure structural reference rewrites for the per-row "Rename to match label"
// Advanced affordance, action-row delete, AND the required->distractor
// toggle cascade (spec §5 review #10).
import { renameActionId, removeActionReferences, type RenameableProcessConfig } from "@/lib/engines/process-simulator/rename";
import { uniqueSlug } from "./slugify";
import { RDS_COLOR_NAMES, type TokenName } from "@/lib/design/tokens";

/* Editing shape mirrors schema.ts's ProcessConfig (pre-validation). No
   companion-doc import in M1 (spec §6 is a separate M2 milestone) -- unlike
   case-editor.tsx/branching-editor.tsx, there is no ImportPanel here. */
type EProcessAction = {
  id: string; label: string; required: boolean; requires?: string[];
  outcome?: string; consequence?: string; consequenceNote?: string;
};
export type EProcessConfig = {
  title: string; intro: string; headerColor?: TokenName; opening: string; expertNote?: string;
  actions: EProcessAction[];
};

const HEADER_COLOR_OPTIONS = RDS_COLOR_NAMES.map((name) => ({ value: name, label: name }));
const PREVIEW_SRC = "/engines/process-simulator/1.0.0/preview.html";
const TYPE_OPTIONS = [
  { value: "required", label: "Required action" },
  { value: "distractor", label: "Distractor (wrong action)" },
];

// Spec §5 (verbatim): the one place the scoring consequence of every click
// is stated plainly to the designer, not hidden behind an affordance a
// keyboard/screen-reader user might never trigger (same WCAG doctrine as
// case-editor.tsx's "single" scoring-mode consequence line).
const SCORING_CONSEQUENCE_LINE =
  "Score = 60% first-try correctness + 40% efficiency; every click on a wrong or premature action counts.";

export function ProcessEditor({ interactiveId, initialTitle, initialConfig, assets }: {
  interactiveId: string; initialTitle: string; initialConfig: EProcessConfig; assets: AssetRef[];
}) {
  // No assets in v1 (spec §10: images are out of scope) -- accepted only for
  // signature parity with the other three editors' dispatch call
  // (editor.tsx passes `assets` uniformly to whichever engine's editor it
  // renders), mirroring runtime-config.ts's own `void urlForAsset` pattern.
  void assets;

  const postPreview = useCallback((cfg: EProcessConfig) => {
    // EProcessConfig (this file's editing shape) is structurally the same
    // authoring shape schema.ts's ProcessConfig satisfies
    // (ProcessRuntimeConfigLike) -- a mid-edit draft can be structurally
    // invalid (empty ids, orphaned text past a toggle, a dangling
    // prerequisite), but toProcessRuntimeConfig is an identity pass-through
    // that never asserts validity, so a best-effort preview of an invalid
    // draft is unaffected; this is the one cast site (mirrors postPreview's
    // cast in case-editor.tsx/branching-editor.tsx).
    return toProcessRuntimeConfig(cfg as unknown as ProcessRuntimeConfigLike, (assetId) => `/api/assets/${assetId}`);
  }, []);

  const { title, config, setConfig, errors, saveState, iframeRef, handleTitleChange, patch, markSaving, onIframeLoad } =
    useDraftEditor<EProcessConfig>({ interactiveId, initialTitle, initialConfig, toPreviewRuntime: postPreview });

  // Backs each row's "Rename to match label" Advanced affordance (ids that
  // OTHER actions' `requires` arrays actually reference -- see rename.ts).
  // Rewrites every reference atomically in one setConfig update, so the
  // config is never briefly inconsistent. EProcessConfig structurally
  // satisfies RenameableProcessConfig (same shape rename.ts's pure module
  // already expects) -- cast the same way case-editor.tsx does for its own
  // structural-superset reason.
  const renameAction = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    setConfig((c) => renameActionId(c as unknown as RenameableProcessConfig, oldId, newId) as unknown as EProcessConfig);
    markSaving();
  }, [setConfig, markSaving]);

  // Backs the actions section row delete: strips every OTHER action's
  // `requires` entry referencing the deleted id in the SAME setConfig update
  // that removes the row's own entry, so the config is never briefly
  // inconsistent (mirrors case-editor.tsx's removeArtifact).
  const removeAction = useCallback((actionId: string) => {
    setConfig((c) => {
      const stripped = removeActionReferences(c as unknown as RenameableProcessConfig, actionId) as unknown as EProcessConfig;
      return { ...stripped, actions: stripped.actions.filter((a) => a.id !== actionId) };
    });
    markSaving();
  }, [setConfig, markSaving]);

  // Required->distractor toggle cascade (spec §5 review #10): flipping an
  // action to a distractor prunes every OTHER action's inbound `requires`
  // entry pointing at it, in the SAME setConfig update as the flag flip
  // itself -- a distractor can never legally be referenced by `requires`, so
  // leaving a stale reference behind would be a silent, unrecoverable
  // authoring bug (the referencing action's prerequisite would point at
  // something that can never be "done"). This ONLY ever touches `requires`
  // arrays; it never removes or edits `outcome`/`consequence`/
  // `consequenceNote` text on ANY action, including the one being toggled --
  // any orphaned text left behind by the flip (e.g. a now-forbidden
  // `outcome` on a fresh distractor) is surfaced by the field-matrix
  // validator as a named error in the Issues panel above, for the designer
  // to resolve deliberately (clear it, or toggle back) -- never silently
  // deleted, and never an unrecoverable dead end. Going distractor->required
  // needs no pruning (a distractor is never referenceable in the first
  // place, per the requires-only-required rule), so the cascade only runs
  // one direction.
  const toggleRequired = useCallback((actionId: string, required: boolean) => {
    setConfig((c) => {
      const cfg = c as EProcessConfig;
      const base = required ? cfg : (removeActionReferences(cfg as unknown as RenameableProcessConfig, actionId) as unknown as EProcessConfig);
      return { ...base, actions: base.actions.map((a) => (a.id === actionId ? { ...a, required } : a)) };
    });
    markSaving();
  }, [setConfig, markSaving]);

  const advisories = useMemo(() => buildAdvisories(config.actions), [config.actions]);

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
                failures (config won't export -- a cycle, a dangling
                prerequisite, a field-matrix mismatch left by a toggle) and
                save failures. */}
            <p className="font-semibold text-amber-900">Issues:</p>
            <ul className="mt-1 list-disc pl-5 text-amber-800">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        <ProcedureSection config={config} onChange={patch} />
        <ActionsSection
          actions={config.actions}
          onChange={(actions) => patch({ actions })}
          onRenameId={renameAction} onRemove={removeAction} onToggleRequired={toggleRequired}
        />

        {advisories.length > 0 && (
          // Advisory styling, not an error: neither condition below blocks
          // export (spec §2/§5) -- these are nudges, not gates.
          <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-semibold">Advisories:</p>
            <ul className="mt-1 list-disc pl-5 text-blue-800">{advisories.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}

        <p className="text-xs" style={{ color: "var(--rds-dark-2)" }}>{SCORING_CONSEQUENCE_LINE}</p>

        <ExportButton interactiveId={interactiveId} disabled={errors.length > 0} />
      </div>

      <div className="sticky top-4 h-[85vh]">
        <p className="mb-1 text-sm font-semibold text-gray-600">Live preview (actual engine runtime)</p>
        {/* Same handshake/no-`sandbox` rationale as case-editor.tsx/
            branching-editor.tsx: preview.html validates postMessage origin
            and posts its ready-ping to location.origin; sandboxing would
            give the iframe an opaque origin and break both checks. */}
        <iframe ref={iframeRef} src={PREVIEW_SRC} title="Preview"
          onLoad={onIframeLoad}
          className="h-full w-full rounded border border-gray-300 bg-white" />
      </div>
    </div>
  );
}

/* ---------- Procedure section ---------- */

function ProcedureSection({ config, onChange }: {
  config: EProcessConfig; onChange: (p: Partial<EProcessConfig>) => void;
}) {
  return (
    <Section title="Procedure">
      <Field label="Intro (learning objective, learner-visible; basic formatting allowed)">
        <textarea className={`${inputCls} font-mono`} rows={3} value={config.intro}
          onChange={(e) => onChange({ intro: e.target.value })} />
      </Field>
      <Field label="Opening (the initial situation the learner walks into; basic formatting allowed)">
        <textarea className={`${inputCls} font-mono`} rows={3} value={config.opening}
          onChange={(e) => onChange({ opening: e.target.value })} />
      </Field>
      <Field label="Expert note (optional; debrief commentary on the expert path, basic formatting allowed)">
        <textarea className={`${inputCls} font-mono`} rows={2} value={config.expertNote ?? ""}
          onChange={(e) => onChange({ expertNote: e.target.value || undefined })} />
      </Field>
      <SelectField label="Header color (brief step brand band)" value={config.headerColor ?? "primary"}
        options={HEADER_COLOR_OPTIONS}
        onChange={(headerColor) => onChange({ headerColor: headerColor as TokenName })} />
    </Section>
  );
}

/* ---------- Actions section ---------- */

function ActionsSection({ actions, onChange, onRenameId, onRemove, onToggleRequired }: {
  actions: EProcessAction[]; onChange: (v: EProcessAction[]) => void;
  onRenameId: (oldId: string, newId: string) => void;
  onRemove: (actionId: string) => void;
  onToggleRequired: (actionId: string, required: boolean) => void;
}) {
  const rowKeys = useRowKeys(actions.length);
  const update = (i: number, p: Partial<EProcessAction>) => onChange(actions.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const addAction = () => {
    rowKeys.add();
    const label = "New action";
    const id = uniqueSlug(label, new Set(actions.map((x) => x.id)), "action");
    onChange([...actions, { id, label, required: true, outcome: "<p></p>" }]);
  };

  const requiredActions = actions.filter((a) => a.required);

  return (
    <Section title="Actions" addLabel="action" onAdd={actions.length < 24 ? addAction : undefined}>
      {actions.map((a, i) => (
        <ActionRow key={rowKeys.keys[i]} action={a}
          otherIds={new Set(actions.filter((_, j) => j !== i).map((x) => x.id))}
          otherRequiredActions={requiredActions.filter((r) => r.id !== a.id)}
          onChange={(p) => update(i, p)}
          onRemove={() => { rowKeys.remove(i); onRemove(a.id); }}
          onRename={(newId) => onRenameId(a.id, newId)}
          onToggleRequired={(required) => onToggleRequired(a.id, required)}
        />
      ))}
      {actions.length < 4 && <p className="text-sm text-gray-500">Add at least 4 actions (2 required minimum).</p>}
    </Section>
  );
}

function ActionRow({ action, otherIds, otherRequiredActions, onChange, onRemove, onRename, onToggleRequired }: {
  action: EProcessAction; otherIds: Set<string>; otherRequiredActions: EProcessAction[];
  onChange: (p: Partial<EProcessAction>) => void; onRemove: () => void; onRename: (newId: string) => void;
  onToggleRequired: (required: boolean) => void;
}) {
  const hasRequires = !!(action.requires && action.requires.length > 0);
  // Field-requirement matrix (schema.ts's validateProcessConfig, both
  // directions): a required action always needs `outcome`; `consequence`/
  // `consequenceNote` apply only when the action is actually attemptable
  // illegally -- a required action WITH a prerequisite, or ANY distractor.
  // `orphaned*` keeps a field's editing UI visible (never silently hides
  // text) even once a toggle has made it inapplicable, so nothing authored
  // is ever hidden from view -- only the Issues panel above decides whether
  // it's currently valid.
  const consequenceApplies = (action.required && hasRequires) || !action.required;
  const showOutcome = action.required || !!action.outcome;
  const showConsequence = consequenceApplies || !!action.consequence || !!action.consequenceNote;

  const toggleRequires = (otherId: string, checked: boolean) => {
    const current = action.requires ?? [];
    const next = checked ? [...current, otherId] : current.filter((id) => id !== otherId);
    onChange({ requires: next.length > 0 ? next : undefined });
  };

  return (
    <Row onRemove={onRemove}>
      <TextField label="Label (imperative, e.g. “Photograph the item in place”)" value={action.label} onChange={(label) => onChange({ label })} />
      <SelectField label="Type" value={action.required ? "required" : "distractor"} options={TYPE_OPTIONS}
        onChange={(v) => onToggleRequired(v === "required")} />

      {action.required && (
        <div className="col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-600">
            Prerequisites (must be done first; every one checked is required, not just one)
          </span>
          {otherRequiredActions.length === 0 ? (
            <p className="text-xs text-gray-500">No other required actions yet to gate this on.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {otherRequiredActions.map((other) => {
                const checked = !!action.requires?.includes(other.id);
                const atCap = !checked && (action.requires?.length ?? 0) >= 6;
                return (
                  <label key={other.id} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={checked} disabled={atCap}
                      onChange={(e) => toggleRequires(other.id, e.target.checked)} />
                    {other.label || other.id}
                  </label>
                );
              })}
            </div>
          )}
          {(action.requires?.length ?? 0) >= 6 && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--rds-dark-2)" }}>Up to 6 prerequisites per action.</p>
          )}
        </div>
      )}

      {showOutcome && (
        <Field label={action.required
          ? "Outcome (required; appended to the Situation log when this action is legally performed)"
          : "Outcome -- not used for a distractor; clear this or switch this action back to Required"}>
          <textarea className={`${inputCls} font-mono`} rows={2} value={action.outcome ?? ""}
            onChange={(e) => onChange({ outcome: e.target.value || undefined })} />
        </Field>
      )}

      {showConsequence && (
        <>
          <Field label={consequenceApplies
            ? (action.required
              ? "Consequence (required; shown when this action is attempted before its prerequisites are met)"
              : "Consequence (required; shown when this wrong action is attempted)")
            : "Consequence -- not used until this action has a prerequisite (add one above) or becomes a distractor; clear this or add a prerequisite"}>
            <textarea className={`${inputCls} font-mono`} rows={2} value={action.consequence ?? ""}
              onChange={(e) => onChange({ consequence: e.target.value || undefined })} />
          </Field>
          <TextField label={consequenceApplies
            ? "Consequence note (required; the debrief teaching line for why this consequence happened)"
            : "Consequence note -- not used until a consequence applies; clear this or add a prerequisite"}
            value={action.consequenceNote ?? ""} onChange={(v) => onChange({ consequenceNote: v || undefined })} />
        </>
      )}

      <IdAdvanced id={action.id} onRename={() => {
        const newIdCandidate = uniqueSlug(action.label, otherIds, "action");
        if (newIdCandidate !== action.id) onRename(newIdCandidate);
      }} />
    </Row>
  );
}

/* ---------- Advisories (spec §5: non-blocking, never gate export) ---------- */

/** Reachable ids from `id`'s OWN `requires` chain (transitive), guarded
 *  against a cycle in an invalid mid-edit draft with a `visiting` set so this
 *  never infinite-loops even before the schema's own acyclic check would
 *  reject the draft on save. */
function reachableFrom(
  id: string,
  byId: Map<string, EProcessAction>,
  memo: Map<string, Set<string>>,
  visiting: Set<string>,
): Set<string> {
  const cached = memo.get(id);
  if (cached) return cached;
  if (visiting.has(id)) return new Set();
  visiting.add(id);
  const result = new Set<string>();
  const action = byId.get(id);
  if (action?.requires) {
    for (const r of action.requires) {
      if (r === id) continue;
      result.add(r);
      for (const s of reachableFrom(r, byId, memo, visiting)) result.add(s);
    }
  }
  visiting.delete(id);
  memo.set(id, result);
  return result;
}

/** Two independent, non-blocking advisories (spec §5): no distractor actions
 *  exist yet, and any `requires` entry that's already implied transitively
 *  by another entry on the SAME action (legal per schema.ts's own comment --
 *  "transitive over-specification legal" -- but worth flagging so a designer
 *  doesn't think they need the redundant edge). */
function buildAdvisories(actions: EProcessAction[]): string[] {
  const advisories: string[] = [];

  if (actions.length > 0 && !actions.some((a) => !a.required)) {
    advisories.push(
      "No distractor actions yet — a procedure can earn correctness purely through prerequisite ordering, " +
      "but a tempting wrong action is usually the clearest way to make a mistake feel real.",
    );
  }

  const byId = new Map(actions.map((a) => [a.id, a]));
  const memo = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const a of actions) {
    if (!a.requires || a.requires.length < 2) continue;
    for (const direct of a.requires) {
      for (const other of a.requires) {
        if (other === direct) continue;
        if (reachableFrom(other, byId, memo, new Set()).has(direct)) {
          const dedupeKey = `${a.id}:${[direct, other].sort().join(",")}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          const directLabel = byId.get(direct)?.label ?? direct;
          const otherLabel = byId.get(other)?.label ?? other;
          advisories.push(
            `"${a.label || a.id}" lists "${directLabel}" as a prerequisite, but it's already implied by ` +
            `"${otherLabel}" — transitively required, so listing it directly is redundant (harmless, not an error).`,
          );
        }
      }
    }
  }
  return advisories;
}
