import { parseFormula, type AstNode } from "@/lib/formula/parser";
import { evaluateFormula } from "@/lib/formula/evaluate";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { chartLayout, CHART_FONT_PX } from "./chart-layout";

type Overlay = NonNullable<RuntimeSandboxConfig["visual"]>["overlays"][number];
type SuspendPayload = { values?: Record<string, number>; best?: number; completed?: boolean };

/** Defect fix: a background image was once a 24x24 placeholder, and with
 *  `.ilb-stage`'s aspect-ratio matched to it 1:1, a "stage-focus"/full-width
 *  column blew that square up to fill the whole page width -- a giant flat
 *  rectangle, since nothing capped how tall the stage could grow. This is
 *  the CSS-pixel height ceiling no stage may exceed regardless of the
 *  background image's own dimensions. */
export const STAGE_MAX_HEIGHT_PX = 480;

/** Pure sizing math for the stage's background-image `load` handler, split
 *  out so it's unit-testable without a real <img>/layout. Returns the CSS
 *  `aspect-ratio` to match the image (so overlay percent boxes stay exactly
 *  coincident with the image's own box -- unaffected by `maxWidth`, since
 *  both dimensions scale together), plus an optional `maxWidth` that caps
 *  the stage's rendered width so its aspect-ratio-derived height can never
 *  exceed `capPx`.
 *
 *  A landscape image (wider than tall) is left uncapped: its height already
 *  grows slower than its width, so within the page's own overall width
 *  constraints it's in no danger of the runaway growth this fix targets.
 *  A square or portrait image (height >= width) is exactly the risky shape
 *  -- at ANY rendered width >= capPx its height would be >= that width,
 *  i.e. already at or past the cap -- so it gets a maxWidth: the width at
 *  which its aspect-ratio-derived height lands exactly on capPx. */
export function stageDimensions(
  naturalW: number,
  naturalH: number,
  capPx: number = STAGE_MAX_HEIGHT_PX,
): { aspectRatio: string; maxWidth?: string } {
  // Degenerate (zero/negative/non-finite) dimensions: nothing sane to ratio
  // against, so fall back to a neutral 1:1 box rather than emitting NaN or
  // Infinity into a style property.
  if (!(naturalW > 0) || !(naturalH > 0)) {
    return { aspectRatio: "1 / 1" };
  }
  const aspectRatio = `${naturalW} / ${naturalH}`;
  if (naturalH >= naturalW) {
    const maxWidth = `${Math.round((capPx * naturalW) / naturalH)}px`;
    return { aspectRatio, maxWidth };
  }
  return { aspectRatio };
}

// Preloaded swap-band image URLs, shared across mounts in this document
// (e.g. repeated remounts in an editor preview) so the same band image is
// never re-fetched/re-preloaded more than once.
const preloadedBandUrls = new Set<string>();

// Canvas 2D drawing cannot resolve CSS custom properties, so chart colors
// are hardcoded hex here rather than read from var(--rds-*). These mirror
// the token palette (src/lib/design/tokens.json) directly:
//   line     -> --rds-primary  (#8c1d40)
//   marker   -> --rds-dark-1   (#747474; 4.6:1 on white, replaces the old
//                #B8860B marker which read too light against #fff8e1/white)
//   axisText -> --rds-dark-2   (#484848)
//   frame    -> --rds-light-5  (#bfbfbf)
const ILB_CHART_COLORS = {
  line: "#8c1d40",
  marker: "#747474",
  axisText: "#484848",
  frame: "#bfbfbf",
} as const;

/** Placement model (schema.ts's `placementSchema`): where an input/output
 *  renders. Absence of `placement` means "panel" — the only behavior that
 *  existed before this feature, so every pre-existing config renders
 *  identically. */
type Placement = NonNullable<RuntimeSandboxConfig["inputs"][number]["placement"]>;

function zoneOf(placement: Placement | undefined): "panel" | "below" | "stage" {
  return placement?.zone ?? "panel";
}

/** The stage box for a "stage" zone placement, or null for any other zone
 *  (including absent placement). */
function stageBoxOf(placement: Placement | undefined): { x: number; y: number; w: number; h: number } | null {
  return placement && placement.zone === "stage" ? placement.box : null;
}

type ZoneKind = "inputs" | "outputs" | "below" | "stage" | "charts";

/** Per-preset DOM append order for `.ilb-layout`'s zone containers — this
 *  IS the tab order, and must match wherever engine.css visually places
 *  each zone for that preset (grid-column placement only; engine.css must
 *  never apply a CSS `order` that contradicts this). A zone absent from a
 *  config (nothing routed to it, or no charts) is simply skipped when
 *  assembling, regardless of its position here. */
const LAYOUT_ZONE_ORDER: Record<NonNullable<RuntimeSandboxConfig["layout"]>, ZoneKind[]> = {
  // Side (default): inputs | stage | outputs sit in one row, then the
  // below-zone panel spans full width beneath, then charts.
  side: ["inputs", "stage", "outputs", "below", "charts"],
  // Stacked: single column, stage first, then inputs, then below, then
  // outputs, then charts.
  stacked: ["stage", "inputs", "below", "outputs", "charts"],
  // Stage-focus: stage first (full width), then inputs+outputs share a row,
  // then below, then charts.
  "stage-focus": ["stage", "inputs", "outputs", "below", "charts"],
};

