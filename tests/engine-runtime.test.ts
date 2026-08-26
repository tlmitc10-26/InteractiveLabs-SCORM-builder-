// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mountSandbox } from "@/engine-runtime/param-sandbox/main";
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

    it("keeps DOM order matching the documented focus-order invariant: panel containers, then below, then stage", () => {
      mountSandbox(document.getElementById("root")!, placementConfig);
      const layout = document.querySelector(".ilb-layout")!;
      const panels = Array.from(layout.children).map((c) => c.className);
      expect(panels).toEqual(["ilb-inputs", "ilb-outputs", "ilb-below-panel", "ilb-stage"]);

      const inputOrder = [...new Set(Array.from(document.querySelectorAll("[data-input]")).map((n) => n.getAttribute("data-input")))];
      expect(inputOrder).toEqual(["panelIn", "belowIn", "stageIn"]);

      const outputOrder = Array.from(document.querySelectorAll("[data-output]")).map((n) => n.getAttribute("data-output"));
      expect(outputOrder).toEqual(["panelOut", "belowOut", "stageOut"]);
    });

    it("omits the below-panel and stage entirely when nothing uses those zones", () => {
      mountSandbox(document.getElementById("root")!, config); // the module-level `config` fixture: no placement, no visual
      expect(document.querySelector(".ilb-below-panel")).toBeNull();
      expect(document.querySelector(".ilb-stage")).toBeNull();
    });
  });
});
