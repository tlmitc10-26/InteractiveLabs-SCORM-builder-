"use client";

// Authoring-time-only spatial layer: drag/resize/nudge overlays and
// stage-placed inputs directly on top of the live preview iframe. ZERO
// runtime engine changes — this reads the same-origin preview DOM (the
// audited engine bundle main.ts already renders) to measure the stage and,
// during a drag, to apply live inline-style feedback; it never mutates
// main.ts's own rendering logic.
//
// Math (pxToPercentBox/snapBox/nudgeBox/deltaToPercent/resizeBox) is
// exported and kept pure/DOM-free so tests/stage-authoring.test.ts can
// exercise it directly — and it's the SAME code path onMove below calls,
// not a parallel implementation the tests merely resemble.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type Box = { x: number; y: number; w: number; h: number };
export type Target = { key: string; label: string; box: Box };
type Rect = { left: number; top: number; width: number; height: number };
type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** Minimum width/height, in percent-of-stage, a box may ever report — shared
 *  by `snapBox` (rounding/clamping) and `resizeBox` (the west/north-handle
 *  anchor below), so both agree on the same floor. */
const MIN_SIZE = 2;

/* ---------- pure math (exported for tests) ---------- */

/** Converts a pixel-space box into a percent-of-stage box. `px` and `stage`
 *  must already be expressed in the SAME coordinate space (this function
 *  only does the percent conversion, never a coordinate-space translation —
 *  callers are responsible for getting both rects into the same frame, see
 *  `measure()` below). Degenerates to the zero box if the stage has no
 *  measurable size, rather than dividing by zero. */
export function pxToPercentBox(
  px: { left: number; top: number; width: number; height: number },
  stage: { left: number; top: number; width: number; height: number },
): Box {
  if (stage.width <= 0 || stage.height <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: ((px.left - stage.left) / stage.width) * 100,
    y: ((px.top - stage.top) / stage.height) * 100,
    w: (px.width / stage.width) * 100,
    h: (px.height / stage.height) * 100,
  };
}

/** Converts a pixel DELTA (e.g. a pointermove's `clientX/Y` minus the
 *  drag's start `clientX/Y`) into a percent-of-stage delta. This is the one
 *  place `onMove` below turns raw pointer pixels into percent — both the
 *  move branch and the resize branch (via `resizeBox`) consume its output,
 *  so it's the actual shipped conversion, not just a same-shaped stand-in
 *  the tests happen to also call. */
export function deltaToPercent(dxPx: number, dyPx: number, stage: { width: number; height: number }): { dxPct: number; dyPct: number } {
  if (stage.width <= 0 || stage.height <= 0) return { dxPct: 0, dyPct: 0 };
  return { dxPct: (dxPx / stage.width) * 100, dyPct: (dyPx / stage.height) * 100 };
}

/** Rounds a box to `step` percent (default 2), enforces a `MIN_SIZE`%
 *  minimum width/height, and clamps so the box always stays fully inside
 *  the 0..100 stage (position is clamped against the box's OWN — already
 *  clamped — size, so e.g. a 10%-wide box can never report x > 90). */
export function snapBox(box: Box, step = 2): Box {
  const snap = (v: number) => Math.round(v / step) * step;
  const w = Math.min(100, Math.max(MIN_SIZE, snap(box.w)));
  const h = Math.min(100, Math.max(MIN_SIZE, snap(box.h)));
  const x = Math.min(Math.max(snap(box.x), 0), 100 - w);
  const y = Math.min(Math.max(snap(box.y), 0), 100 - h);
  return { x, y, w, h };
}

/** Moves (never resizes) a box by 1% per arrow key, 10% with Shift. Clamps
 *  the UPPER bound (100 - size) before flooring at 0, so an out-of-range
 *  size (w or h > 100 — never produced by this module's own math, but not
 *  guaranteed by the type) can't force a negative x/y through a naive
 *  `Math.min(Math.max(x, 0), 100 - w)` (when `100 - w` is itself negative,
 *  that ordering would return the negative bound instead of 0). */
