// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { mountSandbox } from "@/engine-runtime/param-sandbox/main";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";

const config: RuntimeSandboxConfig = {
  title: "Test",
  inputs: [{ id: "mass", label: "Mass", type: "slider", min: 0, max: 10, step: 1, defaultValue: 4, units: "kg" }],
  outputs: [{ id: "double", label: "Double", formula: "mass * 2", units: "kg", decimals: 0 }],
  charts: [],
  challenges: [{ id: "c1", prompt: "Reach 12", outputId: "double", comparator: "gte", value: 12 }],
};

describe("mountSandbox", () => {
  beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; });

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
});
