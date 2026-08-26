// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mountSandbox, stageDimensions, STAGE_MAX_HEIGHT_PX } from "@/engine-runtime/param-sandbox/main";
import { chartLayout, type MeasureTextLike } from "@/engine-runtime/param-sandbox/chart-layout";
import { validateSandboxConfig, toRuntimeConfig, emptySandboxConfig } from "@/lib/engines/param-sandbox/schema";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import type { ScormSession } from "@/engine-runtime/scorm-adapter";

const ENGINE_CSS_PATH = path.resolve(__dirname, "../src/engine-runtime/param-sandbox/engine.css");

const config: RuntimeSandboxConfig = {
  title: "Test",
  inputs: [{ id: "mass", label: "Mass", type: "slider", min: 0, max: 10, step: 1, defaultValue: 4, units: "kg" }],
  outputs: [{ id: "double", label: "Double", formula: "mass * 2", units: "kg", decimals: 0 }],
  charts: [],
  challenges: [{ id: "c1", prompt: "Reach 12", outputId: "double", comparator: "gte", value: 12 }],
};

/** Minimal mock satisfying the ScormSession contract, for engine-side tests. */
function createScormMock(initialSuspend: unknown = null) {
  let suspend: unknown = initialSuspend;
  return {
    mode: "scorm" as const,
    setScore: vi.fn(),
    setCompleted: vi.fn(),
    saveSuspendData: vi.fn((state: unknown) => { suspend = state; return true; }),
    loadSuspendData: vi.fn(() => suspend),
    finish: vi.fn(),
  };
}