export function nudgeBox(box: Box, key: ArrowKey, shift: boolean): Box {
  const step = shift ? 10 : 1;
  const { w, h } = box;
  let { x, y } = box;
  if (key === "ArrowUp") y -= step;
  else if (key === "ArrowDown") y += step;
  else if (key === "ArrowLeft") x -= step;
  else if (key === "ArrowRight") x += step;
  const maxX = Math.max(0, 100 - w);
  const maxY = Math.max(0, 100 - h);
  x = Math.min(Math.max(x, 0), maxX);
  y = Math.min(Math.max(y, 0), maxY);
  return { x, y, w, h };
}

/* ---------- resize-handle geometry (exported for tests) ---------- */

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type HandleKey = typeof HANDLES[number];

const HANDLE_EDGES: Record<HandleKey, { left?: true; right?: true; top?: true; bottom?: true }> = {
  nw: { left: true, top: true }, n: { top: true }, ne: { right: true, top: true },
  e: { right: true }, se: { right: true, bottom: true }, s: { bottom: true },
  sw: { left: true, bottom: true }, w: { left: true },
};

/** Applies a drag delta (already converted to percent, via `deltaToPercent`)
 *  to a box per which edges the handle owns. West/north handles (which move
 *  the LEFT/TOP edge) anchor the OPPOSITE edge when the drag would shrink
 *  past `MIN_SIZE`: rather than letting `x`/`y` keep climbing past what a
 *  size-2 box can actually reach (which `snapBox`'s later floor would then
 *  clamp `w`/`h` back up WITHOUT correcting `x`/`y`, visibly popping the
 *  box's fixed edge sideways), this computes the pre-drag right/bottom edge
 *  and re-derives `x`/`y` from it once the floor kicks in — so the edge the
 *  handle ISN'T supposed to move never appears to jump. East/south handles
 *  need no such anchor: their opposite edge (`x`/`y`) never moves in the
 *  first place, so `snapBox`'s own floor is sufficient there. Left
 *  otherwise un-clamped; the caller always pipes the result through
 *  `snapBox` for rounding and the 0..100 stage bounds. */
export function resizeBox(start: Box, dxPct: number, dyPct: number, handle: HandleKey): Box {
  const edges = HANDLE_EDGES[handle];
  let { x, y, w, h } = start;
  if (edges.left) {
    const right = start.x + start.w;
    w = Math.max(MIN_SIZE, start.w - dxPct);
    x = right - w;
  }
  if (edges.right) {
    w = start.w + dxPct;
  }
  if (edges.top) {
    const bottom = start.y + start.h;
    h = Math.max(MIN_SIZE, start.h - dyPct);
    y = bottom - h;
  }
  if (edges.bottom) {
    h = start.h + dyPct;
  }
  return { x, y, w, h };
}