/** Mount the Parameter Sandbox. Labels/units via textContent (never innerHTML);
 *  only `intro` may contain markup and it arrives pre-sanitized from the builder. */
export function mountSandbox(root: HTMLElement, config: RuntimeSandboxConfig): void {
  root.innerHTML = "";
  root.classList.add("ilb-sandbox");
  // The sandbox is the entire content of its host page (an iframe SCO with
  // no other page furniture — see buildIndexHtml), so it IS that page's main
  // landmark; without this, axe's "region" rule correctly flags every node
  // here as unlandmarked content (nothing else on the page could contain
  // it). role="main" instead of a bare <main> tag because `root` is caller-
  // supplied (could be any element, including one already `<main>`).
  root.setAttribute("role", "main");

  // Unique per-mount id prefix so <label for> associations never collide if
  // more than one sandbox instance is mounted in the same document.
  const mountId = `ilb-${Math.random().toString(36).slice(2, 9)}`;

  const asts = new Map<string, AstNode>();
  for (const out of config.outputs) {
    const r = parseFormula(out.formula);
    if (r.ok) asts.set(out.id, r.ast);
  }

  const values: Record<string, number> = {};
  for (const inp of config.inputs) values[inp.id] = inp.defaultValue;

  let interacted = false;
  let bestPct = 0;
  let reportedComplete = false;
  let scoreReported = false;
  let warnedSuspendLimit = false;
  const scorm = typeof window !== "undefined" ? window.ILBScorm : undefined;

  // Resume: restore saved input values from SCORM suspend data (spec 6).
  // Hygiene: only accept finite numbers; clamp into range for slider/number;
  // fall back to defaultValue for a select whose stored value matches no
  // option; coerce toggles to 0/1. interacted is set only if something
  // actually applied (otherwise a "resume" with nothing to restore would
  // wrongly start reporting scores for a learner who hasn't touched anything).
  //
  // Note: suspend payloads saved by builds before commit 1553af4 predate the
  // `best`/`completed` fields, so a resume from one of those will silently
  // skip the score/completion re-assert below (bestPct stays 0). Acceptable
  // today because no packages built on those earlier engine versions have
  // shipped; if that ever changes, the fallback would be to read the
  // learner's existing score/completion directly from the LMS's own
  // cmi.core.score.raw / cmi.core.lesson_status instead of suspend_data.
  const saved = scorm?.loadSuspendData<SuspendPayload>();
  if (saved) {
    if (saved.values) {
      for (const inp of config.inputs) {
        const raw = saved.values[inp.id];
        if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
        let v = raw;
        if (inp.type === "slider" || inp.type === "number") {
          if (inp.min !== undefined) v = Math.max(inp.min, v);
          if (inp.max !== undefined) v = Math.min(inp.max, v);
        } else if (inp.type === "select") {
          const valid = (inp.options ?? []).some((o) => o.value === v);
          if (!valid) v = inp.defaultValue;
        } else if (inp.type === "toggle") {
          v = v ? 1 : 0;
        }
        values[inp.id] = v;
        interacted = true;
      }
    }
    if (typeof saved.best === "number" && Number.isFinite(saved.best)) {
      bestPct = Math.max(0, Math.min(100, saved.best));
    }
    if (saved.completed) reportedComplete = true;
  }

  // A previously-reported score/completion must never appear "downgraded" or
  // "forgotten" on resume, even before the learner interacts again: re-assert
  // the score whenever there's a nonzero high-water mark OR the attempt was
  // already completed (a completed attempt can have bestPct 0 in principle,
  // e.g. a zero-challenge sandbox never wired that path — belt and braces).
  // Re-assert completion only when it was actually recorded as completed.
  if (scorm && scorm.mode === "scorm") {
    if (bestPct > 0 || reportedComplete) {
      scorm.setScore(bestPct);
      scoreReported = true;
    }
    if (reportedComplete) {
      scorm.setCompleted();
    }
  }

  // ---------- header ----------
  const header = el("div", "ilb-header");
  const h2 = el("h2", "ilb-title"); h2.textContent = config.title; header.appendChild(h2);
  if (config.intro) {
    const intro = el("div", "ilb-intro");
    intro.innerHTML = config.intro; // sanitized at authoring + revalidated at export
    header.appendChild(intro);
  }
  root.appendChild(header);

  const layout = el("div", "ilb-layout");
  root.appendChild(layout);
  layout.classList.add(`ilb-layout-${config.layout ?? "side"}`);

  // FOCUS-ORDER INVARIANT (WCAG 1.3.2/2.4.3, technique C27): DOM and tab
  // order follow the preset's visual reading order; within a zone,
  // authoring order. The zone containers themselves are always the same
  // five nodes -- .ilb-inputs, .ilb-outputs (or its .ilb-outputs-live
  // stand-in, see below), .ilb-below-panel, .ilb-stage, .ilb-charts, each
  // omitted when it has nothing to show -- but the ORDER they're appended
  // to `.ilb-layout` in is chosen per `config.layout` (see LAYOUT_ZONE_ORDER
  // below) to match wherever engine.css visually places that preset's
  // zones. engine.css therefore places zones purely via `grid-column`
  // (which column/row span), never via a CSS `order` that would let the
  // visual position diverge from DOM/tab order again.
  //   .ilb-inputs       - panel-zone inputs, in authoring order
  //   .ilb-outputs      - panel-zone outputs, in authoring order. The
  //      sr-only live-region summary (see `outputsSummary` below) normally
  //      lives inside this container, but it must survive even when the
  //      container itself is omitted — in that case it's appended to a
  //      minimal `.ilb-outputs-live` wrapper (no card styling) in this same
  //      slot instead, so the container being empty of VISIBLE outputs
  //      never silences the live region.
  //   .ilb-below-panel  - below-zone inputs then below-zone outputs, in
  //      authoring order
  //   .ilb-stage        - background image/overlays first, then
  //      .ilb-stage-controls (stage-zone inputs then stage-zone outputs,
  //      in authoring order) appended LAST, so a stage-zone control is
  //      always a later sibling of the stage's own image/overlay nodes
  //   .ilb-charts       - omitted when there are no charts
  // The (sr-only, non-focusable) live region never participates in tab
  // order either way, so omitting/relocating its container never affects
  // reading order.
  const allElements = [...config.inputs, ...config.outputs];
  const anyStageZone = allElements.some((e) => zoneOf(e.placement) === "stage");
  const hasBelowZone = allElements.some((e) => zoneOf(e.placement) === "below");
  const needsStage = !!config.visual && (!!config.visual.backgroundUrl || config.visual.overlays.length > 0 || anyStageZone);

  const inputsPanel = el("div", "ilb-inputs");
  const outputsPanel = el("div", "ilb-outputs");
  const belowPanel = el("div", "ilb-below-panel");
  let stage: HTMLElement | null = null;
  let stageControls: HTMLElement | null = null;
  if (needsStage) {
    stage = el("div", "ilb-stage");
    stageControls = el("div", "ilb-stage-controls");
  }

  // ---------- inputs ----------
  for (const inp of config.inputs) {
    const inputId = `${mountId}-${inp.id}`;
    const row = el("div", "ilb-input-row");
    const lab = document.createElement("label");
    lab.className = "ilb-input-label";
    lab.htmlFor = inputId;
    lab.textContent = inp.units ? `${inp.label} (${inp.units})` : inp.label;
    row.appendChild(lab);

    let control: HTMLElement;
    if (inp.type === "select") {
      const sel = document.createElement("select");
      sel.id = inputId;
      sel.dataset.input = inp.id;
      for (const opt of inp.options ?? []) {
        const o = document.createElement("option");
        o.value = String(opt.value); o.textContent = opt.label;
        if (opt.value === values[inp.id]) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => { values[inp.id] = Number(sel.value); onInteract(); });
      control = sel;
    } else if (inp.type === "toggle") {
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.id = inputId; cb.dataset.input = inp.id; cb.checked = values[inp.id] !== 0;
      cb.addEventListener("change", () => { values[inp.id] = cb.checked ? 1 : 0; onInteract(); });
      control = cb;
    } else if (inp.type === "slider") {
      // 2.5.7 (WCAG 2.2): every slider gets a paired, visible number input
      // so a learner who cannot perform a drag gesture can type an exact
      // value. This number field IS the readout — it replaces the old
      // read-only ".ilb-input-value" text badge.
      const range = document.createElement("input");
      range.type = "range";
      range.id = inputId;
      range.dataset.input = inp.id;
      range.min = String(inp.min ?? 0); range.max = String(inp.max ?? 100);
      range.step = String(inp.step ?? "any"); range.value = String(values[inp.id]);

      const num = document.createElement("input");
      num.type = "number";
      num.id = `${inputId}-value`; // own mount-unique id, distinct from the range's
      num.className = "ilb-input-number";
      num.dataset.input = inp.id; // same logical control as the range, distinguished by [type]
      num.min = range.min; num.max = range.max; num.step = range.step;
      num.value = range.value;
      num.setAttribute("aria-label", `${inp.label}, exact value`);

      // The range always carries a browser-sanitized, complete value (never
      // a mid-edit string), so its input handler may freely mirror straight
      // into the number field's text.
      range.addEventListener("input", () => {
        const v = Number(range.value);
        if (!Number.isFinite(v)) return;
        values[inp.id] = v;
        num.value = range.value;
        onInteract();
      });
      // The number field, by contrast, can be mid-keystroke ("07", "3.50",
      // a trailing "-" or "."): accept a finite value into the model and
      // mirror it to the range, but never rewrite the number field's own
      // text here — doing so would snap "07" -> "7" or "3.50" -> "3.5" out
      // from under the learner's cursor on every keystroke. Ignore an
      // empty/non-finite intermediate state rather than writing 0 into the
      // model, matching the plain "number" type's handling below.
      num.addEventListener("input", () => {
        if (num.value === "") return;
        const v = Number(num.value);
        if (!Number.isFinite(v)) return;
        values[inp.id] = v;
        range.value = String(v);
        onInteract();
      });
      // Only on blur/Enter do we clamp into [min, max] AND normalize the
      // number field's displayed text (e.g. "3.50" -> "3.5", out-of-range
      // -> the bound) — this is the one point where rewriting the field is
      // safe, since the learner is done typing.
      const commitClamp = (): void => {
        if (num.value === "") return;
        const raw = Number(num.value);
        if (!Number.isFinite(raw)) return;
        let v = raw;
        if (inp.min !== undefined) v = Math.max(inp.min, v);
        if (inp.max !== undefined) v = Math.min(inp.max, v);
        if (v !== raw || String(v) !== num.value) {
          values[inp.id] = v;
          range.value = String(v);
          num.value = String(v);
          onInteract();
        }
      };
      num.addEventListener("blur", commitClamp);
      num.addEventListener("keydown", (e) => { if (e.key === "Enter") commitClamp(); });

      const wrap = el("span", "ilb-input-control");
      wrap.appendChild(range); wrap.appendChild(num);
      control = wrap;
    } else {
      const num = document.createElement("input");
      num.type = "number";
      num.id = inputId;
      num.className = "ilb-input-number";
      num.dataset.input = inp.id;
      num.min = String(inp.min ?? 0); num.max = String(inp.max ?? 100);
      num.step = String(inp.step ?? "any"); num.value = String(values[inp.id]);
      num.addEventListener("input", () => {
        // Ignore an empty/non-finite intermediate typing state rather than
        // writing 0 into the model (e.g. while the learner clears a <input
        // type=number> field to type a new value).
        if (num.value === "") return;
        const v = Number(num.value);
        if (!Number.isFinite(v)) return;
        values[inp.id] = v;
        onInteract();
      });
      const commitClamp = (): void => {
        if (num.value === "") return;
        const raw = Number(num.value);
        if (!Number.isFinite(raw)) return;
        let v = raw;
        if (inp.min !== undefined) v = Math.max(inp.min, v);
        if (inp.max !== undefined) v = Math.min(inp.max, v);
        if (v !== raw || String(v) !== num.value) {
          values[inp.id] = v;
          num.value = String(v);
          onInteract();
        }
      };
      num.addEventListener("blur", commitClamp);
      num.addEventListener("keydown", (e) => { if (e.key === "Enter") commitClamp(); });
      const wrap = el("span", "ilb-input-control");
      wrap.appendChild(num);
      control = wrap;
    }
    row.appendChild(control);
    const zone = zoneOf(inp.placement);
    const box = stageBoxOf(inp.placement);
    if (zone === "stage" && stageControls && box) {
      const card = el("div", "ilb-stage-control");
      card.style.left = `${box.x}%`; card.style.top = `${box.y}%`;
      card.style.width = `${box.w}%`; card.style.height = `${box.h}%`;
      card.appendChild(row);
      stageControls.appendChild(card);
    } else if (zone === "below") {
      belowPanel.appendChild(row);
    } else {
      inputsPanel.appendChild(row);
    }
  }

  // ---------- stage (visual layer) ----------
  if (stage && config.visual) {
    if (config.visual.backgroundUrl) {
      const bg = document.createElement("img");
      bg.className = "ilb-stage-bg"; bg.alt = ""; bg.src = config.visual.backgroundUrl;
      // Keep the % overlay boxes coincident with the image's own box by
      // matching the stage's aspect ratio to the loaded image; drop the
      // default min-height once the ratio takes over sizing so the stage
      // doesn't carry extra height beyond the image's own proportions.
      bg.addEventListener("load", () => {
        if (bg.naturalWidth && bg.naturalHeight) {
          const dims = stageDimensions(bg.naturalWidth, bg.naturalHeight);
          stage!.style.aspectRatio = dims.aspectRatio;
          // Explicitly clear (not just omit) maxWidth for a landscape image
          // that doesn't need capping, in case this stage previously held a
          // capped (square/portrait) image -- e.g. a live authoring preview
          // swapping the background asset.
          stage!.style.maxWidth = dims.maxWidth ?? "";
          // Override (not merely clear) the CSS class's default min-height:
          // an inline "" would leave the 240px class rule in effect, which
          // could force the stage taller than the image's own proportions.
          stage!.style.minHeight = "0";
        }
      });
      stage.appendChild(bg);
    }
    for (const ov of config.visual.overlays) {
      const holder = el("div", "ilb-overlay");
      holder.dataset.overlay = ov.id;
      holder.style.left = `${ov.box.x}%`; holder.style.top = `${ov.box.y}%`;
      holder.style.width = `${ov.box.w}%`; holder.style.height = `${ov.box.h}%`;
      if (ov.type === "fill") {
        const fill = el("div", "ilb-fill");
        fill.style.background = ov.color;
        holder.appendChild(fill);
      } else {
        const img = document.createElement("img");
        img.className = "ilb-overlay-img"; img.alt = "";
        holder.appendChild(img);
        if (ov.type === "swap") {
          // Preload every band image at mount so switching bands doesn't
          // stall on a network fetch (deduped across mounts, module-level).
          for (const band of ov.bands) {
            if (preloadedBandUrls.has(band.url)) continue;
            preloadedBandUrls.add(band.url);
            const preload = new Image();
            preload.src = band.url;
          }
        }
      }
      stage.appendChild(holder);
    }
    // Stage-zone controls are appended LAST, after the background image
    // and every overlay node, so they're always a later sibling of the
    // stage's own visual content (see FOCUS-ORDER INVARIANT above).
    if (stageControls) stage.appendChild(stageControls);
    layout.classList.add("ilb-has-stage");
  }

  // ---------- outputs ----------
  // The visible values update instantly and are NOT themselves a live
  // region (role/aria-live live on a separate hidden summary below) — that
  // avoids announcing every keystroke of a slider drag. Each card still
  // keeps a per-output aria-hidden dash + sr-only fallback for browse-mode
  // screen reader navigation.
  const outputNodes = new Map<string, { num: HTMLElement; dash: HTMLElement; sr: HTMLElement }>();
  for (const out of config.outputs) {
    const card = el("div", "ilb-output");
    card.dataset.output = out.id;
    const lab = el("div", "ilb-output-label"); lab.textContent = out.label;
    const val = el("div", "ilb-output-value");
    const num = document.createElement("span");
    const dash = document.createElement("span");
    dash.setAttribute("aria-hidden", "true");
    val.appendChild(num); val.appendChild(dash);
    const unit = el("span", "ilb-output-units"); unit.textContent = out.units ?? "";
    const sr = el("span", "ilb-sr-only");
    card.appendChild(lab); card.appendChild(val); card.appendChild(unit); card.appendChild(sr);
    outputNodes.set(out.id, { num, dash, sr });

    const zone = zoneOf(out.placement);
    const box = stageBoxOf(out.placement);
    if (zone === "stage" && stageControls && box) {
      const wrap = el("div", "ilb-stage-control");
      wrap.style.left = `${box.x}%`; wrap.style.top = `${box.y}%`;
      wrap.style.width = `${box.w}%`; wrap.style.height = `${box.h}%`;
      wrap.appendChild(card);
      stageControls.appendChild(wrap);
    } else if (zone === "below") {
      belowPanel.appendChild(card);
    } else {
      outputsPanel.appendChild(card);
    }
  }

  // Debounced, visually-hidden live-region summary of all outputs: mirrors
  // the instant visual values on a trailing timer so a screen reader hears
  // one settled announcement after input stops, not one per tick. It must
  // survive even when every output is placed "below"/"stage" (so
  // .ilb-outputs ends up with no visible children) — in that case it gets a
  // minimal wrapper of its own (no card styling), appended in the same DOM
  // position `.ilb-outputs` would otherwise occupy, instead of the
  // (otherwise-empty) outputs card.
  const outputsSummary = el("div", "ilb-sr-only");
  outputsSummary.setAttribute("role", "status");
  outputsSummary.setAttribute("aria-live", "polite");
  const outputsPanelHasVisibleOutputs = outputsPanel.childElementCount > 0;
  if (outputsPanelHasVisibleOutputs) {
    outputsPanel.appendChild(outputsSummary);
  }

  let outputsSummaryTimer: ReturnType<typeof setTimeout> | null = null;
  const OUTPUTS_SUMMARY_DEBOUNCE_MS = 500;

  // ---------- charts ----------
  // Charts live OUTSIDE the outputs region entirely (their own container,
  // not aria-live) — a canvas redraw / aria-label refresh on every render
  // must never trigger the outputs live region to re-announce. Built here
  // (before the zone-container assembly below) so the assembly can append
  // it in whatever position the active preset calls for.
  const chartsPanel = el("div", "ilb-charts");
  const chartCanvases = new Map<string, HTMLCanvasElement>();
  for (const chart of config.charts) {
    const wrap = el("div", "ilb-chart");
    const title = el("div", "ilb-chart-title"); title.textContent = chart.title;
    const canvas = document.createElement("canvas");
    canvas.dataset.chart = chart.id;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${chart.title} chart`);
    wrap.appendChild(title); wrap.appendChild(canvas);
    chartsPanel.appendChild(wrap);
    chartCanvases.set(chart.id, canvas);
  }

  // Assemble the layout's zone containers in the ACTIVE PRESET's visual
  // reading order (see LAYOUT_ZONE_ORDER + the FOCUS-ORDER INVARIANT above)
  // — this append order IS the tab order. Content was routed into each
  // container by zone in the loops above, independent of this append order.
  // A zone that ended up with nothing to show is omitted entirely, rather
  // than shipping an empty, borderless-but-still-padded card.
  const zoneOrder = LAYOUT_ZONE_ORDER[config.layout ?? "side"] ?? LAYOUT_ZONE_ORDER.side;
  for (const zone of zoneOrder) {
    switch (zone) {
      case "inputs":
        if (inputsPanel.childElementCount > 0) layout.appendChild(inputsPanel);
        break;
      case "outputs":
        if (outputsPanelHasVisibleOutputs) {
          layout.appendChild(outputsPanel);
        } else {
          const outputsLive = el("div", "ilb-outputs-live");
          outputsLive.appendChild(outputsSummary);
          layout.appendChild(outputsLive);
        }
        break;
      case "below":
        if (hasBelowZone) layout.appendChild(belowPanel);
        break;
      case "stage":
        if (stage) layout.appendChild(stage);
        break;
      case "charts":
        if (config.charts.length) layout.appendChild(chartsPanel);
        break;
    }
  }

  // ---------- challenges / score status ----------
  // The score status strip (defect fix: learners had no visible indication
  // of what was graded or achieved) always exists, even for a no-challenge
  // "exploration" config -- in that case it has no challenges panel to live
  // in, so it's appended directly to root instead. When challenges DO
  // exist, it lives inside the challenges panel (which already carries
  // aria-live="polite") so its text updates are announced alongside
  // challenge-met changes -- one live region, text changes together, no
  // separate/duplicate announcement.
  const challengeNodes = new Map<string, HTMLElement>();
  const scoreStatus = el("div", "ilb-score-status");
  if (config.challenges.length) {
    const panel = el("div", "ilb-challenges");
    panel.setAttribute("aria-live", "polite");
    const h = el("h2"); h.textContent = "Challenges"; panel.appendChild(h);
    panel.appendChild(scoreStatus);
    for (const ch of config.challenges) {
      const row = el("div", "ilb-challenge");
      row.dataset.challenge = ch.id;
      const mark = el("span", "ilb-challenge-mark");
      mark.setAttribute("aria-hidden", "true");
      const status = el("span", "ilb-sr-only");
      status.textContent = "Not met yet";
      const text = el("span"); text.textContent = ch.prompt;
      row.appendChild(mark); row.appendChild(status);
      // Defect fix: `status` and `text` are adjacent inline <span>s with no
      // whitespace between them in the DOM, so a screen reader concatenated
      // them with no word boundary ("Not met yetDisplace more than..."). The
      // sr-only span is visually clipped to 1x1px, so this space is
      // invisible on screen (and collapses harmlessly at the start of the
      // visible line) but restores the missing announcement boundary.
      row.appendChild(document.createTextNode(" "));
      row.appendChild(text);
      panel.appendChild(row);
      challengeNodes.set(ch.id, status);
    }
    root.appendChild(panel);
  } else {
    root.appendChild(scoreStatus);
  }

  // ---------- compute & render ----------
  function computeOutputs(vars: Record<string, number>): Record<string, number | null> {
    const scope: Record<string, number> = { ...vars };
    const results: Record<string, number | null> = {};
    for (const out of config.outputs) {
      const ast = asts.get(out.id);
      if (!ast) { results[out.id] = null; continue; }
      try {
        const v = evaluateFormula(ast, scope);
        scope[out.id] = v;
        results[out.id] = v;
      } catch { results[out.id] = null; }
    }
    return results;
  }

  function formatOutput(out: RuntimeSandboxConfig["outputs"][number], v: number | null): string {
    return v === null ? "not available" : String(Number(v.toFixed(out.decimals ?? 2)));
  }

  function render(): void {
    const results = computeOutputs(values);
    for (const out of config.outputs) {
      const v = results[out.id];
      const nodes = outputNodes.get(out.id)!;
      if (v === null) {
        setText(nodes.num, "");
        setText(nodes.dash, "—");
        setText(nodes.sr, "value not available");
      } else {
        setText(nodes.num, String(Number(v.toFixed(out.decimals ?? 2))));
        setText(nodes.dash, "");
        setText(nodes.sr, "");
      }
    }
    // Debounce the live-region summary: reset the trailing timer on every
    // render so a fast drag produces exactly one announcement, ~500ms after
    // input settles, and identical text never re-fires the region.
    const summaryText = config.outputs.map((out) => `${out.label}: ${formatOutput(out, results[out.id])}`).join(". ");
    if (outputsSummaryTimer !== null) clearTimeout(outputsSummaryTimer);
    outputsSummaryTimer = setTimeout(() => {
      outputsSummaryTimer = null;
      setText(outputsSummary, summaryText);
    }, OUTPUTS_SUMMARY_DEBOUNCE_MS);

    if (stage && config.visual) {
      for (const ov of config.visual.overlays) renderOverlay(ov, results[ov.outputId]);
    }
    let met = 0;
    for (const ch of config.challenges) {
      const v = results[ch.outputId];
      const ok = v !== null && (
        (ch.comparator === "gte" && v >= (ch.value ?? 0)) ||
        (ch.comparator === "lte" && v <= (ch.value ?? 0)) ||
        (ch.comparator === "between" && v >= (ch.min ?? 0) && v <= (ch.max ?? 0)));
      if (ok) met++;
      const row = root.querySelector(`[data-challenge="${ch.id}"]`);
      row?.classList.toggle("met", ok);
      const sr = challengeNodes.get(ch.id);
      if (sr) setText(sr, ok ? "Met" : "Not met yet");
    }
    for (const chart of config.charts) drawChart(chart, chartCanvases.get(chart.id)!, results);
    reportScorm(met);
  }

  function renderOverlay(ov: Overlay, value: number | null): void {
    const holder = root.querySelector(`[data-overlay="${ov.id}"]`) as HTMLElement | null;
    if (!holder || value === null) return;
    if (ov.type === "fill") {
      const t = clamp01((value - ov.inMin) / (ov.inMax - ov.inMin));
      (holder.querySelector(".ilb-fill") as HTMLElement).style.height = `${Math.round(t * 100)}%`;
    } else if (ov.type === "swap") {
      const band = ov.bands.find((b) => value <= b.upTo) ?? ov.bands[ov.bands.length - 1];
      const img = holder.querySelector("img") as HTMLImageElement;
      if (img.getAttribute("src") !== band.url) img.src = band.url;
    } else {
      const t = clamp01((value - ov.inMin) / (ov.inMax - ov.inMin));
      const out = ov.outMin + t * (ov.outMax - ov.outMin);
      const img = holder.querySelector("img") as HTMLImageElement;
      if (!img.getAttribute("src")) img.src = ov.url;
      if (ov.property === "opacity") img.style.opacity = String(out);
      else if (ov.property === "rotate") img.style.transform = `rotate(${out}deg)`;
      else if (ov.property === "scale") img.style.transform = `scale(${out})`;
      else if (ov.property === "translateX") img.style.transform = `translateX(${out}%)`;
      else img.style.transform = `translateY(${out}%)`;
    }
  }

  function drawChart(
    chart: RuntimeSandboxConfig["charts"][number],
    canvas: HTMLCanvasElement,
    currentResults: Record<string, number | null>,
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // DPR-aware crisp rendering (defect fix: chart was blurry): size the
    // canvas BACKING STORE from its laid-out CSS width * devicePixelRatio,
    // then draw everything below in CSS-pixel coordinates via setTransform.
    // clientWidth is 0 in environments with no real layout (e.g. jsdom) --
    // fall back to a sensible default rather than producing a 0-size canvas.
    const cssWidth = canvas.clientWidth || 480;
    const cssHeight = Math.round(cssWidth * 0.46);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const inp = config.inputs.find((i) => i.id === chart.xInputId);
    if (!inp || inp.min === undefined || inp.max === undefined) {
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      setAttr(canvas, "aria-label", `${chart.title}: chart unavailable`);
      return;
    }
    type Pt = [number, number] | null;
    const raw: Pt[] = [];
    for (let s = 0; s < chart.samples; s++) {
      const x = inp.min + (s / (chart.samples - 1)) * (inp.max - inp.min);
      const r = computeOutputs({ ...values, [chart.xInputId]: x });
      const y = r[chart.yOutputId];
      raw.push(y === null ? null : [x, y]);
    }
    const pts = raw.filter((p): p is [number, number] => p !== null);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    if (pts.length < 2) {
      setAttr(canvas, "aria-label", `${chart.title}: not enough data to plot`);
      return;
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];

    // Label layout that can never clip (defect fix): the left gutter and
    // top/bottom padding are computed from the actual measured label text
    // and font size, rather than a single fixed pad on all sides.
    ctx.font = `${CHART_FONT_PX}px sans-serif`;
    const yMinLabel = String(round2(yMin));
    const yMaxLabel = String(round2(yMax));
    const rect = chartLayout(ctx, yMinLabel, yMaxLabel, cssWidth, cssHeight);

    const px = (x: number) => rect.x + ((x - xMin) / (xMax - xMin || 1)) * rect.w;
    const py = (y: number) => rect.y + rect.h - ((y - yMin) / (yMax - yMin || 1)) * rect.h;
    ctx.strokeStyle = ILB_CHART_COLORS.frame; ctx.lineWidth = 1;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = ILB_CHART_COLORS.line; ctx.lineWidth = 2;
    ctx.beginPath();
    // Break the polyline across samples where the formula failed, rather
    // than drawing a misleading straight line across the gap.
    let needMove = true;
    for (const p of raw) {
      if (p === null) { needMove = true; continue; }
      const [x, y] = p;
      if (needMove) { ctx.moveTo(px(x), py(y)); needMove = false; }
      else ctx.lineTo(px(x), py(y));
    }
    ctx.stroke();
    // current-position marker — reuses render()'s already-computed results
    // instead of recomputing outputs a second time.
    const cur = currentResults[chart.yOutputId];
    const curX = values[chart.xInputId];
    let curLabel = "no current point";
    if (cur !== null && curX >= xMin && curX <= xMax) {
      ctx.fillStyle = ILB_CHART_COLORS.marker;
      ctx.beginPath(); ctx.arc(px(curX), py(cur), 4, 0, 2 * Math.PI); ctx.fill();
      curLabel = `current point (${round2(curX)}, ${round2(cur)})`;
    }

    ctx.fillStyle = ILB_CHART_COLORS.axisText;
    ctx.font = `${CHART_FONT_PX}px sans-serif`;
    // Y labels: right-aligned in the left gutter, vertically centered on
    // the plot's top/bottom edge so the y-max label's own top-padding
    // (baked into chartLayout's topPad) keeps it clear of the canvas edge.
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(yMaxLabel, rect.x - 6, rect.y);
    ctx.fillText(yMinLabel, rect.x - 6, rect.y + rect.h);
    // X labels: min left-aligned at the plot's left edge, max right-aligned
    // at the plot's right edge, both below the axis frame.
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(String(round2(xMin)), rect.x, rect.y + rect.h + 6);
    ctx.textAlign = "right";
    ctx.fillText(String(round2(xMax)), rect.x + rect.w, rect.y + rect.h + 6);
    // Restore canvas text defaults so nothing downstream inherits this
    // alignment/baseline.
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    setAttr(
      canvas,
      "aria-label",
      `${chart.title}: x from ${round2(xMin)} to ${round2(xMax)}, y from ${round2(yMin)} to ${round2(yMax)}, ${curLabel}`,
    );
  }

  /** Score status strip text (defect fix: learner had no visible indication
   *  of what was graded or achieved). Always reflects `bestPct` — the
   *  recorded high-water score — rather than the current/live percentage,
   *  so it never goes DOWN as the learner keeps exploring, matching exactly
   *  what's actually reported to the gradebook. `met` is the CURRENT count
   *  of satisfied challenges (that part is allowed to fluctuate live);
   *  "Lesson complete." uses the sticky `reportedComplete` flag, not the
   *  current met-all state, for the same never-goes-backward reason. */
  function updateScoreStatus(met: number): void {
    const total = config.challenges.length;
    let text: string;
    const complete = total > 0 && reportedComplete;
    if (total === 0) {
      text = "Exploration lesson — interacting records a score of 100%.";
    } else {
      text = `Score: ${Math.round(bestPct)}% — ${met} of ${total} challenges met.`;
      if (complete) text += " Lesson complete.";
    }
    if (!scorm || scorm.mode !== "scorm") {
      text += " (preview — grades record only in the course)";
    }
    setText(scoreStatus, text);
    scoreStatus.classList.toggle("complete", complete);
  }

  /** Reports score/completion to the LMS as a monotonic high-water mark: the
   *  reported score never decreases even if the learner un-meets a challenge
   *  afterward, and completion, once reported, is never retracted. Also
   *  guarantees at least one setScore call as soon as the learner interacts
   *  — even a score of 0 — because an attempt with no score written at all
   *  reads to Canvas as "not attempted", not "attempted, scored zero".
   *
   *  The high-water tracking itself (bestPct/reportedComplete) runs
   *  whenever the learner has interacted, regardless of SCORM mode, so the
   *  score status strip stays accurate in standalone/preview too — only the
   *  actual LMS calls are gated on being in real SCORM mode. */
  function reportScorm(challengesMet: number): void {
    const total = config.challenges.length;
    const pct = total === 0 ? 100 : (challengesMet / total) * 100;
    const metAll = total === 0 || challengesMet === total;

    if (interacted) {
      const improved = pct > bestPct;
      if (improved) bestPct = pct;
      const newlyCompleted = metAll && !reportedComplete;
      if (newlyCompleted) reportedComplete = true;

      if (scorm && scorm.mode === "scorm") {
        if (improved || !scoreReported) {
          scoreReported = true;
          scorm.setScore(bestPct);
        }
        if (newlyCompleted) {
          scorm.setCompleted();
        }
        const ok = scorm.saveSuspendData<SuspendPayload>({ values, best: bestPct, completed: reportedComplete });
        if (!ok && !warnedSuspendLimit) {
          warnedSuspendLimit = true;
          console.warn("progress exceeds SCORM suspend limit; resume disabled");
        }
      }
    }

    updateScoreStatus(challengesMet);
  }

  function onInteract(): void {
    interacted = true;
    render();
  }

  // Re-render charts (only) when the layout's laid-out width actually
  // changes -- crisp DPR sizing (see drawChart) depends on clientWidth, so
  // a responsive resize (e.g. rotating a tablet, an editor preview pane
  // being dragged wider) must redraw the canvas backing store, not just
  // stretch a stale bitmap. jsdom (tests) has no ResizeObserver/real
  // layout, hence the typeof guard.
  if (config.charts.length && typeof ResizeObserver !== "undefined") {
    let lastWidth = layout.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = layout.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      const results = computeOutputs(values);
      for (const chart of config.charts) {
        const canvas = chartCanvases.get(chart.id);
        if (canvas) drawChart(chart, canvas, results);
      }
    });
    ro.observe(layout);
  }

  render();
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
/** Assigns textContent only when it actually changes, to avoid needless
 *  mutations inside aria-live regions (which would otherwise re-announce
 *  identical content on every render). */
function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
/** Same idea as setText, for attributes (e.g. a canvas's aria-label). */
function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const round2 = (n: number) => Math.round(n * 100) / 100;

/* Bundle entry: expose mount API. */
declare global {
  interface Window { ILBEngine?: { mount: typeof mountSandbox } }
}
if (typeof window !== "undefined") {
  window.ILBEngine = { mount: mountSandbox };
}
