import { parseFormula, type AstNode } from "@/lib/formula/parser";
import { evaluateFormula } from "@/lib/formula/evaluate";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";

type Overlay = NonNullable<RuntimeSandboxConfig["visual"]>["overlays"][number];

/** Mount the Parameter Sandbox. Labels/units via textContent (never innerHTML);
 *  only `intro` may contain markup and it arrives pre-sanitized from the builder. */
export function mountSandbox(root: HTMLElement, config: RuntimeSandboxConfig): void {
  root.innerHTML = "";
  root.classList.add("ilb-sandbox");

  const asts = new Map<string, AstNode>();
  for (const out of config.outputs) {
    const r = parseFormula(out.formula);
    if (r.ok) asts.set(out.id, r.ast);
  }

  const values: Record<string, number> = {};
  for (const inp of config.inputs) values[inp.id] = inp.defaultValue;

  let interacted = false;
  const scorm = typeof window !== "undefined" ? window.ILBScorm : undefined;

  // Resume: restore saved input values from SCORM suspend data (spec 6).
  const saved = scorm?.loadSuspendData<{ values?: Record<string, number> }>();
  if (saved && saved.values) {
    for (const inp of config.inputs) {
      const v = saved.values[inp.id];
      if (typeof v === "number") values[inp.id] = v;
    }
    interacted = true;
  }

  // ---------- header ----------
  const header = el("div", "ilb-header");
  const h1 = el("h1"); h1.textContent = config.title; header.appendChild(h1);
  if (config.intro) {
    const intro = el("div", "ilb-intro");
    intro.innerHTML = config.intro; // sanitized at authoring + revalidated at export
    header.appendChild(intro);
  }
  root.appendChild(header);

  const layout = el("div", "ilb-layout");
  root.appendChild(layout);

  // ---------- inputs ----------
  const inputsPanel = el("div", "ilb-inputs");
  layout.appendChild(inputsPanel);
  for (const inp of config.inputs) {
    const row = el("label", "ilb-input-row");
    const lab = el("span", "ilb-input-label");
    lab.textContent = inp.units ? `${inp.label} (${inp.units})` : inp.label;
    row.appendChild(lab);

    let control: HTMLElement;
    if (inp.type === "select") {
      const sel = document.createElement("select");
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
      cb.type = "checkbox"; cb.dataset.input = inp.id; cb.checked = values[inp.id] !== 0;
      cb.addEventListener("change", () => { values[inp.id] = cb.checked ? 1 : 0; onInteract(); });
      control = cb;
    } else {
      const num = document.createElement("input");
      num.type = inp.type === "slider" ? "range" : "number";
      num.dataset.input = inp.id;
      num.min = String(inp.min ?? 0); num.max = String(inp.max ?? 100);
      num.step = String(inp.step ?? "any"); num.value = String(values[inp.id]);
      const valueBadge = el("span", "ilb-input-value");
      valueBadge.textContent = String(values[inp.id]);
      num.addEventListener("input", () => {
        values[inp.id] = Number(num.value);
        valueBadge.textContent = num.value;
        onInteract();
      });
      const wrap = el("span", "ilb-input-control");
      wrap.appendChild(num); wrap.appendChild(valueBadge);
      control = wrap;
    }
    row.appendChild(control);
    inputsPanel.appendChild(row);
  }

  // ---------- stage (visual layer) ----------
  let stage: HTMLElement | null = null;
  if (config.visual && (config.visual.backgroundUrl || config.visual.overlays.length)) {
    stage = el("div", "ilb-stage");
    if (config.visual.backgroundUrl) {
      const bg = document.createElement("img");
      bg.className = "ilb-stage-bg"; bg.alt = ""; bg.src = config.visual.backgroundUrl;
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
      }
      stage.appendChild(holder);
    }
    layout.appendChild(stage);
  }

  // ---------- outputs ----------
  const outputsPanel = el("div", "ilb-outputs");
  layout.appendChild(outputsPanel);
  for (const out of config.outputs) {
    const card = el("div", "ilb-output");
    card.dataset.output = out.id;
    const lab = el("div", "ilb-output-label"); lab.textContent = out.label;
    const val = el("div", "ilb-output-value");
    const unit = el("span", "ilb-output-units"); unit.textContent = out.units ?? "";
    card.appendChild(lab); card.appendChild(val); card.appendChild(unit);
    outputsPanel.appendChild(card);
  }

  // ---------- charts ----------
  const chartCanvases = new Map<string, HTMLCanvasElement>();
  for (const chart of config.charts) {
    const wrap = el("div", "ilb-chart");
    const title = el("div", "ilb-chart-title"); title.textContent = chart.title;
    const canvas = document.createElement("canvas");
    canvas.width = 480; canvas.height = 220; canvas.dataset.chart = chart.id;
    wrap.appendChild(title); wrap.appendChild(canvas);
    outputsPanel.appendChild(wrap);
    chartCanvases.set(chart.id, canvas);
  }

  // ---------- challenges ----------
  if (config.challenges.length) {
    const panel = el("div", "ilb-challenges");
    const h = el("h2"); h.textContent = "Challenges"; panel.appendChild(h);
    for (const ch of config.challenges) {
      const row = el("div", "ilb-challenge");
      row.dataset.challenge = ch.id;
      const mark = el("span", "ilb-challenge-mark");
      const text = el("span"); text.textContent = ch.prompt;
      row.appendChild(mark); row.appendChild(text);
      panel.appendChild(row);
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

  function render(): void {
    const results = computeOutputs(values);
    for (const out of config.outputs) {
      const v = results[out.id];
      const elv = root.querySelector(`[data-output="${out.id}"] .ilb-output-value`)!;
      elv.textContent = v === null ? "—" : v.toFixed(out.decimals ?? 2).replace(/\.?0+$/, "") || "0";
    }
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
      root.querySelector(`[data-challenge="${ch.id}"]`)?.classList.toggle("met", ok);
    }
    for (const chart of config.charts) drawChart(chart, chartCanvases.get(chart.id)!);
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

  function drawChart(chart: RuntimeSandboxConfig["charts"][number], canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const inp = config.inputs.find((i) => i.id === chart.xInputId);
    if (!inp || inp.min === undefined || inp.max === undefined) return;
    const pts: Array<[number, number]> = [];
    for (let s = 0; s < chart.samples; s++) {
      const x = inp.min + (s / (chart.samples - 1)) * (inp.max - inp.min);
      const r = computeOutputs({ ...values, [chart.xInputId]: x });
      const y = r[chart.yOutputId];
      if (y !== null) pts.push([x, y]);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts.length < 2) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
    const pad = 28;
    const px = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * (canvas.width - 2 * pad);
    const py = (y: number) => canvas.height - pad - ((y - yMin) / (yMax - yMin || 1)) * (canvas.height - 2 * pad);
    ctx.strokeStyle = "#9aa0a6"; ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, canvas.width - 2 * pad, canvas.height - 2 * pad);
    ctx.strokeStyle = "#8C1D40"; ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.stroke();
    // current-position marker
    const cur = computeOutputs(values)[chart.yOutputId];
    const curX = values[chart.xInputId];
    if (cur !== null && curX >= xMin && curX <= xMax) {
      ctx.fillStyle = "#B8860B";
      ctx.beginPath(); ctx.arc(px(curX), py(cur), 4, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.fillStyle = "#5f6368"; ctx.font = "11px sans-serif";
    ctx.fillText(String(round2(xMin)), pad, canvas.height - 8);
    ctx.fillText(String(round2(xMax)), canvas.width - pad - 24, canvas.height - 8);
    ctx.fillText(String(round2(yMax)), 2, pad + 8);
    ctx.fillText(String(round2(yMin)), 2, canvas.height - pad);
  }

  function reportScorm(challengesMet: number): void {
    if (!scorm || scorm.mode !== "scorm") return;
    if (!interacted) return;
    if (config.challenges.length === 0) {
      scorm.setScore(100);
      scorm.setCompleted();
    } else {
      scorm.setScore((challengesMet / config.challenges.length) * 100);
      if (challengesMet === config.challenges.length) scorm.setCompleted();
    }
  }

  function onInteract(): void {
    interacted = true;
    render();
    scorm?.saveSuspendData({ values });
  }

  render();
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
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
