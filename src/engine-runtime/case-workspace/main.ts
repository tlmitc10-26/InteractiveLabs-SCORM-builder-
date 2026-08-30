import type { CaseConfig } from "@/lib/engines/case-workspace/schema";
import type { RuntimeArtifact } from "@/lib/engines/case-workspace/runtime-config";
import {
  initialState,
  openCaseFile,
  reviewArtifact,
  addToCaseFile,
  removeFromCaseFile,
  goToConclude,
  backToWorkspace,
  chooseConclusion,
  toggleReason,
  submit,
  startOver,
  suspendPayload,
  restoreState,
  type CaseState,
  type Strength,
} from "@/lib/engines/case-workspace/state";
import { scoreCase, type CaseScoreResult } from "@/lib/engines/case-workspace/scoring";

/**
 * Runtime config type: exactly what `toCaseRuntimeConfig(config, urlForAsset)`
 * (src/lib/engines/case-workspace/runtime-config.ts) produces when called
 * with a real `CaseConfig` (schema.ts's zod-inferred type) -- `CaseConfig`
 * is imported `import type` only, so this stays erased at bundle time (zero
 * zod/sanitize-html weight in the engine bundle), exactly like every other
 * `import type` in this file. `RuntimeCaseWorkspaceConfig<T>`'s generic
 * shape is `Omit<T, "artifacts"> & { artifacts: RuntimeArtifact[] }`; this
 * alias pins T to `CaseConfig` so title/intro/scoringMode/headerColor/
 * conclusions/expertMap all keep their full authored types (not the
 * light module's passthrough index signature) for everything this runtime
 * renders.
 */
export type RuntimeCaseConfig = Omit<CaseConfig, "artifacts"> & { artifacts: RuntimeArtifact[] };
type RuntimeConclusion = RuntimeCaseConfig["conclusions"][number];
type RuntimeReason = RuntimeConclusion["reasons"][number];

const KIND_LABEL: Record<RuntimeArtifact["kind"], string> = { text: "Text", image: "Image", table: "Table" };

type ArtifactVerdict = "included-support" | "left-out-support" | "misused-contradict" | "excluded-contradict";
type ReasonVerdict = "sound-selected" | "sound-missed" | "flawed-selected" | "flawed-correctly-unselected";

/** Maps the three FLAGGED verdicts onto the existing three status palettes
 *  (best/ok/poor -- review #22 / spec §3: no new color pairs). The fourth,
 *  neutral verdict in each pair (a contradicting artifact correctly left
 *  out; a flawed reason correctly left unselected) intentionally has no
 *  entry here -- it renders with no color emphasis at all. */
const ARTIFACT_VERDICT_SUFFIX: Partial<Record<ArtifactVerdict, "best" | "ok" | "poor">> = {
  "included-support": "best",
  "left-out-support": "ok",
  "misused-contradict": "poor",
};
const ARTIFACT_VERDICT_TEXT: Record<ArtifactVerdict, string> = {
  "included-support": "included in your case file. This supports the conclusion.",
  "left-out-support": "not included, but it supports the conclusion.",
  "misused-contradict": "included in your case file, but it contradicts the conclusion.",
  "excluded-contradict": "correctly left out. It contradicts the conclusion.",
};
const REASON_VERDICT_SUFFIX: Partial<Record<ReasonVerdict, "best" | "ok" | "poor">> = {
  "sound-selected": "best",
  "sound-missed": "ok",
  "flawed-selected": "poor",
};
const REASON_VERDICT_TEXT: Record<ReasonVerdict, string> = {
  "sound-selected": "selected. This reasoning holds up.",
  "sound-missed": "not selected, but this reasoning holds up.",
  "flawed-selected": "selected, but this reasoning has a flaw.",
  "flawed-correctly-unselected": "not selected. Good: this reasoning has a flaw.",
};

function classifyArtifact(role: "supports" | "contradicts", included: boolean): ArtifactVerdict {
  if (role === "supports") return included ? "included-support" : "left-out-support";
  return included ? "misused-contradict" : "excluded-contradict";
}

/** The debrief score line's exact text -- the ANNOUNCED source for the
 *  score (spec §3: "visible score line (announced source: component
 *  breakdown text)"); the aria-hidden big numeral next to it is purely
 *  decorative, mirroring branching's ilb-score-num/ilb-score-line split.
 *  Mode-specific: argument-quality never mentions credit (the math itself
 *  ignores it, spec §4); single states the gate explicitly when it zeroed
 *  the grade, rather than silently showing "credit: none" with no
 *  explanation. Learner-facing copy: no em dashes, plain punctuation. */
