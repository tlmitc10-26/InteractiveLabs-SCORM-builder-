/**
 * Generates the per-engine NVDA verification scripts:
 *   - docs/a11y/nvda-check-param-sandbox.md   (Parameter Sandbox / Buoyancy Explorer)
 *   - docs/a11y/nvda-check-branching-scenario.md (Branching Scenario / Jury Deliberation)
 *   - docs/a11y/nvda-check-case-workspace.md  (Case / Evidence Workspace / blank starter)
 *
 * Both are derived from the SAME spec-determined expectations encoded in
 * src/lib/a11y/transcript.ts and locked by tests/sr-transcript.test.ts and
 * tests/sr-transcript-branching.test.ts respectively.
 *
 * Doctrine: a screen reader implements W3C specs (accname computation,
 * ARIA/HTML-AAM role mapping, live-region processing), so for conformant
 * markup the announcement is determined ahead of time -- the human NVDA
 * pass exists to VERIFY that determination against a real screen reader,
 * not to discover what should be announced by trial and error. This script
 * mounts the exact same starter configs the automated contract tests use,
 * drives the exact same interaction sequences, and prints the exact same
 * computed text into numbered steps a human can follow with NVDA running.
 *
 * Regenerate: `npm run a11y:script` (rerun any time either engine's main.ts
 * markup, or its starter config, changes -- this ALWAYS emits both docs).
 * Commit both resulting docs.
 *
 * Run via tsx (not plain node) because it imports the TypeScript engine
 * runtime, schema, and transcript modules directly -- see package.json's
 * "a11y:script" script.
 */
import { JSDOM } from "jsdom";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = path.join(ROOT, "docs", "a11y");

// ---------- jsdom bootstrap (mirrors vitest's jsdom environment closely
// enough for both engines' main.ts to mount: they only ever touch
// document/window/Image/ResizeObserver (guarded), none of which need a full
// browser). Shared across both docs below -- each mounts into its own fresh
// container element, so there's no cross-engine DOM interference. ----------
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.HTMLElement = dom.window.HTMLElement;
global.Image = dom.window.Image;

const { readingOrderTranscript, focusOrderTranscript } = await import("@/lib/a11y/transcript");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freshRoot(id) {
  document.body.innerHTML = `<div id="${id}"></div>`;
  return document.getElementById(id);
}

// ---------- NVDA utterance phrasing ----------
// NVDA's spoken role words differ cosmetically from the ARIA/HTML-AAM role
// strings transcript.ts uses (e.g. "spinbutton" -> "spin button"). This is
// the ONE place that translation happens, kept small and explicit so it's
// easy to correct against a real NVDA session if a wording turns out wrong.
// Shared by both engines' docs below.
const NVDA_ROLE_WORD = {
  slider: "slider",
  spinbutton: "spin button",
  checkbox: "check box",
  radio: "radio button",
  combobox: "combo box",
  listbox: "list box",
  button: "button",
  link: "link",
  img: "graphic",
};

/** "<name>, <role>, <value>" -- NVDA's default utterance order (name, then
 *  role, then value/state) when a control receives focus. */
function nvdaFocusUtterance(entry) {
  const roleWord = NVDA_ROLE_WORD[entry.role] ?? entry.role;
  const parts = [entry.name, roleWord];
  if (entry.value !== undefined) parts.push(entry.value);
  if (entry.states?.length) parts.push(...entry.states);
  return parts.join(", ");
}

function headingUtterance(entry) {
  const level = entry.role.match(/level (\d)/)?.[1] ?? "?";
  return `${entry.name} heading level ${level}`;
}

// ==================== Parameter Sandbox doc ====================

