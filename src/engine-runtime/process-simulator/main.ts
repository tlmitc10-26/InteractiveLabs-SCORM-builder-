import type { ProcessConfig } from "@/lib/engines/process-simulator/schema";
import {
  initialState,
  beginProcedure,
  attemptAction,
  startOver,
  suspendPayload,
  restoreState,
  type ProcessState,
} from "@/lib/engines/process-simulator/state";
import { scoreProcess } from "@/lib/engines/process-simulator/scoring";

/**
 * Runtime config type: process-simulator carries no assets in v1 (spec §10:
 * images are out of scope), so `toProcessRuntimeConfig` (src/lib/engines/
 * process-simulator/runtime-config.ts) is an identity pass-through -- unlike
 * the other three engines' `RuntimeXConfig`, this one needs no `Omit<...,
 * "artifacts"|"scenes"|...> & {...}` reshaping. `ProcessConfig` is imported
 * `import type` only, so this stays erased at bundle time (zero zod/
 * sanitize-html weight in the engine bundle), exactly like every other
 * `import type` in this file.
 */
export type RuntimeProcessConfig = ProcessConfig;
type RuntimeAction = RuntimeProcessConfig["actions"][number];

/** Defensive salvage for a suspend payload that failed restoreState's full
 *  structural validation (e.g. the config was edited since the payload was
 *  saved, so an action id it references no longer exists) but still carries
 *  individually well-formed `b` (best score) and `c` (completed). COPIED
 *  VERBATIM from src/engine-runtime/branching-scenario/main.ts's
 *  salvageBestAndCompleted (spec §4 review #9's precedent, applied by every
 *  engine's own copy) -- this engine's suspend payload happens to use the
 *  same `b`/`c` field names, so the reader here is byte-identical. Losing
 *  procedure progress on a stale payload is acceptable (the learner restarts
 *  at the brief step); silently losing an already-reported grade/completion
 *  is not. */
function salvageBestAndCompleted(payload: unknown): { best: number; completed: boolean } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const b = p.b;
  const c = p.c;
  if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b > 100) return null;
  if (typeof c !== "boolean") return null;
  return { best: b, completed: c };
}

/** Builds one situation-log `<li>` (spec §3 review #20: the text-carrier
 *  class -- transcript.ts's "ilb-log-entry" -- goes on each entry, not the
 *  list). `isLatest` adds the non-color-only emphasis: a heavier weight + an
 *  already-approved-token left rule (both via the `ilb-log-entry--latest`
 *  class in engine.css) plus a visually-hidden "Latest: " prefix (review
 *  #25 / WCAG 1.4.1) -- the sr-only span is prepended so it reads before the
 *  outcome text. `action.outcome` is pre-sanitized rich text (same trust
 *  model as every other innerHTML write in this runtime). */
function buildLogEntryLi(action: RuntimeAction, isLatest: boolean): HTMLLIElement {
  const li = document.createElement("li");
  li.className = isLatest ? "ilb-log-entry ilb-log-entry--latest" : "ilb-log-entry";
  if (isLatest) {
    const sr = el("span", "ilb-sr-only");
    sr.textContent = "Latest: ";
    li.appendChild(sr);
  }
  const text = el("span", "ilb-log-entry-text");
  text.innerHTML = action.outcome ?? "";
  li.appendChild(text);
  return li;
}

/** Builds the full situation log `<ul>` from a `done` id list (completion
 *  order) -- used both for the procedure room's step-entry reconstruction
 *  (a resumed mid-procedure session) and the debrief's full read-back (spec
 *  §3 review #13). Only the LAST entry carries the latest-emphasis. */
function buildLogList(doneIds: readonly string[], byId: Map<string, RuntimeAction>): HTMLUListElement {
  const ul = document.createElement("ul");
  ul.className = "ilb-situation-log";
  doneIds.forEach((id, i) => {
    const action = byId.get(id);
    if (!action) return; // defensive: byId is derived from the same config that produced `done`
    ul.appendChild(buildLogEntryLi(action, i === doneIds.length - 1));
  });
  return ul;
}

/** Saturation-aware count display (spec §4 review #3: "display '99+'") --
 *  every attempt counter saturates at 99 AT INCREMENT TIME (state.ts), so a
 *  displayed "99" can never be distinguished from a true count that kept
 *  growing past it. Any counter AT the 99 ceiling therefore renders "99+"
 *  rather than claiming a false-precise "99"; anything below renders as-is. */
const formatCount = (n: number): string => (n >= 99 ? "99+" : String(n));