function scoreLineText(mode: RuntimeCaseConfig["scoringMode"], score: CaseScoreResult): string {
  const evidenceText = `Evidence: ${score.evidence.num} of ${score.evidence.den}.`;
  const reasonText = `Reasoning: ${score.reason.num} of ${score.reason.den}.`;
  if (mode === "argument-quality") {
    return `${evidenceText} ${reasonText} Score: ${score.totalPct}%.`;
  }
  if (mode === "single" && score.credit !== "full") {
    return `${evidenceText} ${reasonText} This is not the case's credited conclusion, so no credit is given. Score: ${score.totalPct}%.`;
  }
  return `${evidenceText} ${reasonText} Conclusion credit: ${score.credit}. Score: ${score.totalPct}%.`;
}

/** Defensive salvage for a suspend payload that failed restoreState's full
 *  structural validation (e.g. the config was edited since the payload was
 *  saved, so an artifact/conclusion/reason id it references no longer
 *  exists) but still carries individually well-formed `b` (best score) and
 *  `c` (completed). COPIED VERBATIM from
 *  src/engine-runtime/branching-scenario/main.ts's salvageBestAndCompleted
 *  (spec §4 review #9: "the ~9-line salvageBestAndCompleted is COPIED from
 *  branching") -- the case workspace's suspend payload happens to use the
 *  same `b`/`c` field names, so the reader here is byte-identical. Losing
 *  case-file/reviewed/conclusion progress on a stale payload is acceptable
 *  (the learner restarts at the brief step); silently losing an
 *  already-reported grade/completion is not. */
function salvageBestAndCompleted(payload: unknown): { best: number; completed: boolean } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const b = p.b;
  const c = p.c;
  if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b > 100) return null;
  if (typeof c !== "boolean") return null;
  return { best: b, completed: c };
}

/** Mount the Case / Evidence Workspace engine. Artifact bodies and expert
 *  rationale are rendered via innerHTML (pre-sanitized rich text from the
 *  authoring schema, same trust model as branching's scene body); every
 *  other piece of text (titles, labels, status/score lines) is set via
 *  textContent, never innerHTML. */