async function generateParamSandboxDoc() {
  const { mountSandbox } = await import("@/engine-runtime/param-sandbox/main");
  const { starterConfig } = await import("@/lib/engines/param-sandbox/starter-configs");
  const { toRuntimeConfig } = await import("@/lib/engines/param-sandbox/runtime-config");

  const config = starterConfig("buoyancy", "Buoyancy Explorer");
  const runtimeConfig = toRuntimeConfig(config, (id) => `assets/${id}.png`);
  const root = freshRoot("root");
  mountSandbox(root, runtimeConfig);

  // ==================== 1. Tab-through (focus order) ====================
  const focusOrder = focusOrderTranscript(root);
  const tabSteps = focusOrder.map((entry, i) => ({
    n: i + 1,
    action: "Press Tab",
    says: nvdaFocusUtterance(entry),
  }));

  // ==================== 2. Headings / chart / initial live text ====================
  await wait(600); // settle the debounced outputs summary at the default values
  const readingOrderInitial = readingOrderTranscript(root);
  const headingEntries = readingOrderInitial.filter((e) => e.role.startsWith("heading"));
  const chartEntry = readingOrderInitial.find((e) => e.role === "img");
  const statusEntry = readingOrderInitial.find((e) => e.role === "status");

  // ==================== 3. Arrow the mass slider up to the challenge ====================
  const massInput = document.querySelector('input[type="range"][data-input="mass"]');
  const step = Number(massInput.step);
  const scoreStatusNode = () => root.querySelector(".ilb-score-status");
  const challengeStatusNode = () => root.querySelector('[data-challenge="displace6"] .ilb-sr-only');

  const arrowSteps = [];
  let metStepIndex = null;
  for (let i = 1; i <= 10 && metStepIndex === null; i++) {
    const beforeScore = scoreStatusNode().textContent;
    const beforeChallenge = challengeStatusNode().textContent;
    massInput.value = String(Number(massInput.value) + step);
    massInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    const afterScore = scoreStatusNode().textContent;
    const afterChallenge = challengeStatusNode().textContent;

    const step_ = {
      n: i,
      value: massInput.value,
      scoreStatusChangedTo: afterScore !== beforeScore ? afterScore : null,
      challengeStatusChangedTo: afterChallenge !== beforeChallenge ? afterChallenge : null,
    };
    arrowSteps.push(step_);
    if (afterChallenge === "Met") metStepIndex = i;
  }

  await wait(600); // settle the debounced outputs summary at the post-arrow values
  const settledSummaryText = scoreStatusNode() && root.querySelector('[role="status"]').textContent;

  // ==================== Emit markdown ====================
  const lines = [];
  const push = (s = "") => lines.push(s);

  push("# NVDA verification script: Parameter Sandbox (Buoyancy Explorer starter)");
  push();
  push("_Generated by `scripts/emit-nvda-script.mjs` from the same spec-determined transcript");
  push("data locked in `tests/sr-transcript.test.ts` (see `src/lib/a11y/transcript.ts`).");
  push("Do not hand-edit this file -- rerun `npm run a11y:script` to regenerate it after any");
  push("change to the runtime's markup or to the buoyancy starter config._");
  push();
  push("## Assumptions");
  push();
  push("- NVDA with **default settings** (default speech verbosity: roles and states announced).");
  push("- Latest Chrome or Firefox -- accname computation and live-region processing are the");
  push("  browser's job; NVDA reads whatever the browser exposes via the accessibility tree.");
  push("- Open **NVDA's Speech Viewer** before starting, so you can log/copy exactly what NVDA");
  push("  says as you go, and compare it word-for-word against the \"NVDA should say\" lines below.");
  push("- Load the Buoyancy Explorer starter fresh (no prior SCORM resume/suspend data) before");
  push("  beginning at step 1.");
  push();
  push("## 1. Tab through the controls (focus order)");
  push();
  push("Starting from before the sandbox (e.g. the browser's address bar), press Tab repeatedly:");
  push();
  for (const s of tabSteps) {
    push(`${s.n}. ${s.action} → NVDA should say: **"${s.says}"**`);
  }
  push();
  push("If you hear anything else here -- a different name, a wrong role word, a stale value --");
  push("that's a contract regression: check `tests/sr-transcript.test.ts`'s locked focus-order");
  push("transcript against what the runtime currently renders.");
  push();
  push("## 2. Headings and the chart image");
  push();
  push("Use NVDA's quick-navigation heading key (`H`) or browse the page top to bottom:");
  push();
  let hStep = tabSteps.length + 1;
  for (const h of headingEntries) {
    push(`${hStep}. Press H → NVDA should say: **"${headingUtterance(h)}"**`);
    hStep++;
  }
  if (chartEntry) {
    push(`${hStep}. Navigate onto the chart → NVDA should say: **"${chartEntry.name}, graphic"**`);
    push("   - Note: this generation environment (jsdom) has no real `<canvas>` 2D context, so");
    push("     the label above is the chart's STATIC initial label. In a real browser the label");
    push("     is DYNAMIC and includes the plotted axis range and current point, e.g. something");
    push("     like “Volume vs mass chart: x from 0.5 to 20, y from 0.5 to 20, current point");
    push("     (5, 5)”. Verify the dynamic form manually in the browser; only its STATIC form is");
    push("     covered by the automated contract (see the comment in `tests/sr-transcript.test.ts`");
    push("     group 2).");
    hStep++;
  }
  push();
  push("## 3. The outputs summary (debounced live region)");
  push();
  push("At the default values (mass 5 kg, Fresh water), after you stop interacting for about");
  push("half a second, NVDA should announce:");
  push();
  push(`${hStep}. Wait ~500ms with no input → NVDA should say: **"${statusEntry?.name}"**`);
  hStep++;
  push();
  push("This does NOT fire on every keystroke/drag tick -- only once, ~500ms after input settles.");
  push("If you hear it announced repeatedly while dragging, that's a regression in the debounce.");
  push();
  push("## 4. Arrow the mass slider up to the challenge threshold");
  push();
  push("Tab to the mass slider (step 1 above) and press the Right Arrow key repeatedly:");
  push();
  for (const s of arrowSteps) {
    push(`${hStep}. Press Right Arrow → NVDA should say (bare number only, no name/role repeated):`);
    push(`   **"${s.value}"**`);
    if (s.scoreStatusChangedTo || s.challengeStatusChangedTo) {
      push("   - At this exact key press the challenges live region also updates. Because it is");
      push("     a non-atomic `aria-live=\"polite\"` region, NVDA announces each changed text node");
      push("     separately (in DOM order), essentially at the same time as the slider's own");
      push("     number above -- you may hear it interleave with, or immediately follow, the");
      push("     bare-number announcement. That overlap is expected AT behavior, not a defect.");
      if (s.scoreStatusChangedTo) push(`   - Also expect to hear: **"${s.scoreStatusChangedTo}"**`);
      if (s.challengeStatusChangedTo) push(`   - Also expect to hear: **"${s.challengeStatusChangedTo}"**`);
    }
    hStep++;
  }
  push();
  push(`## 5. Wait for the outputs summary to catch up`);
  push();
  push(`${hStep}. Stop interacting and wait ~500ms → NVDA should say:`);
  push(`   **"${settledSummaryText}"**`);
  hStep++;
  push();
  push("## What you should NOT hear");
  push();
  push("- **No double announcement** of the same value/text within the same ~500ms window --");
  push("  `tests/sr-transcript.test.ts`'s churn guard proves the runtime never rewrites a live");
  push("  region's text node when the computed text hasn't actually changed, so NVDA has nothing");
  push("  to re-announce on a no-op re-render.");
  push("- **Nothing announced as \"blank\"** -- every focusable control in step 1 has a non-empty");
  push("  accessible name (a paired `<label for>`, or an explicit `aria-label` for the slider's");
  push("  companion exact-value field).");
  push("- **Nothing announced as \"clickable\"** -- every control is a native form element (range/");
  push("  number/select), never a generic `<div>`/`<span>` with a click handler bolted on, so NVDA");
  push("  never falls back to its generic \"clickable\" description.");
  push("- **No stray reading of the decorative challenge-met glyph mark or any decorative image**");
  push("  -- both are `aria-hidden=\"true\"` and are excluded from the reading order (see");
  push("  `tests/sr-transcript.test.ts` group 4).");
  push();

  return { outPath: path.join(DOCS_DIR, "nvda-check-param-sandbox.md"), text: lines.join("\n") + "\n" };
}