const times = (n: number): string => `${formatCount(n)} time${n === 1 ? "" : "s"}`;
const prematureAttempts = (n: number): string => `${formatCount(n)} premature attempt${n === 1 ? "" : "s"}`;

/** Mount the Process Simulator engine. Action outcomes/consequences and the
 *  intro/opening/expertNote are rendered via innerHTML (pre-sanitized rich
 *  text from the authoring schema, same trust model as every other engine);
 *  every other piece of text (titles, labels, status/score lines) is set via
 *  textContent, never innerHTML. */
export function mountProcessSimulator(root: HTMLElement, config: RuntimeProcessConfig): void {
  root.innerHTML = "";
  root.classList.add("ilb-process");
  // Same reasoning as the other three engines: this mounted root IS the
  // entire page content of its host SCO/iframe, so it must carry the page's
  // only landmark itself.
  root.setAttribute("role", "main");

  const scorm = typeof window !== "undefined" ? window.ILBScorm : undefined;
  let warnedSuspendLimit = false;

  const byId = new Map(config.actions.map((a) => [a.id, a]));
  const totalRequired = config.actions.filter((a) => a.required).length;

  // ---------- resume (spec §4 / SCORM contract: mirrors the other three
  // engines' restore-then-re-assert pattern) ----------
  let state: ProcessState;
  const saved = scorm?.loadSuspendData<unknown>();
  const restored = saved != null ? restoreState(config, saved) : null;
  if (restored) {
    state = restored;
  } else {
    state = initialState();
    // restoreState rejects the WHOLE payload on any structural mismatch
    // (e.g. a stale action id after an authoring edit), but the grade
    // fields it carries are independent of that identity. Salvage them
    // rather than silently reverting an already-reported score/completion
    // to zero/incomplete.
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
  const card = el("div", "ilb-process-card");
  root.appendChild(card);

  // The ONE live region this runtime ever uses (spec §3): progress-count
  // semantics ONLY, "N of M required steps done" -- created once here,
  // OUTSIDE stepContainer, so no step/panel swap below can ever remove or
  // recreate it. Always present (mirrors case-workspace's caseStatus): there
  // is no configuration under which showing it would be pointless.
  const progressStatus = el("div", "ilb-process-status");
  progressStatus.setAttribute("role", "status");
  progressStatus.setAttribute("aria-live", "polite");
  progressStatus.setAttribute("aria-atomic", "true");
  card.appendChild(progressStatus);

  const stepContainer = el("div", "ilb-step");
  card.appendChild(stepContainer);

  // Procedure-step-scoped DOM refs, (re)assigned by enterProcedure() on
  // every entry into the step. `actionsContainer` is the "Actions
  // sub-container" spec §3 calls out: it alone gets replaced between the
  // action menu and the consequence panel, while `situationHeading` and
  // `logList` (inside the Situation panel) persist untouched.
  let situationHeading!: HTMLHeadingElement;
  let logList!: HTMLUListElement;
  let actionsContainer!: HTMLElement;

  // Illegal-path double-activation guard (fix round): true while the
  // consequence panel occupies actionsContainer, false whenever the action
  // menu does. Guards against a SECOND synchronous activation of the same
  // (already-detached, but still listener-bound) illegal button re-entering
  // handleActionClick before the panel swap it triggered has any chance to
  // remove it from the accessibility tree -- without this, such a
  // double-activation would record two illegal attempts for one learner
  // action. Cleared on every menu rebuild (step entry, post-success, and
  // Continue), set whenever the consequence panel renders.
  let consequenceOpen = false;

  // ---------- shared helpers ----------

  function persistSuspend(): void {
    if (!scorm || scorm.mode !== "scorm") return;
    const ok = scorm.saveSuspendData(suspendPayload(state));
    if (!ok && !warnedSuspendLimit) {
      warnedSuspendLimit = true;
      console.warn("process simulator progress exceeds SCORM suspend limit; resume disabled");
    }
  }

  /** Churn-guarded (setText below) so re-rendering with an unchanged count
   *  never mutates the live region's text -- in particular, opening or
   *  closing the consequence panel must NOT touch this (spec §3: "its text
   *  does not change", asserted in process-runtime.test.ts). */
  function updateProgress(): void {
    setText(progressStatus, `${state.done.length} of ${totalRequired} required steps done`);
  }

  // ---------- Step 1: Brief ----------

  function renderBrief(focusHeading: boolean): void {
    updateProgress();

    stepContainer.innerHTML = "";
    retriggerEnter(stepContainer);

    const header = el("div", "ilb-process-header ilb-process-header--band");
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

    const beginBtn = document.createElement("button");
    beginBtn.type = "button";
    beginBtn.className = "ilb-btn ilb-btn-pill";
    beginBtn.textContent = "Begin the procedure.";
    beginBtn.addEventListener("click", () => {
      if (state.step !== "brief") return; // stale-closure guard
      state = beginProcedure(state);
      persistSuspend();
      enterProcedure(true);
    });
    stepContainer.appendChild(beginBtn);

    if (focusHeading) heading.focus();
  }

  // ---------- Step 2: Procedure room ----------

  /** Full rebuild of the procedure step -- called on STEP ENTRY only
   *  (initial mount/resume, "Begin the procedure."). Every within-step
   *  interaction (perform an action, dismiss a consequence) uses the
   *  targeted render* functions below instead, so a click never tears down
   *  the Situation panel it needs to keep persisting. */
  function enterProcedure(focusHeading: boolean): void {
    stepContainer.innerHTML = "";
    retriggerEnter(stepContainer);

    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = "Procedure";
    stepContainer.appendChild(heading);

    const situationSection = el("div", "ilb-situation");
    stepContainer.appendChild(situationSection);

    situationHeading = document.createElement("h3");
    situationHeading.tabIndex = -1;
    situationHeading.textContent = "Situation";
    situationSection.appendChild(situationHeading);

    const opening = el("div", "ilb-situation-opening");
    opening.innerHTML = config.opening; // sanitized at authoring + revalidated at export
    situationSection.appendChild(opening);

    logList = buildLogList(state.done, byId); // reconstructs a resumed mid-procedure log in full
    situationSection.appendChild(logList);

    actionsContainer = el("div", "ilb-actions");
    stepContainer.appendChild(actionsContainer);
    renderActionsMenu();

    updateProgress();
    if (focusHeading) heading.focus();
  }

  /** Appends the just-completed action's outcome as the new latest log
   *  entry, first stripping the latest-emphasis (class + sr-only prefix)
   *  from whatever was previously last -- spec §3: "moved as the log
   *  grows". Never rebuilds the list wholesale, so `logList`'s node identity
   *  (and everything already in it) survives untouched. */
  function appendLogEntry(actionId: string): void {
    const prevLast = logList.lastElementChild;
    if (prevLast) {
      prevLast.classList.remove("ilb-log-entry--latest");
      prevLast.querySelector(".ilb-sr-only")?.remove();
    }
    const action = byId.get(actionId);
    if (!action) return; // defensive: actionId always comes from config.actions
    logList.appendChild(buildLogEntryLi(action, true));
  }

  /** Rebuilds ONLY the action menu half of the Actions sub-container --
   *  called on procedure-step entry, after every successful action, and
   *  after "Continue" dismisses a consequence panel. `focusActionId` (used
   *  only by the Continue path) re-establishes focus on that action's own
   *  button BY ID (spec §3), which is still enabled since an illegal
   *  attempt never marks an action done. */
  function renderActionsMenu(focusActionId?: string): void {
    consequenceOpen = false;
    actionsContainer.innerHTML = "";

    const heading = document.createElement("h3");
    heading.textContent = "Actions";
    actionsContainer.appendChild(heading);

    const list = el("div", "ilb-action-list");
    for (const action of config.actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ilb-btn ilb-action-btn";
      btn.dataset.actionId = action.id;

      // The button's accessible name must equal the label VERBATIM (spec
      // §3, locked) -- the done-glyph below is aria-hidden, so it never
      // contributes to the accname computation.
      const labelSpan = el("span", "ilb-action-label");
      labelSpan.textContent = action.label;
      btn.appendChild(labelSpan);

      const done = state.done.includes(action.id);
      if (done) {
        btn.disabled = true;
        const glyph = el("span", "ilb-action-done-glyph");
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = "✓"; // check mark
        btn.appendChild(glyph);
      }

      btn.addEventListener("click", () => handleActionClick(action.id));
      list.appendChild(btn);
    }
    actionsContainer.appendChild(list);

    if (focusActionId) {
      const btn = list.querySelector<HTMLButtonElement>(`[data-action-id="${focusActionId}"]`);
      btn?.focus();
    }
  }

  /** Replaces ONLY the Actions sub-container with the consequence panel
   *  (spec §3 review #21: Situation and progress persist) -- focus moves to
   *  its own h3 (review #26); the live region is NOT touched. */
  function renderConsequencePanel(attemptedActionId: string): void {
    const action = byId.get(attemptedActionId);
    if (!action) return; // defensive: attemptedActionId always comes from config.actions

    consequenceOpen = true;
    actionsContainer.innerHTML = "";

    const heading = document.createElement("h3");
    heading.tabIndex = -1;
    heading.textContent = "Consequence";
    actionsContainer.appendChild(heading);

    const text = el("div", "ilb-consequence-text");
    text.innerHTML = action.consequence ?? ""; // sanitized at authoring + revalidated at export
    actionsContainer.appendChild(text);

    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "ilb-btn ilb-btn-pill";
    continueBtn.textContent = "Continue";
    continueBtn.addEventListener("click", () => {
      if (state.step !== "procedure") return; // stale-closure guard
      renderActionsMenu(attemptedActionId);
    });
    actionsContainer.appendChild(continueBtn);

    heading.focus();
  }

  /** A single learner click on an action button (spec §3/§4). */
  function handleActionClick(actionId: string): void {
    if (state.step !== "procedure") return; // stale-closure guard
    if (state.done.includes(actionId)) return; // defensive: the button is disabled once done
    if (consequenceOpen) return; // double-activation guard: a consequence panel is already open for the prior attempt

    const result = attemptAction(config, state, actionId);
    state = result.state;

    if (!result.legal) {
      persistSuspend();
      renderConsequencePanel(actionId);
      return;
    }

    appendLogEntry(actionId);

    if (result.score) {
      // Last required action just completed -> debrief (spec §3: entered
      // automatically). First debrief: setScore(bestPct) then
      // setCompleted() (spec §4), mirroring every other engine's submit.
      if (scorm && scorm.mode === "scorm") {
        scorm.setScore(state.bestPct);
        scorm.setCompleted();
      }
      persistSuspend();
      renderDebrief(true);
      return;
    }

    persistSuspend();
    renderActionsMenu();
    updateProgress();
    situationHeading.focus();
  }

  // ---------- Step 3: Debrief ----------

  function renderDebrief(focusHeading: boolean): void {
    // Belt-and-braces (mirrors every other engine's debrief guard):
    // restoreState already rejects a step:"debrief" payload whose `done`
    // isn't every required action, so this should be unreachable through a
    // normal resume -- but a debrief render must never assume an invariant
    // it can instead just check.
    if (state.done.length !== totalRequired) {
      // startOver() (not initialState()) so a resume/render-order defect
      // never appears to erase an already-reported bestPct/completed --
      // high-water is preserved exactly like a learner-initiated "Start
      // over" (spec §4). Case-workspace's main.ts has the same unreachable
      // guard using initialState() (its bundle must stay byte-identical) --
      // flagged as a cross-engine follow-up, not fixed here.
      state = startOver(state);
      renderBrief(true);
      return;
    }

    updateProgress();

    stepContainer.innerHTML = "";
    retriggerEnter(stepContainer);

    const score = scoreProcess(config, state.attempts);
    const cleanCount = score.correctness.num;
    const recoveredCount = score.correctness.den - cleanCount;
    const totalAttempts = score.efficiency.den;
    const attemptedDistractors = config.actions.filter((a) => !a.required && (state.attempts.get(a.id) ?? 0) > 0);
    // Saturation-aware total (spec §4 review #3, "display '99+'"): if ANY
    // counter contributing to totalAttempts is itself saturated at 99, the
    // true total could be higher than this exact sum, so the total gets a
    // "+" too -- iff >=1 counter is AT 99 (not merely large).
    const attemptsSaturated = Array.from(state.attempts.values()).some((count) => count >= 99);

    const resultHead = el("div", "ilb-result-head");
    stepContainer.appendChild(resultHead);

    const eyebrow = el("p", "ilb-eyebrow");
    eyebrow.textContent = "Procedure complete";
    resultHead.appendChild(eyebrow);

    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = config.title;
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

    // Score line's exact text is spec-mandated (§3, the announced source
    // for the score): "Steps: X of Y clean. Attempts: N (expert minimum
    // M). Score: P%." -- M is the expert minimum, i.e. exactly |R|
    // (score.efficiency.num), since a flawless run takes exactly one
    // attempt per required action and zero distractor hits.
    const scoreLine = el("p", "ilb-score-line");
    scoreLine.textContent =
      `Steps: ${cleanCount} of ${score.correctness.den} clean. ` +
      `Attempts: ${totalAttempts}${attemptsSaturated ? "+" : ""} (expert minimum ${score.efficiency.num}). ` +
      `Score: ${score.totalPct}%.`;
    resultHead.appendChild(scoreLine);

    // Quality-breakdown chips (mirrors branching's/case's ilb-quality-chips
    // exactly): the SAME counts already in the accessible step review below,
    // rendered as aria-hidden decorative chips -- redundancy doctrine, never
    // the sole carrier of the breakdown. Each label carries its own
    // singular/plural form (chip copy fix: "distractor" -> "wrong turn(s)",
    // a real noun that needs it; "clean"/"recovered" are invariant
    // adjectives, so their singular/plural forms are simply identical).
    const chipDefs: Array<[number, string, string, "best" | "ok" | "poor"]> = [
      [cleanCount, "clean", "clean", "best"],
      [recoveredCount, "recovered", "recovered", "ok"],
      [attemptedDistractors.length, "wrong turn", "wrong turns", "poor"],
    ];
    if (chipDefs.some(([count]) => count > 0)) {
      const chipsWrap = el("div", "ilb-quality-chips");
      chipsWrap.setAttribute("aria-hidden", "true");
      for (const [count, singular, plural, suffix] of chipDefs) {
        if (count === 0) continue;
        const chip = document.createElement("span");
        chip.className = `ilb-qchip ilb-qchip--${suffix}`;
        chip.textContent = `${count} ${count === 1 ? singular : plural}`;
        chipsWrap.appendChild(chip);
      }
      resultHead.appendChild(chipsWrap);
    }

    // Full situation log read-back (spec §3 review #13): the final outcome
    // must survive the transition, so the whole log renders again in full.
    const situationHeadingEl = document.createElement("h3");
    situationHeadingEl.textContent = "Situation";
    stepContainer.appendChild(situationHeadingEl);
    stepContainer.appendChild(buildLogList(state.done, byId));

    // Step review: every required action in completion order, then every
    // attempted distractor in authored order -- the three existing status
    // palettes verbatim (spec §3), zero new pairs.
    const reviewHeading = document.createElement("h3");
    reviewHeading.textContent = "Step review";
    stepContainer.appendChild(reviewHeading);

    const reviewList = document.createElement("ul");
    reviewList.className = "ilb-comparison-list";
    for (const id of state.done) {
      const action = byId.get(id);
      if (!action) continue;
      const count = state.attempts.get(id) ?? 0;
      const li = document.createElement("li");
      if (count === 0) {
        li.className = "ilb-comparison-row ilb-comparison-row--best";
        li.textContent = `${action.label}: completed on the first try.`;
      } else {
        li.className = "ilb-comparison-row ilb-comparison-row--ok";
        li.textContent = `${action.label}: completed after ${prematureAttempts(count)}. ${action.consequenceNote ?? ""}`;
      }
      reviewList.appendChild(li);
    }
    for (const action of attemptedDistractors) {
      const count = state.attempts.get(action.id) ?? 0;
      const li = document.createElement("li");
      li.className = "ilb-comparison-row ilb-comparison-row--poor";
      li.textContent = `${action.label}: attempted ${times(count)}. ${action.consequenceNote ?? ""}`;
      reviewList.appendChild(li);
    }
    stepContainer.appendChild(reviewList);

    if (config.expertNote) {
      const expertHeading = document.createElement("h3");
      expertHeading.textContent = "Expert note";
      stepContainer.appendChild(expertHeading);
      const expertNote = el("div", "ilb-expert-note");
      expertNote.innerHTML = config.expertNote; // sanitized at authoring + revalidated at export
      stepContainer.appendChild(expertNote);
    }

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
    // changes; only the reset position needs to be persisted.
    state = startOver(state);
    persistSuspend();
    renderBrief(true); // re-states the progress region to "0 of N" (spec §3 review #28)
  }

  // ---------- initial render (no focus-stealing on page load, even on a
  // mid-attempt or mid-consequence resume -- there is no persisted
  // "consequence panel open" state, so a resume always lands back on the
  // action menu) ----------
  updateProgress();
  switch (state.step) {
    case "brief":
      renderBrief(false);
      break;
    case "procedure":
      enterProcedure(false);
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
 *  otherwise re-announce unchanged content). Mirrors the other three
 *  engines' setText exactly. */
function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Re-triggers the 150ms fade/rise transition (`.ilb-enter`, engine.css) on
 *  a container whose CONTENT is about to be replaced. Mirrors the other
 *  three engines' retriggerEnter exactly. */
function retriggerEnter(node: HTMLElement): void {
  node.classList.remove("ilb-enter");
  void node.offsetWidth; // force reflow so the next class add is seen as a fresh animation start
  node.classList.add("ilb-enter");
}

/* Bundle entry: expose mount API on the same window.ILBEngine global every
 * engine bundle uses (see src/engine-runtime/globals.d.ts's doc comment for
 * why this plain assignment type-checks with no cast, from any engine). */
if (typeof window !== "undefined") {
  window.ILBEngine = { mount: mountProcessSimulator };
}
