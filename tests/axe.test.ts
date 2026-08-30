// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import axe from "axe-core";
import { mountSandbox } from "@/engine-runtime/param-sandbox/main";
import { starterConfig, STARTERS as PS_STARTERS } from "@/lib/engines/param-sandbox/starter-configs";
import { toRuntimeConfig } from "@/lib/engines/param-sandbox/runtime-config";
import { sandboxConfigSchema, type SandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { mountBranchingScenario } from "@/engine-runtime/branching-scenario/main";
import { branchingStarterConfig, BRANCHING_STARTERS } from "@/lib/engines/branching-scenario/starters";
import { toBranchingRuntimeConfig } from "@/lib/engines/branching-scenario/runtime-config";
import { branchingConfigSchema } from "@/lib/engines/branching-scenario/schema";
import { mountCaseWorkspace, type RuntimeCaseConfig } from "@/engine-runtime/case-workspace/main";
import { CASE_STARTERS, caseStarterConfig } from "@/lib/engines/case-workspace/starters";
import { toCaseRuntimeConfig } from "@/lib/engines/case-workspace/runtime-config";

/** Renders every violation (id, impact, help, and each offending node's
 *  outerHTML) so a failure tells you exactly what to fix without re-running
 *  axe locally. */
function describeViolations(violations: axe.Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `    - ${n.html}`).join("\n");
      return `[${v.id}] impact=${v.impact} — ${v.help}\n${nodes}`;
    })
    .join("\n\n");
}

// color-contrast is disabled below: axe measures it from jsdom's computed
// layout/paint, which doesn't exist in this environment (no real rendering,
// so background/foreground colors resolve unreliably). Our own math
// (src/lib/design/contrast.ts) verifies every fill-overlay color against the
// stage background at both authoring time (live badge) and validation time
// (export-blocking), which is the real guarantee for this rule.
const AXE_OPTIONS: Parameters<typeof axe.run>[1] = {
  rules: { "color-contrast": { enabled: false } },
};

async function auditBody() {
  const results = await axe.run(document.body, AXE_OPTIONS);
  if (results.violations.length > 0) {
    throw new Error(`axe found ${results.violations.length} violation(s):\n\n${describeViolations(results.violations)}`);
  }
  return results;
}

describe("axe-core accessibility gate", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("has zero violations for the buoyancy starter's runtime config", async () => {
    const config = starterConfig("buoyancy", "Buoyancy Explorer");
    const runtimeConfig = toRuntimeConfig(config, (id) => `assets/${id}.png`);
    mountSandbox(document.getElementById("root")!, runtimeConfig);

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations for a config with a fill overlay and a chart", async () => {
    const config: SandboxConfig = sandboxConfigSchema.parse({
      title: "Visual scene demo",
      intro: "<p>Watch the tank fill as you increase the flow rate.</p>",
      inputs: [
        { id: "flow", label: "Flow rate", type: "slider", min: 0, max: 10, step: 0.5, defaultValue: 3, units: "L/min" },
      ],
      outputs: [
        { id: "level", label: "Tank level", formula: "flow * 8", units: "%", decimals: 0 },
      ],
      charts: [
        { id: "level_chart", title: "Level vs flow", xInputId: "flow", yOutputId: "level", samples: 20 },
      ],
      challenges: [
        { id: "fill80", prompt: "Fill the tank past 80%.", outputId: "level", comparator: "gte", value: 80 },
      ],
      visual: {
        // No backgroundAssetId: the fill color is checked against the stage
        // background, so it must clear the 3:1 non-text contrast gate
        // (primary/#8c1d40 on light-1/#fafafa is ~8.8:1 — well clear).
        overlays: [
          { id: "tank", type: "fill", outputId: "level", inMin: 0, inMax: 100, color: { token: "primary" }, box: { x: 10, y: 10, w: 30, h: 80 } },
        ],
      },
    });
    const runtimeConfig = toRuntimeConfig(config, (id) => `assets/${id}.png`);
    mountSandbox(document.getElementById("root")!, runtimeConfig);

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations once the score banner shows the .complete success state (visual pass restyle)", async () => {
    const config: SandboxConfig = sandboxConfigSchema.parse({
      title: "Completion banner demo",
      inputs: [{ id: "mass", label: "Mass", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5, units: "kg" }],
      outputs: [{ id: "double", label: "Double", formula: "mass * 2", units: "kg", decimals: 0 }],
      challenges: [
        { id: "c1", prompt: "Reach a doubled mass of at least 12.", outputId: "double", comparator: "gte", value: 12 },
      ],
    });
    const runtimeConfig = toRuntimeConfig(config, (id) => `assets/${id}.png`);
    mountSandbox(document.getElementById("root")!, runtimeConfig);

    const slider = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
    slider.value = "7"; // double = 14 >= 12: meets the challenge, triggers the completed banner
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    const status = document.querySelector(".ilb-score-status")!;
    expect(status.classList.contains("complete")).toBe(true); // sanity: the state under audit actually rendered

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });
});

