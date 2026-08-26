// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pxToPercentBox, snapBox, nudgeBox, StageAuthoringLayer, type Target } from "@/app/interactives/[id]/stage-authoring";

/* ---------- pure math ---------- */

describe("pxToPercentBox", () => {
  it("converts a pixel box into percent-of-stage, honoring the stage's own offset", () => {
    const stage = { left: 100, top: 50, width: 400, height: 200 };
    const px = { left: 200, top: 100, width: 40, height: 20 };
    // (200-100)/400=25%, (100-50)/200=25%, 40/400=10%, 20/200=10%
    expect(pxToPercentBox(px, stage)).toEqual({ x: 25, y: 25, w: 10, h: 10 });
  });

  it("returns the zero box when the stage has no measurable size", () => {
    const stage = { left: 0, top: 0, width: 0, height: 0 };
    expect(pxToPercentBox({ left: 10, top: 10, width: 10, height: 10 }, stage)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("handles a box coincident with the stage origin", () => {
    const stage = { left: 0, top: 0, width: 300, height: 300 };
    expect(pxToPercentBox({ left: 0, top: 0, width: 150, height: 75 }, stage)).toEqual({ x: 0, y: 0, w: 50, h: 25 });
  });
});

describe("snapBox", () => {
  it("rounds every field to the default 2% step", () => {
    // Math.round(v/2)*2: 11->12, 13->14, 21->22, 19->20.
    expect(snapBox({ x: 11, y: 13, w: 21, h: 19 })).toEqual({ x: 12, y: 14, w: 22, h: 20 });
  });

  it("rounds to a custom step", () => {
    expect(snapBox({ x: 7, y: 7, w: 30, h: 30 }, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 });
  });

  it("clamps position into 0..100", () => {
    expect(snapBox({ x: -10, y: -50, w: 20, h: 20 })).toEqual({ x: 0, y: 0, w: 20, h: 20 });
  });

  it("enforces a 2% minimum width/height", () => {
    expect(snapBox({ x: 10, y: 10, w: 0.4, h: -5 })).toEqual({ x: 10, y: 10, w: 2, h: 2 });
  });

  it("clamps position so the box never extends past the stage's right/bottom edge", () => {
    expect(snapBox({ x: 98, y: 95, w: 10, h: 10 })).toEqual({ x: 90, y: 90, w: 10, h: 10 });
  });

  it("clamps an oversized box's size into 0..100 as well", () => {
    expect(snapBox({ x: 0, y: 0, w: 140, h: 130 })).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe("nudgeBox", () => {
  const box = { x: 50, y: 50, w: 10, h: 10 };

  it("moves 1% per arrow key without touching size", () => {
    expect(nudgeBox(box, "ArrowUp", false)).toEqual({ x: 50, y: 49, w: 10, h: 10 });
    expect(nudgeBox(box, "ArrowDown", false)).toEqual({ x: 50, y: 51, w: 10, h: 10 });
    expect(nudgeBox(box, "ArrowLeft", false)).toEqual({ x: 49, y: 50, w: 10, h: 10 });
    expect(nudgeBox(box, "ArrowRight", false)).toEqual({ x: 51, y: 50, w: 10, h: 10 });
  });

  it("moves 10% per arrow key when shift is held", () => {
    expect(nudgeBox(box, "ArrowRight", true)).toEqual({ x: 60, y: 50, w: 10, h: 10 });
    expect(nudgeBox(box, "ArrowDown", true)).toEqual({ x: 50, y: 60, w: 10, h: 10 });
  });

  it("clamps at 0 so the box never crosses the left/top edge", () => {
    const nearOrigin = { x: 0.5, y: 0.5, w: 10, h: 10 };
    expect(nudgeBox(nearOrigin, "ArrowLeft", false)).toEqual({ x: 0, y: 0.5, w: 10, h: 10 });
    expect(nudgeBox(nearOrigin, "ArrowUp", true)).toEqual({ x: 0.5, y: 0, w: 10, h: 10 });
  });

  it("clamps position so x+w and y+h never exceed 100", () => {
    const nearEdge = { x: 88, y: 85, w: 10, h: 10 };
    expect(nudgeBox(nearEdge, "ArrowRight", true)).toEqual({ x: 90, y: 85, w: 10, h: 10 });
    expect(nudgeBox(nearEdge, "ArrowDown", true)).toEqual({ x: 88, y: 90, w: 10, h: 10 });
  });
});

/* ---------- component ---------- */

/** Builds a same-origin iframe with a `.ilb-stage` div inside its
 *  contentDocument — the minimum StageAuthoringLayer's `measure()` needs to
 *  find a non-null (if zero-sized, under jsdom's layout-free
 *  getBoundingClientRect) stage rect and render its outlines. */
function makeStageIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  const stage = doc.createElement("div");
  stage.className = "ilb-stage";
  doc.body.appendChild(stage);
  return iframe;
}

const TARGETS: Target[] = [
  { key: "overlay:fill1", label: "fill overlay", box: { x: 10, y: 10, w: 20, h: 20 } },
  { key: "input:mass", label: "Mass", box: { x: 60, y: 70, w: 30, h: 12 } },
];

describe("StageAuthoringLayer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let iframe: HTMLIFrameElement;
  let iframeRef: RefObject<HTMLIFrameElement | null>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    iframe = makeStageIframe();
    iframeRef = { current: iframe };
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    iframe.remove();
  });

  it("renders a labeled outline per target", () => {
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef, selected: null, onSelect: () => {}, onBoxChange: () => {}, targets: TARGETS,
      }));
    });
    const outlines = container.querySelectorAll('[role="button"]');
    expect(outlines.length).toBe(2);
    const labels = Array.from(container.querySelectorAll("span")).map((s) => s.textContent);
    expect(labels).toContain("fill overlay");
    expect(labels).toContain("Mass");
  });

  it("nudges the focused outline's own box on ArrowRight and reports it via onBoxChange", () => {
    const onBoxChange = vi.fn();
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef, selected: null, onSelect: () => {}, onBoxChange, targets: TARGETS,
      }));
    });
    const outlines = container.querySelectorAll<HTMLElement>('[role="button"]');
    const massOutline = Array.from(outlines).find((el) => el.getAttribute("aria-label")?.startsWith("Mass"))!;
    act(() => {
      massOutline.focus();
      massOutline.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    expect(onBoxChange).toHaveBeenCalledWith("input:mass", { x: 61, y: 70, w: 30, h: 12 });
  });

  it("nudges by 10% when Shift is held", () => {
    const onBoxChange = vi.fn();
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef, selected: null, onSelect: () => {}, onBoxChange, targets: TARGETS,
      }));
    });
    const outlines = container.querySelectorAll<HTMLElement>('[role="button"]');
    const fillOutline = Array.from(outlines).find((el) => el.getAttribute("aria-label")?.startsWith("fill overlay"))!;
    act(() => {
      fillOutline.focus();
      fillOutline.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(onBoxChange).toHaveBeenCalledWith("overlay:fill1", { x: 10, y: 20, w: 20, h: 20 });
  });

  it("deselects on Escape", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef, selected: "input:mass", onSelect, onBoxChange: () => {}, targets: TARGETS,
      }));
    });
    const outlines = container.querySelectorAll<HTMLElement>('[role="button"]');
    const massOutline = Array.from(outlines).find((el) => el.getAttribute("aria-label")?.startsWith("Mass"))!;
    act(() => {
      massOutline.focus();
      massOutline.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("renders nothing when there is no `.ilb-stage` in the iframe (no visual configured yet)", () => {
    const bareIframe = document.createElement("iframe");
    document.body.appendChild(bareIframe);
    const bareRef: RefObject<HTMLIFrameElement | null> = { current: bareIframe };
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef: bareRef, selected: null, onSelect: () => {}, onBoxChange: () => {}, targets: TARGETS,
      }));
    });
    expect(container.querySelectorAll('[role="button"]').length).toBe(0);
    bareIframe.remove();
  });
});