function rectsEqual(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Locates the DOM node inside the (same-origin) preview iframe whose
 *  inline style positions a given target, for authoring-time-only live
 *  style feedback during a drag. Overlay holders carry `data-overlay`
 *  directly (main.ts); stage-placed inputs carry `data-input` on their
 *  INNER control, not on the positioned `.ilb-stage-control` card, so that
 *  ancestor is reached via `closest` — both read-only lookups, no engine
 *  change. Returns null (never throws) when the preview isn't in a state
 *  where the node can be found. */
function findLiveEl(iframeEl: HTMLIFrameElement | null, key: string): HTMLElement | null {
  try {
    const doc = iframeEl?.contentDocument;
    if (!doc) return null;
    if (key.startsWith("overlay:")) {
      return doc.querySelector<HTMLElement>(`[data-overlay="${key.slice("overlay:".length)}"]`);
    }
    if (key.startsWith("input:")) {
      const inner = doc.querySelector<HTMLElement>(`[data-input="${key.slice("input:".length)}"]`);
      return inner?.closest<HTMLElement>(".ilb-stage-control") ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function applyLiveStyle(el: HTMLElement | null, box: Box) {
  if (!el) return;
  el.style.left = `${box.x}%`;
  el.style.top = `${box.y}%`;
  el.style.width = `${box.w}%`;
  el.style.height = `${box.h}%`;
}

/* ---------- component ---------- */

export function StageAuthoringLayer({ iframeRef, selected, onSelect, onBoxChange, targets }: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onBoxChange: (key: string, box: Box) => void;
  targets: Target[];
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [stageRect, setStageRect] = useState<Rect | null>(null);

  // The ResizeObserver instance lives for this component's whole lifetime
  // (created once, below) so the per-render effect can keep re-pointing it
  // at whatever `.ilb-stage` element currently exists — main.ts rebuilds
  // that element on every config repost, so its identity changes often;
  // `observedStageRef` is what lets the per-render effect notice that and
  // re-`observe()` the new node cheaply instead of tearing down and
  // recreating the observer itself every time.
  const roRef = useRef<ResizeObserver | null>(null);
  const observedStageRef = useRef<Element | null>(null);

  // stageRect = the iframe's own PADDING-BOX rect (this page's coordinate
  // frame; `iframeEl.clientLeft/clientTop` are the iframe's own border
  // widths, added so a bordered iframe doesn't shift every measurement by
  // that border) offset by the `.ilb-stage` element's own PADDING-BOX rect
  // inside the iframe's contentDocument (`stageEl.clientLeft/clientTop` are
  // ITS border widths; `clientWidth/clientHeight` are the padding-box size,
  // excluding border — main.ts's overlay/stage-control percentages resolve
  // against this same padding box, so measuring the border box instead was
  // off by exactly the stage's border width and 2x that in size) — then
  // translated into the layer's own local frame by subtracting the layer
  // div's own rect, since the outlines below are positioned with plain
  // `left`/`top` relative to it. Same-origin access can legitimately fail
  // to find `.ilb-stage` (no visual configured yet), find a zero-sized one
  // (mid-layout, e.g. before an aspect-ratio-driven stage has laid out), or
  // throw (a transient cross-document state) — any of those returns null
  // and the layer renders nothing, per the task's contract. Only ever
  // called from inside the effects below, never from this component's own
  // render body, so reading `.current` here is the sanctioned "read a ref
  // inside an effect/callback" shape, not the "read a ref during render"
  // one the hooks linter forbids.
  const measure = useCallback((): Rect | null => {
    try {
      const iframeEl = iframeRef.current;
      const layerEl = layerRef.current;
      const stageEl = iframeEl?.contentDocument?.querySelector(".ilb-stage");
      if (!iframeEl || !layerEl || !stageEl) return null;
      if (stageEl.clientWidth <= 0 || stageEl.clientHeight <= 0) return null;
      const iframeBox = iframeEl.getBoundingClientRect();
      const stageBox = stageEl.getBoundingClientRect();
      const layerBox = layerEl.getBoundingClientRect();
      return {
        left: iframeBox.left + iframeEl.clientLeft + stageBox.left + stageEl.clientLeft - layerBox.left,
        top: iframeBox.top + iframeEl.clientTop + stageBox.top + stageEl.clientTop - layerBox.top,
        width: stageEl.clientWidth,
        height: stageEl.clientHeight,
      };
    } catch {
      return null;
    }
  }, [iframeRef]);

  // Re-measures on every commit of this component — covers a preview
  // re-mount from a config change (main.ts rebuilds `.ilb-stage` on every
  // config repost, so there's no stable element identity to subscribe to
  // instead; re-running per commit sidesteps that entirely, per the task's
  // own "a simple re-measure on every render... is acceptable; keep it
  // simple and robust" note), plus any selection change. Also re-wires the
  // ResizeObserver's stage subscription (see `roRef`/`observedStageRef`
  // above) whenever the `.ilb-stage` node identity has changed since the
  // last commit — cheap (a reference-equality check most renders skip
  // past) and it means a stage that resizes ASYNCHRONOUSLY after a config
  // change (e.g. an aspect-ratio flip once a background image finishes
  // loading, in main.ts) still triggers a re-measurement even though
  // nothing about this component's own props changed in that moment.
  // Deliberately no dependency array: `measure` is stable (memoized on
  // `iframeRef`, which never changes), so listing it would collapse this to
  // running once, and the shallow-equal guard below — not a dependency
  // list — is what actually keeps a no-op measurement from cascading into
  // another render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    try {
      const iframeEl = iframeRef.current;
      const stageEl = iframeEl?.contentDocument?.querySelector(".ilb-stage") ?? null;
      const ro = roRef.current;
      if (ro && stageEl !== observedStageRef.current) {
        if (observedStageRef.current) ro.unobserve(observedStageRef.current);
        if (stageEl) ro.observe(stageEl);
        observedStageRef.current = stageEl;
      }
    } catch {
      // Same-origin access can transiently fail (e.g. mid-navigation); the
      // next commit's re-run of this same effect retries.
    }
    // Intentional direct setState in an effect body: this synchronizes with
    // a same-origin iframe's live DOM (an external system with no
    // React-visible identity to key a dependency array on), which is
    // exactly the "external store" case this rule's own guidance carves
    // out — the shallow-equal check is what prevents cascading, see above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStageRect((prev) => {
      const next = measure();
      return rectsEqual(prev, next) ? prev : next;
    });
  });

  // Layout shifts that don't themselves cause THIS component to re-render
  // (a window resize; the iframe element itself resizing; the `.ilb-stage`
  // element resizing without any prop of ours changing — e.g. its
  // aspect-ratio flipping once a background image loads) still need to
  // trigger a re-measurement. The ResizeObserver instance is created once
  // here and stashed in `roRef` so the per-render effect above can keep
  // re-pointing it at whatever `.ilb-stage` currently exists.
  useEffect(() => {
    const remeasure = () => setStageRect((prev) => {
      const next = measure();
      return rectsEqual(prev, next) ? prev : next;
    });
    window.addEventListener("resize", remeasure);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(remeasure);
      roRef.current = ro;
      const iframeEl = iframeRef.current;
      if (iframeEl) ro.observe(iframeEl);
    }
    return () => {
      window.removeEventListener("resize", remeasure);
      ro?.disconnect();
      roRef.current = null;
      observedStageRef.current = null;
    };
  }, [measure, iframeRef]);

  if (!stageRect) return <div ref={layerRef} className="pointer-events-none absolute inset-0" />;

  const toPx = (box: Box) => ({
    left: stageRect.left + (box.x / 100) * stageRect.width,
    top: stageRect.top + (box.y / 100) * stageRect.height,
    width: (box.w / 100) * stageRect.width,
    height: (box.h / 100) * stageRect.height,
  });

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0">
      {targets.map((t) => (
        <Outline key={t.key} target={t} px={toPx(t.box)} stageRect={stageRect} selected={t.key === selected}
          onSelect={onSelect} onBoxChange={onBoxChange} iframeRef={iframeRef} />
      ))}
    </div>
  );
}

