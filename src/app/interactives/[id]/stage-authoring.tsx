"use client";

// Authoring-time-only spatial layer: drag/resize/nudge overlays and
// stage-placed inputs directly on top of the live preview iframe. ZERO
// runtime engine changes — this reads the same-origin preview DOM (the
// audited engine bundle main.ts already renders) to measure the stage and,
// during a drag, to apply live inline-style feedback; it never mutates
// main.ts's own rendering logic.
//
// Math (pxToPercentBox/snapBox/nudgeBox) is exported and kept pure/DOM-free
// so tests/stage-authoring.test.ts can exercise it directly.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type Box = { x: number; y: number; w: number; h: number };
export type Target = { key: string; label: string; box: Box };
type Rect = { left: number; top: number; width: number; height: number };
type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

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

/** Rounds a box to `step` percent (default 2), enforces a 2% minimum
 *  width/height, and clamps so the box always stays fully inside the
 *  0..100 stage (position is clamped against the box's OWN — already
 *  clamped — size, so e.g. a 10%-wide box can never report x > 90). */
export function snapBox(box: Box, step = 2): Box {
  const snap = (v: number) => Math.round(v / step) * step;
  const w = Math.min(100, Math.max(2, snap(box.w)));
  const h = Math.min(100, Math.max(2, snap(box.h)));
  const x = Math.min(Math.max(snap(box.x), 0), 100 - w);
  const y = Math.min(Math.max(snap(box.y), 0), 100 - h);
  return { x, y, w, h };
}

/** Moves (never resizes) a box by 1% per arrow key, 10% with Shift,
 *  clamping position so the box stays fully inside 0..100. */
export function nudgeBox(box: Box, key: ArrowKey, shift: boolean): Box {
  const step = shift ? 10 : 1;
  const { w, h } = box;
  let { x, y } = box;
  if (key === "ArrowUp") y -= step;
  else if (key === "ArrowDown") y += step;
  else if (key === "ArrowLeft") x -= step;
  else if (key === "ArrowRight") x += step;
  x = Math.min(Math.max(x, 0), 100 - w);
  y = Math.min(Math.max(y, 0), 100 - h);
  return { x, y, w, h };
}

/* ---------- resize-handle geometry (internal) ---------- */

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type HandleKey = typeof HANDLES[number];

const HANDLE_EDGES: Record<HandleKey, { left?: true; right?: true; top?: true; bottom?: true }> = {
  nw: { left: true, top: true }, n: { top: true }, ne: { right: true, top: true },
  e: { right: true }, se: { right: true, bottom: true }, s: { bottom: true },
  sw: { left: true, bottom: true }, w: { left: true },
};

/** Applies a drag delta (already converted to percent) to a box per which
 *  edges the handle owns — e.g. the "w" handle moves x and shrinks w by the
 *  same amount, "se" grows w and h. Left un-clamped; the caller always
 *  pipes the result through `snapBox`. */
function resizeBox(start: Box, dxPct: number, dyPct: number, handle: HandleKey): Box {
  const edges = HANDLE_EDGES[handle];
  let { x, y, w, h } = start;
  if (edges.left) { x = start.x + dxPct; w = start.w - dxPct; }
  if (edges.right) { w = start.w + dxPct; }
  if (edges.top) { y = start.y + dyPct; h = start.h - dyPct; }
  if (edges.bottom) { h = start.h + dyPct; }
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

  // stageRect = the iframe's own rect (this page's coordinate frame) offset
  // by the `.ilb-stage` element's rect inside the iframe's contentDocument
  // (that element's coordinate frame is the iframe's OWN viewport, so this
  // sum lands in this page's frame too) — then translated into the layer's
  // own local frame by subtracting the layer div's own rect, since the
  // outlines below are positioned with plain `left`/`top` relative to it.
  // Same-origin access can legitimately fail to find `.ilb-stage` (no
  // visual configured yet) or throw (a transient cross-document state) —
  // either way this returns null and the layer renders nothing, per the
  // task's contract. Only ever called from inside the effects below, never
  // from this component's own render body, so reading `.current` here is
  // the sanctioned "read a ref inside an effect/callback" shape, not the
  // "read a ref during render" one the hooks linter forbids.
  const measure = useCallback((): Rect | null => {
    try {
      const iframeEl = iframeRef.current;
      const layerEl = layerRef.current;
      const stageEl = iframeEl?.contentDocument?.querySelector(".ilb-stage");
      if (!iframeEl || !layerEl || !stageEl) return null;
      const iframeBox = iframeEl.getBoundingClientRect();
      const stageBox = stageEl.getBoundingClientRect();
      const layerBox = layerEl.getBoundingClientRect();
      return {
        left: iframeBox.left + stageBox.left - layerBox.left,
        top: iframeBox.top + stageBox.top - layerBox.top,
        width: stageBox.width,
        height: stageBox.height,
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
  // simple and robust" note), plus any selection change. Deliberately no
  // dependency array: `measure` is stable (memoized on `iframeRef`, which
  // never changes), so listing it would collapse this to running once, and
  // the shallow-equal guard below — not a dependency list — is what
  // actually keeps a no-op measurement from cascading into another render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
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
  // (a window resize; the iframe element resizing without any prop of ours
  // changing) still need to trigger a re-measurement.
  useEffect(() => {
    const remeasure = () => setStageRect((prev) => {
      const next = measure();
      return rectsEqual(prev, next) ? prev : next;
    });
    window.addEventListener("resize", remeasure);
    const iframeEl = iframeRef.current;
    let ro: ResizeObserver | undefined;
    if (iframeEl && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(remeasure);
      ro.observe(iframeEl);
    }
    return () => {
      window.removeEventListener("resize", remeasure);
      ro?.disconnect();
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

  const beginDrag = (e: React.PointerEvent, handle: HandleKey | "move") => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startBox: target.box, startX: e.clientX, startY: e.clientY, handle, raf: null, latest: target.box };
    onSelect(target.key);
  };

  const onMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPct = ((e.clientX - drag.startX) / stageRect.width) * 100;
    const dyPct = ((e.clientY - drag.startY) / stageRect.height) * 100;
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
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
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
      className="pointer-events-auto absolute box-border"
      style={{
        left: px.left, top: px.top, width: px.width, height: px.height,
        border: `2px solid var(--rds-info)`,
        outline: selected ? "1px solid #fff" : undefined,
        outlineOffset: selected ? "-3px" : undefined,
      }}
      onFocus={() => onSelect(target.key)}
      onClick={() => onSelect(target.key)}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => { if (selected) beginDrag(e, "move"); else onSelect(target.key); }}
      onPointerMove={onMove}
      onPointerUp={endDrag}
    >
      <span
        className="pointer-events-none absolute left-0 -top-5 whitespace-nowrap rounded px-1 text-[10px] text-white"
        style={{ background: "var(--rds-info)" }}
      >
        {target.label}
      </span>
      {selected && HANDLES.map((h) => (
        <Handle key={h} handle={h} onDown={(e) => beginDrag(e, h)} onMove={onMove} onUp={endDrag} />
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
function Handle({ handle, onDown, onMove, onUp }: {
  handle: HandleKey;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-auto absolute h-6 w-6 rounded-full border-2 border-white ${HANDLE_POSITION[handle]}`}
      style={{ background: "var(--rds-info)" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  );
}
