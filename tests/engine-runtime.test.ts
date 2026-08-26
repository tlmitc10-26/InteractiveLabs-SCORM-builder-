// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountSandbox } from "@/engine-runtime/param-sandbox/main";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import type { ScormSession } from "@/engine-runtime/scorm-adapter";

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
    const slider = document.querySelector('input[data-input="mass"]') as HTMLInputElement;
    slider.value = "6";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
    expect(out.textContent).toBe("12");
  });

  it("marks challenges met and unmet", () => {
    mountSandbox(document.getElementById("root")!, config);
    const slider = document.querySelector('input[data-input="mass"]') as HTMLInputElement;
    expect(document.querySelector('[data-challenge="c1"]')!.classList.contains("met")).toBe(false);
    slider.value = "7";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector('[data-challenge="c1"]')!.classList.contains("met")).toBe(true);
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
      const slider = document.querySelector('input[data-input="mass"]') as HTMLInputElement;

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
      const slider = document.querySelector('input[data-input="mass"]') as HTMLInputElement;

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
});
