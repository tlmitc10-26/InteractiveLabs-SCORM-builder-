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

  const feedbackPanel = el("div", "ilb-feedback");
  feedbackPanel.setAttribute("role", "status");
  feedbackPanel.setAttribute("aria-live", "polite");
  feedbackPanel.hidden = true;
  const feedbackText = document.createElement("p");
  feedbackPanel.appendChild(feedbackText);
  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  // Deliberately NOT ".ilb-choice-btn": that class is reserved for the
  // current scene's visible-choice buttons (and the ending's Start-over
  // button) so `.ilb-choice-btn` queries only ever match genuinely
  // interactive-right-now buttons, never this persistent-but-usually-hidden
  // Continue button. General button styling (24px target, focus ring) still
  // applies via the `.ilb-scenario button` rules in engine.css.
  continueBtn.className = "ilb-continue-btn";
  continueBtn.textContent = "Continue";
  continueBtn.addEventListener("click", () => completeTransition());
  feedbackPanel.appendChild(continueBtn);
  root.appendChild(feedbackPanel);

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
    for (const choice of visibleChoices(config, state)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ilb-choice-btn";
      btn.textContent = choice.label;
      btn.addEventListener("click", () => handleChoiceClick(choice.id));
      choicesContainer.appendChild(btn);
    }
  }

  /** Scene title fallback: an author-supplied scene title takes precedence;
   *  a scene authored without one falls back to the scenario's own title
   *  rather than an empty string, since the h2 is also the programmatic
   *  focus target on every transition and must never be empty/silent. */
  function sceneHeading(scene: RuntimeScene): string {
    return scene.title ?? config.title;
  }

  function renderScene(sceneId: string, focusHeading: boolean): void {
    const scene = config.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`branching runtime: scene "${sceneId}" not found in config`);

    feedbackPanel.hidden = true;
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

  function renderEnding(focusHeading: boolean): void {
    const ending = config.endings.find((e) => e.id === state.endingId);
    if (!ending) throw new Error(`branching runtime: ending "${state.endingId}" not found in config`);

    feedbackPanel.hidden = true;

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
    const scoreLine = el("p", "ilb-score-line");
    // Learner-facing copy: no em dashes. Two sentences, plain punctuation.
    scoreLine.textContent =
      `Decisions: ${counts.best} best, ${counts.acceptable} acceptable, ${counts.poor} poor. ` +
      `Score: ${scorePct(state)}%.`;
    sceneContainer.appendChild(scoreLine);

    updateVarsStatus();

    choicesContainer.innerHTML = "";
    choicesContainer.hidden = false;
    const startOverBtn = document.createElement("button");
    startOverBtn.type = "button";
    startOverBtn.className = "ilb-choice-btn ilb-start-over-btn";
    startOverBtn.textContent = "Start over";
    startOverBtn.addEventListener("click", () => handleStartOver());
    choicesContainer.appendChild(startOverBtn);

    debriefContainer.innerHTML = "";
    if (config.showPathInDebrief && state.path.length > 0) {
      debriefContainer.hidden = false;
      const debriefHeading = document.createElement("h3");
      debriefHeading.textContent = "Your path";
      debriefContainer.appendChild(debriefHeading);

      const ol = document.createElement("ol");
      ol.className = "ilb-debrief-list";
      for (const step of state.path) {
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

        if (stepScene) {
          const others = stepScene.choices.filter((c) => c.id !== step.c).map((c) => c.label);
          if (others.length > 0) {
            const otherP = el("p", "ilb-debrief-other");
            otherP.textContent = `Other options: ${others.join(", ")}.`;
            li.appendChild(otherP);
          }
        }

        if (config.feedbackMode === "debrief" && choice?.feedback) {
          const fb = el("p", "ilb-debrief-feedback");
          fb.innerHTML = choice.feedback; // sanitized at authoring + revalidated at export
          li.appendChild(fb);
        }

        ol.appendChild(li);
      }
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

  function handleChoiceClick(choiceId: string): void {
    const chosen = visibleChoices(config, state).find((c) => c.id === choiceId);
    if (!chosen) return; // defensive: button only exists for a currently-visible choice
    state = applyChoice(config, state, choiceId);
    updateVarsStatus();

    if (config.feedbackMode === "immediate" && chosen.feedback) {
      choicesContainer.hidden = true;
      feedbackText.innerHTML = chosen.feedback; // sanitized at authoring + revalidated at export
      feedbackPanel.hidden = false;
      continueBtn.focus();
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
 * engine bundle uses. A `declare global` augmentation isn't used here
 * (unlike param-sandbox/main.ts) because both engine bundles are part of the
 * SAME TypeScript program at `tsc --noEmit` time even though esbuild bundles
 * them into separate files — two conflicting `mount` signatures on the same
 * ambient Window.ILBEngine interface would fail to merge. The double cast
 * through `unknown` assigns without widening either engine's own mount
 * function type. */
if (typeof window !== "undefined") {
  (window as unknown as { ILBEngine: { mount: typeof mountBranchingScenario } }).ILBEngine = {
    mount: mountBranchingScenario,
  };
}