// ==================== Branching Scenario doc ====================

async function generateBranchingDoc() {
  const { mountBranchingScenario } = await import("@/engine-runtime/branching-scenario/main");
  const { branchingStarterConfig } = await import("@/lib/engines/branching-scenario/starters");
  const { toBranchingRuntimeConfig } = await import("@/lib/engines/branching-scenario/runtime-config");

  const config = branchingStarterConfig("jury", "Jury Deliberation");
  const runtimeConfig = toBranchingRuntimeConfig(config, (id) => `assets/${id}.png`);
  const root = freshRoot("root-branching");
  mountBranchingScenario(root, runtimeConfig);

  const clickChoice = (label) => {
    // Match on the visible label span's own text, not the button's raw
    // (marker-inclusive) textContent — the runtime prepends an aria-hidden
    // A/B/C marker span before the label (visual pass, 2026-08-28; see
    // tests/sr-transcript-branching.test.ts's `choiceLabelText` helper,
    // which this mirrors).
    const btn = Array.from(root.querySelectorAll(".ilb-choice-btn")).find(
      (b) => b.querySelector(".ilb-choice-label")?.textContent === label,
    );
    if (!btn) throw new Error(`no visible choice button labeled "${label}"`);
    btn.click();
  };

  // ==================== 1. Initial load: role line, heading, vars status ====================
  const readingStart = readingOrderTranscript(root);
  const roleEntry = readingStart.find((e) => e.role === "text");
  const startHeading = readingStart.find((e) => e.role.startsWith("heading"));
  const startStatus = readingStart.find((e) => e.role === "status");

  // ==================== 2. Tab through the start scene's choices ====================
  const startFocusOrder = focusOrderTranscript(root);
  const tabSteps = startFocusOrder.map((entry, i) => ({ n: i + 1, says: nvdaFocusUtterance(entry) }));

  // ==================== 3. Walk the best path to an ending, one Enter at a time ====================
  // first_vote -(speak_up)-> timeline -(walk_through)-> holdout -(invite_reasons)-> ending.
  const bestPathLabels = [
    "Raise your doubts before the room votes",
    "Walk the group through the conflict",
    "Ask them to explain what evidence would change their mind",
  ];
  const pathSteps = [];
  for (const label of bestPathLabels) {
    clickChoice(label);
    const after = readingOrderTranscript(root);
    const heading = after.find((e) => e.role.startsWith("heading"));
    const status = after.find((e) => e.role === "status");
    pathSteps.push({ chosenLabel: label, headingSays: heading ? headingUtterance(heading) : null, statusText: status?.name ?? null });
  }

  // ==================== 4. Debrief reading order at the ending ====================
  const readingEnd = readingOrderTranscript(root);
  // NEW (visual pass, 2026-08-28): the "Scenario complete" eyebrow is now the
  // FIRST "text"-role entry, ahead of the ending heading — see main.ts's
  // renderEnding and tests/sr-transcript-branching.test.ts group 5. Excluded
  // by identity (not just scoreLine) below so `debriefText` still resolves to
  // the actual path-list entry rather than this new eyebrow.
  const eyebrowEntry = readingEnd.find((e) => e.role === "text");
  const endingHeading = readingEnd.find((e) => e.role === "heading level 2");
  const scoreLine = readingEnd.find((e) => e.role === "text" && /^Decisions:/.test(e.name));
  const endStatus = readingEnd.find((e) => e.role === "status");
  const startOverButton = readingEnd.find((e) => e.role === "button");
  const debriefHeading = readingEnd.find((e) => e.role === "heading level 3");
  const debriefText = readingEnd.find((e) => e.role === "text" && e !== eyebrowEntry && e !== scoreLine);

  // ==================== Emit markdown ====================
  const lines = [];
  const push = (s = "") => lines.push(s);

  push("# NVDA verification script: Branching Scenario (Jury Deliberation starter)");
  push();
  push("_Generated by `scripts/emit-nvda-script.mjs` from the same spec-determined transcript");
  push("data locked in `tests/sr-transcript-branching.test.ts` (see `src/lib/a11y/transcript.ts`).");
  push("Do not hand-edit this file -- rerun `npm run a11y:script` to regenerate it after any");
  push("change to the runtime's markup or to the jury starter config._");
  push();
  push("## Assumptions");
  push();
  push("- NVDA with **default settings** (default speech verbosity: roles and states announced).");
  push("- Latest Chrome or Firefox -- accname computation and live-region processing are the");
  push("  browser's job; NVDA reads whatever the browser exposes via the accessibility tree.");
  push("- Open **NVDA's Speech Viewer** before starting, so you can log/copy exactly what NVDA");
  push("  says as you go, and compare it word-for-word against the \"NVDA should say\" lines below.");
  push("- Load the Jury Deliberation starter fresh (no prior SCORM resume/suspend data) before");
  push("  beginning at step 1.");
  push();
  push("## 1. Load: role line, scene heading, variable status");
  push();
  push("Browse from the top of the page (e.g. NVDA's `H` heading-navigation key, then continue");
  push("reading down):");
  push();
  let n = 1;
  if (roleEntry) {
    push(`${n}. Read the first line → NVDA should say: **"${roleEntry.name}"**`);
    n++;
  }
  push(`${n}. Press H → NVDA should say: **"${headingUtterance(startHeading)}"**`);
  n++;
  if (startStatus) {
    push(`${n}. Continue reading → NVDA should say: **"${startStatus.name}"**`);
    n++;
  }
  push();
  push("## 2. Tab through the start scene's choices (focus order)");
  push();
  push("Starting from before the choices (e.g. the browser's address bar), press Tab repeatedly:");
  push();
  for (const s of tabSteps) {
    // s.says already ends in ", button" -- nvdaFocusUtterance appends the
    // NVDA_ROLE_WORD for every focusable entry, buttons included.
    push(`${n}. Press Tab → NVDA should say: **"${s.says}"**`);
    n++;
  }
  push();
  push("If you hear anything else here -- a different name, a missing \"button\" role word, a");
  push("stale label -- that's a contract regression: check");
  push("`tests/sr-transcript-branching.test.ts`'s locked focus-order transcript against what the");
  push("runtime currently renders.");
  push();
  push("## 3. Choose the best path (Enter on each best choice)");
  push();
  push("With a choice button focused, press Enter to activate it. Each activation moves focus to");
  push("the new scene's heading (spec §6's focus-management contract), which NVDA announces the");
  push("instant the transition completes -- immediately followed by the variable-status live");
  push("region's updated value:");
  push();
  // Section 2's tab-through audit deliberately visits every choice button in
  // order, which leaves real focus on the LAST one -- not the first choice
  // this section's first Enter press needs. Bridge that explicitly (mirrors
  // the param-sandbox doc's "Tab to the mass slider (step 1 above)..."
  // pattern) so a tester following the steps literally doesn't activate the
  // wrong choice and silently invalidate the rest of the walkthrough.
  const shiftTabsBack = tabSteps.length - 1;
  if (shiftTabsBack > 0 && pathSteps.length > 0) {
    const firstChoice = tabSteps[0];
    const times = shiftTabsBack === 1 ? "once" : `${shiftTabsBack} times`;
    push(
      `${n}. Press Shift+Tab ${times} to return to the first choice button, ` +
        `"${pathSteps[0].chosenLabel}". NVDA should announce it again as you land on it: **"${firstChoice.says}"**`,
    );
    n++;
  }
  for (const s of pathSteps) {
    push(`${n}. Press Enter on **"${s.chosenLabel}"** → NVDA should say: **"${s.headingSays}"**`);
    n++;
    if (s.statusText) {
      push(`${n}. (same transition) NVDA should also announce the updated status: **"${s.statusText}"**`);
      n++;
    }
  }
  push();
  push("## 4. The ending and debrief");
  push();
  if (eyebrowEntry) {
    // NEW (visual pass, 2026-08-28): the "Scenario complete" eyebrow sits
    // just above the ending heading in reading order — focus still lands on
    // the heading itself (the focus-management contract is unchanged), so a
    // sighted-equivalent browse-cursor read of the line just before it is
    // what surfaces this new text.
    push(`${n}. Move the browse cursor up one line from the heading → NVDA should say: **"${eyebrowEntry.name}"**`);
    n++;
  }
  push(`${n}. Focus lands on the ending heading → NVDA should say: **"${headingUtterance(endingHeading)}"**`);
  n++;
  if (scoreLine) {
    push(`${n}. Continue reading → NVDA should say: **"${scoreLine.name}"**`);
    n++;
  }
  if (endStatus) {
    push(`${n}. Continue reading → NVDA should say the final variable status: **"${endStatus.name}"**`);
    n++;
  }
  if (startOverButton) {
    push(`${n}. Continue reading (or press Tab) → NVDA should say: **"${startOverButton.name}, button"**`);
    n++;
  }
  if (debriefHeading) {
    push(`${n}. Press H → NVDA should say: **"${headingUtterance(debriefHeading)}"**`);
    n++;
  }
  if (debriefText) {
    push(`${n}. Continue reading the path list → NVDA should say each step's scene, choice, quality,`);
    push("   and \"Other options\" summary, e.g. (the full text, verbatim):");
    push(`   **"${debriefText.name}"**`);
    n++;
  }
  push();
  push("## What you should NOT hear");
  push();
  push("- **No run-on concatenation** between a debrief step's scene name and its chosen-choice");
  push("  label (e.g. never \"Vote:Raise\" with no space) -- `tests/sr-transcript-branching.test.ts`");
  push("  locks the exact, correctly-spaced debrief text above.");
  push("- **No double announcement** of the scene heading or the variable status on a single");
  push("  choice activation -- each transition updates the DOM exactly once per changed value");
  push("  (main.ts's `setText` churn guard), so NVDA has nothing to re-announce.");
  push("- **Nothing announced as \"clickable\"** -- every choice, the Continue button (when a");
  push("  scenario uses immediate feedback), and Start over are native `<button>` elements, never");
  push("  a generic `<div>`/`<span>` with a click handler bolted on.");
  push("- **No stale variable value** -- the status line always reflects the CURRENT scene's vars");
  push("  at the moment focus lands on its heading, never the previous scene's value lingering a");
  push("  beat behind.");
  push("- **No stray reading of the decorative per-step quality glyph** -- each debrief step's");
  push("  quality mark (●/◐/○) is `aria-hidden=\"true\"`; only its paired text (\"Best choice\" /");
  push("  \"Acceptable choice\" / \"Poor choice\") is ever announced.");
  push();

  return { outPath: path.join(DOCS_DIR, "nvda-check-branching-scenario.md"), text: lines.join("\n") + "\n" };
}