type DragState = { startBox: Box; startX: number; startY: number; handle: HandleKey | "move"; raf: number | null; latest: Box };

function Outline({ target, px, stageRect, selected, onSelect, onBoxChange, iframeRef }: {
  target: Target;
  px: { left: number; top: number; width: number; height: number };
  stageRect: Rect;
  selected: boolean;
  onSelect: (key: string | null) => void;
  onBoxChange: (key: string, box: Box) => void;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  // Mutable drag state — a ref, not React state, since it's read/written at
  // pointermove frequency (far too often to setState on every tick). `raf`
  // throttles onBoxChange (and therefore the React re-render / preview
  // repost / debounced save it triggers) to at most once per animation
  // frame; the direct iframe-element style write in `applyLiveStyle` still
  // happens on every single pointermove for maximally smooth visual
  // feedback, independent of that throttle.
  const dragRef = useRef<DragState | null>(null);

  // A pending rAF must never outlive the component that scheduled it — if
  // this Outline unmounts mid-drag (its target removed from the config
  // while a pointer is still down), an unguarded callback would still fire
  // and call the (now stale-closure) `onBoxChange`.
  useEffect(() => () => {
    if (dragRef.current?.raf !== null && dragRef.current?.raf !== undefined) {
      cancelAnimationFrame(dragRef.current.raf);
    }
  }, []);

  const beginDrag = (e: React.PointerEvent, handle: HandleKey | "move") => {
    e.preventDefault();
    e.stopPropagation();
    // Not every environment implements pointer capture (jsdom notably
    // doesn't); failing to capture just means a fast drag that leaves the
    // element's bounds may stop tracking mid-gesture, a graceful
    // degradation rather than something worth crashing the handler over.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not supported here */ }
    dragRef.current = { startBox: target.box, startX: e.clientX, startY: e.clientY, handle, raf: null, latest: target.box };
    onSelect(target.key);
  };

  // pointercancel (the browser aborting a gesture — a touch scroll takes
  // over, an OS-level interruption, devtools, etc.) is NOT a commit: unlike
  // `endDrag`, this must NOT call `onBoxChange` with whatever `latest` box
  // happened to be mid-gesture. It only tears down the drag state, so a
  // subsequent buttonless pointermove (the repro this fixes) sees
  // `dragRef.current === null` and no-ops instead of resuming the drag.
  const cancelDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.raf !== null) cancelAnimationFrame(drag.raf);
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released, or unsupported */ }
  };

  const onMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Belt-and-suspenders for the pointercancel fix above: a real
    // pointercancel always reaches `cancelDrag` first and clears `dragRef`,
    // but some platforms are known to occasionally drop it (e.g. certain
    // touch/stylus interruptions) — a move that reports no buttons held is
    // never a legitimate continuation of a drag, so treat it as an
    // implicit cancel rather than letting a stray buttonless hover keep
    // dragging.
    if (e.buttons === 0) { cancelDrag(e); return; }
    const { dxPct, dyPct } = deltaToPercent(e.clientX - drag.startX, e.clientY - drag.startY, stageRect);
    const raw = drag.handle === "move"
      ? { ...drag.startBox, x: drag.startBox.x + dxPct, y: drag.startBox.y + dyPct }
      : resizeBox(drag.startBox, dxPct, dyPct, drag.handle);
    const snapped = snapBox(raw);
    drag.latest = snapped;
    applyLiveStyle(findLiveEl(iframeRef.current, target.key), snapped);
    if (drag.raf === null) {
      drag.raf = requestAnimationFrame(() => {
        if (dragRef.current) {
          onBoxChange(target.key, dragRef.current.latest);
          dragRef.current.raf = null;
        }
      });
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.raf !== null) cancelAnimationFrame(drag.raf);
    dragRef.current = null;
    onBoxChange(target.key, drag.latest); // final commit through normal config state, even if the rAF above hadn't fired yet
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released, or unsupported */ }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onSelect(null); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onBoxChange(target.key, nudgeBox(target.box, e.key, e.shiftKey));
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${target.label}, position ${target.box.x},${target.box.y}, size ${target.box.w} by ${target.box.h} percent — arrow keys to move, Shift for larger steps`}
      className="ilb-authoring-outline pointer-events-auto absolute box-border"
      style={{
        left: px.left, top: px.top, width: px.width, height: px.height,
        // Selected state is shown via the resize handles plus a dashed
        // border (rather than an inline `outline`, which — being higher
        // specificity than any stylesheet rule — used to permanently
        // suppress the CSS `:focus-visible` ring below whenever a target
        // was selected).
        border: selected ? "2px dashed var(--rds-info)" : "2px solid var(--rds-info)",
        touchAction: "none",
      }}
      onFocus={() => onSelect(target.key)}
      onClick={() => onSelect(target.key)}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => { if (selected) beginDrag(e, "move"); else onSelect(target.key); }}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
    >
      <span
        className="pointer-events-none absolute left-0 -top-5 whitespace-nowrap rounded px-1 text-[10px] text-white"
        style={{ background: "var(--rds-info)" }}
      >
        {target.label}
      </span>
      {selected && HANDLES.map((h) => (
        <Handle key={h} handle={h}
          onDown={(e) => beginDrag(e, h)}
          // stopPropagation: pointer capture routes subsequent moves to
          // whichever element called setPointerCapture (this Handle), but
          // without this the event still BUBBLES from the Handle up through
          // the outline's own onPointerMove listener, running `onMove`
          // (the same function) a second, redundant time per event.
          onMove={(e) => { e.stopPropagation(); onMove(e); }}
          onUp={endDrag}
          onCancel={cancelDrag}
        />
      ))}
    </div>
  );
}

const HANDLE_POSITION: Record<HandleKey, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
};

/** 24x24px hit area (the WCAG 2.2 §2.5.8 target-size floor this whole
 *  design-system pass already holds the runtime to — applied here to the
 *  authoring tool itself for the same reason). */
function Handle({ handle, onDown, onMove, onUp, onCancel }: {
  handle: HandleKey;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
  onCancel: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-auto absolute h-6 w-6 rounded-full border-2 border-white ${HANDLE_POSITION[handle]}`}
      style={{ background: "var(--rds-info)", touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    />
  );
}