export function mountCaseWorkspace(root: HTMLElement, config: RuntimeCaseConfig): void {
  root.innerHTML = "";
  root.classList.add("ilb-case");
  // Same reasoning as the other two engines: this mounted root IS the
  // entire page content of its host SCO/iframe, so it must carry the
  // page's only landmark itself.
  root.setAttribute("role", "main");

  const mountId = `ilb-${Math.random().toString(36).slice(2, 9)}`;
  const scorm = typeof window !== "undefined" ? window.ILBScorm : undefined;
  let warnedSuspendLimit = false;

  // ---------- resume (spec §4 / SCORM contract: mirrors the other two
  // engines' restore-then-re-assert pattern; CaseState carries
  // bestPct/completed/scoreReported directly, unlike branching's separately
  // tracked closure variables, so there is nothing extra to reconcile) ----------
  let state: CaseState;
  const saved = scorm?.loadSuspendData<unknown>();
  const restored = saved != null ? restoreState(config, saved) : null;
  if (restored) {
    state = restored;
  } else {
    state = initialState();
    // restoreState rejects the WHOLE payload on any structural mismatch
    // (e.g. a stale artifact/conclusion id after an authoring edit), but
    // the grade fields it carries are independent of that identity.
    // Salvage them rather than silently reverting an already-reported
    // score/completion to zero/incomplete.
    if (saved != null) {
      const salvaged = salvageBestAndCompleted(saved);
      if (salvaged) state = { ...state, bestPct: salvaged.best, completed: salvaged.completed };
    }
  }

  // A previously-reported score/completion must never appear downgraded or
  // forgotten on resume, even before any new interaction this session.
  if (scorm && scorm.mode === "scorm") {
    if (state.bestPct > 0 || state.completed) {
      scorm.setScore(state.bestPct);
      state = { ...state, scoreReported: true };
    }
    if (state.completed) scorm.setCompleted();
  }

  // ---------- persistent DOM (survives every re-render within a step;
  // rebuilt wholesale only on an actual STEP transition) ----------
  const card = el("div", "ilb-case-card");
  root.appendChild(card);

  // The ONE live region this runtime ever uses (spec §3): case-file status
  // only, "Case file: N of M artifacts". Always present -- unlike
  // branching's conditionally-appended vars-status, this engine has no
  // configuration under which it would be pointless, so it is built once
  // here and never removed.
  const caseStatus = el("div", "ilb-case-status");
  caseStatus.setAttribute("role", "status");
  caseStatus.setAttribute("aria-live", "polite");
  caseStatus.setAttribute("aria-atomic", "true");
  card.appendChild(caseStatus);

  const stepContainer = el("div", "ilb-step");
  card.appendChild(stepContainer);

  // Workspace-step-scoped DOM refs, (re)assigned by enterWorkspace() on
  // every entry into the step; referenced by the targeted-update functions
  // below so within-step interactions (select/add/remove) never tear down
  // and rebuild the whole step (which would drop keyboard focus to <body>).
  let viewerContainer!: HTMLElement;
  let caseFilePanel!: HTMLElement;
  const artifactGlyphs = new Map<string, HTMLElement>();
  let currentArtifactId: string | null = null;

  // Conclude-step-scoped DOM refs, (re)assigned by renderConclude() on
  // every entry into the step.
  let reasonSection!: HTMLElement;
  let submitBtn!: HTMLButtonElement;
  let submitHint!: HTMLElement;

  /** Keeps submitBtn's disabled state, its visible hint paragraph's
   *  [hidden], and its aria-describedby IN LOCKSTEP everywhere the disabled
   *  condition can change (review F4) -- both the visible and programmatic
   *  halves of the disabled explanation must appear/disappear together, or
   *  a screen-reader user hears a stale "select at least one reason"
   *  description on an already-enabled button. */
  function updateSubmitDisabledUI(): void {
    const disabled = !state.chosen || state.selectedReasons.size === 0;
    submitBtn.disabled = disabled;
    submitHint.hidden = !disabled;
    if (disabled) submitBtn.setAttribute("aria-describedby", submitHint.id);
    else submitBtn.removeAttribute("aria-describedby");
  }

  // ---------- shared helpers ----------

  function persistSuspend(): void {
    if (!scorm || scorm.mode !== "scorm") return;
    const ok = scorm.saveSuspendData(suspendPayload(state));
    if (!ok && !warnedSuspendLimit) {
      warnedSuspendLimit = true;
      console.warn("case workspace progress exceeds SCORM suspend limit; resume disabled");
    }
  }

  function updateCaseFileStatus(): void {
    setText(caseStatus, `Case file: ${state.caseFile.length} of ${config.artifacts.length} artifacts`);
  }

  // ---------- Step 1: Brief ----------

  function renderBrief(focusHeading: boolean): void {
    // F2 (review): keeps the live region in sync uniformly on every path
    // into Brief -- initial mount AND "Start over" (whose case-file reset
    // would otherwise leave the region reading the pre-reset count until
    // something else happened to touch it, e.g. re-entering Workspace).
    updateCaseFileStatus();

    stepContainer.innerHTML = "";
    retriggerEnter(stepContainer);

    const header = el("div", "ilb-case-header ilb-case-header--band");
    const band = el("div", "ilb-brand-band");
    band.style.background = `var(--rds-${config.headerColor ?? "primary"})`;
    header.appendChild(band);
    stepContainer.appendChild(header);

    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = config.title;
    stepContainer.appendChild(heading);

    const intro = el("div", "ilb-intro");
    intro.innerHTML = config.intro; // sanitized at authoring + revalidated at export
    stepContainer.appendChild(intro);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "ilb-btn ilb-btn-pill";
    openBtn.textContent = "Open the case file.";
    openBtn.addEventListener("click", () => {
      if (state.step !== "brief") return; // stale-closure guard
      state = openCaseFile(state);
      persistSuspend();
      enterWorkspace(true);
    });
    stepContainer.appendChild(openBtn);

    if (focusHeading) heading.focus();
  }

  // ---------- Step 2: Workspace ----------

  /** Full rebuild of the workspace step -- called on STEP ENTRY only
   *  (initial mount/resume, "Open the case file.", "Back to the case
   *  file."). Interactions WITHIN the step (select/add/remove) use the
   *  targeted render* functions below instead, so a click never destroys
   *  the very control the user just activated. */
  function enterWorkspace(focusHeading: boolean): void {
    currentArtifactId = null;
    stepContainer.innerHTML = "";
    retriggerEnter(stepContainer);
    artifactGlyphs.clear();

    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = "Workspace";
    stepContainer.appendChild(heading);

    const list = el("div", "ilb-artifact-list");
    for (const artifact of config.artifacts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ilb-btn ilb-artifact-btn";
      const titleSpan = document.createElement("span");
      titleSpan.className = "ilb-artifact-title";
      titleSpan.textContent = artifact.title;
      btn.appendChild(titleSpan);
      const kindSpan = document.createElement("span");
      kindSpan.className = "ilb-artifact-kind";
      kindSpan.textContent = KIND_LABEL[artifact.kind];
      btn.appendChild(kindSpan);
      // Aria-hidden reviewed glyph (spec §3): decorative only -- reviewed
      // status is a sighted bookkeeping convenience, never scored and never
      // announced as its own fact (mirrors the aria-hidden A/B/C markers in
      // branching's choice buttons, which likewise contribute nothing to
      // the accessible name).
      const glyph = document.createElement("span");
      glyph.className = "ilb-artifact-reviewed";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = state.reviewed.has(artifact.id) ? "●" : "○"; // ● / ○
      btn.appendChild(glyph);
      btn.addEventListener("click", () => handleSelectArtifact(artifact.id));
      list.appendChild(btn);
      artifactGlyphs.set(artifact.id, glyph);
    }
    stepContainer.appendChild(list);

    viewerContainer = el("div", "ilb-viewer");
    stepContainer.appendChild(viewerContainer);
    renderViewer(false);

    caseFilePanel = el("div", "ilb-case-file-panel");
    stepContainer.appendChild(caseFilePanel);
    renderCaseFilePanel(false);

    const readyBtn = document.createElement("button");
    readyBtn.type = "button";
    readyBtn.className = "ilb-btn ilb-btn-pill";
    readyBtn.textContent = "Ready to conclude";
    readyBtn.addEventListener("click", () => {
      if (state.step !== "workspace") return; // stale-closure guard
      state = goToConclude(state);
      persistSuspend();
      renderConclude(true);
    });
    stepContainer.appendChild(readyBtn);

    updateCaseFileStatus();
    if (focusHeading) heading.focus();
  }

  function handleSelectArtifact(artifactId: string): void {
    if (state.step !== "workspace") return; // stale-closure guard
    const wasReviewed = state.reviewed.has(artifactId);
    state = reviewArtifact(config, state, artifactId);
    if (!wasReviewed) {
      const glyph = artifactGlyphs.get(artifactId);
      if (glyph) glyph.textContent = "●"; // in-place update -- the artifact list itself is never rebuilt, so the button that was just clicked keeps focus
    }
    currentArtifactId = artifactId;
    persistSuspend();
    renderViewer(false); // never steals focus from the artifact-list button just clicked
  }

  /** Rebuilds ONLY the viewer container -- called whenever the currently
   *  viewed artifact or its case-file membership changes. `focusAction`
   *  moves focus onto the resulting add/remove control (used when the
   *  rebuild is a direct consequence of activating one of THIS viewer's own
   *  buttons, so focus follows the control that replaced it); selecting a
   *  different artifact from the list passes false, since the artifact-list
   *  button that was clicked should keep focus instead. */
  function renderViewer(focusAction: boolean): void {
    viewerContainer.innerHTML = "";
    if (!currentArtifactId) {
      const empty = el("p", "ilb-viewer-empty");
      empty.textContent = "Select an artifact from the list to review it.";
      viewerContainer.appendChild(empty);
      return;
    }
    const artifact = config.artifacts.find((a) => a.id === currentArtifactId);
    if (!artifact) return; // defensive: currentArtifactId always comes from config.artifacts above

    const h3 = document.createElement("h3");
    h3.textContent = artifact.title;
    viewerContainer.appendChild(h3);

    if (artifact.sourceLine) {
      const src = el("p", "ilb-artifact-source");
      src.textContent = artifact.sourceLine;
      viewerContainer.appendChild(src);
    }

    const body = el("div", "ilb-artifact-body");
    if (artifact.kind === "text") {
      body.innerHTML = artifact.body ?? ""; // sanitized at authoring + revalidated at export
      viewerContainer.appendChild(body);
    } else if (artifact.kind === "image") {
      const img = document.createElement("img");
      img.className = "ilb-artifact-image";
      img.src = artifact.imageUrl ?? "";
      img.alt = artifact.imageRole === "informative" ? (artifact.imageAlt ?? "") : "";
      body.appendChild(img);
      viewerContainer.appendChild(body);
    } else if (artifact.kind === "table" && artifact.table) {
      const table = document.createElement("table");
      table.className = "ilb-artifact-table";
      const caption = document.createElement("caption");
      caption.textContent = artifact.table.caption || artifact.title; // spec §2: optional caption falls back to title
      table.appendChild(caption);
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const h of artifact.table.headers) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = h;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const row of artifact.table.rows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      viewerContainer.appendChild(table);
    }

    const actions = el("div", "ilb-viewer-actions");
    const included = state.caseFile.some(([id]) => id === currentArtifactId);
    const artifactIdAtRender = currentArtifactId; // stale-closure guard: captured once per render
    let removeBtn: HTMLButtonElement | null = null;
    let addStrongBtn: HTMLButtonElement | null = null;
    if (included) {
      removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ilb-btn ilb-btn-pill ilb-btn-pill--ghost";
      removeBtn.textContent = "Remove from case file";
      removeBtn.addEventListener("click", () => {
        if (state.step !== "workspace" || currentArtifactId !== artifactIdAtRender) return;
        state = removeFromCaseFile(state, artifactIdAtRender);
        persistSuspend();
        updateCaseFileStatus();
        renderCaseFilePanel(false);
        renderViewer(true);
      });
      actions.appendChild(removeBtn);
    } else {
      addStrongBtn = document.createElement("button");
      addStrongBtn.type = "button";
      addStrongBtn.className = "ilb-btn ilb-btn-pill";
      addStrongBtn.textContent = "Add as strong support";
      addStrongBtn.addEventListener("click", () => handleAddToCaseFile(artifactIdAtRender, "strong"));
      actions.appendChild(addStrongBtn);

      const addWeakBtn = document.createElement("button");
      addWeakBtn.type = "button";
      addWeakBtn.className = "ilb-btn ilb-btn-pill ilb-btn-pill--ghost";
      addWeakBtn.textContent = "Add as weak support";
      addWeakBtn.addEventListener("click", () => handleAddToCaseFile(artifactIdAtRender, "weak"));
      actions.appendChild(addWeakBtn);
    }
    viewerContainer.appendChild(actions);

    if (focusAction) (removeBtn ?? addStrongBtn)?.focus();
  }

  function handleAddToCaseFile(artifactId: string, strength: Strength): void {
    if (state.step !== "workspace" || currentArtifactId !== artifactId) return; // stale-closure guard
    state = addToCaseFile(config, state, artifactId, strength);
    persistSuspend();
    updateCaseFileStatus();
    renderCaseFilePanel(false);
    renderViewer(true);
  }

  /** Rebuilds ONLY the case-file panel's rows. `focusHeadingAfterRemove`
   *  moves focus to the panel's own (tabIndex=-1) heading -- used when the
   *  rebuild is a direct consequence of clicking a Remove button THAT PANEL
   *  ITSELF just destroyed, so focus lands somewhere stable in the panel
   *  rather than falling back to <body>. */
  function renderCaseFilePanel(focusHeadingAfterRemove: boolean): void {
    caseFilePanel.innerHTML = "";
    const heading = document.createElement("h3");
    heading.tabIndex = -1;
    heading.textContent = "Your case file";
    caseFilePanel.appendChild(heading);

    if (state.caseFile.length === 0) {
      const empty = el("p", "ilb-case-file-empty");
      empty.textContent = "No artifacts added yet.";
      caseFilePanel.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "ilb-case-file-list";
      for (const [artifactId, strength] of state.caseFile) {
        const artifact = config.artifacts.find((a) => a.id === artifactId);
        if (!artifact) continue;
        const li = document.createElement("li");
        li.className = "ilb-case-file-row";
        const label = document.createElement("span");
        label.textContent = `${artifact.title}: `;
        // Review F5: the strength is its OWN tracked text-carrier
        // (transcript.ts's TEXT_CARRIER_CLASSES) so a screen-reader user
        // gets a reading-order confirmation of which strength they assigned
        // -- previously this whole row was untracked prose.
        const strengthSpan = document.createElement("span");
        strengthSpan.className = "ilb-case-file-strength";
        strengthSpan.textContent = strength === "strong" ? "Strong support" : "Weak support";
        label.appendChild(strengthSpan);
        li.appendChild(label);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "ilb-btn ilb-case-file-remove";
        removeBtn.textContent = `Remove ${artifact.title} from case file`;
        removeBtn.addEventListener("click", () => handlePanelRemove(artifactId));
        li.appendChild(removeBtn);
        list.appendChild(li);
      }
      caseFilePanel.appendChild(list);
    }

    if (focusHeadingAfterRemove) heading.focus();
  }

  function handlePanelRemove(artifactId: string): void {
    if (state.step !== "workspace") return; // stale-closure guard
    state = removeFromCaseFile(state, artifactId);
    persistSuspend();
    updateCaseFileStatus();
    // The Remove button just clicked is about to be destroyed (its row is
    // removed from this rebuild) -- land focus on the panel's own heading
    // rather than losing it to <body>.
    renderCaseFilePanel(true);
    // If the viewer is currently showing the artifact just removed here, its
    // controls must swap back from "Remove from case file" to the two Add
    // buttons -- but focus already moved to the panel heading above, so this
    // rebuild must not steal it back.
    if (currentArtifactId === artifactId) renderViewer(false);
  }

  // ---------- Step 3: Conclude ----------

  function renderConclude(focusHeading: boolean): void {
    stepContainer.innerHTML = "";
    retriggerEnter(stepContainer);

    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = "Conclude";
    stepContainer.appendChild(heading);

    const conclusionGroupName = `${mountId}-conclusion`;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "ilb-conclusion-group";
    const legend = document.createElement("legend");
    legend.textContent = "Choose the conclusion this case supports.";
    fieldset.appendChild(legend);

    for (const conclusion of config.conclusions) {
      const label = document.createElement("label");
      label.className = "ilb-conclusion-card";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = conclusionGroupName;
      radio.value = conclusion.id;
      radio.checked = state.chosen === conclusion.id;
      radio.addEventListener("change", () => {
        if (state.step !== "conclude") return; // stale-closure guard
        const prevChosen = state.chosen;
        state = chooseConclusion(config, state, conclusion.id);
        persistSuspend();
        // Spec §3: "on conclusion change, selections reset and focus moves
        // to the reason group's legend" -- the live region is NOT used for
        // this (branching's aria-describedby doctrine: the accname carries
        // the announcement instead).
        if (state.chosen !== prevChosen) renderReasonSection(true);
      });
      label.appendChild(radio);
      const labelText = document.createElement("span");
      labelText.className = "ilb-conclusion-label";
      labelText.textContent = conclusion.label;
      label.appendChild(labelText);
      fieldset.appendChild(label);
    }
    stepContainer.appendChild(fieldset);

    reasonSection = el("div", "ilb-reason-section");
    stepContainer.appendChild(reasonSection);

    submitHint = el("p", "ilb-submit-hint");
    submitHint.id = `${mountId}-submit-hint`;
    submitHint.textContent = "Select at least one reason before you can submit.";
    stepContainer.appendChild(submitHint);

    submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "ilb-btn ilb-btn-pill";
    submitBtn.textContent = "Submit conclusion";
    // Visible (the hint paragraph above) + programmatic (aria-describedby)
    // explanation for the disabled state (spec §3 review #17), mirroring
    // branching's aria-describedby doctrine for its Continue button --
    // updateSubmitDisabledUI() (review F4) keeps both in lockstep with
    // submitBtn.disabled everywhere it changes, so the initial state is set
    // there too (via renderReasonSection(false) below), not here.
    submitBtn.addEventListener("click", () => {
      if (state.step !== "conclude" || !state.chosen || state.selectedReasons.size === 0) return;
      handleSubmit();
    });
    stepContainer.appendChild(submitBtn);

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "ilb-btn ilb-btn-pill ilb-btn-pill--ghost";
    backBtn.textContent = "Back to the case file";
    backBtn.addEventListener("click", () => {
      if (state.step !== "conclude") return; // stale-closure guard
      state = backToWorkspace(state);
      persistSuspend();
      enterWorkspace(true);
    });
    stepContainer.appendChild(backBtn);

    renderReasonSection(false); // builds the group for a restored mid-conclude chosen conclusion, if any; no legend focus on step entry

    if (focusHeading) heading.focus();
  }

  /** Rebuilds ONLY the reason checkbox group (and the submit button's
   *  disabled state) -- called on conclusion change and on entering the
   *  Conclude step. `focusLegend` moves focus to the (tabIndex=-1) legend,
   *  which is the ONLY focus-management this runtime does outside a full
   *  step transition (spec §3). */
  function renderReasonSection(focusLegend: boolean): void {
    reasonSection.innerHTML = "";
    updateSubmitDisabledUI();
    if (!state.chosen) return;
    const conclusion = config.conclusions.find((c) => c.id === state.chosen) as RuntimeConclusion;
    const conclusionIdAtRender = state.chosen; // stale-closure guard: captured once per render

    const fieldset = document.createElement("fieldset");
    fieldset.className = "ilb-reason-group";
    const legend = document.createElement("legend");
    legend.tabIndex = -1;
    legend.textContent = `Which of these justify ${conclusion.label}? Select all that apply.`;
    fieldset.appendChild(legend);

    for (const reason of conclusion.reasons as RuntimeReason[]) {
      const label = document.createElement("label");
      label.className = "ilb-reason-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedReasons.has(reason.id);
      checkbox.addEventListener("change", () => {
        if (state.step !== "conclude" || state.chosen !== conclusionIdAtRender) return; // stale-closure guard
        state = toggleReason(config, state, reason.id);
        persistSuspend();
        updateSubmitDisabledUI();
      });
      label.appendChild(checkbox);
      const text = document.createElement("span");
      text.textContent = reason.text;
      label.appendChild(text);
      fieldset.appendChild(label);
    }
    reasonSection.appendChild(fieldset);

    if (focusLegend) legend.focus();
  }

  // ---------- SCORM reporting on submit (spec §4: "First debrief:
  // setScore(bestPct) then setCompleted() (idempotent)") ----------

  function handleSubmit(): void {
    const result = submit(config, state);
    state = result.state; // step "debrief"; bestPct/completed/scoreReported already updated by submit()
    if (scorm && scorm.mode === "scorm") {
      scorm.setScore(state.bestPct);
      scorm.setCompleted(); // idempotent at the adapter
    }
    persistSuspend();
    renderDebrief(true);
  }

  // ---------- Step 4: Debrief ----------

  function renderDebrief(focusHeading: boolean): void {
    // Belt-and-braces (review F3): restoreState (state.ts) already rejects
    // any step:"debrief" payload missing a chosen conclusion, so this
    // should be unreachable through a normal resume -- but a debrief render
    // must never dereference an absent/no-longer-existing conclusion no
    // matter how `state` got here. Treat it as corrupted, exactly like a
    // fresh mount, rather than throwing.
    const conclusion = config.conclusions.find((c) => c.id === state.chosen);
    if (!state.chosen || !conclusion) {
      state = initialState();
      renderBrief(true);
      return;
    }

    stepContainer.innerHTML = "";
    retriggerEnter(stepContainer);

    const includedIds = state.caseFile.map(([id]) => id);
    // Recomputed directly rather than carried over from handleSubmit's
    // result: on a resume that restores straight into the debrief step, no
    // submit() call happens this session at all, so this must be
    // independently reproducible from state alone -- and it is, since
    // scoreCase is pure and state.caseFile/chosen/selectedReasons are all
    // frozen once step is "debrief" (see startOver, the only way out).
    const score = scoreCase(config, state.chosen as string, includedIds, [...state.selectedReasons]);

    const resultHead = el("div", "ilb-result-head");
    stepContainer.appendChild(resultHead);

    const eyebrow = el("p", "ilb-eyebrow");
    eyebrow.textContent = "Case complete";
    resultHead.appendChild(eyebrow);

    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = conclusion.label;
    resultHead.appendChild(heading);

    const numeral = el("div", "ilb-score-num");
    numeral.setAttribute("aria-hidden", "true");
    const numeralValue = document.createElement("span");
    numeralValue.textContent = String(score.totalPct);
    numeral.appendChild(numeralValue);
    const numeralUnit = document.createElement("small");
    numeralUnit.textContent = "%";
    numeral.appendChild(numeralUnit);
    resultHead.appendChild(numeral);

    const scoreLine = el("p", "ilb-score-line");
    scoreLine.textContent = scoreLineText(config.scoringMode, score);
    resultHead.appendChild(scoreLine);

    const includedSet = new Set(includedIds);
    const artifactEntries = config.expertMap
      .filter((m) => m.conclusionId === state.chosen)
      .map((m) => ({ artifactId: m.artifactId, verdict: classifyArtifact(m.role, includedSet.has(m.artifactId)) }));

    const counts: Record<ArtifactVerdict, number> = {
      "included-support": 0,
      "left-out-support": 0,
      "misused-contradict": 0,
      "excluded-contradict": 0,
    };
    for (const entry of artifactEntries) counts[entry.verdict]++;

    // Quality-breakdown chips (mirrors branching's ilb-quality-chips
    // exactly): the SAME counts already in the accessible comparison list
    // below, rendered as aria-hidden decorative chips -- redundancy
    // doctrine, never the sole carrier of the breakdown. Zero categories
    // are omitted (branching precedent), and the neutral "correctly
    // excluded" category never gets a chip at all (it isn't one of the
    // three flagged palettes).
    const flaggedVerdicts: ArtifactVerdict[] = ["included-support", "left-out-support", "misused-contradict"];
    if (flaggedVerdicts.some((v) => counts[v] > 0)) {
      const chipsWrap = el("div", "ilb-quality-chips");
      chipsWrap.setAttribute("aria-hidden", "true");
      for (const v of flaggedVerdicts) {
        if (counts[v] === 0) continue;
        const chip = document.createElement("span");
        chip.className = `ilb-qchip ilb-qchip--${ARTIFACT_VERDICT_SUFFIX[v]}`;
        chip.textContent = `${counts[v]} ${v.replace(/-/g, " ")}`;
        chipsWrap.appendChild(chip);
      }
      resultHead.appendChild(chipsWrap);
    }

    if (artifactEntries.length > 0) {
      const comparisonHeading = document.createElement("h3");
      comparisonHeading.textContent = "How your case file compares";
      stepContainer.appendChild(comparisonHeading);

      const ul = document.createElement("ul");
      ul.className = "ilb-comparison-list";
      for (const entry of artifactEntries) {
        const artifact = config.artifacts.find((a) => a.id === entry.artifactId);
        if (!artifact) continue;
        const suffix = ARTIFACT_VERDICT_SUFFIX[entry.verdict];
        const li = document.createElement("li");
        li.className = suffix ? `ilb-comparison-row ilb-comparison-row--${suffix}` : "ilb-comparison-row";
        li.textContent = `${artifact.title}: ${ARTIFACT_VERDICT_TEXT[entry.verdict]}`;
        ul.appendChild(li);
      }
      stepContainer.appendChild(ul);
    }

    const reasonHeading = document.createElement("h3");
    reasonHeading.textContent = "Your reasoning";
    stepContainer.appendChild(reasonHeading);

    const reasonList = document.createElement("ul");
    reasonList.className = "ilb-reason-review-list";
    for (const reason of conclusion.reasons as RuntimeReason[]) {
      const selected = state.selectedReasons.has(reason.id);
      const verdict: ReasonVerdict = reason.sound
        ? selected ? "sound-selected" : "sound-missed"
        : selected ? "flawed-selected" : "flawed-correctly-unselected";
      const suffix = REASON_VERDICT_SUFFIX[verdict];
      const li = document.createElement("li");
      li.className = suffix ? `ilb-comparison-row ilb-comparison-row--${suffix}` : "ilb-comparison-row";
      let text = `${reason.text}: ${REASON_VERDICT_TEXT[verdict]}`;
      // Flawed reasons get their flawNote explained ONLY when the learner
      // actually selected them -- an unselected flawed reason was already
      // correctly avoided, and doesn't need its flaw spelled out.
      if (verdict === "flawed-selected" && reason.flawNote) text += ` ${reason.flawNote}`;
      li.textContent = text;
      reasonList.appendChild(li);
    }
    stepContainer.appendChild(reasonList);

    const rationaleHeading = document.createElement("h3");
    rationaleHeading.textContent = "Expert's rationale";
    stepContainer.appendChild(rationaleHeading);
    const rationale = el("div", "ilb-expert-rationale");
    rationale.innerHTML = conclusion.expertRationale; // sanitized at authoring + revalidated at export
    stepContainer.appendChild(rationale);

    const startOverBtn = document.createElement("button");
    startOverBtn.type = "button";
    startOverBtn.className = "ilb-btn ilb-start-over-btn ilb-btn-pill ilb-btn-pill--ghost";
    startOverBtn.textContent = "Start over";
    startOverBtn.addEventListener("click", () => handleStartOver());
    stepContainer.appendChild(startOverBtn);

    if (focusHeading) heading.focus();
  }

  function handleStartOver(): void {
    // bestPct/completed are intentionally preserved by startOver() itself
    // (spec §4: "Start over never lowers/uncompletes") -- no SCORM
    // setScore/setCompleted call is needed here since neither value
    // changes; only the reset position needs to be persisted (mirrors
    // branching's handleStartOver, which likewise only calls its
    // score-reporting function for the SUSPEND side-effect once the
    // improved/newlyCompleted guards are both already-false).
    state = startOver(state);
    currentArtifactId = null;
    persistSuspend();
    renderBrief(true);
  }

  // ---------- initial render (no focus-stealing on page load, even on a
  // mid-attempt resume) ----------
  updateCaseFileStatus();
  switch (state.step) {
    case "brief":
      renderBrief(false);
      break;
    case "workspace":
      enterWorkspace(false);
      break;
    case "conclude":
      renderConclude(false);
      break;
    case "debrief":
      renderDebrief(false);
      break;
  }
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** Assigns textContent only when it actually changes, so re-rendering with
 *  identical text never mutates the DOM inside a live region (which would
 *  otherwise re-announce unchanged content). Mirrors the other two engines'
 *  setText exactly. */
function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Re-triggers the 150ms fade/rise transition (`.ilb-enter`, engine.css) on
 *  a container whose CONTENT is about to be replaced. Mirrors branching's
 *  retriggerEnter exactly (generalized to any node, not just the scene
 *  container, since this runtime rebuilds one shared step container instead
 *  of per-shape persistent sections). */
function retriggerEnter(node: HTMLElement): void {
  node.classList.remove("ilb-enter");
  void node.offsetWidth; // force reflow so the next class add is seen as a fresh animation start
  node.classList.add("ilb-enter");
}

/* Bundle entry: expose mount API on the same window.ILBEngine global every
 * engine bundle uses (see src/engine-runtime/globals.d.ts's doc comment for
 * why this plain assignment type-checks with no cast, from any engine). */
if (typeof window !== "undefined") {
  window.ILBEngine = { mount: mountCaseWorkspace };
}
