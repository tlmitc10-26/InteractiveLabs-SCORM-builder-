import type { RuntimeBranchingConfig, RuntimeScene, Quality } from "@/lib/engines/branching-scenario/runtime-config";
import {
  initialState,
  visibleChoices,
  applyChoice,
  scorePct,
  suspendPayload,
  restoreState,
  type ScenarioState,
} from "@/lib/engines/branching-scenario/state";

/** Text + aria-hidden glyph for a decision's quality (never color alone —
 *  mirrors the challenge-row pattern in param-sandbox/main.ts's
 *  .ilb-challenge-mark, which similarly pairs an aria-hidden glyph with
 *  screen-reader text rather than relying on color). */
const QUALITY_TEXT: Record<Quality, string> = {
  best: "Best choice",
  acceptable: "Acceptable choice",
  poor: "Poor choice",
};
const QUALITY_GLYPH: Record<Quality, string> = {
  best: "●", // ●
  acceptable: "◐", // ◐
  poor: "○", // ○
};

/** Defensive salvage for a suspend payload that failed restoreState's full
 *  structural validation (e.g. the config was edited since the payload was
 *  saved, so a scene/choice/variable id it references no longer exists) but
 *  still carries individually well-formed `b` (best score, a finite number
 *  in [0,100]) and `c` (completed, a boolean). Losing scene/var progress on
 *  a stale payload is acceptable (the learner restarts positionally at
 *  scene 1); silently losing an already-reported grade/completion is not —
 *  that would let a learner's recorded score regress on the LMS side for a
 *  reason that has nothing to do with anything they did. */
function salvageBestAndCompleted(payload: unknown): { best: number; completed: boolean } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const b = p.b;
  const c = p.c;
  if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b > 100) return null;
  if (typeof c !== "boolean") return null;
  return { best: b, completed: c };
}

/** Mount the Branching Scenario engine. Scene/ending body and per-choice
 *  feedback are rendered via innerHTML (pre-sanitized rich text from the
 *  authoring schema, same trust model as param-sandbox's `intro`); every
 *  other piece of text (titles, labels, role line, status line) is set via
 *  textContent, never innerHTML. */