describe("mountSandbox", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).ILBScorm;
  });

  it("renders inputs and computes outputs from defaults", () => {
    mountSandbox(document.getElementById("root")!, config);
    const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
    expect(out.textContent).toBe("8");
  });

  it("recomputes when an input changes", () => {
    mountSandbox(document.getElementById("root")!, config);
    const slider = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
    slider.value = "6";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
    expect(out.textContent).toBe("12");
  });

  it("marks challenges met and unmet", () => {
    mountSandbox(document.getElementById("root")!, config);
    const slider = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
    expect(document.querySelector('[data-challenge="c1"]')!.classList.contains("met")).toBe(false);
    slider.value = "7";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector('[data-challenge="c1"]')!.classList.contains("met")).toBe(true);
  });

  it("displays a title containing '&' correctly end-to-end through the FULL authoring pipeline (validate -> runtime -> mount)", () => {
    // Task fix 2: sanitizePlainText used to entity-escape plain-text fields
    // at storage time, so a title of "Mass & weight test" was PERMANENTLY
    // stored as "Mass &amp; weight test" and every consumer (including this
    // textContent render) displayed the escaped form. Round-tripping
    // through the real authoring schema (not just calling mountSandbox
    // directly with a hand-built RuntimeSandboxConfig) is what actually
    // exercises sanitizePlainText.
    const draft = { ...emptySandboxConfig("x"), title: "Mass & weight test" };
    const result = validateSandboxConfig(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.title).toBe("Mass & weight test"); // stored raw, not "Mass &amp; weight test"

    const runtimeConfig = toRuntimeConfig(result.config, () => { throw new Error("no assets in this config"); });
    mountSandbox(document.getElementById("root")!, runtimeConfig);
    const h2 = document.querySelector(".ilb-title")!;
    expect(h2.textContent).toBe("Mass & weight test");
  });

  describe("paired numeric input for sliders (2.5.7)", () => {
    it("renders both a range input and a visible number input for a slider, sharing min/max/step", () => {
      mountSandbox(document.getElementById("root")!, config);
      const range = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      const number = document.querySelector('input[type="number"][data-input="mass"]') as HTMLInputElement;
      expect(range).toBeTruthy();
      expect(number).toBeTruthy();
      expect(number.id).not.toBe(range.id); // mount-unique id, distinct from the range's
      expect(number.min).toBe(range.min);
      expect(number.max).toBe(range.max);
      expect(number.step).toBe(range.step);
      expect(number.getAttribute("aria-label")).toBe("Mass, exact value");
    });

    it("slider change updates the paired number field's value", () => {
      mountSandbox(document.getElementById("root")!, config);
      const range = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      const number = document.querySelector('input[type="number"][data-input="mass"]') as HTMLInputElement;
      range.value = "6";
      range.dispatchEvent(new Event("input", { bubbles: true }));
      expect(number.value).toBe("6");
    });

    it("typing into the paired number field updates outputs and the range value", () => {
      mountSandbox(document.getElementById("root")!, config);
      const range = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      const number = document.querySelector('input[type="number"][data-input="mass"]') as HTMLInputElement;
      number.value = "7";
      number.dispatchEvent(new Event("input", { bubbles: true }));
      expect(range.value).toBe("7");
      const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
      expect(out.textContent).toBe("14");
    });

    it("ignores an empty/non-finite intermediate value while typing in the number field", () => {
      mountSandbox(document.getElementById("root")!, config);
      const number = document.querySelector('input[type="number"][data-input="mass"]') as HTMLInputElement;
      number.value = "";
      number.dispatchEvent(new Event("input", { bubbles: true }));
      const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
      expect(out.textContent).toBe("8"); // unchanged from the default (4 * 2)
    });

    it("clamps an out-of-range number entry into [min, max] on blur", () => {
      mountSandbox(document.getElementById("root")!, config);
      const range = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      const number = document.querySelector('input[type="number"][data-input="mass"]') as HTMLInputElement;
      number.value = "999"; // config max is 10
      number.dispatchEvent(new Event("input", { bubbles: true }));
      number.dispatchEvent(new Event("blur", { bubbles: true }));
      expect(number.value).toBe("10");
      expect(range.value).toBe("10");
      const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
      expect(out.textContent).toBe("20"); // 10 * 2, clamped value drives outputs
    });

    it("preserves in-progress typing in the number field instead of rewriting it mid-keystroke", () => {
      mountSandbox(document.getElementById("root")!, config);
      const range = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      const number = document.querySelector('input[type="number"][data-input="mass"]') as HTMLInputElement;

      // A leading zero must not be snapped away mid-keystroke.
      number.value = "07";
      number.dispatchEvent(new Event("input", { bubbles: true }));
      expect(number.value).toBe("07");
      expect(range.value).toBe("7");

      // A trailing zero after the decimal point must not be snapped away
      // mid-keystroke either (typing "3.5" then "3.50").
      number.value = "3.5";
      number.dispatchEvent(new Event("input", { bubbles: true }));
      number.value = "3.50";
      number.dispatchEvent(new Event("input", { bubbles: true }));
      expect(number.value).toBe("3.50");
      const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
      expect(out.textContent).toBe("7"); // 3.5 * 2

      // Only on blur is the displayed text normalized.
      number.dispatchEvent(new Event("blur", { bubbles: true }));
      expect(number.value).toBe("3.5");
      expect(range.value).toBe("3.5");
    });

    it("clamps an out-of-range number entry into [min, max] on Enter", () => {
      mountSandbox(document.getElementById("root")!, config);
      const range = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      const number = document.querySelector('input[type="number"][data-input="mass"]') as HTMLInputElement;
      number.value = "-5"; // config min is 0
      number.dispatchEvent(new Event("input", { bubbles: true }));
      number.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(number.value).toBe("0");
      expect(range.value).toBe("0");
    });
  });

  describe("engine.css source rules (2.5.8 target size + focus visibility)", () => {
    const css = readFileSync(ENGINE_CSS_PATH, "utf8");

    it("defines a 24px minimum height for range, number, and select controls", () => {
      expect(css).toMatch(/input\[type="range"\][^{]*\{[^}]*min-height:\s*24px/);
      expect(css).toMatch(/input\[type="number"\][^{]*\{[^}]*min-height:\s*24px/);
      expect(css).toMatch(/select[^{]*\{[^}]*min-height:\s*24px/);
    });

    it("defines a 24x24px checkbox control", () => {
      expect(css).toMatch(/input\[type="checkbox"\][^{]*\{[^}]*width:\s*24px/);
      expect(css).toMatch(/input\[type="checkbox"\][^{]*\{[^}]*height:\s*24px/);
    });

    it("defines focus-visible outline styles scoped under .ilb-sandbox", () => {
      expect(css).toMatch(
        /\.ilb-sandbox[^{]*input:focus-visible[^{]*,[^{]*select:focus-visible[^{]*,[^{]*button:focus-visible[^{]*\{[^}]*outline:\s*3px solid var\(--rds-info\)[^}]*outline-offset:\s*2px/,
      );
    });

    // Regression guard (caught only by real-browser layout, not jsdom): CSS
    // Grid switches a grid item's sizing from stretch to content-based the
    // instant an auto margin is present on that axis. .ilb-stage's only
    // children are position:absolute (no intrinsic width), so adding
    // margin-left/right:auto to center a width-capped stage -- without also
    // pinning width:100% -- collapsed EVERY stage (capped or not) to 0x0.
    it("pins .ilb-stage to width:100% alongside its centering auto margins", () => {
      // Anchored to a line starting with the bare ".ilb-stage" selector, so
      // this doesn't accidentally match ".ilb-layout...> .ilb-stage { ... }"
      // (a different rule, grid-column placement only) earlier in the file.
      const stageRule = css.match(/^\.ilb-stage\s*\{[^}]*\}/m)?.[0] ?? "";
      expect(stageRule).toMatch(/width:\s*100%/);
      expect(stageRule).toMatch(/margin-left:\s*auto/);
      expect(stageRule).toMatch(/margin-right:\s*auto/);
    });
  });

  it("renders a fill overlay whose height tracks the output", () => {
    mountSandbox(document.getElementById("root")!, {
      ...config,
      visual: {
        overlays: [{ id: "w", type: "fill", outputId: "double", inMin: 0, inMax: 20, color: "#4a90d9", box: { x: 0, y: 0, w: 100, h: 100 } }],
      },
    });
    const fill = document.querySelector('[data-overlay="w"] .ilb-fill') as HTMLElement;
    expect(fill.style.height).toBe("40%"); // 8 of 0..20
  });

  it("never renders unsanitized text as HTML in labels", () => {
    mountSandbox(document.getElementById("root")!, {
      ...config,
      outputs: [{ id: "double", label: '<img src=x onerror=alert(1)>', formula: "mass * 2" }],
    });
    expect(document.querySelector("img")).toBeNull();
  });

  describe("output decimal formatting", () => {
    // Regression: `.toFixed(d).replace(/\.?0+$/, "")` mangled whole numbers
    // under decimals:0 (100 -> "1", 20 -> "2"). Must render the plain
    // formatted number instead.
    function renderWith(defaultValue: number, decimals: number | undefined): string {
      document.body.innerHTML = '<div id="root"></div>';
      mountSandbox(document.getElementById("root")!, {
        title: "Decimals",
        inputs: [{ id: "x", label: "x", type: "number", min: -1000, max: 1000, defaultValue, units: "" }],
        outputs: [{ id: "v", label: "v", formula: "x", decimals }],
        charts: [],
        challenges: [],
      });
      return document.querySelector('[data-output="v"] .ilb-output-value')!.textContent!;
    }

    it("renders 100 with decimals:0 as \"100\", not \"1\"", () => {
      expect(renderWith(100, 0)).toBe("100");
    });
    it("renders 20 with decimals:0 as \"20\", not \"2\"", () => {
      expect(renderWith(20, 0)).toBe("20");
    });
    it("renders -100 with decimals:0 as \"-100\"", () => {
      expect(renderWith(-100, 0)).toBe("-100");
    });
    it("renders 0.5 with decimals:2 as \"0.5\"", () => {
      expect(renderWith(0.5, 2)).toBe("0.5");
    });
  });

  describe("SCORM score/completion reporting", () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).ILBScorm;
    });

    it("keeps the reported score at its high-water mark when a challenge is met then un-met", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountSandbox(document.getElementById("root")!, config);
      const slider = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;

      // Meet the challenge: double = 14 >= 12.
      slider.value = "7";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      expect(scorm.setScore).toHaveBeenCalledTimes(1);
      expect(scorm.setScore).toHaveBeenLastCalledWith(100);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);

      // Un-meet it: double = 2 < 12. Score must NOT be downgraded, and
      // completion must not be un-set (setCompleted still only called once).
      slider.value = "1";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      expect(scorm.setScore).toHaveBeenCalledTimes(1);
      expect(scorm.setScore).toHaveBeenLastCalledWith(100);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("re-asserts score and completion on mount when restoring a completed suspend state", () => {
      const scorm = createScormMock({ values: { mass: 4 }, best: 100, completed: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountSandbox(document.getElementById("root")!, config);

      expect(scorm.setScore).toHaveBeenCalledWith(100);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("writes a score of 0 once when the learner interacts without meeting any challenge", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountSandbox(document.getElementById("root")!, config);
      const slider = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;

      // double = 10, challenge requires >= 12: still unmet, but an absent
      // score reads as "not attempted" in Canvas, not zero — must be written.
      slider.value = "5";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      expect(scorm.setScore).toHaveBeenCalledTimes(1);
      expect(scorm.setScore).toHaveBeenCalledWith(0);
      expect(scorm.setCompleted).not.toHaveBeenCalled();

      // Interacting again while still unmet at the same 0% must not add a
      // duplicate call.
      slider.value = "3";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      expect(scorm.setScore).toHaveBeenCalledTimes(1);
    });

    it("re-asserts a restored partial score on mount even when not completed", () => {
      const scorm = createScormMock({ values: { mass: 4 }, best: 50, completed: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountSandbox(document.getElementById("root")!, config);

      expect(scorm.setScore).toHaveBeenCalledTimes(1);
      expect(scorm.setScore).toHaveBeenCalledWith(50);
      expect(scorm.setCompleted).not.toHaveBeenCalled();
    });
  });

  describe("placement zones and layout presets (Task 11)", () => {
    const placementConfig: RuntimeSandboxConfig = {
      title: "Placement test",
      layout: "stage-focus",
      inputs: [
        { id: "panelIn", label: "Panel input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 2 },
        { id: "belowIn", label: "Below input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 3, placement: { zone: "below" } },
        { id: "stageIn", label: "Stage input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 4, placement: { zone: "stage", box: { x: 10, y: 20, w: 15, h: 10 } } },
      ],
      outputs: [
        { id: "panelOut", label: "Panel output", formula: "panelIn * 2" },
        { id: "belowOut", label: "Below output", formula: "belowIn * 2", placement: { zone: "below" } },
        { id: "stageOut", label: "Stage output", formula: "stageIn * 2", placement: { zone: "stage", box: { x: 40, y: 50, w: 15, h: 10 } } },
      ],
      charts: [],
      challenges: [],
      visual: { overlays: [] },
    };

    it("applies the layout class to .ilb-layout", () => {
      mountSandbox(document.getElementById("root")!, placementConfig);
      const layout = document.querySelector(".ilb-layout")!;
      expect(layout.classList.contains("ilb-layout-stage-focus")).toBe(true);
    });

    it("renders a stage-zone input inside .ilb-stage-controls with left/top set, and its slider still drives outputs", () => {
      mountSandbox(document.getElementById("root")!, placementConfig);
      const stageControls = document.querySelector(".ilb-stage-controls")!;
      const slider = stageControls.querySelector('input[type="range"][data-input="stageIn"]') as HTMLInputElement;
      expect(slider).toBeTruthy();
      const card = slider.closest(".ilb-stage-control") as HTMLElement;
      expect(card.style.left).toBe("10%");
      expect(card.style.top).toBe("20%");

      slider.value = "8";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      const out = document.querySelector('[data-output="stageOut"] .ilb-output-value')!;
      expect(out.textContent).toBe("16");
    });

    it("renders below-zone input and output inside .ilb-below-panel", () => {
      mountSandbox(document.getElementById("root")!, placementConfig);
      const below = document.querySelector(".ilb-below-panel")!;
      expect(below.querySelector('input[data-input="belowIn"]')).toBeTruthy();
      expect(below.querySelector('[data-output="belowOut"]')).toBeTruthy();
    });

    it("omits the below-panel and stage entirely when nothing uses those zones", () => {
      mountSandbox(document.getElementById("root")!, config); // the module-level `config` fixture: no placement, no visual
      expect(document.querySelector(".ilb-below-panel")).toBeNull();
      expect(document.querySelector(".ilb-stage")).toBeNull();
    });
  });

  describe("focus order matches each preset's visual reading order (WCAG 1.3.2/2.4.3, technique C27)", () => {
    // Same shape as `placementConfig` above (one input + one output per
    // zone) but parameterized over `layout`, so DOM order can be checked
    // against each preset's documented visual order (main.ts's
    // LAYOUT_ZONE_ORDER / engine.css's grid placement).
    function configFor(layout: RuntimeSandboxConfig["layout"]): RuntimeSandboxConfig {
      return {
        title: "Placement test",
        layout,
        inputs: [
          { id: "panelIn", label: "Panel input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 2 },
          { id: "belowIn", label: "Below input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 3, placement: { zone: "below" } },
          { id: "stageIn", label: "Stage input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 4, placement: { zone: "stage", box: { x: 10, y: 20, w: 15, h: 10 } } },
        ],
        outputs: [
          { id: "panelOut", label: "Panel output", formula: "panelIn * 2" },
          { id: "belowOut", label: "Below output", formula: "belowIn * 2", placement: { zone: "below" } },
          { id: "stageOut", label: "Stage output", formula: "stageIn * 2", placement: { zone: "stage", box: { x: 40, y: 50, w: 15, h: 10 } } },
        ],
        charts: [],
        challenges: [],
        visual: { overlays: [] },
      };
    }

    // Expected zone-container DOM order, and the resulting input/output
    // element order it implies (below-zone and stage-zone elements sort
    // wherever their zone container falls; panel-zone elements sort
    // wherever .ilb-inputs/.ilb-outputs falls) — one case per preset.
    const cases: Array<{
      layout: RuntimeSandboxConfig["layout"];
      panels: string[];
      inputOrder: string[];
      outputOrder: string[];
    }> = [
      {
        layout: "side",
        // Visual: inputs | stage | outputs row, then below-panel beneath.
        panels: ["ilb-inputs", "ilb-stage", "ilb-outputs", "ilb-below-panel"],
        inputOrder: ["panelIn", "stageIn", "belowIn"],
        outputOrder: ["stageOut", "panelOut", "belowOut"],
      },
      {
        layout: "stacked",
        // Visual: stage first, then inputs, then below, then outputs.
        panels: ["ilb-stage", "ilb-inputs", "ilb-below-panel", "ilb-outputs"],
        inputOrder: ["stageIn", "panelIn", "belowIn"],
        outputOrder: ["stageOut", "belowOut", "panelOut"],
      },
      {
        layout: "stage-focus",
        // Visual: stage first (full width), then inputs+outputs row, then below.
        panels: ["ilb-stage", "ilb-inputs", "ilb-outputs", "ilb-below-panel"],
        inputOrder: ["stageIn", "panelIn", "belowIn"],
        outputOrder: ["stageOut", "panelOut", "belowOut"],
      },
    ];

    for (const { layout, panels, inputOrder, outputOrder } of cases) {
      it(`layout="${layout}": DOM order of zone containers, inputs, and outputs matches the visual order`, () => {
        mountSandbox(document.getElementById("root")!, configFor(layout));
        const layoutEl = document.querySelector(".ilb-layout")!;
        expect(Array.from(layoutEl.children).map((c) => c.className)).toEqual(panels);

        const actualInputOrder = [...new Set(Array.from(document.querySelectorAll("[data-input]")).map((n) => n.getAttribute("data-input")))];
        expect(actualInputOrder).toEqual(inputOrder);

        const actualOutputOrder = Array.from(document.querySelectorAll("[data-output]")).map((n) => n.getAttribute("data-output"));
        expect(actualOutputOrder).toEqual(outputOrder);
      });
    }
  });

  describe("empty zone containers are not rendered (Task 13 cosmetic fix)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // Every input AND output placed off-panel (stage/below), with a visual
    // scene present so the "stage" placements are valid — nothing at all
    // routes into .ilb-inputs or .ilb-outputs, so both containers should be
    // omitted entirely rather than rendered empty.
    const allStageConfig: RuntimeSandboxConfig = {
      title: "All stage",
      layout: "stage-focus",
      inputs: [
        { id: "stageIn", label: "Stage input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 4, placement: { zone: "stage", box: { x: 10, y: 20, w: 15, h: 10 } } },
      ],
      outputs: [
        { id: "stageOut", label: "Stage output", formula: "stageIn * 2", placement: { zone: "stage", box: { x: 40, y: 50, w: 15, h: 10 } } },
      ],
      charts: [],
      challenges: [],
      visual: { overlays: [] },
    };

    it("omits .ilb-inputs and .ilb-outputs when every input/output is stage-placed", () => {
      mountSandbox(document.getElementById("root")!, allStageConfig);
      expect(document.querySelector(".ilb-inputs")).toBeNull();
      expect(document.querySelector(".ilb-outputs")).toBeNull();
      // The stage-placed controls themselves still render.
      expect(document.querySelector('[data-input="stageIn"]')).toBeTruthy();
      expect(document.querySelector('[data-output="stageOut"]')).toBeTruthy();
    });

    it("still renders the sr-only outputs live region (in a minimal wrapper) and keeps it functional", () => {
      vi.useFakeTimers();
      mountSandbox(document.getElementById("root")!, allStageConfig);
      const live = document.querySelector('[role="status"][aria-live="polite"]');
      expect(live).toBeTruthy();
      // Not inside an (absent) .ilb-outputs card — it must have its own
      // minimal wrapper instead.
      expect(document.querySelector(".ilb-outputs")).toBeNull();
      expect(live!.closest(".ilb-outputs-live")).toBeTruthy();

      const slider = document.querySelector('input[type="range"][data-input="stageIn"]') as HTMLInputElement;
      slider.value = "8";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(500);
      expect(live!.textContent).toBe("Stage output: 16");
    });

    it("still renders .ilb-inputs/.ilb-outputs when at least one panel-zone element exists", () => {
      mountSandbox(document.getElementById("root")!, config); // module-level fixture: panel-zone input+output
      expect(document.querySelector(".ilb-inputs")).toBeTruthy();
      expect(document.querySelector(".ilb-outputs")).toBeTruthy();
      expect(document.querySelector(".ilb-outputs-live")).toBeNull();
    });
  });

  describe("charts (crisp DPR rendering + non-clipping labels)", () => {
    const chartConfig: RuntimeSandboxConfig = {
      title: "Chart test",
      inputs: [{ id: "x", label: "X", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }],
      outputs: [{ id: "y", label: "Y", formula: "x * 2" }],
      charts: [{ id: "c", title: "Y vs X", xInputId: "x", yOutputId: "y", samples: 10 }],
      challenges: [],
    };

    it("mounts and re-renders a chart without crashing even though jsdom's canvas has no real layout (clientWidth 0, no 2D context)", () => {
      expect(() => mountSandbox(document.getElementById("root")!, chartConfig)).not.toThrow();
      const canvas = document.querySelector('canvas[data-chart="c"]') as HTMLCanvasElement;
      expect(canvas).toBeTruthy();
      // Interacting recomputes and redraws the chart — must not throw when
      // canvas.clientWidth is 0 (falls back to 480) and getContext("2d")
      // returns null (jsdom has no canvas backend installed).
      const slider = document.querySelector('input[type="range"][data-input="x"]') as HTMLInputElement;
      expect(() => {
        slider.value = "8";
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }).not.toThrow();
    });
  });

  describe("chartLayout (pure gutter math, extracted so it's testable without a real canvas)", () => {
    // Stub measureText: N characters * a fixed per-character width, close
    // enough to a monospace-ish estimate for testing gutter sizing without
    // needing real font metrics (unavailable in jsdom).
    function stubCtx(charWidthPx: number): MeasureTextLike {
      return { measureText: (text: string) => ({ width: text.length * charWidthPx }) };
    }

    it("sizes the left gutter from the wider of the two y-axis labels", () => {
      // "15.87" is 5 chars * 6px = 30px wide -> leftGutter = ceil(30) + 12 = 42
      const rect = chartLayout(stubCtx(6), "0", "15.87", 480, 220);
      expect(rect.x).toBe(42);
    });

    it("keeps a positive top padding so a y-max label (baseline middle, drawn at rect.y) never clips the canvas's top edge", () => {
      const rect = chartLayout(stubCtx(6), "0", "100", 480, 220);
      expect(rect.y).toBeGreaterThan(0);
      expect(rect.y).toBe(12); // ceil(12px font / 2) + 6px pad
    });

    it("keeps the plot rect strictly inside the canvas bounds regardless of label width", () => {
      const cssWidth = 480, cssHeight = 220;
      const rect = chartLayout(stubCtx(6), "-12.34", "987.65", cssWidth, cssHeight);
      expect(rect.x).toBeGreaterThan(0);
      expect(rect.y).toBeGreaterThan(0);
      expect(rect.x + rect.w).toBeLessThan(cssWidth);
      expect(rect.y + rect.h).toBeLessThan(cssHeight);
    });

    it("never collapses the plot to a non-positive size even for a tiny canvas", () => {
      const rect = chartLayout(stubCtx(6), "0", "100", 40, 30);
      expect(rect.w).toBeGreaterThanOrEqual(10);
      expect(rect.h).toBeGreaterThanOrEqual(10);
    });
  });

  describe("stageDimensions (stage height cap defect fix)", () => {
    // Defect: a 24x24 placeholder image, aspect-ratio-matched 1:1 onto a
    // full-width "stage-focus" column, blew up into a giant flat square
    // filling the page. stageDimensions caps the stage's rendered width so
    // its aspect-ratio-derived height can never exceed STAGE_MAX_HEIGHT_PX,
    // while the CSS aspect-ratio itself always matches the image exactly
    // (so overlay percent boxes stay coincident with the image regardless
    // of whether maxWidth kicks in).

    it("does not cap a wide/landscape image", () => {
      const dims = stageDimensions(1600, 900);
      expect(dims.aspectRatio).toBe("1600 / 900");
      expect(dims.maxWidth).toBeUndefined();
    });

    it("caps a square image at the height cap (480px == 480px wide for a 1:1 ratio)", () => {
      const dims = stageDimensions(24, 24);
      expect(dims.aspectRatio).toBe("24 / 24");
      expect(dims.maxWidth).toBe("480px");
    });

    it("caps a tall/portrait image so its height never exceeds the cap", () => {
      const dims = stageDimensions(600, 1200);
      expect(dims.aspectRatio).toBe("600 / 1200");
      expect(dims.maxWidth).toBe("240px"); // 480 * 600/1200
    });

    it("respects a custom capPx", () => {
      const dims = stageDimensions(600, 1200, 240);
      expect(dims.maxWidth).toBe("120px");
    });

    it("guards degenerate (zero) natural dimensions without producing NaN/Infinity", () => {
      expect(stageDimensions(0, 0)).toEqual({ aspectRatio: "1 / 1" });
      expect(stageDimensions(100, 0)).toEqual({ aspectRatio: "1 / 1" });
      expect(stageDimensions(0, 100)).toEqual({ aspectRatio: "1 / 1" });
    });

    it("exports the default cap as 480", () => {
      expect(STAGE_MAX_HEIGHT_PX).toBe(480);
    });
  });

  describe("stage background load applies the height cap (main.ts integration)", () => {
    it("sets aspectRatio and maxWidth on the stage once the background image loads", () => {
      mountSandbox(document.getElementById("root")!, {
        ...config,
        visual: { backgroundUrl: "beaker.png", overlays: [] },
      });
      const stage = document.querySelector(".ilb-stage") as HTMLElement;
      const bg = stage.querySelector(".ilb-stage-bg") as HTMLImageElement;
      Object.defineProperty(bg, "naturalWidth", { value: 24, configurable: true });
      Object.defineProperty(bg, "naturalHeight", { value: 24, configurable: true });
      bg.dispatchEvent(new Event("load"));
      expect(stage.style.aspectRatio).toBe("24 / 24");
      expect(stage.style.maxWidth).toBe("480px");
      expect(stage.style.minHeight).toBe("0px");
    });
  });

  describe("score status strip (visible grading feedback)", () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).ILBScorm;
    });

    it("shows the initial ungraded state with the standalone/preview suffix", () => {
      mountSandbox(document.getElementById("root")!, config); // module-level fixture: 1 challenge, unmet by default
      const status = document.querySelector(".ilb-score-status")!;
      expect(status.textContent).toBe(
        "Score: 0% — 0 of 1 challenges met. (preview — grades record only in the course)",
      );
      expect(status.classList.contains("complete")).toBe(false);
    });

    it("updates to the completed state, with no preview suffix, once the challenge is met in real SCORM mode", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountSandbox(document.getElementById("root")!, config);
      const slider = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      slider.value = "7"; // double = 14 >= 12: meets challenge c1
      slider.dispatchEvent(new Event("input", { bubbles: true }));

      const status = document.querySelector(".ilb-score-status")!;
      expect(status.textContent).toBe("Score: 100% — 1 of 1 challenges met. Lesson complete.");
      expect(status.classList.contains("complete")).toBe(true);
    });

    it("shows the exploration-lesson line (no challenge count) when the config has no challenges", () => {
      mountSandbox(document.getElementById("root")!, { ...config, challenges: [] });
      const status = document.querySelector(".ilb-score-status")!;
      expect(status.textContent).toBe(
        "Exploration lesson — interacting records a score of 100%. (preview — grades record only in the course)",
      );
    });
  });
});