describe("axe-core accessibility gate: branching scenario", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  const juryConfig = toBranchingRuntimeConfig(
    branchingStarterConfig("jury", "Jury Deliberation"),
    () => { throw new Error("no assets in the jury starter"); },
  );

  function clickChoice(label: string): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-choice-btn"));
    // The runtime prepends an aria-hidden A/B/C marker span before the
    // visible label span (visual pass, 2026-08-28) — match on the label
    // span's own text, not the button's raw (marker-inclusive) textContent.
    const btn = buttons.find((b) => b.querySelector(".ilb-choice-label")?.textContent === label);
    if (!btn) throw new Error(`no visible choice button labeled "${label}"`);
    btn.click();
  }

  it("has zero violations at the jury starter's start scene", async () => {
    mountBranchingScenario(document.getElementById("root")!, juryConfig);

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations at the jury starter's ending + debrief", async () => {
    mountBranchingScenario(document.getElementById("root")!, juryConfig);
    clickChoice("Raise your doubts before the room votes");
    clickChoice("Walk the group through the conflict");
    clickChoice("Ask them to explain what evidence would change their mind");

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  // The jury/blank starters are both feedbackMode "debrief", so neither ever
  // renders the feedback panel + Continue button — a config authored in
  // "immediate" mode is needed to audit that state at all.
  const immediateConfig = toBranchingRuntimeConfig(
    branchingConfigSchema.parse({
      title: "Immediate Feedback Audit",
      variables: [{ id: "confidence", label: "Confidence", initial: 50, min: 0, max: 100, visible: true }],
      scenes: [
        {
          id: "s1",
          title: "Scene One",
          body: "<p>Choose how to proceed.</p>",
          choices: [
            {
              id: "go",
              label: "Go",
              quality: "best",
              effects: [{ variableId: "confidence", delta: 10 }],
              feedback: "<p>Nice choice.</p>",
              goTo: "scene:s2",
            },
          ],
        },
        {
          id: "s2",
          title: "Scene Two",
          body: "<p>Finish up.</p>",
          choices: [{ id: "finish", label: "Finish", quality: "best", effects: [], goTo: "ending:done" }],
        },
      ],
      startSceneId: "s1",
      endings: [{ id: "done", title: "Done", body: "<p>The end.</p>" }],
      feedbackMode: "immediate",
      showPathInDebrief: true,
    }),
    () => { throw new Error("no assets in this config"); },
  );

  it("has zero violations while the immediate-feedback panel + Continue button are shown", async () => {
    mountBranchingScenario(document.getElementById("root")!, immediateConfig);
    clickChoice("Go");

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  // The jury/blank/immediate starters above all render the no-image brand-band
  // header (spec §2's default), so a config with an uploaded scene image is
  // needed to audit that header variant (full-bleed <img>, rounded-top card,
  // image-before-heading reading order) at all.
  const imageHeaderConfig = toBranchingRuntimeConfig(
    branchingConfigSchema.parse({
      title: "Image Header Audit",
      variables: [],
      scenes: [
        {
          id: "s1",
          title: "Scene With An Image",
          body: "<p>This scene has an uploaded header image.</p>",
          imageAssetId: "courtroom",
          imageRole: "informative",
          imageAlt: "A courtroom sketch",
          choices: [{ id: "go", label: "Continue", quality: "best", effects: [], goTo: "ending:done" }],
        },
      ],
      startSceneId: "s1",
      endings: [{ id: "done", title: "Done", body: "<p>The end.</p>" }],
      feedbackMode: "debrief",
      showPathInDebrief: true,
    }),
    (id) => `assets/${id}.png`,
  );

  it("has zero violations for a scene with an uploaded image header (spec §2 header rule)", async () => {
    mountBranchingScenario(document.getElementById("root")!, imageHeaderConfig);

    const img = document.querySelector("img.ilb-scene-image");
    expect(img).not.toBeNull(); // sanity: the state under audit actually rendered

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });
});

describe("axe-core accessibility gate: case workspace", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  const noAssets = () => { throw new Error("no assets in this config"); };

  /** Exercises every artifact kind (text/image/table), a "single" scoring
   *  mode, and an expert map covering all four artifact/conclusion
   *  relationships the debrief's comparison list renders — see
   *  tests/case-runtime.test.ts's richConfig for the same shape, kept
   *  independent here so this file's fixtures don't depend on another
   *  test file's exports. */
  const richConfig: RuntimeCaseConfig = toCaseRuntimeConfig(
    {
      title: "The Equipment Failure Case",
      intro: "<p>Review the artifacts and decide what happened.</p>",
      scoringMode: "single",
      artifacts: [
        { id: "memo", title: "Maintenance Memo", sourceLine: "Internal memo, p.1", kind: "text", body: "<p>The lift was flagged for service three times.</p>" },
        { id: "photo", title: "Scene Photo", kind: "image", imageAssetId: "scene", imageRole: "informative", imageAlt: "The lift mechanism after the incident" },
        {
          id: "logs",
          title: "Access Logs",
          kind: "table",
          table: { caption: "Badge swipes, 6-8pm", headers: ["Time", "Employee"], rows: [["6:02", "R. Alvarez"], ["7:45", "T. Kim"]] },
        },
        { id: "weather", title: "Weather Log", kind: "text", body: "<p>Clear skies, no precipitation.</p>" },
      ],
      conclusions: [
        {
          id: "equipment_failure",
          label: "Equipment failure",
          credit: "full",
          expertRationale: "<p>The maintenance history is the most direct explanation.</p>",
          reasons: [
            { id: "ef_sound", text: "The lift had unresolved service flags.", sound: true },
            { id: "ef_flaw", text: "T. Kim badged in that evening.", sound: false, flawNote: "Presence at the scene doesn't establish a mechanical cause." },
          ],
        },
        {
          id: "operator_error",
          label: "Operator error",
          credit: "none",
          expertRationale: "<p>The evidence does not support operator error.</p>",
          reasons: [
            { id: "oe_sound", text: "An untrained employee badged in that evening.", sound: true },
            { id: "oe_flaw", text: "Clear weather ruled out every other cause.", sound: false, flawNote: "Ruling out one alternative doesn't establish this one." },
          ],
        },
      ],
      expertMap: [
        { artifactId: "memo", conclusionId: "equipment_failure", role: "supports", strength: "strong" },
        { artifactId: "logs", conclusionId: "equipment_failure", role: "contradicts", strength: "weak" },
        { artifactId: "photo", conclusionId: "operator_error", role: "supports", strength: "weak" },
        { artifactId: "weather", conclusionId: "equipment_failure", role: "contradicts", strength: "weak" },
      ],
    },
    (id) => `assets/${id}.png`,
  ) as unknown as RuntimeCaseConfig;

  function clickByText(selector: string, text: string): void {
    const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((b) => b.textContent === text);
    if (!btn) throw new Error(`no ${selector} with text "${text}"`);
    btn.click();
  }

  function selectArtifactByTitlePrefix(title: string): void {
    const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-artifact-btn")).find((b) => b.textContent?.startsWith(title));
    if (!btn) throw new Error(`no artifact button starting with "${title}"`);
    btn.click();
  }

  it("has zero violations at the brief step", async () => {
    mountCaseWorkspace(document.getElementById("root")!, richConfig);
    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations in the workspace viewing a text artifact", async () => {
    mountCaseWorkspace(document.getElementById("root")!, richConfig);
    clickByText(".ilb-btn-pill", "Open the case file.");
    selectArtifactByTitlePrefix("Maintenance Memo");
    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations in the workspace viewing an image artifact", async () => {
    mountCaseWorkspace(document.getElementById("root")!, richConfig);
    clickByText(".ilb-btn-pill", "Open the case file.");
    selectArtifactByTitlePrefix("Scene Photo");
    const img = document.querySelector(".ilb-artifact-image");
    expect(img).not.toBeNull(); // sanity: the state under audit actually rendered
    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations in the workspace viewing a table artifact, with the artifact added to the case file", async () => {
    mountCaseWorkspace(document.getElementById("root")!, richConfig);
    clickByText(".ilb-btn-pill", "Open the case file.");
    selectArtifactByTitlePrefix("Access Logs");
    clickByText(".ilb-viewer-actions .ilb-btn", "Add as weak support");
    const table = document.querySelector(".ilb-artifact-table");
    expect(table).not.toBeNull(); // sanity: the state under audit actually rendered
    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations at the conclude step with the reason group open", async () => {
    mountCaseWorkspace(document.getElementById("root")!, richConfig);
    clickByText(".ilb-btn-pill", "Open the case file.");
    clickByText(".ilb-btn-pill", "Ready to conclude");
    const radio = document.querySelector<HTMLInputElement>('input[type="radio"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector(".ilb-reason-group")).not.toBeNull(); // sanity
    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations at the debrief step", async () => {
    mountCaseWorkspace(document.getElementById("root")!, richConfig);
    clickByText(".ilb-btn-pill", "Open the case file.");
    selectArtifactByTitlePrefix("Maintenance Memo");
    clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
    clickByText(".ilb-btn-pill", "Ready to conclude");
    const radio = document.querySelector<HTMLInputElement>('input[type="radio"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    clickByText(".ilb-btn-pill", "Submit conclusion");
    expect(document.querySelector(".ilb-eyebrow")).not.toBeNull(); // sanity
    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations for every case-workspace starter's brief step", async () => {
    for (const id of Object.keys(CASE_STARTERS)) {
      document.body.innerHTML = '<div id="root"></div>';
      const config = toCaseRuntimeConfig(caseStarterConfig(id, `Starter check: ${id}`), noAssets) as unknown as RuntimeCaseConfig;
      mountCaseWorkspace(document.getElementById("root")!, config);

      const results = await auditBody();
      expect(results.violations, `starter "${id}": ${describeViolations(results.violations)}`).toEqual([]);
    }
  });
});

// Generalized starter coverage (Task 3, spec §6): rather than only auditing
// the buoyancy/jury starters by name (the deep per-state cases above stay as
// they are), this loop mounts EVERY starter of BOTH engines at its initial
// state (initial output/challenge values for param-sandbox; the start scene
// for branching-scenario) so a future exemplar starter is audited for free
// the moment it's added to STARTERS/BRANCHING_STARTERS, with no test-file
// edit required. Blank starters are included: both blanks validate and mount
// meaningfully (a single slider+result; two scenes with real choices), so
// there's no reason to skip them.
describe("axe-core accessibility gate: every starter (generalized coverage)", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("has zero violations for every param-sandbox starter's initial state", async () => {
    for (const id of Object.keys(PS_STARTERS)) {
      document.body.innerHTML = '<div id="root"></div>';
      const config = starterConfig(id, `Starter check: ${id}`);
      const runtimeConfig = toRuntimeConfig(config, (assetId) => `assets/${assetId}.png`);
      mountSandbox(document.getElementById("root")!, runtimeConfig);

      const results = await auditBody();
      expect(results.violations, `starter "${id}": ${describeViolations(results.violations)}`).toEqual([]);
    }
  });

  it("has zero violations for every branching-scenario starter's start scene", async () => {
    for (const id of Object.keys(BRANCHING_STARTERS)) {
      document.body.innerHTML = '<div id="root"></div>';
      const config = branchingStarterConfig(id, `Starter check: ${id}`);
      const runtimeConfig = toBranchingRuntimeConfig(config, (assetId) => `assets/${assetId}.png`);
      mountBranchingScenario(document.getElementById("root")!, runtimeConfig);

      const results = await auditBody();
      expect(results.violations, `starter "${id}": ${describeViolations(results.violations)}`).toEqual([]);
    }
  });
});
