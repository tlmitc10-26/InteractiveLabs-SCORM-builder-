import { parseFormula, type AstNode } from "@/lib/formula/parser";
import { evaluateFormula } from "@/lib/formula/evaluate";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";

type Overlay = NonNullable<RuntimeSandboxConfig["visual"]>["overlays"][number];
type SuspendPayload = { values?: Record<string, number>; best?: number; completed?: boolean };

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

  // FOCUS-ORDER INVARIANT: regardless of authoring order or which `layout`
  // preset is active, the DOM (and therefore default tab) order of the
  // zone containers inside `.ilb-layout` is always:
  //   1. .ilb-inputs       - panel-zone inputs, in authoring order; OMITTED
  //      entirely when no input uses the panel zone (nothing to render)
  //   2. .ilb-outputs      - panel-zone outputs, in authoring order; OMITTED
  //      when no output uses the panel zone. The sr-only live-region summary
  //      (see `outputsSummary` below) normally lives inside this container,
  //      but it must survive even when the container itself is omitted — in
  //      that case it's appended to a minimal `.ilb-outputs-live` wrapper
  //      (no card styling) in this same position instead, so the container
  //      being empty of VISIBLE outputs never silences the live region.
  //   3. .ilb-below-panel  - below-zone inputs then below-zone outputs, in
  //      authoring order (the container is omitted entirely when nothing
  //      uses this zone)
  //   4. .ilb-stage        - background image/overlays first, then
  //      .ilb-stage-controls (stage-zone inputs then stage-zone outputs,
  //      in authoring order) appended LAST, so a stage-zone control is
  //      always a later sibling of the stage's own image/overlay nodes
  //   5. .ilb-charts       - omitted when there are no charts
  // Which preset makes the stage render first/large/etc. is controlled
  // purely by CSS (`order`/grid-column in engine.css); it never changes
  // this DOM order. Net tab sequence for a mixed config: panel-zone
  // inputs -> panel-zone outputs -> below-zone inputs -> below-zone
  // outputs -> stage-zone inputs -> stage-zone outputs -> chart canvases
  // (if any) -> challenges (a later sibling of `.ilb-layout` under `root`).
  // The (sr-only, non-focusable) live region never participates in tab
  // order either way, so omitting/relocating its container never affects
  // this sequence.
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
          stage!.style.aspectRatio = `${bg.naturalWidth} / ${bg.naturalHeight}`;
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

  // Assemble the layout's zone containers in the fixed DOM order documented
  // in the FOCUS-ORDER INVARIANT above; content was routed into each
  // container by zone in the loops above, independent of this append order.
  // A panel container that ended up with no visible children (every input/
  // output was routed to "below" or "stage") is omitted entirely, rather
  // than shipping an empty, borderless-but-still-padded card.
  if (inputsPanel.childElementCount > 0) layout.appendChild(inputsPanel);
  if (outputsPanelHasVisibleOutputs) {
    layout.appendChild(outputsPanel);
  } else {
    const outputsLive = el("div", "ilb-outputs-live");
    outputsLive.appendChild(outputsSummary);
    layout.appendChild(outputsLive);
  }
  if (hasBelowZone) layout.appendChild(belowPanel);
  if (stage) layout.appendChild(stage);
  let outputsSummaryTimer: ReturnType<typeof setTimeout> | null = null;
  const OUTPUTS_SUMMARY_DEBOUNCE_MS = 500;

  // ---------- charts ----------
  // Charts live OUTSIDE the outputs region entirely (their own container,
  // not aria-live) — a canvas redraw / aria-label refresh on every render
  // must never trigger the outputs live region to re-announce.
  const chartsPanel = el("div", "ilb-charts");
  const chartCanvases = new Map<string, HTMLCanvasElement>();
  for (const chart of config.charts) {
    const wrap = el("div", "ilb-chart");
    const title = el("div", "ilb-chart-title"); title.textContent = chart.title;
    const canvas = document.createElement("canvas");
    canvas.width = 480; canvas.height = 220; canvas.dataset.chart = chart.id;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${chart.title} chart`);
    wrap.appendChild(title); wrap.appendChild(canvas);
    chartsPanel.appendChild(wrap);
    chartCanvases.set(chart.id, canvas);
  }
  if (config.charts.length) layout.appendChild(chartsPanel);

  // ---------- challenges ----------
  const challengeNodes = new Map<string, HTMLElement>();
  if (config.challenges.length) {
    const panel = el("div", "ilb-challenges");
    panel.setAttribute("aria-live", "polite");
    const h = el("h2"); h.textContent = "Challenges"; panel.appendChild(h);
    for (const ch of config.challenges) {
      const row = el("div", "ilb-challenge");
      row.dataset.challenge = ch.id;
      const mark = el("span", "ilb-challenge-mark");
      mark.setAttribute("aria-hidden", "true");
      const status = el("span", "ilb-sr-only");
      status.textContent = "Not met yet";
      const text = el("span"); text.textContent = ch.prompt;
      row.appendChild(mark); row.appendChild(status); row.appendChild(text);
      panel.appendChild(row);
      challengeNodes.set(ch.id, status);
    }
    root.appendChild(panel);
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
    const inp = config.inputs.find((i) => i.id === chart.xInputId);
    if (!inp || inp.min === undefined || inp.max === undefined) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts.length < 2) {
      setAttr(canvas, "aria-label", `${chart.title}: not enough data to plot`);
      return;
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
    const pad = 28;
    const px = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * (canvas.width - 2 * pad);
    const py = (y: number) => canvas.height - pad - ((y - yMin) / (yMax - yMin || 1)) * (canvas.height - 2 * pad);
    ctx.strokeStyle = ILB_CHART_COLORS.frame; ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, canvas.width - 2 * pad, canvas.height - 2 * pad);
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
    ctx.fillStyle = ILB_CHART_COLORS.axisText; ctx.font = "11px sans-serif";
    ctx.fillText(String(round2(xMin)), pad, canvas.height - 8);
    ctx.fillText(String(round2(xMax)), canvas.width - pad - 24, canvas.height - 8);
    ctx.fillText(String(round2(yMax)), 2, pad + 8);
    ctx.fillText(String(round2(yMin)), 2, canvas.height - pad);
    setAttr(
      canvas,
      "aria-label",
      `${chart.title}: x from ${round2(xMin)} to ${round2(xMax)}, y from ${round2(yMin)} to ${round2(yMax)}, ${curLabel}`,
    );
  }

  /** Reports score/completion to the LMS as a monotonic high-water mark: the
   *  reported score never decreases even if the learner un-meets a challenge
   *  afterward, and completion, once reported, is never retracted. Also
   *  guarantees at least one setScore call as soon as the learner interacts
   *  — even a score of 0 — because an attempt with no score written at all
   *  reads to Canvas as "not attempted", not "attempted, scored zero". */
  function reportScorm(challengesMet: number): void {
    if (!scorm || scorm.mode !== "scorm") return;
    if (!interacted) return;
    const total = config.challenges.length;
    const pct = total === 0 ? 100 : (challengesMet / total) * 100;
    const metAll = total === 0 || challengesMet === total;
    if (pct > bestPct || !scoreReported) {
      bestPct = Math.max(bestPct, pct);
      scoreReported = true;
      scorm.setScore(bestPct);
    }
    if (metAll && !reportedComplete) {
      reportedComplete = true;
      scorm.setCompleted();
    }
    const ok = scorm.saveSuspendData<SuspendPayload>({ values, best: bestPct, completed: reportedComplete });
    if (!ok && !warnedSuspendLimit) {
      warnedSuspendLimit = true;
      console.warn("progress exceeds SCORM suspend limit; resume disabled");
    }
  }

  function onInteract(): void {
    interacted = true;
    render();
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