// ==================== Case / Evidence Workspace doc ====================

async function generateCaseWorkspaceDoc() {
  const { mountCaseWorkspace } = await import("@/engine-runtime/case-workspace/main");
  const { caseStarterConfig } = await import("@/lib/engines/case-workspace/starters");
  const { toCaseRuntimeConfig } = await import("@/lib/engines/case-workspace/runtime-config");

  const noAssets = () => { throw new Error("the blank case starter has no assets"); };
  const config = caseStarterConfig("blank", "Blank Case");
  const runtimeConfig = toCaseRuntimeConfig(config, noAssets);
  const root = freshRoot("root-case");
  mountCaseWorkspace(root, runtimeConfig);

  const clickByText = (selector, text) => {
    const btn = Array.from(root.querySelectorAll(selector)).find((b) => b.textContent === text);
    if (!btn) throw new Error(`no ${selector} with text "${text}"`);
    btn.click();
  };

  // ==================== 1. Brief: live region, heading, Open button ====================
  const briefReading = readingOrderTranscript(root);
  const briefStatus = briefReading.find((e) => e.role === "status");
  const briefHeading = briefReading.find((e) => e.role.startsWith("heading"));
  const briefFocus = focusOrderTranscript(root);

  // ==================== 2. Workspace: artifact list, select + add to case file ====================
  clickByText(".ilb-btn-pill", "Open the case file.");
  const workspaceReading = readingOrderTranscript(root);
  const workspaceHeading = workspaceReading.find((e) => e.role.startsWith("heading level 2"));
  const artifactButtons = workspaceReading.filter((e) => e.role === "button" && e.name.endsWith("Text"));
  const caseFileHeading = workspaceReading.find((e) => e.role === "heading level 3");

  const firstArtifactBtn = root.querySelector(".ilb-artifact-btn");
  firstArtifactBtn.click();
  const viewerReading = readingOrderTranscript(root);
  const viewerHeading = viewerReading.find((e) => e.role === "heading level 3" && e.name !== caseFileHeading?.name);
  const addButtons = viewerReading.filter((e) => e.role === "button" && e.name.startsWith("Add as"));

  clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
  const afterAddReading = readingOrderTranscript(root);
  const afterAddStatus = afterAddReading.find((e) => e.role === "status");
  const strengthEntry = afterAddReading.find((e) => e.role === "text");
  const removeButton = afterAddReading.find((e) => e.role === "button" && e.name.startsWith("Remove "));

  // ==================== 3. Conclude: radio cards, reason checkboxes, legend focus ====================
  clickByText(".ilb-btn-pill", "Ready to conclude");
  const concludeBeforeReading = readingOrderTranscript(root);
  const concludeHeading = concludeBeforeReading.find((e) => e.role.startsWith("heading"));
  const radios = concludeBeforeReading.filter((e) => e.role === "radio");
  const submitBeforeReading = concludeBeforeReading.find((e) => e.name === "Submit conclusion");

  const firstRadio = root.querySelector('input[type="radio"]');
  const firstRadioLabel = readingOrderTranscript(root).find((e) => e.role === "radio")?.name;
  firstRadio.checked = true;
  firstRadio.dispatchEvent(new window.Event("change", { bubbles: true }));
  const afterChooseReading = readingOrderTranscript(root);
  const checkedRadio = afterChooseReading.find((e) => e.role === "radio" && e.states?.includes("checked"));
  const reasonCheckboxes = afterChooseReading.filter((e) => e.role === "checkbox");
  const legendText = document.activeElement?.tagName === "LEGEND" ? document.activeElement.textContent : null;

  const firstCheckbox = root.querySelector('input[type="checkbox"]');
  firstCheckbox.checked = true;
  firstCheckbox.dispatchEvent(new window.Event("change", { bubbles: true }));
  const afterCheckReading = readingOrderTranscript(root);
  const checkedReasonEntry = afterCheckReading.find((e) => e.role === "checkbox" && e.states?.includes("checked"));
  const submitAfterReading = afterCheckReading.find((e) => e.name === "Submit conclusion");

  // ==================== 4. Debrief: eyebrow, score, comparison + reason review ====================
  clickByText(".ilb-btn-pill", "Submit conclusion");
  const debriefReading = readingOrderTranscript(root);
  const debriefStatus = debriefReading.find((e) => e.role === "status");
  const eyebrow = debriefReading.find((e) => e.role === "text");
  const debriefHeading = debriefReading.find((e) => e.role === "heading level 2");
  const scoreLine = debriefReading.find((e) => e.role === "text" && e !== eyebrow && /Score:/.test(e.name));
  const comparisonHeading = debriefReading.find((e) => e.role === "heading level 3" && /compares/.test(e.name));
  const comparisonText = debriefReading.find((e) => e.role === "text" && e !== eyebrow && e !== scoreLine && /included|left out/.test(e.name));
  const reasoningHeading = debriefReading.find((e) => e.role === "heading level 3" && /reasoning/i.test(e.name));
  const reasonReviewText = debriefReading.find((e) => e.role === "text" && e !== eyebrow && e !== scoreLine && e !== comparisonText);
  const rationaleHeading = debriefReading.find((e) => e.role === "heading level 3" && /rationale/i.test(e.name));
  const startOverButton = debriefReading.find((e) => e.role === "button");

  // ==================== Emit markdown ====================
  const lines = [];
  const push = (s = "") => lines.push(s);

  push("# NVDA verification script: Case / Evidence Workspace (Blank starter)");
  push();
  push("_Generated by `scripts/emit-nvda-script.mjs` from the same spec-determined transcript");
  push("data locked in `tests/sr-transcript-case.test.ts` (see `src/lib/a11y/transcript.ts`).");
  push("Do not hand-edit this file -- rerun `npm run a11y:script` to regenerate it after any");
  push("change to the runtime's markup or to the blank case starter config._");
  push();
  push("## Assumptions");
  push();
  push("- NVDA with **default settings** (default speech verbosity: roles and states announced).");
  push("- Latest Chrome or Firefox -- accname computation and live-region processing are the");
  push("  browser's job; NVDA reads whatever the browser exposes via the accessibility tree.");
  push("- Open **NVDA's Speech Viewer** before starting, so you can log/copy exactly what NVDA");
  push("  says as you go, and compare it word-for-word against the \"NVDA should say\" lines below.");
  push("- Load the Blank Case starter fresh (no prior SCORM resume/suspend data) before beginning");
  push("  at step 1.");
  push();
  push("## 1. Brief: live region, heading, Open button");
  push();
  let n = 1;
  if (briefStatus) {
    push(`${n}. Read the first line → NVDA should say: **"${briefStatus.name}"**`);
    n++;
  }
  push(`${n}. Press H → NVDA should say: **"${headingUtterance(briefHeading)}"**`);
  n++;
  for (const s of briefFocus) {
    push(`${n}. Press Tab → NVDA should say: **"${nvdaFocusUtterance(s)}"**`);
    n++;
  }
  push();
  push("## 2. Workspace: open the case file, review an artifact, add it");
  push();
  push(`${n}. Press Enter on the Open button → NVDA should say the new heading: **"${headingUtterance(workspaceHeading)}"**`);
  n++;
  for (const btn of artifactButtons) {
    push(`${n}. Press Tab to the next artifact button → NVDA should say: **"${nvdaFocusUtterance(btn)}"**`);
    n++;
  }
  if (caseFileHeading) {
    push(`${n}. Continue reading → NVDA should say: **"${headingUtterance(caseFileHeading)}"**`);
    n++;
  }
  push(`${n}. Press Enter on the first artifact button ("${artifactButtons[0]?.name}") → NVDA should say the new heading:`);
  push(`   **"${headingUtterance(viewerHeading)}"**`);
  n++;
  for (const btn of addButtons) {
    push(`${n}. Continue reading (or Tab) → NVDA should say: **"${nvdaFocusUtterance(btn)}"**`);
    n++;
  }
  push(`${n}. Press Enter on "${addButtons[0]?.name}" → the live region updates: NVDA should say:`);
  push(`   **"${afterAddStatus?.name}"**`);
  n++;
  if (strengthEntry) {
    push(`${n}. Continue reading the case-file panel → NVDA should say the strength text: **"${strengthEntry.name}"**`);
    n++;
  }
  if (removeButton) {
    push(`${n}. Continue reading (or Tab) → NVDA should say: **"${nvdaFocusUtterance(removeButton)}"**`);
    n++;
  }
  push();
  push("## 3. Conclude: choose a conclusion, select a reason");
  push();
  push(`${n}. Press Enter on "Ready to conclude" → NVDA should say the new heading:`);
  push(`   **"${headingUtterance(concludeHeading)}"**`);
  n++;
  push("The two conclusion radio buttons follow, initially unchecked:");
  push();
  for (const r of radios) {
    push(`${n}. Continue reading (or Tab) → NVDA should say: **"${nvdaFocusUtterance(r)}"**`);
    n++;
  }
  if (submitBeforeReading) {
    push(`${n}. Continue reading → NVDA should say: **"${nvdaFocusUtterance(submitBeforeReading)}"**`);
    n++;
  }
  push(`${n}. Press Space/Enter on "${firstRadioLabel}" → NVDA should say it flip to checked:`);
  push(`   **"${nvdaFocusUtterance(checkedRadio)}"**`);
  n++;
  push(`${n}. Focus moves automatically to the newly revealed reason group's legend (NOT announced`);
  push("   via the live region -- spec §3's aria-describedby doctrine) → NVDA should say:");
  push(`   **"${legendText}"**`);
  n++;
  for (const c of reasonCheckboxes) {
    push(`${n}. Continue reading (or Tab) → NVDA should say: **"${nvdaFocusUtterance(c)}"**`);
    n++;
  }
  push(`${n}. Press Space on the first reason checkbox → NVDA should say it flip to checked:`);
  push(`   **"${nvdaFocusUtterance(checkedReasonEntry)}"**`);
  n++;
  if (submitAfterReading) {
    push(`${n}. Continue reading → the Submit button is no longer disabled: NVDA should say just:`);
    push(`   **"${nvdaFocusUtterance(submitAfterReading)}"**`);
    n++;
  }
  push();
  push("## 4. Debrief: score, case-file comparison, reason review");
  push();
  push(`${n}. Press Enter on "Submit conclusion" → the live region reflects the final case file:`);
  push(`   NVDA should say: **"${debriefStatus?.name}"**`);
  n++;
  if (eyebrow) {
    push(`${n}. Move the browse cursor to the top of the debrief → NVDA should say: **"${eyebrow.name}"**`);
    n++;
  }
  push(`${n}. Focus lands on the result heading (the chosen conclusion's label) → NVDA should say:`);
  push(`   **"${headingUtterance(debriefHeading)}"**`);
  n++;
  if (scoreLine) {
    push(`${n}. Continue reading → NVDA should say the score line: **"${scoreLine.name}"**`);
    n++;
  }
  if (comparisonHeading) {
    push(`${n}. Press H → NVDA should say: **"${headingUtterance(comparisonHeading)}"**`);
    n++;
  }
  if (comparisonText) {
    push(`${n}. Continue reading the comparison list (bundled as ONE reading-order entry) → NVDA`);
    push("   should say, verbatim:");
    push(`   **"${comparisonText.name}"**`);
    n++;
  }
  if (reasoningHeading) {
    push(`${n}. Press H → NVDA should say: **"${headingUtterance(reasoningHeading)}"**`);
    n++;
  }
  if (reasonReviewText) {
    push(`${n}. Continue reading the reason-review list (bundled as ONE reading-order entry,`);
    push("   including the flaw note for any flawed reason the learner selected) → NVDA should say,");
    push("   verbatim:");
    push(`   **"${reasonReviewText.name}"**`);
    n++;
  }
  if (rationaleHeading) {
    push(`${n}. Press H → NVDA should say: **"${headingUtterance(rationaleHeading)}"**`);
    n++;
  }
  if (startOverButton) {
    push(`${n}. Continue reading (or Tab; this is the only focusable control at debrief) → NVDA`);
    push(`   should say: **"${nvdaFocusUtterance(startOverButton)}"**`);
    n++;
  }
  push();
  push("## What you should NOT hear");
  push();
  push("- **No double announcement** of a conclusion's checked state or the case-file status --");
  push("  each change updates the DOM exactly once (main.ts's churn guard on the one live region),");
  push("  so NVDA has nothing to re-announce on a no-op re-render.");
  push("- **No live-region announcement of the reason group appearing** -- choosing a conclusion");
  push("  moves focus directly to the reason group's legend (see step 3 above); the case-file");
  push("  status live region is untouched by conclusion/reason selection at all");
  push("  (`tests/sr-transcript-case.test.ts`'s \"exactly one live region\" contract).");
  push("- **Nothing announced as \"blank\"** -- every artifact button, radio, and checkbox has a");
  push("  non-empty accessible name (the artifact title + kind, the conclusion label, the reason");
  push("  text), never an empty or icon-only label.");
  push("- **Nothing announced as \"clickable\"** -- every control is a native form element (button/");
  push("  radio/checkbox), never a generic `<div>`/`<span>` with a click handler bolted on.");
  push("- **No stray reading of the decorative reviewed glyph** (the artifact list's ●/○ mark) --");
  push("  it is `aria-hidden=\"true\"` and excluded from the reading order; only the case-file");
  push("  status live region ever reports how many artifacts have been reviewed/added.");
  push("- **No flaw note read aloud before submission** -- a flawed reason's explanation only");
  push("  appears in the debrief's reason-review list, never as part of the Conclude-step");
  push("  checkbox's own accessible name.");
  push();

  return { outPath: path.join(DOCS_DIR, "nvda-check-case-workspace.md"), text: lines.join("\n") + "\n" };
}

// ==================== Write both docs ====================

mkdirSync(DOCS_DIR, { recursive: true });
const outputs = [await generateParamSandboxDoc(), await generateBranchingDoc(), await generateCaseWorkspaceDoc()];
for (const { outPath, text } of outputs) {
  writeFileSync(outPath, text);
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
}
