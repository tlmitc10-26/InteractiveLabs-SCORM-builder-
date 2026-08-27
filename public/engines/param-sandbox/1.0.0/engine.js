"use strict";
(() => {
  // src/lib/formula/parser.ts
  var FORMULA_FUNCTIONS = [
    "min",
    "max",
    "abs",
    "round",
    "floor",
    "ceil",
    "sqrt",
    "pow",
    "exp",
    "ln",
    "log10",
    "sin",
    "cos",
    "tan"
  ];
  var FORMULA_CONSTANTS = { pi: Math.PI, e: Math.E };
  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (/[0-9.]/.test(c)) {
        const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
        if (!m) throw new Error(`invalid number at position ${i}`);
        const value = Number(m[0]);
        if (!Number.isFinite(value)) throw new Error(`number literal too large at position ${i}`);
        tokens.push({ type: "num", value });
        i += m[0].length;
        continue;
      }
      if (/[a-zA-Z_]/.test(c)) {
        const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
        tokens.push({ type: "ident", name: m[0] });
        i += m[0].length;
        continue;
      }
      if ("+-*/^(),".includes(c)) {
        tokens.push({ type: "op", op: c });
        i++;
        continue;
      }
      throw new Error(`unexpected character "${c}" at position ${i}`);
    }
    return tokens;
  }
  var MAX_FORMULA_LENGTH = 1e3;
  function parseFormula(src) {
    try {
      let expr2 = function() {
        let left = term2();
        while (isOp("+") || isOp("-")) {
          const op = tokens[pos++].op;
          left = { kind: "binary", op, left, right: term2() };
        }
        return left;
      }, term2 = function() {
        let left = unary2();
        while (isOp("*") || isOp("/")) {
          const op = tokens[pos++].op;
          left = { kind: "binary", op, left, right: unary2() };
        }
        return left;
      }, unary2 = function() {
        if (isOp("-")) {
          pos++;
          return { kind: "unary", op: "-", operand: unary2() };
        }
        return factor2();
      }, factor2 = function() {
        const base = primary2();
        if (isOp("^")) {
          pos++;
          return { kind: "binary", op: "^", left: base, right: unaryForExponent2() };
        }
        return base;
      }, unaryForExponent2 = function() {
        if (isOp("-")) {
          pos++;
          return { kind: "unary", op: "-", operand: unaryForExponent2() };
        }
        return factor2();
      }, primary2 = function() {
        const t = peek();
        if (!t) throw new Error("unexpected end of formula");
        if (t.type === "num") {
          pos++;
          return { kind: "num", value: t.value };
        }
        if (t.type === "ident") {
          pos++;
          if (isOp("(")) {
            if (!FORMULA_FUNCTIONS.includes(t.name)) {
              throw new Error(`unknown function "${t.name}"`);
            }
            pos++;
            const args = [expr2()];
            while (isOp(",")) {
              pos++;
              args.push(expr2());
            }
            expect(")");
            return { kind: "call", name: t.name, args };
          }
          return { kind: "var", name: t.name };
        }
        if (t.type === "op" && t.op === "(") {
          pos++;
          const inner = expr2();
          expect(")");
          return inner;
        }
        throw new Error(`unexpected token "${t.type === "op" ? t.op : ""}"`);
      };
      var expr = expr2, term = term2, unary = unary2, factor = factor2, unaryForExponent = unaryForExponent2, primary = primary2;
      if (src.length > MAX_FORMULA_LENGTH) {
        throw new Error(`formula too long (max ${MAX_FORMULA_LENGTH} characters)`);
      }
      const tokens = tokenize(src);
      if (tokens.length === 0) throw new Error("empty formula");
      let pos = 0;
      const peek = () => tokens[pos];
      const isOp = (op) => {
        var _a;
        return ((_a = peek()) == null ? void 0 : _a.type) === "op" && peek().op === op;
      };
      const expect = (op) => {
        if (!isOp(op)) throw new Error(`expected "${op}"`);
        pos++;
      };
      const ast = expr2();
      if (pos !== tokens.length) throw new Error(`unexpected trailing input at token ${pos}`);
      return { ok: true, ast };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // src/lib/formula/evaluate.ts
  var FormulaError = class extends Error {
  };
  var FUNCTION_IMPLS = {
    min: Math.min,
    max: Math.max,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    sqrt: Math.sqrt,
    pow: Math.pow,
    exp: Math.exp,
    ln: Math.log,
    log10: Math.log10,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan
  };
  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }
  function lookupVar(name, vars) {
    if (hasOwn(vars, name)) {
      const v = vars[name];
      if (typeof v === "number") return v;
      throw new FormulaError(`unknown variable "${name}"`);
    }
    if (hasOwn(FORMULA_CONSTANTS, name)) {
      const v = FORMULA_CONSTANTS[name];
      if (typeof v === "number") return v;
      throw new FormulaError(`unknown variable "${name}"`);
    }
    throw new FormulaError(`unknown variable "${name}"`);
  }
  function evaluateFormula(ast, vars) {
    try {
      const result = evalNode(ast, vars);
      if (!Number.isFinite(result)) throw new FormulaError("result is not a finite number");
      return result;
    } catch (e) {
      if (e instanceof FormulaError) throw e;
      throw new FormulaError(e instanceof Error ? e.message : String(e));
    }
  }
  function evalNode(node, vars) {
    switch (node.kind) {
      case "num":
        return node.value;
      case "var":
        return lookupVar(node.name, vars);
      case "unary":
        return -evalNode(node.operand, vars);
      case "binary": {
        const l = evalNode(node.left, vars);
        const r = evalNode(node.right, vars);
        switch (node.op) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/": {
            const v = l / r;
            if (!Number.isFinite(v)) throw new FormulaError("result is not a finite number (division by zero)");
            return v;
          }
          case "^":
            return Math.pow(l, r);
          default:
            throw new FormulaError("unreachable binary operator");
        }
      }
      case "call": {
        const fn = FUNCTION_IMPLS[node.name];
        if (!fn) throw new FormulaError(`unknown function "${node.name}"`);
        return fn(...node.args.map((a) => evalNode(a, vars)));
      }
      default: {
        const _exhaustive = node;
        throw new FormulaError(`unreachable node kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  // src/engine-runtime/param-sandbox/chart-layout.ts
  var CHART_FONT_PX = 12;
  var CHART_LABEL_PAD = 6;
  function chartLayout(ctx, yMinLabel, yMaxLabel, cssWidth, cssHeight) {
    const yLabelWidth = Math.max(ctx.measureText(yMinLabel).width, ctx.measureText(yMaxLabel).width);
    const leftGutter = Math.ceil(yLabelWidth) + CHART_LABEL_PAD * 2;
    const rightPad = CHART_LABEL_PAD * 2;
    const bottomGutter = CHART_FONT_PX + CHART_LABEL_PAD * 2;
    const topPad = Math.ceil(CHART_FONT_PX / 2) + CHART_LABEL_PAD;
    const x = leftGutter;
    const y = topPad;
    const w = Math.max(10, cssWidth - leftGutter - rightPad);
    const h = Math.max(10, cssHeight - topPad - bottomGutter);
    return { x, y, w, h };
  }

  // src/engine-runtime/param-sandbox/main.ts
  var STAGE_MAX_HEIGHT_PX = 480;
  function stageDimensions(naturalW, naturalH, capPx = STAGE_MAX_HEIGHT_PX) {
    if (!(naturalW > 0) || !(naturalH > 0)) {
      return { aspectRatio: "1 / 1" };
    }
    const aspectRatio = `${naturalW} / ${naturalH}`;
    if (naturalH >= naturalW) {
      const maxWidth = `${Math.round(capPx * naturalW / naturalH)}px`;
      return { aspectRatio, maxWidth };
    }
    return { aspectRatio };
  }
  var preloadedBandUrls = /* @__PURE__ */ new Set();
  var ILB_CHART_COLORS = {
    line: "#8c1d40",
    marker: "#747474",
    axisText: "#484848",
    frame: "#bfbfbf"
  };
  function zoneOf(placement) {
    var _a;
    return (_a = placement == null ? void 0 : placement.zone) != null ? _a : "panel";
  }
  function stageBoxOf(placement) {
    return placement && placement.zone === "stage" ? placement.box : null;
  }
  var LAYOUT_ZONE_ORDER = {
    // Side (default): inputs | stage | outputs sit in one row, then the
    // below-zone panel spans full width beneath, then charts.
    side: ["inputs", "stage", "outputs", "below", "charts"],
    // Stacked: single column, stage first, then inputs, then below, then
    // outputs, then charts.
    stacked: ["stage", "inputs", "below", "outputs", "charts"],
    // Stage-focus: stage first (full width), then inputs+outputs share a row,
    // then below, then charts.
    "stage-focus": ["stage", "inputs", "outputs", "below", "charts"]
  };
  function mountSandbox(root, config) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    root.innerHTML = "";
    root.classList.add("ilb-sandbox");
    root.setAttribute("role", "main");
    const mountId = `ilb-${Math.random().toString(36).slice(2, 9)}`;
    const asts = /* @__PURE__ */ new Map();
    for (const out of config.outputs) {
      const r = parseFormula(out.formula);
      if (r.ok) asts.set(out.id, r.ast);
    }
    const values = {};
    for (const inp of config.inputs) values[inp.id] = inp.defaultValue;
    let interacted = false;
    let bestPct = 0;
    let reportedComplete = false;
    let scoreReported = false;
    let warnedSuspendLimit = false;
    const scorm = typeof window !== "undefined" ? window.ILBScorm : void 0;
    const saved = scorm == null ? void 0 : scorm.loadSuspendData();
    if (saved) {
      if (saved.values) {
        for (const inp of config.inputs) {
          const raw = saved.values[inp.id];
          if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
          let v = raw;
          if (inp.type === "slider" || inp.type === "number") {
            if (inp.min !== void 0) v = Math.max(inp.min, v);
            if (inp.max !== void 0) v = Math.min(inp.max, v);
          } else if (inp.type === "select") {
            const valid = ((_a = inp.options) != null ? _a : []).some((o) => o.value === v);
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
    if (scorm && scorm.mode === "scorm") {
      if (bestPct > 0 || reportedComplete) {
        scorm.setScore(bestPct);
        scoreReported = true;
      }
      if (reportedComplete) {
        scorm.setCompleted();
      }
    }
    const header = el("div", "ilb-header");
    const h2 = el("h2", "ilb-title");
    h2.textContent = config.title;
    header.appendChild(h2);
    if (config.intro) {
      const intro = el("div", "ilb-intro");
      intro.innerHTML = config.intro;
      header.appendChild(intro);
    }
    root.appendChild(header);
    const layout = el("div", "ilb-layout");
    root.appendChild(layout);
    layout.classList.add(`ilb-layout-${(_b = config.layout) != null ? _b : "side"}`);
    const allElements = [...config.inputs, ...config.outputs];
    const anyStageZone = allElements.some((e) => zoneOf(e.placement) === "stage");
    const hasBelowZone = allElements.some((e) => zoneOf(e.placement) === "below");
    const needsStage = !!config.visual && (!!config.visual.backgroundUrl || config.visual.overlays.length > 0 || anyStageZone);
    const inputsPanel = el("div", "ilb-inputs");
    const outputsPanel = el("div", "ilb-outputs");
    const belowPanel = el("div", "ilb-below-panel");
    let stage = null;
    let stageControls = null;
    if (needsStage) {
      stage = el("div", "ilb-stage");
      stageControls = el("div", "ilb-stage-controls");
    }
    for (const inp of config.inputs) {
      const inputId = `${mountId}-${inp.id}`;
      const row = el("div", "ilb-input-row");
      const lab = document.createElement("label");
      lab.className = "ilb-input-label";
      lab.htmlFor = inputId;
      lab.textContent = inp.units ? `${inp.label} (${inp.units})` : inp.label;
      row.appendChild(lab);
      let control;
      if (inp.type === "select") {
        const sel = document.createElement("select");
        sel.id = inputId;
        sel.dataset.input = inp.id;
        for (const opt of (_c = inp.options) != null ? _c : []) {
          const o = document.createElement("option");
          o.value = String(opt.value);
          o.textContent = opt.label;
          if (opt.value === values[inp.id]) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener("change", () => {
          values[inp.id] = Number(sel.value);
          onInteract();
        });
        control = sel;
      } else if (inp.type === "toggle") {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = inputId;
        cb.dataset.input = inp.id;
        cb.checked = values[inp.id] !== 0;
        cb.addEventListener("change", () => {
          values[inp.id] = cb.checked ? 1 : 0;
          onInteract();
        });
        control = cb;
      } else if (inp.type === "slider") {
        const range = document.createElement("input");
        range.type = "range";
        range.id = inputId;
        range.dataset.input = inp.id;
        range.min = String((_d = inp.min) != null ? _d : 0);
        range.max = String((_e = inp.max) != null ? _e : 100);
        range.step = String((_f = inp.step) != null ? _f : "any");
        range.value = String(values[inp.id]);
        const num = document.createElement("input");
        num.type = "number";
        num.id = `${inputId}-value`;
        num.className = "ilb-input-number";
        num.dataset.input = inp.id;
        num.min = range.min;
        num.max = range.max;
        num.step = range.step;
        num.value = range.value;
        num.setAttribute("aria-label", `${inp.label}, exact value`);
        range.addEventListener("input", () => {
          const v = Number(range.value);
          if (!Number.isFinite(v)) return;
          values[inp.id] = v;
          num.value = range.value;
          onInteract();
        });
        num.addEventListener("input", () => {
          if (num.value === "") return;
          const v = Number(num.value);
          if (!Number.isFinite(v)) return;
          values[inp.id] = v;
          range.value = String(v);
          onInteract();
        });
        const commitClamp = () => {
          if (num.value === "") return;
          const raw = Number(num.value);
          if (!Number.isFinite(raw)) return;
          let v = raw;
          if (inp.min !== void 0) v = Math.max(inp.min, v);
          if (inp.max !== void 0) v = Math.min(inp.max, v);
          if (v !== raw || String(v) !== num.value) {
            values[inp.id] = v;
            range.value = String(v);
            num.value = String(v);
            onInteract();
          }
        };
        num.addEventListener("blur", commitClamp);
        num.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitClamp();
        });
        const wrap = el("span", "ilb-input-control");
        wrap.appendChild(range);
        wrap.appendChild(num);
        control = wrap;
      } else {
        const num = document.createElement("input");
        num.type = "number";
        num.id = inputId;
        num.className = "ilb-input-number";
        num.dataset.input = inp.id;
        num.min = String((_g = inp.min) != null ? _g : 0);
        num.max = String((_h = inp.max) != null ? _h : 100);
        num.step = String((_i = inp.step) != null ? _i : "any");
        num.value = String(values[inp.id]);
        num.addEventListener("input", () => {
          if (num.value === "") return;
          const v = Number(num.value);
          if (!Number.isFinite(v)) return;
          values[inp.id] = v;
          onInteract();
        });
        const commitClamp = () => {
          if (num.value === "") return;
          const raw = Number(num.value);
          if (!Number.isFinite(raw)) return;
          let v = raw;
          if (inp.min !== void 0) v = Math.max(inp.min, v);
          if (inp.max !== void 0) v = Math.min(inp.max, v);
          if (v !== raw || String(v) !== num.value) {
            values[inp.id] = v;
            num.value = String(v);
            onInteract();
          }
        };
        num.addEventListener("blur", commitClamp);
        num.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitClamp();
        });
        const wrap = el("span", "ilb-input-control");
        wrap.appendChild(num);
        control = wrap;
      }
      row.appendChild(control);
      const zone = zoneOf(inp.placement);
      const box = stageBoxOf(inp.placement);
      if (zone === "stage" && stageControls && box) {
        const card = el("div", "ilb-stage-control");
        card.style.left = `${box.x}%`;
        card.style.top = `${box.y}%`;
        card.style.width = `${box.w}%`;
        card.style.height = `${box.h}%`;
        card.appendChild(row);
        stageControls.appendChild(card);
      } else if (zone === "below") {
        belowPanel.appendChild(row);
      } else {
        inputsPanel.appendChild(row);
      }
    }
    if (stage && config.visual) {
      if (config.visual.backgroundUrl) {
        const bg = document.createElement("img");
        bg.className = "ilb-stage-bg";
        bg.alt = "";
        bg.src = config.visual.backgroundUrl;
        bg.addEventListener("load", () => {
          var _a2;
          if (bg.naturalWidth && bg.naturalHeight) {
            const dims = stageDimensions(bg.naturalWidth, bg.naturalHeight);
            stage.style.aspectRatio = dims.aspectRatio;
            stage.style.maxWidth = (_a2 = dims.maxWidth) != null ? _a2 : "";
            stage.style.minHeight = "0";
          }
        });
        stage.appendChild(bg);
      }
      for (const ov of config.visual.overlays) {
        const holder = el("div", "ilb-overlay");
        holder.dataset.overlay = ov.id;
        holder.style.left = `${ov.box.x}%`;
        holder.style.top = `${ov.box.y}%`;
        holder.style.width = `${ov.box.w}%`;
        holder.style.height = `${ov.box.h}%`;
        if (ov.type === "fill") {
          const fill = el("div", "ilb-fill");
          fill.style.background = ov.color;
          holder.appendChild(fill);
        } else {
          const img = document.createElement("img");
          img.className = "ilb-overlay-img";
          img.alt = "";
          holder.appendChild(img);
          if (ov.type === "swap") {
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
      if (stageControls) stage.appendChild(stageControls);
      layout.classList.add("ilb-has-stage");
    }
    const outputNodes = /* @__PURE__ */ new Map();
    for (const out of config.outputs) {
      const card = el("div", "ilb-output");
      card.dataset.output = out.id;
      const lab = el("div", "ilb-output-label");
      lab.textContent = out.label;
      const val = el("div", "ilb-output-value");
      const num = document.createElement("span");
      const dash = document.createElement("span");
      dash.setAttribute("aria-hidden", "true");
      val.appendChild(num);
      val.appendChild(dash);
      const unit = el("span", "ilb-output-units");
      unit.textContent = (_j = out.units) != null ? _j : "";
      const sr = el("span", "ilb-sr-only");
      card.appendChild(lab);
      card.appendChild(val);
      card.appendChild(unit);
      card.appendChild(sr);
      outputNodes.set(out.id, { num, dash, sr });
      const zone = zoneOf(out.placement);
      const box = stageBoxOf(out.placement);
      if (zone === "stage" && stageControls && box) {
        const wrap = el("div", "ilb-stage-control");
        wrap.style.left = `${box.x}%`;
        wrap.style.top = `${box.y}%`;
        wrap.style.width = `${box.w}%`;
        wrap.style.height = `${box.h}%`;
        wrap.appendChild(card);
        stageControls.appendChild(wrap);
      } else if (zone === "below") {
        belowPanel.appendChild(card);
      } else {
        outputsPanel.appendChild(card);
      }
    }
    const outputsSummary = el("div", "ilb-sr-only");
    outputsSummary.setAttribute("role", "status");
    outputsSummary.setAttribute("aria-live", "polite");
    const outputsPanelHasVisibleOutputs = outputsPanel.childElementCount > 0;
    if (outputsPanelHasVisibleOutputs) {
      outputsPanel.appendChild(outputsSummary);
    }
    let outputsSummaryTimer = null;
    const OUTPUTS_SUMMARY_DEBOUNCE_MS = 500;
    const chartsPanel = el("div", "ilb-charts");
    const chartCanvases = /* @__PURE__ */ new Map();
    for (const chart of config.charts) {
      const wrap = el("div", "ilb-chart");
      const title = el("div", "ilb-chart-title");
      title.textContent = chart.title;
      const canvas = document.createElement("canvas");
      canvas.dataset.chart = chart.id;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${chart.title} chart`);
      wrap.appendChild(title);
      wrap.appendChild(canvas);
      chartsPanel.appendChild(wrap);
      chartCanvases.set(chart.id, canvas);
    }
    const zoneOrder = (_l = LAYOUT_ZONE_ORDER[(_k = config.layout) != null ? _k : "side"]) != null ? _l : LAYOUT_ZONE_ORDER.side;
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
    const challengeNodes = /* @__PURE__ */ new Map();
    const scoreStatus = el("div", "ilb-score-status");
    if (config.challenges.length) {
      const panel = el("div", "ilb-challenges");
      panel.setAttribute("aria-live", "polite");
      const h = el("h2");
      h.textContent = "Challenges";
      panel.appendChild(h);
      panel.appendChild(scoreStatus);
      for (const ch of config.challenges) {
        const row = el("div", "ilb-challenge");
        row.dataset.challenge = ch.id;
        const mark = el("span", "ilb-challenge-mark");
        mark.setAttribute("aria-hidden", "true");
        const status = el("span", "ilb-sr-only");
        status.textContent = "Not met yet";
        const text = el("span");
        text.textContent = ch.prompt;
        row.appendChild(mark);
        row.appendChild(status);
        row.appendChild(document.createTextNode(" "));
        row.appendChild(text);
        panel.appendChild(row);
        challengeNodes.set(ch.id, status);
      }
      root.appendChild(panel);
    } else {
      root.appendChild(scoreStatus);
    }
    function computeOutputs(vars) {
      const scope = { ...vars };
      const results = {};
      for (const out of config.outputs) {
        const ast = asts.get(out.id);
        if (!ast) {
          results[out.id] = null;
          continue;
        }
        try {
          const v = evaluateFormula(ast, scope);
          scope[out.id] = v;
          results[out.id] = v;
        } catch {
          results[out.id] = null;
        }
      }
      return results;
    }
    function formatOutput(out, v) {
      var _a2;
      return v === null ? "not available" : String(Number(v.toFixed((_a2 = out.decimals) != null ? _a2 : 2)));
    }
    function render() {
      var _a2, _b2, _c2, _d2, _e2;
      const results = computeOutputs(values);
      for (const out of config.outputs) {
        const v = results[out.id];
        const nodes = outputNodes.get(out.id);
        if (v === null) {
          setText(nodes.num, "");
          setText(nodes.dash, "\u2014");
          setText(nodes.sr, "value not available");
        } else {
          setText(nodes.num, String(Number(v.toFixed((_a2 = out.decimals) != null ? _a2 : 2))));
          setText(nodes.dash, "");
          setText(nodes.sr, "");
        }
      }
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
        const ok = v !== null && (ch.comparator === "gte" && v >= ((_b2 = ch.value) != null ? _b2 : 0) || ch.comparator === "lte" && v <= ((_c2 = ch.value) != null ? _c2 : 0) || ch.comparator === "between" && v >= ((_d2 = ch.min) != null ? _d2 : 0) && v <= ((_e2 = ch.max) != null ? _e2 : 0));
        if (ok) met++;
        const row = root.querySelector(`[data-challenge="${ch.id}"]`);
        row == null ? void 0 : row.classList.toggle("met", ok);
        const sr = challengeNodes.get(ch.id);
        if (sr) setText(sr, ok ? "Met" : "Not met yet");
      }
      for (const chart of config.charts) drawChart(chart, chartCanvases.get(chart.id), results);
      reportScorm(met);
    }
    function renderOverlay(ov, value) {
      var _a2;
      const holder = root.querySelector(`[data-overlay="${ov.id}"]`);
      if (!holder || value === null) return;
      if (ov.type === "fill") {
        const t = clamp01((value - ov.inMin) / (ov.inMax - ov.inMin));
        holder.querySelector(".ilb-fill").style.height = `${Math.round(t * 100)}%`;
      } else if (ov.type === "swap") {
        const band = (_a2 = ov.bands.find((b) => value <= b.upTo)) != null ? _a2 : ov.bands[ov.bands.length - 1];
        const img = holder.querySelector("img");
        if (img.getAttribute("src") !== band.url) img.src = band.url;
      } else {
        const t = clamp01((value - ov.inMin) / (ov.inMax - ov.inMin));
        const out = ov.outMin + t * (ov.outMax - ov.outMin);
        const img = holder.querySelector("img");
        if (!img.getAttribute("src")) img.src = ov.url;
        if (ov.property === "opacity") img.style.opacity = String(out);
        else if (ov.property === "rotate") img.style.transform = `rotate(${out}deg)`;
        else if (ov.property === "scale") img.style.transform = `scale(${out})`;
        else if (ov.property === "translateX") img.style.transform = `translateX(${out}%)`;
        else img.style.transform = `translateY(${out}%)`;
      }
    }
    function drawChart(chart, canvas, currentResults) {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cssWidth = canvas.clientWidth || 480;
      const cssHeight = Math.round(cssWidth * 0.46);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      canvas.style.height = `${cssHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const inp = config.inputs.find((i) => i.id === chart.xInputId);
      if (!inp || inp.min === void 0 || inp.max === void 0) {
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        setAttr(canvas, "aria-label", `${chart.title}: chart unavailable`);
        return;
      }
      const raw = [];
      for (let s = 0; s < chart.samples; s++) {
        const x = inp.min + s / (chart.samples - 1) * (inp.max - inp.min);
        const r = computeOutputs({ ...values, [chart.xInputId]: x });
        const y = r[chart.yOutputId];
        raw.push(y === null ? null : [x, y]);
      }
      const pts = raw.filter((p) => p !== null);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      if (pts.length < 2) {
        setAttr(canvas, "aria-label", `${chart.title}: not enough data to plot`);
        return;
      }
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
      const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
      ctx.font = `${CHART_FONT_PX}px sans-serif`;
      const yMinLabel = String(round2(yMin));
      const yMaxLabel = String(round2(yMax));
      const rect = chartLayout(ctx, yMinLabel, yMaxLabel, cssWidth, cssHeight);
      const px = (x) => rect.x + (x - xMin) / (xMax - xMin || 1) * rect.w;
      const py = (y) => rect.y + rect.h - (y - yMin) / (yMax - yMin || 1) * rect.h;
      ctx.strokeStyle = ILB_CHART_COLORS.frame;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = ILB_CHART_COLORS.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let needMove = true;
      for (const p of raw) {
        if (p === null) {
          needMove = true;
          continue;
        }
        const [x, y] = p;
        if (needMove) {
          ctx.moveTo(px(x), py(y));
          needMove = false;
        } else ctx.lineTo(px(x), py(y));
      }
      ctx.stroke();
      const cur = currentResults[chart.yOutputId];
      const curX = values[chart.xInputId];
      let curLabel = "no current point";
      if (cur !== null && curX >= xMin && curX <= xMax) {
        ctx.fillStyle = ILB_CHART_COLORS.marker;
        ctx.beginPath();
        ctx.arc(px(curX), py(cur), 4, 0, 2 * Math.PI);
        ctx.fill();
        curLabel = `current point (${round2(curX)}, ${round2(cur)})`;
      }
      ctx.fillStyle = ILB_CHART_COLORS.axisText;
      ctx.font = `${CHART_FONT_PX}px sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(yMaxLabel, rect.x - 6, rect.y);
      ctx.fillText(yMinLabel, rect.x - 6, rect.y + rect.h);
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(String(round2(xMin)), rect.x, rect.y + rect.h + 6);
      ctx.textAlign = "right";
      ctx.fillText(String(round2(xMax)), rect.x + rect.w, rect.y + rect.h + 6);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      setAttr(
        canvas,
        "aria-label",
        `${chart.title}: x from ${round2(xMin)} to ${round2(xMax)}, y from ${round2(yMin)} to ${round2(yMax)}, ${curLabel}`
      );
    }
    function updateScoreStatus(met) {
      const total = config.challenges.length;
      let text;
      const complete = total > 0 && reportedComplete;
      if (total === 0) {
        text = "Exploration lesson \u2014 interacting records a score of 100%.";
      } else {
        text = `Score: ${Math.round(bestPct)}% \u2014 ${met} of ${total} challenges met.`;
        if (complete) text += " Lesson complete.";
      }
      if (!scorm || scorm.mode !== "scorm") {
        text += " (preview \u2014 grades record only in the course)";
      }
      setText(scoreStatus, text);
      scoreStatus.classList.toggle("complete", complete);
    }
    function reportScorm(challengesMet) {
      const total = config.challenges.length;
      const pct = total === 0 ? 100 : challengesMet / total * 100;
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
          const ok = scorm.saveSuspendData({ values, best: bestPct, completed: reportedComplete });
          if (!ok && !warnedSuspendLimit) {
            warnedSuspendLimit = true;
            console.warn("progress exceeds SCORM suspend limit; resume disabled");
          }
        }
      }
      updateScoreStatus(challengesMet);
    }
    function onInteract() {
      interacted = true;
      render();
    }
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
  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  function setAttr(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  var clamp01 = (t) => Math.max(0, Math.min(1, t));
  var round2 = (n) => Math.round(n * 100) / 100;
  if (typeof window !== "undefined") {
    window.ILBEngine = { mount: mountSandbox };
  }
})();
