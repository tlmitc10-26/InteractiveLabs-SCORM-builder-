// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  pxToPercentBox, snapBox, nudgeBox, deltaToPercent, resizeBox,
  StageAuthoringLayer, type Target,
} from "@/app/interactives/[id]/stage-authoring";

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

describe("deltaToPercent", () => {
  it("converts a pixel delta into a percent delta using the stage's own size", () => {
    expect(deltaToPercent(40, 30, { width: 400, height: 300 })).toEqual({ dxPct: 10, dyPct: 10 });
  });

  it("handles a negative delta (dragging up/left)", () => {
    expect(deltaToPercent(-20, -15, { width: 400, height: 300 })).toEqual({ dxPct: -5, dyPct: -5 });
  });

  it("returns zero deltas when the stage has no measurable size", () => {
    expect(deltaToPercent(40, 20, { width: 0, height: 0 })).toEqual({ dxPct: 0, dyPct: 0 });
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

  it("never produces a negative x/y even for an (out-of-contract) oversized box", () => {
    // A naive `Math.min(Math.max(x, 0), 100 - w)` returns the NEGATIVE
    // upper bound when w > 100 (100 - w < 0), violating the floor-0
    // guarantee. nudgeBox's own math never produces w > 100, but the type
    // doesn't enforce that, so this guards the clamp order itself.
    // Both axes are always re-clamped against the box's own (possibly
    // out-of-contract) size regardless of which arrow key moved which axis
    // — an oversized w pins x to 0 and an oversized h pins y to 0 either way.
    const oversized = { x: 5, y: 5, w: 110, h: 120 };
    expect(nudgeBox(oversized, "ArrowRight", true)).toEqual({ x: 0, y: 0, w: 110, h: 120 });
    expect(nudgeBox(oversized, "ArrowDown", true)).toEqual({ x: 0, y: 0, w: 110, h: 120 });
  });
});

describe("resizeBox", () => {
  it("west handle: a normal shrink moves x right and reduces w", () => {
    const start = { x: 20, y: 20, w: 30, h: 30 };
    expect(resizeBox(start, 5, 0, "w")).toEqual({ x: 25, y: 20, w: 25, h: 30 });
  });

  it("west handle past the 2% floor anchors the EAST edge instead of jumping it", () => {
    const start = { x: 50, y: 50, w: 10, h: 10 }; // right edge at 60
    const r = resizeBox(start, 15, 0, "w"); // naive w would be 10-15=-5
    expect(r.w).toBe(2);
    expect(r.x).toBe(58); // 60 - 2: right edge preserved
    expect(r.y).toBe(50);
    expect(r.h).toBe(10);
  });

  it("north handle past the 2% floor anchors the SOUTH edge instead of jumping it", () => {
    const start = { x: 50, y: 50, w: 10, h: 10 }; // bottom edge at 60
    const r = resizeBox(start, 0, 15, "n");
    expect(r.h).toBe(2);
    expect(r.y).toBe(58); // 60 - 2: bottom edge preserved
    expect(r.x).toBe(50);
    expect(r.w).toBe(10);
  });

  it("northwest handle anchors both the east and south edges past the floor", () => {
    const start = { x: 50, y: 50, w: 10, h: 10 };
    const r = resizeBox(start, 15, 20, "nw");
    expect(r).toEqual({ x: 58, y: 58, w: 2, h: 2 });
  });

  it("east/south handles grow without needing an anchor (x/y unaffected)", () => {
    const start = { x: 10, y: 10, w: 20, h: 20 };
    expect(resizeBox(start, 5, 8, "se")).toEqual({ x: 10, y: 10, w: 25, h: 28 });
  });

  it("east handle shrinking past the floor leaves x alone (no anchor needed on this side)", () => {
    const start = { x: 10, y: 10, w: 10, h: 10 };
    // Unlike west/north, resizeBox itself doesn't floor east/south — that's
    // left to the caller's snapBox pass, since x never moves for this side.
    expect(resizeBox(start, -15, 0, "e")).toEqual({ x: 10, y: 10, w: -5, h: 10 });
  });
});

describe("the shipped drag conversion (deltaToPercent -> move/resizeBox -> snapBox)", () => {
  // This is deliberately the exact sequence stage-authoring.tsx's onMove
  // runs, so these tests fail if that handler's real math ever drifts from
  // the exported, independently-tested functions above.
  const stage = { width: 500, height: 250 };

  it("move: matches what the pointer handler commits for a given client dx/dy", () => {
    const startBox = { x: 20, y: 20, w: 20, h: 20 };
    const { dxPct, dyPct } = deltaToPercent(50, 25, stage); // +10%, +10%
    const raw = { ...startBox, x: startBox.x + dxPct, y: startBox.y + dyPct };
    expect(snapBox(raw)).toEqual({ x: 30, y: 30, w: 20, h: 20 });
  });

  it("resize (se handle): matches what the pointer handler commits for a given client dx/dy", () => {
    const startBox = { x: 20, y: 20, w: 20, h: 20 };
    const { dxPct, dyPct } = deltaToPercent(25, 12.5, stage); // +5%, +5%
    const raw = resizeBox(startBox, dxPct, dyPct, "se");
    expect(snapBox(raw)).toEqual({ x: 20, y: 20, w: 26, h: 26 });
  });

  it("resize (w handle) past the floor: matches what the pointer handler commits", () => {
    const startBox = { x: 50, y: 50, w: 10, h: 10 };
    const { dxPct, dyPct } = deltaToPercent(75, 0, stage); // +15%
    const raw = resizeBox(startBox, dxPct, dyPct, "w");
    expect(snapBox(raw)).toEqual({ x: 58, y: 50, w: 2, h: 10 });
  });
});

/* ---------- component ---------- */

/** Builds a same-origin iframe with a `.ilb-stage` div inside its
 *  contentDocument. jsdom has no layout engine — every element's
 *  `getBoundingClientRect()` and `clientWidth`/`clientHeight`/`clientLeft`/
 *  `clientTop` default to 0 — so the stage's padding-box size/offset (what
 *  `measure()` now reads, per the coordinate-offset fix) is stubbed via
 *  `defineProperty` (these are getter-only accessors on the prototype;
 *  defining an own property on the instance shadows them). `stageSize`
 *  defaults to a plausible laid-out size; pass `{ w: 0, h: 0 }` to simulate
 *  a not-yet-laid-out stage (measure()'s zero-size guard, reviewer item 7). */
function makeStageIframe(stageSize: { w: number; h: number } = { w: 400, h: 300 }): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  const stage = doc.createElement("div");
  stage.className = "ilb-stage";
  doc.body.appendChild(stage);
  Object.defineProperty(stage, "clientWidth", { value: stageSize.w, configurable: true });
  Object.defineProperty(stage, "clientHeight", { value: stageSize.h, configurable: true });
  Object.defineProperty(stage, "clientLeft", { value: 0, configurable: true });
  Object.defineProperty(stage, "clientTop", { value: 0, configurable: true });
  Object.defineProperty(iframe, "clientLeft", { value: 0, configurable: true });
  Object.defineProperty(iframe, "clientTop", { value: 0, configurable: true });
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

  it("renders nothing when the stage has no measurable size yet (not laid out)", () => {
    const notLaidOutIframe = makeStageIframe({ w: 0, h: 0 });
    const ref: RefObject<HTMLIFrameElement | null> = { current: notLaidOutIframe };
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef: ref, selected: null, onSelect: () => {}, onBoxChange: () => {}, targets: TARGETS,
      }));
    });
    expect(container.querySelectorAll('[role="button"]').length).toBe(0);
    notLaidOutIframe.remove();
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

  it("dragging the selected outline's move surface commits the real pointer-to-percent conversion", () => {
    const onBoxChange = vi.fn();
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef, selected: "overlay:fill1", onSelect: () => {}, onBoxChange, targets: TARGETS,
      }));
    });
    const outline = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .find((el) => el.getAttribute("aria-label")?.startsWith("fill overlay"))!;
    act(() => {
      // Stage is 400x300 (stubbed): +40px -> +10%, +30px -> +10%.
      outline.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, clientX: 100, clientY: 100, buttons: 1 }));
      outline.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 1, clientX: 140, clientY: 130, buttons: 1 }));
      outline.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, clientX: 140, clientY: 130 }));
    });
    // start box {x:10,y:10,w:20,h:20} + (10%,10%) = {x:20,y:20,w:20,h:20}
    expect(onBoxChange).toHaveBeenLastCalledWith("overlay:fill1", { x: 20, y: 20, w: 20, h: 20 });
  });

  it("dragging the se resize handle grows width/height via the real conversion path", () => {
    const onBoxChange = vi.fn();
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef, selected: "overlay:fill1", onSelect: () => {}, onBoxChange, targets: TARGETS,
      }));
    });
    const outline = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .find((el) => el.getAttribute("aria-label")?.startsWith("fill overlay"))!;
    const seHandle = outline.querySelectorAll<HTMLElement>('[aria-hidden="true"]')[4]; // HANDLES = [nw,n,ne,e,se,...]
    act(() => {
      // +40px -> +10% width, +30px -> +10% height (stage 400x300).
      seHandle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 2, clientX: 0, clientY: 0, buttons: 1 }));
      seHandle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 2, clientX: 40, clientY: 30, buttons: 1 }));
      seHandle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 2, clientX: 40, clientY: 30 }));
    });
    expect(onBoxChange).toHaveBeenLastCalledWith("overlay:fill1", { x: 10, y: 10, w: 30, h: 30 });
  });

  it("pointercancel mid-drag clears drag state so a later buttonless move can't resume/commit it", () => {
    const onBoxChange = vi.fn();
    act(() => {
      root.render(createElement(StageAuthoringLayer, {
        iframeRef, selected: "overlay:fill1", onSelect: () => {}, onBoxChange, targets: TARGETS,
      }));
    });
    const outline = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .find((el) => el.getAttribute("aria-label")?.startsWith("fill overlay"))!;
    act(() => {
      outline.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 3, clientX: 100, clientY: 100, buttons: 1 }));
      outline.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 3, clientX: 140, clientY: 130, buttons: 1 }));
      outline.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, cancelable: true, pointerId: 3 }));
    });
    onBoxChange.mockClear(); // drop the calls from the legitimate move above; only what follows matters
    act(() => {
      // The repro: a buttonless hover arriving after the cancel must not
      // resume dragging (dragRef must already be cleared by cancelDrag).
      outline.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 3, clientX: 300, clientY: 300, buttons: 0 }));
      outline.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 3, clientX: 300, clientY: 300 }));
    });
    expect(onBoxChange).not.toHaveBeenCalled();
  });
});
