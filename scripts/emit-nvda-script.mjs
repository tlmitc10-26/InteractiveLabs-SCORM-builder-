/**
 * Generates docs/a11y/nvda-check-param-sandbox.md: a human NVDA verification
 * script derived from the SAME spec-determined expectations encoded in
 * src/lib/a11y/transcript.ts and locked by tests/sr-transcript.test.ts.
 *
 * Doctrine: a screen reader implements W3C specs (accname computation,
 * ARIA/HTML-AAM role mapping, live-region processing), so for conformant
 * markup the announcement is determined ahead of time -- the human NVDA
 * pass exists to VERIFY that determination against a real screen reader,
 * not to discover what should be announced by trial and error. This script
 * mounts the exact same buoyancy starter config the automated contract
 * tests use, drives the exact same interaction sequence, and prints the
 * exact same computed text into numbered steps a human can follow with
 * NVDA running.
 *
 * Regenerate: `npm run a11y:script` (rerun any time main.ts's markup, or the
 * buoyancy starter config, changes). Commit the resulting doc.
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
const OUT_PATH = path.join(ROOT, "docs", "a11y", "nvda-check-param-sandbox.md");

// ---------- jsdom bootstrap (mirrors vitest's jsdom environment closely
// enough for main.ts to mount: it only ever touches document/window/Image/
// ResizeObserver (guarded), none of which need a full browser). ----------
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
});
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.HTMLElement = dom.window.HTMLElement;
global.Image = dom.window.Image;

const { mountSandbox } = await import("@/engine-runtime/param-sandbox/main");
const { starterConfig } = await import("@/lib/engines/param-sandbox/starter-configs");
const { toRuntimeConfig } = await import("@/lib/engines/param-sandbox/runtime-config");
const { readingOrderTranscript, focusOrderTranscript } = await import("@/lib/a11y/transcript");

const config = starterConfig("buoyancy", "Buoyancy Explorer");
const runtimeConfig = toRuntimeConfig(config, (id) => `assets/${id}.png`);
const root = document.getElementById("root");
mountSandbox(root, runtimeConfig);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- NVDA utterance phrasing ----------
// NVDA's spoken role words differ cosmetically from the ARIA/HTML-AAM role
// strings transcript.ts uses (e.g. "spinbutton" -> "spin button"). This is
// the ONE place that translation happens, kept small and explicit so it's
// easy to correct against a real NVDA session if a wording turns out wrong.
const NVDA_ROLE_WORD = {
  slider: "slider",
  spinbutton: "spin button",
  checkbox: "check box",
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

mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, lines.join("\n") + "\n");
console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