export function mountBranchingScenario(root: HTMLElement, config: RuntimeBranchingConfig): void {
  root.innerHTML = "";
  root.classList.add("ilb-scenario");
  // Same reasoning as param-sandbox's mountSandbox: this engine's mounted
  // root IS the entire page content of its host SCO/iframe, so it must
  // carry the page's only landmark itself.
  root.setAttribute("role", "main");

  // Unique per-mount id prefix so id/aria-describedby associations never
  // collide if more than one instance is mounted in the same document.
  const mountId = `ilb-${Math.random().toString(36).slice(2, 9)}`;

  const scorm = typeof window !== "undefined" ? window.ILBScorm : undefined;

  let bestPct = 0;
  let reportedComplete = false;
  let scoreReported = false;
  let warnedSuspendLimit = false;

  // ---------- resume (spec 6 / SCORM contract: mirrors param-sandbox's
  // restore-then-re-assert pattern exactly) ----------
  let state: ScenarioState;
  const saved = scorm?.loadSuspendData<unknown>();
  const restored = saved != null ? restoreState(config, saved) : null;
  if (restored) {
    state = restored.state;
    bestPct = restored.best;
    reportedComplete = restored.completed;
  } else {
    state = initialState(config);
    // restoreState rejects the WHOLE payload on any structural mismatch
    // (e.g. a stale scene id after an authoring edit), but the grade
    // fields it carries are independent of scene/choice/variable identity.
    // Salvage them rather than silently reverting an already-reported
    // score/completion to zero/incomplete.
    if (saved != null) {
      const salvaged = salvageBestAndCompleted(saved);
      if (salvaged) {
        bestPct = salvaged.best;
        reportedComplete = salvaged.completed;
      }
    }
  }

  // A previously-reported score/completion must never appear downgraded or
  // forgotten on resume, even before any new interaction this session.
  if (scorm && scorm.mode === "scorm") {
    if (bestPct > 0 || reportedComplete) {
      scorm.setScore(bestPct);
      scoreReported = true;
    }
    if (reportedComplete) {
      scorm.setCompleted();
    }
  }

  // ---------- persistent DOM (survives every re-render; see setText below
  // for the churn-guard pattern that makes this safe inside a live region) ----------
  const sceneContainer = el("div", "ilb-scene");
  root.appendChild(sceneContainer);

  const hasVisibleVars = config.variables.some((v) => v.visible);
  const varsStatus = el("div", "ilb-vars-status");
  varsStatus.setAttribute("role", "status");
  varsStatus.setAttribute("aria-live", "polite");
  varsStatus.setAttribute("aria-atomic", "true");
  if (hasVisibleVars) root.appendChild(varsStatus);

  const choicesContainer = el("div", "ilb-choices");
  root.appendChild(choicesContainer);

  const debriefContainer = el("div", "ilb-debrief");
  debriefContainer.hidden = true;
  root.appendChild(debriefContainer);

  // The feedback panel is its own polite live region (belt-and-braces —
  // the PRIMARY announcement mechanism is the Continue button's
  // aria-describedby, which the accessible-description algorithm
  // guarantees is spoken on focus regardless of live-region timing/support).
  // It is built and appended to the DOM lazily, ONLY when it can ever be
  // used (feedbackMode "immediate" AND at least one choice actually carries
  // feedback text) — a scenario authored entirely in "debrief" mode (e.g.
  // both starters) must render exactly ZERO extra live regions, not one
  // that merely stays hidden forever.
  const needsFeedbackPanel =
    config.feedbackMode === "immediate" && config.scenes.some((s) => s.choices.some((c) => c.feedback));
  let feedbackPanel: HTMLElement | null = null;
  let feedbackText: HTMLElement | null = null;
  let continueBtn: HTMLButtonElement | null = null;
  if (needsFeedbackPanel) {
    feedbackPanel = el("div", "ilb-feedback");
    feedbackPanel.setAttribute("role", "status");
    feedbackPanel.setAttribute("aria-live", "polite");
    feedbackPanel.hidden = true;
    feedbackText = document.createElement("p");
    feedbackText.id = `${mountId}-feedback-text`;
    feedbackPanel.appendChild(feedbackText);
    continueBtn = document.createElement("button");
    continueBtn.type = "button";
    // Deliberately NOT ".ilb-choice-btn": that class is reserved for the
    // current scene's visible-choice buttons (and the ending's Start-over
    // button) so `.ilb-choice-btn` queries only ever match genuinely
    // interactive-right-now buttons, never this persistent-but-usually-
    // hidden Continue button.
    continueBtn.className = "ilb-btn ilb-continue-btn";
    continueBtn.textContent = "Continue";
    // The accessible-description algorithm guarantees this is announced
    // alongside the button's name the instant it receives focus — spec-
    // determined, not dependent on live-region timing/AT support.
    continueBtn.setAttribute("aria-describedby", feedbackText.id);
    continueBtn.addEventListener("click", () => completeTransition());
    feedbackPanel.appendChild(continueBtn);
    root.appendChild(feedbackPanel);
  }

  // ---------- rendering ----------

  function updateVarsStatus(): void {
    if (!hasVisibleVars) return;
    const text = config.variables
      .filter((v) => v.visible)
      .map((v) => `${v.label}: ${state.vars[v.id]}`)
      .join(". ");
    setText(varsStatus, text);
  }

  function renderChoices(): void {
    choicesContainer.innerHTML = "";
    choicesContainer.hidden = false;
    // Captured once per render, not read fresh inside the click handler:
    // this is what makes a click on a STALE (already-detached) button from
    // a previous scene a safe no-op even if the CURRENT scene happens to
    // reuse the same choice id (a same-shaped-graph collision) — see
    // handleChoiceClick's guard.
    const renderedForSceneId = state.sceneId;
    for (const choice of visibleChoices(config, state)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ilb-btn ilb-choice-btn";
      btn.textContent = choice.label;
      btn.addEventListener("click", () => handleChoiceClick(choice.id, renderedForSceneId));
      choicesContainer.appendChild(btn);
    }
  }

  /** Scene heading: an author-supplied title takes precedence; an untitled
   *  scene falls back to a positional "Part N" (N = the scene's 1-based
   *  index within config.scenes) rather than the scenario's own title —
   *  every untitled scene sharing the scenario title would be indistinguishable
   *  from each other both as the focus-target h2 and in the debrief list.
   *  The h2 must never be empty either way, since it's the programmatic
   *  focus target on every transition. */
  function sceneHeading(scene: RuntimeScene): string {
    if (scene.title) return scene.title;
    const index = config.scenes.findIndex((s) => s.id === scene.id);
    return `Part ${index + 1}`;
  }

  function renderScene(sceneId: string, focusHeading: boolean): void {
    const scene = config.scenes.find((s) => s.id === sceneId);
    if (!scene) {
      console.error(`branching runtime: scene "${sceneId}" not found in config`);
      throw new Error("This lesson's content could not be loaded.");
    }

    if (feedbackPanel) feedbackPanel.hidden = true;
    debriefContainer.hidden = true;
    debriefContainer.innerHTML = "";

    sceneContainer.innerHTML = "";
    const isStart = sceneId === config.startSceneId;
    if (isStart) {
      if (config.role) {
        const roleLine = el("p", "ilb-role");
        roleLine.textContent = config.role;
        sceneContainer.appendChild(roleLine);
      }
      if (config.intro) {
        const intro = el("div", "ilb-intro");
        intro.innerHTML = config.intro; // sanitized at authoring + revalidated at export
        sceneContainer.appendChild(intro);
      }
    }

    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = sceneHeading(scene);
    sceneContainer.appendChild(heading);

    const body = el("div", "ilb-scene-body");
    body.innerHTML = scene.body; // sanitized at authoring + revalidated at export
    sceneContainer.appendChild(body);

    if (scene.imageUrl) {
      const img = document.createElement("img");
      img.className = "ilb-scene-image";
      img.src = scene.imageUrl;
      img.alt = scene.imageRole === "informative" ? (scene.imageAlt ?? "") : "";
      sceneContainer.appendChild(img);
    }

    updateVarsStatus();
    renderChoices();

    if (focusHeading) heading.focus();
  }

  /** Replays the recorded decision path through the pure state machine from
   *  a fresh initialState, recomputing which choices were ACTUALLY visible
   *  (showIf-eligible) to the learner at the moment each step's decision was
   *  made — not simply "every choice ever authored for that scene", which
   *  would list a showIf-gated choice as something the learner could have
   *  picked even when it was hidden at the time (or, symmetrically, omit
   *  nothing that really was available).
   *
   *  Two situations make the replay untrustworthy from some point onward,
   *  and both fall back to "all authored choices in that scene" for every
   *  remaining step rather than guessing:
   *  - `state.truncated`: the path was capped at MAX_PATH by dropping its
   *    EARLIEST steps, so replaying from initialState no longer lines up
   *    with the (now-missing) real history from step 1 -- fall back from
   *    the very first recorded step.
   *  - the replay's current scene ever disagrees with a step's recorded
   *    scene (a stale/tampered suspend payload restored earlier in this
   *    session, or any other divergence) -- fall back from that step on.
   */
  function computeVisibleOtherLabelsPerStep(): string[][] {
    const result: string[][] = [];
    let replay = initialState(config);
    let fellBack = state.truncated;
    for (const step of state.path) {
      if (!fellBack && replay.sceneId !== step.s) fellBack = true;

      const stepScene = config.scenes.find((s) => s.id === step.s);
      if (!stepScene) {
        result.push([]);
        continue;
      }

      const visibleNow = fellBack ? stepScene.choices : visibleChoices(config, replay);
      result.push(visibleNow.filter((c) => c.id !== step.c).map((c) => c.label));

      if (!fellBack) {
        try {
          replay = applyChoice(config, replay, step.c);
        } catch {
          fellBack = true;
        }
      }
    }
    return result;
  }

  function renderEnding(focusHeading: boolean): void {
    const ending = config.endings.find((e) => e.id === state.endingId);
    if (!ending) {
      console.error(`branching runtime: ending "${state.endingId}" not found in config`);
      throw new Error("This lesson's content could not be loaded.");
    }

    if (feedbackPanel) feedbackPanel.hidden = true;

    sceneContainer.innerHTML = "";
    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = ending.title;
    sceneContainer.appendChild(heading);

    const body = el("div", "ilb-scene-body");
    body.innerHTML = ending.body; // sanitized at authoring + revalidated at export
    sceneContainer.appendChild(body);

    const counts: Record<Quality, number> = { best: 0, acceptable: 0, poor: 0 };
    for (const step of state.path) counts[step.q]++;
    const parts: string[] = [];
    if (counts.best > 0) parts.push(`${counts.best} best`);
    if (counts.acceptable > 0) parts.push(`${counts.acceptable} acceptable`);
    if (counts.poor > 0) parts.push(`${counts.poor} poor`);
    const decisionsClause = parts.length > 0 ? `Decisions: ${parts.join(", ")}.` : "No decisions recorded.";
    const scoreLine = el("p", "ilb-score-line");
    // Learner-facing copy: no em dashes. Two sentences, plain punctuation.
    scoreLine.textContent = `${decisionsClause} Score: ${scorePct(state)}%.`;
    sceneContainer.appendChild(scoreLine);

    updateVarsStatus();

    choicesContainer.innerHTML = "";
    choicesContainer.hidden = false;
    const startOverBtn = document.createElement("button");
    startOverBtn.type = "button";
    startOverBtn.className = "ilb-btn ilb-choice-btn ilb-start-over-btn";
    startOverBtn.textContent = "Start over";
    startOverBtn.addEventListener("click", () => handleStartOver());
    choicesContainer.appendChild(startOverBtn);

    debriefContainer.innerHTML = "";
    if (config.showPathInDebrief && state.path.length > 0) {
      debriefContainer.hidden = false;
      const debriefHeading = document.createElement("h3");
      debriefHeading.textContent = "Your path";
      debriefContainer.appendChild(debriefHeading);

      if (state.truncated) {
        const truncatedNote = el("p", "ilb-debrief-truncated-note");
        truncatedNote.textContent = "This summary shows your most recent decisions.";
        debriefContainer.appendChild(truncatedNote);
      }

      const othersPerStep = computeVisibleOtherLabelsPerStep();
      const ol = document.createElement("ol");
      ol.className = "ilb-debrief-list";
      state.path.forEach((step, i) => {
        const stepScene = config.scenes.find((s) => s.id === step.s);
        const choice = stepScene?.choices.find((c) => c.id === step.c);
        const li = document.createElement("li");
        li.className = "ilb-debrief-step";

        const sceneSpan = el("span", "ilb-debrief-scene");
        sceneSpan.textContent = `${stepScene ? sceneHeading(stepScene) : step.s}: `;
        li.appendChild(sceneSpan);

        const choiceSpan = el("span", "ilb-debrief-choice");
        choiceSpan.textContent = choice?.label ?? step.c;
        li.appendChild(choiceSpan);

        const qualitySpan = el("span", "ilb-debrief-quality");
        qualitySpan.appendChild(document.createTextNode(" ("));
        const glyphSpan = document.createElement("span");
        glyphSpan.setAttribute("aria-hidden", "true");
        glyphSpan.textContent = QUALITY_GLYPH[step.q];
        qualitySpan.appendChild(glyphSpan);
        qualitySpan.appendChild(document.createTextNode(` ${QUALITY_TEXT[step.q]})`));
        li.appendChild(qualitySpan);

        const others = othersPerStep[i];
        if (others.length > 0) {
          const otherP = el("p", "ilb-debrief-other");
          otherP.textContent = `Other options: ${others.join(", ")}.`;
          li.appendChild(otherP);
        }

        if (config.feedbackMode === "debrief" && choice?.feedback) {
          const fb = el("p", "ilb-debrief-feedback");
          fb.innerHTML = choice.feedback; // sanitized at authoring + revalidated at export
          li.appendChild(fb);
        }

        ol.appendChild(li);
      });
      debriefContainer.appendChild(ol);
    }

    if (focusHeading) heading.focus();
  }

  function renderCurrent(focusHeading: boolean): void {
    if (state.sceneId !== null) renderScene(state.sceneId, focusHeading);
    else renderEnding(focusHeading);
  }

  // ---------- SCORM reporting (mirrors param-sandbox's high-water /
  // reportedComplete / scoreReported pattern exactly) ----------

  /** Called on every transition once the learner has made at least one
   *  choice this attempt (state.path is non-empty by construction — see
   *  handleChoiceClick/handleStartOver call sites). Score is reported as a
   *  monotonic high-water mark of scorePct across the whole run; completion
   *  fires exactly once, the first time an ending is reached. */
  function reportScorm(): void {
    const pct = scorePct(state);
    const improved = pct > bestPct;
    if (improved) bestPct = pct;
    const isEnding = state.endingId !== null;
    const newlyCompleted = isEnding && !reportedComplete;
    if (newlyCompleted) reportedComplete = true;

    if (scorm && scorm.mode === "scorm") {
      if (improved || !scoreReported) {
        scoreReported = true;
        scorm.setScore(bestPct);
      }
      if (newlyCompleted) {
        scorm.setCompleted();
      }
      const ok = scorm.saveSuspendData(suspendPayload(state, bestPct, reportedComplete));
      if (!ok && !warnedSuspendLimit) {
        warnedSuspendLimit = true;
        console.warn("branching scenario progress exceeds SCORM suspend limit; resume disabled");
      }
    }
  }

  // ---------- interaction ----------

  function completeTransition(): void {
    reportScorm();
    renderCurrent(true);
  }

  function handleChoiceClick(choiceId: string, expectedSceneId: string | null): void {
    // Stale-click guard: this button was rendered for `expectedSceneId`. If
    // the scene has since moved on (a detached/duplicate event on an old
    // button, e.g. a double-click racing the first click's transition),
    // this click must be inert -- even if the CURRENT scene happens to
    // authored a choice with the identical id (a same-shaped-graph
    // collision), which would otherwise silently apply the wrong choice.
    if (state.sceneId !== expectedSceneId) return;

    const chosen = visibleChoices(config, state).find((c) => c.id === choiceId);
    if (!chosen) return; // defensive: button only exists for a currently-visible choice
    state = applyChoice(config, state, choiceId);

    if (config.feedbackMode === "immediate" && chosen.feedback && feedbackPanel && feedbackText && continueBtn) {
      choicesContainer.hidden = true;
      feedbackText.innerHTML = chosen.feedback; // sanitized at authoring + revalidated at export
      feedbackPanel.hidden = false;
      continueBtn.focus();
      // updateVarsStatus() is deliberately NOT called here: the eventual
      // renderScene/renderEnding call (once Continue is pressed) updates it
      // at the right moment. Updating it now would let the visible-variable
      // number change WHILE the feedback panel (for a still-uncommitted-
      // looking transition) is being read, racing the two announcements.
    } else {
      completeTransition();
    }
  }

  function handleStartOver(): void {
    // Score/completion (bestPct/reportedComplete/scoreReported) are
    // intentionally NOT reset here — a replay from the debrief must never
    // downgrade what's already been reported to the LMS.
    state = initialState(config);
    reportScorm(); // persists the reset position; never downgrades score/completion
    renderCurrent(true);
  }

  // ---------- initial render (no focus-stealing on page load) ----------
  renderCurrent(false);
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** Assigns textContent only when it actually changes, so re-rendering with
 *  identical text never mutates the DOM inside a live region (which would
 *  otherwise re-announce unchanged content). Mirrors param-sandbox/main.ts's
 *  setText exactly. */
function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/* Bundle entry: expose mount API on the same window.ILBEngine global every
 * engine bundle uses. The ambient Window.ILBEngine type lives in the shared
 * src/engine-runtime/globals.d.ts (not declared locally here) so that both
 * engine bundles' differently-typed mount functions can coexist in the same
 * TypeScript program without a conflicting interface-merge — see that
 * file's doc comment for how `config: never` plus method-signature
 * bivariance makes this plain assignment (no cast) type-check. */
if (typeof window !== "undefined") {
  window.ILBEngine = { mount: mountBranchingScenario };
}
