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

  // src/engine-runtime/param-sandbox/main.ts
  var preloadedBandUrls = /* @__PURE__ */ new Set();
  var ILB_CHART_COLORS = {
    line: "#8c1d40",
    marker: "#747474",
    axisText: "#484848",
    frame: "#bfbfbf"
  };
  function mountSandbox(root, config) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
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
    const inputsPanel = el("div", "ilb-inputs");
    layout.appendChild(inputsPanel);
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
        for (const opt of (_b = inp.options) != null ? _b : []) {
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
        range.min = String((_c = inp.min) != null ? _c : 0);
        range.max = String((_d = inp.max) != null ? _d : 100);
        range.step = String((_e = inp.step) != null ? _e : "any");
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
        num.min = String((_f = inp.min) != null ? _f : 0);
        num.max = String((_g = inp.max) != null ? _g : 100);
        num.step = String((_h = inp.step) != null ? _h : "any");
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
      inputsPanel.appendChild(row);
    }
    let stage = null;
    if (config.visual && (config.visual.backgroundUrl || config.visual.overlays.length)) {
      stage = el("div", "ilb-stage");
      if (config.visual.backgroundUrl) {
        const bg = document.createElement("img");
        bg.className = "ilb-stage-bg";
        bg.alt = "";
        bg.src = config.visual.backgroundUrl;
        bg.addEventListener("load", () => {
          if (bg.naturalWidth && bg.naturalHeight) {
            stage.style.aspectRatio = `${bg.naturalWidth} / ${bg.naturalHeight}`;
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
      layout.appendChild(stage);
      layout.classList.add("ilb-has-stage");
    }
    const outputsPanel = el("div", "ilb-outputs");
    layout.appendChild(outputsPanel);
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
      unit.textContent = (_i = out.units) != null ? _i : "";
      const sr = el("span", "ilb-sr-only");
      card.appendChild(lab);
      card.appendChild(val);
      card.appendChild(unit);
      card.appendChild(sr);
      outputsPanel.appendChild(card);
      outputNodes.set(out.id, { num, dash, sr });
    }
    const outputsSummary = el("div", "ilb-sr-only");
    outputsSummary.setAttribute("role", "status");
    outputsSummary.setAttribute("aria-live", "polite");
    outputsPanel.appendChild(outputsSummary);
    let outputsSummaryTimer = null;
    const OUTPUTS_SUMMARY_DEBOUNCE_MS = 500;
    const chartsPanel = el("div", "ilb-charts");
    const chartCanvases = /* @__PURE__ */ new Map();
    for (const chart of config.charts) {
      const wrap = el("div", "ilb-chart");
      const title = el("div", "ilb-chart-title");
      title.textContent = chart.title;
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 220;
      canvas.dataset.chart = chart.id;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${chart.title} chart`);
      wrap.appendChild(title);
      wrap.appendChild(canvas);
      chartsPanel.appendChild(wrap);
      chartCanvases.set(chart.id, canvas);
    }
    if (config.charts.length) layout.appendChild(chartsPanel);
    const challengeNodes = /* @__PURE__ */ new Map();
    if (config.challenges.length) {
      const panel = el("div", "ilb-challenges");
      panel.setAttribute("aria-live", "polite");
      const h = el("h2");
      h.textContent = "Challenges";
      panel.appendChild(h);
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
        row.appendChild(text);
        panel.appendChild(row);
        challengeNodes.set(ch.id, status);
      }
      root.appendChild(panel);
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
      const inp = config.inputs.find((i) => i.id === chart.xInputId);
      if (!inp || inp.min === void 0 || inp.max === void 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (pts.length < 2) {
        setAttr(canvas, "aria-label", `${chart.title}: not enough data to plot`);
        return;
      }
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
      const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
      const pad = 28;
      const px = (x) => pad + (x - xMin) / (xMax - xMin || 1) * (canvas.width - 2 * pad);
      const py = (y) => canvas.height - pad - (y - yMin) / (yMax - yMin || 1) * (canvas.height - 2 * pad);
      ctx.strokeStyle = ILB_CHART_COLORS.frame;
      ctx.lineWidth = 1;
      ctx.strokeRect(pad, pad, canvas.width - 2 * pad, canvas.height - 2 * pad);
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
      ctx.font = "11px sans-serif";
      ctx.fillText(String(round2(xMin)), pad, canvas.height - 8);
      ctx.fillText(String(round2(xMax)), canvas.width - pad - 24, canvas.height - 8);
      ctx.fillText(String(round2(yMax)), 2, pad + 8);
      ctx.fillText(String(round2(yMin)), 2, canvas.height - pad);
      setAttr(
        canvas,
        "aria-label",
        `${chart.title}: x from ${round2(xMin)} to ${round2(xMax)}, y from ${round2(yMin)} to ${round2(yMax)}, ${curLabel}`
      );
    }
    function reportScorm(challengesMet) {
      if (!scorm || scorm.mode !== "scorm") return;
      if (!interacted) return;
      const total = config.challenges.length;
      const pct = total === 0 ? 100 : challengesMet / total * 100;
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
      const ok = scorm.saveSuspendData({ values, best: bestPct, completed: reportedComplete });
      if (!ok && !warnedSuspendLimit) {
        warnedSuspendLimit = true;
        console.warn("progress exceeds SCORM suspend limit; resume disabled");
      }
    }
    function onInteract() {
      interacted = true;
      render();
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
