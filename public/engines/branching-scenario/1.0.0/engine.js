"use strict";
(() => {
  // src/lib/engines/branching-scenario/runtime-config.ts
  var QUALITY_WEIGHTS = { best: 1, acceptable: 0.5, poor: 0 };

  // src/lib/engines/branching-scenario/state.ts
  var MAX_PATH = 200;
  var QUALITY_CODES = { best: 0, acceptable: 1, poor: 2 };
  var CODE_TO_QUALITY = ["best", "acceptable", "poor"];
  function initialState(config) {
    const vars = {};
    for (const v of config.variables) vars[v.id] = v.initial;
    return { sceneId: config.startSceneId, endingId: null, vars, path: [], truncated: false };
  }
  function conditionMet(cond, vars) {
    const val = vars[cond.variableId];
    if (val === void 0) return false;
    switch (cond.comparator) {
      case "gte":
        return cond.value !== void 0 && val >= cond.value;
      case "lte":
        return cond.value !== void 0 && val <= cond.value;
      case "between":
        return cond.min !== void 0 && cond.max !== void 0 && val >= cond.min && val <= cond.max;
      default:
        return false;
    }
  }
  function sceneById(config, id) {
    return config.scenes.find((s) => s.id === id);
  }
  function visibleChoices(config, state) {
    if (!state.sceneId) return [];
    const scene = sceneById(config, state.sceneId);
    if (!scene) return [];
    return scene.choices.filter((c) => !c.showIf || conditionMet(c.showIf, state.vars));
  }
  function applyChoice(config, state, choiceId) {
    var _a;
    const visible = visibleChoices(config, state);
    const choice = visible.find((c) => c.id === choiceId);
    if (!choice) throw new Error(`choice "${choiceId}" is not a visible choice in the current scene`);
    const currentSceneId = state.sceneId;
    const varsById = new Map(config.variables.map((v) => [v.id, v]));
    const vars = { ...state.vars };
    for (const ef of choice.effects) {
      const varDef = varsById.get(ef.variableId);
      if (!varDef) continue;
      const current = (_a = vars[ef.variableId]) != null ? _a : varDef.initial;
      vars[ef.variableId] = Math.min(varDef.max, Math.max(varDef.min, current + ef.delta));
    }
    let path = [...state.path, { s: currentSceneId, c: choice.id, q: choice.quality }];
    let truncated = state.truncated;
    if (path.length > MAX_PATH) {
      path = path.slice(path.length - MAX_PATH);
      truncated = true;
    }
    const [kind, target] = choice.goTo.split(":");
    const sceneId = kind === "scene" ? target : null;
    const endingId = kind === "ending" ? target : null;
    return { sceneId, endingId, vars, path, truncated };
  }
  function scorePct(state) {
    if (state.path.length === 0) return 0;
    const sum = state.path.reduce((acc, step) => acc + QUALITY_WEIGHTS[step.q], 0);
    return Math.round(sum / state.path.length * 100);
  }
  function suspendPayload(state, best, completed) {
    const d = [];
    const indexOf = /* @__PURE__ */ new Map();
    const dedup = (id) => {
      const existing = indexOf.get(id);
      if (existing !== void 0) return existing;
      const idx = d.length;
      d.push(id);
      indexOf.set(id, idx);
      return idx;
    };
    const p = state.path.map((step) => [dedup(step.s), dedup(step.c), QUALITY_CODES[step.q]]);
    return {
      v: 1,
      s: state.sceneId,
      e: state.endingId,
      vars: state.vars,
      d,
      p,
      t: state.truncated,
      b: best,
      c: completed
    };
  }
  function restoreState(config, payload) {
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const p = payload;
      if (p.v !== 1) return null;
      const sceneIds = new Set(config.scenes.map((s2) => s2.id));
      const endingIds = new Set(config.endings.map((e2) => e2.id));
      const varIds = new Set(config.variables.map((v) => v.id));
      const s = p.s;
      if (s !== null && (typeof s !== "string" || !sceneIds.has(s))) return null;
      const e = p.e;
      if (e !== null && (typeof e !== "string" || !endingIds.has(e))) return null;
      if (s === null === (e === null)) return null;
      const varsRaw = p.vars;
      if (!varsRaw || typeof varsRaw !== "object" || Array.isArray(varsRaw)) return null;
      const varsObj = varsRaw;
      if (Object.keys(varsObj).length !== varIds.size) return null;
      const varDefs = new Map(config.variables.map((v) => [v.id, v]));
      const vars = {};
      for (const vid of varIds) {
        const val = varsObj[vid];
        if (typeof val !== "number" || !Number.isFinite(val)) return null;
        const varDef = varDefs.get(vid);
        vars[vid] = Math.min(varDef.max, Math.max(varDef.min, val));
      }
      const dictRaw = p.d;
      if (!Array.isArray(dictRaw) || !dictRaw.every((x) => typeof x === "string")) return null;
      const dict = dictRaw;
      const pathRaw = p.p;
      if (!Array.isArray(pathRaw)) return null;
      const choicesByScene = new Map(config.scenes.map((sc) => [sc.id, new Set(sc.choices.map((c) => c.id))]));
      const path = [];
      for (const step of pathRaw) {
        if (!Array.isArray(step) || step.length !== 3) return null;
        const [sceneIdx, choiceIdx, qCode] = step;
        if (typeof sceneIdx !== "number" || !Number.isInteger(sceneIdx) || sceneIdx < 0 || sceneIdx >= dict.length) return null;
        if (typeof choiceIdx !== "number" || !Number.isInteger(choiceIdx) || choiceIdx < 0 || choiceIdx >= dict.length) return null;
        const stepSceneId = dict[sceneIdx];
        const stepChoiceId = dict[choiceIdx];
        const choiceIds = choicesByScene.get(stepSceneId);
        if (!choiceIds || !choiceIds.has(stepChoiceId)) return null;
        if (qCode !== 0 && qCode !== 1 && qCode !== 2) return null;
        path.push({ s: stepSceneId, c: stepChoiceId, q: CODE_TO_QUALITY[qCode] });
      }
      if (typeof p.t !== "boolean") return null;
      if (typeof p.b !== "number" || !Number.isFinite(p.b)) return null;
      if (typeof p.c !== "boolean") return null;
      return {
        state: { sceneId: s, endingId: e, vars, path, truncated: p.t },
        best: p.b,
        completed: p.c
      };
    } catch {
      return null;
    }
  }

  // src/engine-runtime/branching-scenario/main.ts
  var QUALITY_TEXT = {
    best: "Best choice",
    acceptable: "Acceptable choice",
    poor: "Poor choice"
  };
  var QUALITY_GLYPH = {
    best: "\u25CF",
    // ●
    acceptable: "\u25D0",
    // ◐
    poor: "\u25CB"
    // ○
  };
  function salvageBestAndCompleted(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const p = payload;
    const b = p.b;
    const c = p.c;
    if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b > 100) return null;
    if (typeof c !== "boolean") return null;
    return { best: b, completed: c };
  }
  function mountBranchingScenario(root, config) {
    root.innerHTML = "";
    root.classList.add("ilb-scenario");
    root.setAttribute("role", "main");
    const mountId = `ilb-${Math.random().toString(36).slice(2, 9)}`;
    const scorm = typeof window !== "undefined" ? window.ILBScorm : void 0;
    let bestPct = 0;
    let reportedComplete = false;
    let scoreReported = false;
    let warnedSuspendLimit = false;
    let state;
    const saved = scorm == null ? void 0 : scorm.loadSuspendData();
    const restored = saved != null ? restoreState(config, saved) : null;
    if (restored) {
      state = restored.state;
      bestPct = restored.best;
      reportedComplete = restored.completed;
    } else {
      state = initialState(config);
      if (saved != null) {
        const salvaged = salvageBestAndCompleted(saved);
        if (salvaged) {
          bestPct = salvaged.best;
          reportedComplete = salvaged.completed;
        }
      }
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
    const sceneContainer = el("div", "ilb-scene");
    root.appendChild(sceneContainer);
    const hasVisibleVars = config.variables.some((v) => v.visible);
    const varsStatus = el("div", "ilb-vars-status");
    varsStatus.setAttribute("role", "status");
    varsStatus.setAttribute("aria-live", "polite");
    varsStatus.setAttribute("aria-atomic", "true");
    if (hasVisibleVars) root.appendChild(varsStatus);
    const choicesContainer = el("div", "ilb-choices");
    root.appendChild(choicesContainer);
    const debriefContainer = el("div", "ilb-debrief");
    debriefContainer.hidden = true;
    root.appendChild(debriefContainer);
    const needsFeedbackPanel = config.feedbackMode === "immediate" && config.scenes.some((s) => s.choices.some((c) => c.feedback));
    let feedbackPanel = null;
    let feedbackText = null;
    let continueBtn = null;
    if (needsFeedbackPanel) {
      feedbackPanel = el("div", "ilb-feedback");
      feedbackPanel.setAttribute("role", "status");
      feedbackPanel.setAttribute("aria-live", "polite");
      feedbackPanel.hidden = true;
      feedbackText = document.createElement("p");
      feedbackText.id = `${mountId}-feedback-text`;
      feedbackPanel.appendChild(feedbackText);
      continueBtn = document.createElement("button");
      continueBtn.type = "button";
      continueBtn.className = "ilb-btn ilb-continue-btn";
      continueBtn.textContent = "Continue";
      continueBtn.setAttribute("aria-describedby", feedbackText.id);
      continueBtn.addEventListener("click", () => completeTransition());
      feedbackPanel.appendChild(continueBtn);
      root.appendChild(feedbackPanel);
    }
    function updateVarsStatus() {
      if (!hasVisibleVars) return;
      const text = config.variables.filter((v) => v.visible).map((v) => `${v.label}: ${state.vars[v.id]}`).join(". ");
      setText(varsStatus, text);
    }
    function renderChoices() {
      choicesContainer.innerHTML = "";
      choicesContainer.hidden = false;
      const renderedForSceneId = state.sceneId;
      for (const choice of visibleChoices(config, state)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ilb-btn ilb-choice-btn";
        btn.textContent = choice.label;
        btn.addEventListener("click", () => handleChoiceClick(choice.id, renderedForSceneId));
        choicesContainer.appendChild(btn);
      }
    }
    function sceneHeading(scene) {
      if (scene.title) return scene.title;
      const index = config.scenes.findIndex((s) => s.id === scene.id);
      return `Part ${index + 1}`;
    }
    function renderScene(sceneId, focusHeading) {
      var _a;
      const scene = config.scenes.find((s) => s.id === sceneId);
      if (!scene) {
        console.error(`branching runtime: scene "${sceneId}" not found in config`);
        throw new Error("This lesson's content could not be loaded.");
      }
      if (feedbackPanel) feedbackPanel.hidden = true;
      debriefContainer.hidden = true;
      debriefContainer.innerHTML = "";
      sceneContainer.innerHTML = "";
      const isStart = sceneId === config.startSceneId;
      if (isStart) {
        if (config.role) {
          const roleLine = el("p", "ilb-role");
          roleLine.textContent = config.role;
          sceneContainer.appendChild(roleLine);
        }
        if (config.intro) {
          const intro = el("div", "ilb-intro");
          intro.innerHTML = config.intro;
          sceneContainer.appendChild(intro);
        }
      }
      const heading = document.createElement("h2");
      heading.tabIndex = -1;
      heading.textContent = sceneHeading(scene);
      sceneContainer.appendChild(heading);
      const body = el("div", "ilb-scene-body");
      body.innerHTML = scene.body;
      sceneContainer.appendChild(body);
      if (scene.imageUrl) {
        const img = document.createElement("img");
        img.className = "ilb-scene-image";
        img.src = scene.imageUrl;
        img.alt = scene.imageRole === "informative" ? (_a = scene.imageAlt) != null ? _a : "" : "";
        sceneContainer.appendChild(img);
      }
      updateVarsStatus();
      renderChoices();
      if (focusHeading) heading.focus();
    }
    function computeVisibleOtherLabelsPerStep() {
      const result = [];
      let replay = initialState(config);
      let fellBack = state.truncated;
      for (const step of state.path) {
        if (!fellBack && replay.sceneId !== step.s) fellBack = true;
        const stepScene = config.scenes.find((s) => s.id === step.s);
        if (!stepScene) {
          result.push([]);
          continue;
        }
        const visibleNow = fellBack ? stepScene.choices : visibleChoices(config, replay);
        result.push(visibleNow.filter((c) => c.id !== step.c).map((c) => c.label));
        if (!fellBack) {
          try {
            replay = applyChoice(config, replay, step.c);
          } catch {
            fellBack = true;
          }
        }
      }
      return result;
    }
    function renderEnding(focusHeading) {
      const ending = config.endings.find((e) => e.id === state.endingId);
      if (!ending) {
        console.error(`branching runtime: ending "${state.endingId}" not found in config`);
        throw new Error("This lesson's content could not be loaded.");
      }
      if (feedbackPanel) feedbackPanel.hidden = true;
      sceneContainer.innerHTML = "";
      const heading = document.createElement("h2");
      heading.tabIndex = -1;
      heading.textContent = ending.title;
      sceneContainer.appendChild(heading);
      const body = el("div", "ilb-scene-body");
      body.innerHTML = ending.body;
      sceneContainer.appendChild(body);
      const counts = { best: 0, acceptable: 0, poor: 0 };
      for (const step of state.path) counts[step.q]++;
      const parts = [];
      if (counts.best > 0) parts.push(`${counts.best} best`);
      if (counts.acceptable > 0) parts.push(`${counts.acceptable} acceptable`);
      if (counts.poor > 0) parts.push(`${counts.poor} poor`);
      const decisionsClause = parts.length > 0 ? `Decisions: ${parts.join(", ")}.` : "No decisions recorded.";
      const scoreLine = el("p", "ilb-score-line");
      scoreLine.textContent = `${decisionsClause} Score: ${scorePct(state)}%.`;
      sceneContainer.appendChild(scoreLine);
      updateVarsStatus();
      choicesContainer.innerHTML = "";
      choicesContainer.hidden = false;
      const startOverBtn = document.createElement("button");
      startOverBtn.type = "button";
      startOverBtn.className = "ilb-btn ilb-choice-btn ilb-start-over-btn";
      startOverBtn.textContent = "Start over";
      startOverBtn.addEventListener("click", () => handleStartOver());
      choicesContainer.appendChild(startOverBtn);
      debriefContainer.innerHTML = "";
      if (config.showPathInDebrief && state.path.length > 0) {
        debriefContainer.hidden = false;
        const debriefHeading = document.createElement("h3");
        debriefHeading.textContent = "Your path";
        debriefContainer.appendChild(debriefHeading);
        if (state.truncated) {
          const truncatedNote = el("p", "ilb-debrief-truncated-note");
          truncatedNote.textContent = "This summary shows your most recent decisions.";
          debriefContainer.appendChild(truncatedNote);
        }
        const othersPerStep = computeVisibleOtherLabelsPerStep();
        const ol = document.createElement("ol");
        ol.className = "ilb-debrief-list";
        state.path.forEach((step, i) => {
          var _a;
          const stepScene = config.scenes.find((s) => s.id === step.s);
          const choice = stepScene == null ? void 0 : stepScene.choices.find((c) => c.id === step.c);
          const li = document.createElement("li");
          li.className = "ilb-debrief-step";
          const sceneSpan = el("span", "ilb-debrief-scene");
          sceneSpan.textContent = `${stepScene ? sceneHeading(stepScene) : step.s}: `;
          li.appendChild(sceneSpan);
          const choiceSpan = el("span", "ilb-debrief-choice");
          choiceSpan.textContent = (_a = choice == null ? void 0 : choice.label) != null ? _a : step.c;
          li.appendChild(choiceSpan);
          const qualitySpan = el("span", "ilb-debrief-quality");
          qualitySpan.appendChild(document.createTextNode(" ("));
          const glyphSpan = document.createElement("span");
          glyphSpan.setAttribute("aria-hidden", "true");
          glyphSpan.textContent = QUALITY_GLYPH[step.q];
          qualitySpan.appendChild(glyphSpan);
          qualitySpan.appendChild(document.createTextNode(` ${QUALITY_TEXT[step.q]})`));
          li.appendChild(qualitySpan);
          const others = othersPerStep[i];
          if (others.length > 0) {
            const otherP = el("p", "ilb-debrief-other");
            otherP.textContent = `Other options: ${others.join(", ")}.`;
            li.appendChild(otherP);
          }
          if (config.feedbackMode === "debrief" && (choice == null ? void 0 : choice.feedback)) {
            const fb = el("p", "ilb-debrief-feedback");
            fb.innerHTML = choice.feedback;
            li.appendChild(fb);
          }
          ol.appendChild(li);
        });
        debriefContainer.appendChild(ol);
      }
      if (focusHeading) heading.focus();
    }
    function renderCurrent(focusHeading) {
      if (state.sceneId !== null) renderScene(state.sceneId, focusHeading);
      else renderEnding(focusHeading);
    }
    function reportScorm() {
      const pct = scorePct(state);
      const improved = pct > bestPct;
      if (improved) bestPct = pct;
      const isEnding = state.endingId !== null;
      const newlyCompleted = isEnding && !reportedComplete;
      if (newlyCompleted) reportedComplete = true;
      if (scorm && scorm.mode === "scorm") {
        if (improved || !scoreReported) {
          scoreReported = true;
          scorm.setScore(bestPct);
        }
        if (newlyCompleted) {
          scorm.setCompleted();
        }
        const ok = scorm.saveSuspendData(suspendPayload(state, bestPct, reportedComplete));
        if (!ok && !warnedSuspendLimit) {
          warnedSuspendLimit = true;
          console.warn("branching scenario progress exceeds SCORM suspend limit; resume disabled");
        }
      }
    }
    function completeTransition() {
      reportScorm();
      renderCurrent(true);
    }
    function handleChoiceClick(choiceId, expectedSceneId) {
      if (state.sceneId !== expectedSceneId) return;
      const chosen = visibleChoices(config, state).find((c) => c.id === choiceId);
      if (!chosen) return;
      state = applyChoice(config, state, choiceId);
      if (config.feedbackMode === "immediate" && chosen.feedback && feedbackPanel && feedbackText && continueBtn) {
        choicesContainer.hidden = true;
        feedbackText.innerHTML = chosen.feedback;
        feedbackPanel.hidden = false;
        continueBtn.focus();
      } else {
        completeTransition();
      }
    }
    function handleStartOver() {
      state = initialState(config);
      reportScorm();
      renderCurrent(true);
    }
    renderCurrent(false);
  }
  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  if (typeof window !== "undefined") {
    window.ILBEngine = { mount: mountBranchingScenario };
  }
})();
