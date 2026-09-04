"use strict";
(() => {
  // src/lib/engines/process-simulator/scoring.ts
  function scoreComponents(config, attempts) {
    var _a;
    const required = config.actions.filter((a) => a.required);
    const totalRequired = required.length;
    let cleanCount = 0;
    let illegalAttempts = 0;
    for (const a of config.actions) {
      const count = (_a = attempts.get(a.id)) != null ? _a : 0;
      illegalAttempts += count;
      if (a.required && count === 0) cleanCount++;
    }
    return { totalRequired, cleanCount, totalAttempts: totalRequired + illegalAttempts };
  }
  function combineScore(totalRequired, cleanCount, totalAttempts) {
    const correctness = { num: cleanCount, den: totalRequired };
    const efficiency = { num: totalRequired, den: totalAttempts };
    const num = 60 * correctness.num * efficiency.den + 40 * efficiency.num * correctness.den;
    const den = correctness.den * efficiency.den;
    const totalPct = Math.round(num / den);
    return { correctness, efficiency, totalPct };
  }
  function scoreProcess(config, attempts) {
    const { totalRequired, cleanCount, totalAttempts } = scoreComponents(config, attempts);
    return combineScore(totalRequired, cleanCount, totalAttempts);
  }

  // src/lib/engines/process-simulator/state.ts
  function initialState() {
    return { step: "brief", done: [], attempts: /* @__PURE__ */ new Map(), bestPct: 0, completed: false, scoreReported: false };
  }
  function beginProcedure(state) {
    return { ...state, step: "procedure" };
  }
  function incrementAttempt(attempts, actionId) {
    var _a;
    const next = new Map(attempts);
    next.set(actionId, Math.min(99, ((_a = next.get(actionId)) != null ? _a : 0) + 1));
    return next;
  }
  function attemptAction(config, state, actionId) {
    var _a;
    const action = config.actions.find((a) => a.id === actionId);
    if (!action) throw new Error(`action "${actionId}" does not exist`);
    if (state.done.includes(actionId)) throw new Error(`action "${actionId}" is already done`);
    const legal = action.required && ((_a = action.requires) != null ? _a : []).every((id) => state.done.includes(id));
    if (!legal) {
      return { state: { ...state, attempts: incrementAttempt(state.attempts, actionId) }, legal: false };
    }
    const done = [...state.done, actionId];
    const totalRequired = config.actions.filter((a) => a.required).length;
    if (done.length < totalRequired) {
      return { state: { ...state, done }, legal: true };
    }
    const score = scoreProcess(config, state.attempts);
    const bestPct = Math.max(state.bestPct, score.totalPct);
    return {
      state: { ...state, step: "debrief", done, bestPct, completed: true, scoreReported: true },
      legal: true,
      score
    };
  }
  function startOver(state) {
    return {
      step: "brief",
      done: [],
      attempts: /* @__PURE__ */ new Map(),
      bestPct: state.bestPct,
      completed: state.completed,
      scoreReported: false
    };
  }
  function suspendPayload(state) {
    return {
      v: 1,
      done: [...state.done],
      at: [...state.attempts.entries()],
      b: state.bestPct,
      c: state.completed,
      step: state.step
    };
  }
  var VALID_STEPS = ["brief", "procedure", "debrief"];
  function restoreState(config, payload) {
    var _a;
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const p = payload;
      if (p.v !== 1) return null;
      if (typeof p.step !== "string" || !VALID_STEPS.includes(p.step)) return null;
      const step = p.step;
      const byId = new Map(config.actions.map((a) => [a.id, a]));
      const requiredIds = new Set(config.actions.filter((a) => a.required).map((a) => a.id));
      if (!Array.isArray(p.done) || !p.done.every((x) => typeof x === "string")) return null;
      const doneRaw = p.done;
      const seenDone = /* @__PURE__ */ new Set();
      for (const id of doneRaw) {
        if (!requiredIds.has(id)) return null;
        if (seenDone.has(id)) return null;
        seenDone.add(id);
      }
      const prefix = /* @__PURE__ */ new Set();
      for (const id of doneRaw) {
        const action = byId.get(id);
        const reqs = (_a = action.requires) != null ? _a : [];
        if (!reqs.every((r) => prefix.has(r))) return null;
        prefix.add(id);
      }
      const done = [...doneRaw];
      if (!Array.isArray(p.at)) return null;
      const attempts = /* @__PURE__ */ new Map();
      for (const entry of p.at) {
        if (!Array.isArray(entry) || entry.length !== 2) return null;
        const [id, count] = entry;
        if (typeof id !== "string" || !byId.has(id)) return null;
        if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 99) return null;
        if (attempts.has(id)) return null;
        const action = byId.get(id);
        if (action.required && (!action.requires || action.requires.length === 0)) return null;
        attempts.set(id, count);
      }
      const allRequiredDone = done.length === requiredIds.size;
      if (step === "debrief" && !allRequiredDone) return null;
      if (step !== "debrief" && allRequiredDone) return null;
      if (typeof p.b !== "number" || !Number.isFinite(p.b)) return null;
      const bestPct = Math.min(100, Math.max(0, p.b));
      if (typeof p.c !== "boolean") return null;
      return { step, done, attempts, bestPct, completed: p.c, scoreReported: false };
    } catch {
      return null;
    }
  }

  // src/engine-runtime/process-simulator/main.ts
  function salvageBestAndCompleted(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const p = payload;
    const b = p.b;
    const c = p.c;
    if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b > 100) return null;
    if (typeof c !== "boolean") return null;
    return { best: b, completed: c };
  }
  function buildLogEntryLi(action, isLatest) {
    var _a;
    const li = document.createElement("li");
    li.className = isLatest ? "ilb-log-entry ilb-log-entry--latest" : "ilb-log-entry";
    if (isLatest) {
      const sr = el("span", "ilb-sr-only");
      sr.textContent = "Latest: ";
      li.appendChild(sr);
    }
    const text = el("span", "ilb-log-entry-text");
    text.innerHTML = (_a = action.outcome) != null ? _a : "";
    li.appendChild(text);
    return li;
  }
  function buildLogList(doneIds, byId) {
    const ul = document.createElement("ul");
    ul.className = "ilb-situation-log";
    doneIds.forEach((id, i) => {
      const action = byId.get(id);
      if (!action) return;
      ul.appendChild(buildLogEntryLi(action, i === doneIds.length - 1));
    });
    return ul;
  }
  var times = (n) => `${n} time${n === 1 ? "" : "s"}`;
  var prematureAttempts = (n) => `${n} premature attempt${n === 1 ? "" : "s"}`;
  function mountProcessSimulator(root, config) {
    root.innerHTML = "";
    root.classList.add("ilb-process");
    root.setAttribute("role", "main");
    const scorm = typeof window !== "undefined" ? window.ILBScorm : void 0;
    let warnedSuspendLimit = false;
    const byId = new Map(config.actions.map((a) => [a.id, a]));
    const totalRequired = config.actions.filter((a) => a.required).length;
    let state;
    const saved = scorm == null ? void 0 : scorm.loadSuspendData();
    const restored = saved != null ? restoreState(config, saved) : null;
    if (restored) {
      state = restored;
    } else {
      state = initialState();
      if (saved != null) {
        const salvaged = salvageBestAndCompleted(saved);
        if (salvaged) state = { ...state, bestPct: salvaged.best, completed: salvaged.completed };
      }
    }
    if (scorm && scorm.mode === "scorm") {
      if (state.bestPct > 0 || state.completed) {
        scorm.setScore(state.bestPct);
        state = { ...state, scoreReported: true };
      }
      if (state.completed) scorm.setCompleted();
    }
    const card = el("div", "ilb-process-card");
    root.appendChild(card);
    const progressStatus = el("div", "ilb-process-status");
    progressStatus.setAttribute("role", "status");
    progressStatus.setAttribute("aria-live", "polite");
    progressStatus.setAttribute("aria-atomic", "true");
    card.appendChild(progressStatus);
    const stepContainer = el("div", "ilb-step");
    card.appendChild(stepContainer);
    let situationHeading;
    let logList;
    let actionsContainer;
    function persistSuspend() {
      if (!scorm || scorm.mode !== "scorm") return;
      const ok = scorm.saveSuspendData(suspendPayload(state));
      if (!ok && !warnedSuspendLimit) {
        warnedSuspendLimit = true;
        console.warn("process simulator progress exceeds SCORM suspend limit; resume disabled");
      }
    }
    function updateProgress() {
      setText(progressStatus, `${state.done.length} of ${totalRequired} required steps done`);
    }
    function renderBrief(focusHeading) {
      var _a;
      updateProgress();
      stepContainer.innerHTML = "";
      retriggerEnter(stepContainer);
      const header = el("div", "ilb-process-header ilb-process-header--band");
      const band = el("div", "ilb-brand-band");
      band.style.background = `var(--rds-${(_a = config.headerColor) != null ? _a : "primary"})`;
      header.appendChild(band);
      stepContainer.appendChild(header);
      const heading = document.createElement("h2");
      heading.tabIndex = -1;
      heading.textContent = config.title;
      stepContainer.appendChild(heading);
      const intro = el("div", "ilb-intro");
      intro.innerHTML = config.intro;
      stepContainer.appendChild(intro);
      const beginBtn = document.createElement("button");
      beginBtn.type = "button";
      beginBtn.className = "ilb-btn ilb-btn-pill";
      beginBtn.textContent = "Begin the procedure.";
      beginBtn.addEventListener("click", () => {
        if (state.step !== "brief") return;
        state = beginProcedure(state);
        persistSuspend();
        enterProcedure(true);
      });
      stepContainer.appendChild(beginBtn);
      if (focusHeading) heading.focus();
    }
    function enterProcedure(focusHeading) {
      stepContainer.innerHTML = "";
      retriggerEnter(stepContainer);
      const heading = document.createElement("h2");
      heading.tabIndex = -1;
      heading.textContent = "Procedure";
      stepContainer.appendChild(heading);
      const situationSection = el("div", "ilb-situation");
      stepContainer.appendChild(situationSection);
      situationHeading = document.createElement("h3");
      situationHeading.tabIndex = -1;
      situationHeading.textContent = "Situation";
      situationSection.appendChild(situationHeading);
      const opening = el("div", "ilb-situation-opening");
      opening.innerHTML = config.opening;
      situationSection.appendChild(opening);
      logList = buildLogList(state.done, byId);
      situationSection.appendChild(logList);
      actionsContainer = el("div", "ilb-actions");
      stepContainer.appendChild(actionsContainer);
      renderActionsMenu();
      updateProgress();
      if (focusHeading) heading.focus();
    }
    function appendLogEntry(actionId) {
      var _a;
      const prevLast = logList.lastElementChild;
      if (prevLast) {
        prevLast.classList.remove("ilb-log-entry--latest");
        (_a = prevLast.querySelector(".ilb-sr-only")) == null ? void 0 : _a.remove();
      }
      const action = byId.get(actionId);
      if (!action) return;
      logList.appendChild(buildLogEntryLi(action, true));
    }
    function renderActionsMenu(focusActionId) {
      actionsContainer.innerHTML = "";
      const heading = document.createElement("h3");
      heading.textContent = "Actions";
      actionsContainer.appendChild(heading);
      const list = el("div", "ilb-action-list");
      for (const action of config.actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ilb-btn ilb-action-btn";
        btn.dataset.actionId = action.id;
        const labelSpan = el("span", "ilb-action-label");
        labelSpan.textContent = action.label;
        btn.appendChild(labelSpan);
        const done = state.done.includes(action.id);
        if (done) {
          btn.disabled = true;
          const glyph = el("span", "ilb-action-done-glyph");
          glyph.setAttribute("aria-hidden", "true");
          glyph.textContent = "\u2713";
          btn.appendChild(glyph);
        }
        btn.addEventListener("click", () => handleActionClick(action.id));
        list.appendChild(btn);
      }
      actionsContainer.appendChild(list);
      if (focusActionId) {
        const btn = list.querySelector(`[data-action-id="${focusActionId}"]`);
        btn == null ? void 0 : btn.focus();
      }
    }
    function renderConsequencePanel(attemptedActionId) {
      var _a;
      const action = byId.get(attemptedActionId);
      if (!action) return;
      actionsContainer.innerHTML = "";
      const heading = document.createElement("h3");
      heading.tabIndex = -1;
      heading.textContent = "Consequence";
      actionsContainer.appendChild(heading);
      const text = el("div", "ilb-consequence-text");
      text.innerHTML = (_a = action.consequence) != null ? _a : "";
      actionsContainer.appendChild(text);
      const continueBtn = document.createElement("button");
      continueBtn.type = "button";
      continueBtn.className = "ilb-btn ilb-btn-pill";
      continueBtn.textContent = "Continue";
      continueBtn.addEventListener("click", () => {
        if (state.step !== "procedure") return;
        renderActionsMenu(attemptedActionId);
      });
      actionsContainer.appendChild(continueBtn);
      heading.focus();
    }
    function handleActionClick(actionId) {
      if (state.step !== "procedure") return;
      if (state.done.includes(actionId)) return;
      const result = attemptAction(config, state, actionId);
      state = result.state;
      if (!result.legal) {
        persistSuspend();
        renderConsequencePanel(actionId);
        return;
      }
      appendLogEntry(actionId);
      if (result.score) {
        if (scorm && scorm.mode === "scorm") {
          scorm.setScore(state.bestPct);
          scorm.setCompleted();
        }
        persistSuspend();
        renderDebrief(true);
        return;
      }
      persistSuspend();
      renderActionsMenu();
      updateProgress();
      situationHeading.focus();
    }
    function renderDebrief(focusHeading) {
      var _a, _b, _c, _d;
      if (state.done.length !== totalRequired) {
        state = initialState();
        renderBrief(true);
        return;
      }
      updateProgress();
      stepContainer.innerHTML = "";
      retriggerEnter(stepContainer);
      const score = scoreProcess(config, state.attempts);
      const cleanCount = score.correctness.num;
      const recoveredCount = score.correctness.den - cleanCount;
      const totalAttempts = score.efficiency.den;
      const attemptedDistractors = config.actions.filter((a) => {
        var _a2;
        return !a.required && ((_a2 = state.attempts.get(a.id)) != null ? _a2 : 0) > 0;
      });
      const resultHead = el("div", "ilb-result-head");
      stepContainer.appendChild(resultHead);
      const eyebrow = el("p", "ilb-eyebrow");
      eyebrow.textContent = "Procedure complete";
      resultHead.appendChild(eyebrow);
      const heading = document.createElement("h2");
      heading.tabIndex = -1;
      heading.textContent = config.title;
      resultHead.appendChild(heading);
      const numeral = el("div", "ilb-score-num");
      numeral.setAttribute("aria-hidden", "true");
      const numeralValue = document.createElement("span");
      numeralValue.textContent = String(score.totalPct);
      numeral.appendChild(numeralValue);
      const numeralUnit = document.createElement("small");
      numeralUnit.textContent = "%";
      numeral.appendChild(numeralUnit);
      resultHead.appendChild(numeral);
      const scoreLine = el("p", "ilb-score-line");
      scoreLine.textContent = `Steps: ${cleanCount} of ${score.correctness.den} clean. Attempts: ${totalAttempts} (expert minimum ${score.efficiency.num}). Score: ${score.totalPct}%.`;
      resultHead.appendChild(scoreLine);
      const chipDefs = [
        [cleanCount, "clean", "best"],
        [recoveredCount, "recovered", "ok"],
        [attemptedDistractors.length, "distractor", "poor"]
      ];
      if (chipDefs.some(([count]) => count > 0)) {
        const chipsWrap = el("div", "ilb-quality-chips");
        chipsWrap.setAttribute("aria-hidden", "true");
        for (const [count, label, suffix] of chipDefs) {
          if (count === 0) continue;
          const chip = document.createElement("span");
          chip.className = `ilb-qchip ilb-qchip--${suffix}`;
          chip.textContent = `${count} ${label}`;
          chipsWrap.appendChild(chip);
        }
        resultHead.appendChild(chipsWrap);
      }
      const situationHeadingEl = document.createElement("h3");
      situationHeadingEl.textContent = "Situation";
      stepContainer.appendChild(situationHeadingEl);
      stepContainer.appendChild(buildLogList(state.done, byId));
      const reviewHeading = document.createElement("h3");
      reviewHeading.textContent = "Step review";
      stepContainer.appendChild(reviewHeading);
      const reviewList = document.createElement("ul");
      reviewList.className = "ilb-comparison-list";
      for (const id of state.done) {
        const action = byId.get(id);
        if (!action) continue;
        const count = (_a = state.attempts.get(id)) != null ? _a : 0;
        const li = document.createElement("li");
        if (count === 0) {
          li.className = "ilb-comparison-row ilb-comparison-row--best";
          li.textContent = `${action.label}: completed on the first try.`;
        } else {
          li.className = "ilb-comparison-row ilb-comparison-row--ok";
          li.textContent = `${action.label}: completed after ${prematureAttempts(count)}. ${(_b = action.consequenceNote) != null ? _b : ""}`;
        }
        reviewList.appendChild(li);
      }
      for (const action of attemptedDistractors) {
        const count = (_c = state.attempts.get(action.id)) != null ? _c : 0;
        const li = document.createElement("li");
        li.className = "ilb-comparison-row ilb-comparison-row--poor";
        li.textContent = `${action.label}: attempted ${times(count)}. ${(_d = action.consequenceNote) != null ? _d : ""}`;
        reviewList.appendChild(li);
      }
      stepContainer.appendChild(reviewList);
      if (config.expertNote) {
        const expertHeading = document.createElement("h3");
        expertHeading.textContent = "Expert note";
        stepContainer.appendChild(expertHeading);
        const expertNote = el("div", "ilb-expert-note");
        expertNote.innerHTML = config.expertNote;
        stepContainer.appendChild(expertNote);
      }
      const startOverBtn = document.createElement("button");
      startOverBtn.type = "button";
      startOverBtn.className = "ilb-btn ilb-start-over-btn ilb-btn-pill ilb-btn-pill--ghost";
      startOverBtn.textContent = "Start over";
      startOverBtn.addEventListener("click", () => handleStartOver());
      stepContainer.appendChild(startOverBtn);
      if (focusHeading) heading.focus();
    }
    function handleStartOver() {
      state = startOver(state);
      persistSuspend();
      renderBrief(true);
    }
    updateProgress();
    switch (state.step) {
      case "brief":
        renderBrief(false);
        break;
      case "procedure":
        enterProcedure(false);
        break;
      case "debrief":
        renderDebrief(false);
        break;
    }
  }
  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  function retriggerEnter(node) {
    node.classList.remove("ilb-enter");
    void node.offsetWidth;
    node.classList.add("ilb-enter");
  }
  if (typeof window !== "undefined") {
    window.ILBEngine = { mount: mountProcessSimulator };
  }
})();
