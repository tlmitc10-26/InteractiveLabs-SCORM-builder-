"use strict";
(() => {
  // src/lib/engines/case-workspace/scoring.ts
  function evidenceRatio(config, chosenId, includedIds) {
    const supports = [];
    const contradicts = [];
    for (const m of config.expertMap) {
      if (m.conclusionId !== chosenId) continue;
      (m.role === "supports" ? supports : contradicts).push(m.artifactId);
    }
    const included = new Set(includedIds);
    const includedSupports = supports.filter((id) => included.has(id)).length;
    const includedContradicts = contradicts.filter((id) => included.has(id)).length;
    const num = Math.max(0, includedSupports - includedContradicts);
    const den = Math.max(1, supports.length);
    return { num, den };
  }
  function reasonRatio(config, chosenId, selectedReasonIds) {
    const conclusion = config.conclusions.find((c) => c.id === chosenId);
    if (!conclusion) return { num: 0, den: 1 };
    const sound = [];
    const flawed = [];
    for (const r of conclusion.reasons) (r.sound ? sound : flawed).push(r.id);
    const selected = new Set(selectedReasonIds);
    const selSound = sound.filter((id) => selected.has(id)).length;
    const selFlawed = flawed.filter((id) => selected.has(id)).length;
    const num = Math.max(0, selSound - selFlawed);
    const den = Math.max(1, sound.length);
    return { num, den };
  }
  function creditRatio(credit) {
    switch (credit) {
      case "full":
        return { num: 2, den: 2 };
      case "partial":
        return { num: 1, den: 2 };
      case "none":
        return { num: 0, den: 2 };
    }
  }
  function combine2(e, r, we, wr, weightSum) {
    const num = we * e.num * r.den + wr * r.num * e.den;
    const den = weightSum * e.den * r.den;
    return Math.round(100 * num / den);
  }
  function combine3(e, r, c, we, wr, wc, weightSum) {
    const num = we * e.num * r.den * c.den + wr * r.num * e.den * c.den + wc * c.num * e.den * r.den;
    const den = weightSum * e.den * r.den * c.den;
    return Math.round(100 * num / den);
  }
  function scoreCase(config, chosenId, includedIds, selectedReasonIds) {
    const conclusion = config.conclusions.find((c) => c.id === chosenId);
    const evidence = evidenceRatio(config, chosenId, includedIds);
    const reason = reasonRatio(config, chosenId, selectedReasonIds);
    const credit = conclusion ? conclusion.credit : null;
    if (config.scoringMode === "single") {
      if (credit !== "full") {
        return { evidence, reason, credit, totalPct: 0 };
      }
      return { evidence, reason, credit, totalPct: combine3(evidence, reason, creditRatio("full"), 50, 30, 20, 100) };
    }
    if (config.scoringMode === "argument-quality") {
      return { evidence, reason, credit, totalPct: combine2(evidence, reason, 50, 30, 80) };
    }
    const cr = creditRatio(credit != null ? credit : "none");
    return { evidence, reason, credit, totalPct: combine3(evidence, reason, cr, 50, 30, 20, 100) };
  }

  // src/lib/engines/case-workspace/state.ts
  function initialState() {
    return {
      step: "brief",
      caseFile: [],
      reviewed: /* @__PURE__ */ new Set(),
      chosen: void 0,
      selectedReasons: /* @__PURE__ */ new Set(),
      bestPct: 0,
      completed: false,
      scoreReported: false
    };
  }
  function openCaseFile(state) {
    return { ...state, step: "workspace" };
  }
  function reviewArtifact(config, state, artifactId) {
    if (!config.artifacts.some((a) => a.id === artifactId)) throw new Error(`artifact "${artifactId}" does not exist`);
    if (state.reviewed.has(artifactId)) return state;
    const reviewed = new Set(state.reviewed);
    reviewed.add(artifactId);
    return { ...state, reviewed };
  }
  function addToCaseFile(config, state, artifactId, strength) {
    if (!config.artifacts.some((a) => a.id === artifactId)) throw new Error(`artifact "${artifactId}" does not exist`);
    const caseFile = state.caseFile.filter(([id]) => id !== artifactId);
    caseFile.push([artifactId, strength]);
    return { ...state, caseFile };
  }
  function removeFromCaseFile(state, artifactId) {
    return { ...state, caseFile: state.caseFile.filter(([id]) => id !== artifactId) };
  }
  function goToConclude(state) {
    return { ...state, step: "conclude" };
  }
  function backToWorkspace(state) {
    return { ...state, step: "workspace" };
  }
  function chooseConclusion(config, state, conclusionId) {
    if (!config.conclusions.some((c) => c.id === conclusionId)) throw new Error(`conclusion "${conclusionId}" does not exist`);
    if (state.chosen === conclusionId) return state;
    return { ...state, chosen: conclusionId, selectedReasons: /* @__PURE__ */ new Set() };
  }
  function toggleReason(config, state, reasonId) {
    if (!state.chosen) throw new Error("toggleReason requires a chosen conclusion");
    const conclusion = config.conclusions.find((c) => c.id === state.chosen);
    if (!conclusion || !conclusion.reasons.some((r) => r.id === reasonId)) {
      throw new Error(`reason "${reasonId}" does not belong to the chosen conclusion "${state.chosen}"`);
    }
    const selectedReasons = new Set(state.selectedReasons);
    if (selectedReasons.has(reasonId)) selectedReasons.delete(reasonId);
    else selectedReasons.add(reasonId);
    return { ...state, selectedReasons };
  }
  function submit(config, state) {
    if (!state.chosen) throw new Error("submit requires a chosen conclusion");
    if (state.selectedReasons.size === 0) throw new Error("submit requires at least one selected reason");
    const includedIds = state.caseFile.map(([id]) => id);
    const score = scoreCase(config, state.chosen, includedIds, [...state.selectedReasons]);
    const bestPct = Math.max(state.bestPct, score.totalPct);
    return {
      state: { ...state, step: "debrief", bestPct, completed: true, scoreReported: true },
      score
    };
  }
  function startOver(state) {
    return {
      step: "brief",
      caseFile: [],
      reviewed: /* @__PURE__ */ new Set(),
      chosen: void 0,
      selectedReasons: /* @__PURE__ */ new Set(),
      bestPct: state.bestPct,
      completed: state.completed,
      scoreReported: false
    };
  }
  function suspendPayload(state) {
    const payload = {
      v: 1,
      cf: state.caseFile.map(([id, strength]) => [id, strength]),
      rv: [...state.reviewed],
      sel: [...state.selectedReasons],
      b: state.bestPct,
      c: state.completed,
      step: state.step
    };
    if (state.chosen !== void 0) payload.ch = state.chosen;
    return payload;
  }
  var VALID_STEPS = ["brief", "workspace", "conclude", "debrief"];
  function restoreState(config, payload) {
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const p = payload;
      if (p.v !== 1) return null;
      if (typeof p.step !== "string" || !VALID_STEPS.includes(p.step)) return null;
      const step = p.step;
      const artifactIds = new Set(config.artifacts.map((a) => a.id));
      const conclusionsById = new Map(config.conclusions.map((c) => [c.id, c]));
      if (!Array.isArray(p.cf)) return null;
      const caseFile = [];
      const seenArtifacts = /* @__PURE__ */ new Set();
      for (const entry of p.cf) {
        if (!Array.isArray(entry) || entry.length !== 2) return null;
        const [id, strength] = entry;
        if (typeof id !== "string" || !artifactIds.has(id)) return null;
        if (strength !== "strong" && strength !== "weak") return null;
        if (seenArtifacts.has(id)) return null;
        seenArtifacts.add(id);
        caseFile.push([id, strength]);
      }
      if (!Array.isArray(p.rv) || !p.rv.every((x) => typeof x === "string" && artifactIds.has(x))) return null;
      const reviewed = new Set(p.rv);
      let chosen;
      if (p.ch !== void 0) {
        if (typeof p.ch !== "string" || !conclusionsById.has(p.ch)) return null;
        chosen = p.ch;
      }
      if (!Array.isArray(p.sel) || !p.sel.every((x) => typeof x === "string")) return null;
      const selRaw = p.sel;
      if (selRaw.length > 0) {
        if (!chosen) return null;
        const reasonIds = new Set(conclusionsById.get(chosen).reasons.map((r) => r.id));
        if (!selRaw.every((id) => reasonIds.has(id))) return null;
      }
      const selectedReasons = new Set(selRaw);
      if (step === "debrief" && (!chosen || selRaw.length === 0)) return null;
      if (typeof p.b !== "number" || !Number.isFinite(p.b)) return null;
      const bestPct = Math.min(100, Math.max(0, p.b));
      if (typeof p.c !== "boolean") return null;
      return { step, caseFile, reviewed, chosen, selectedReasons, bestPct, completed: p.c, scoreReported: false };
    } catch {
      return null;
    }
  }

  // src/engine-runtime/case-workspace/main.ts
  var KIND_LABEL = { text: "Text", image: "Image", table: "Table" };
  var ARTIFACT_VERDICT_SUFFIX = {
    "included-support": "best",
    "left-out-support": "ok",
    "misused-contradict": "poor"
  };
  var ARTIFACT_VERDICT_TEXT = {
    "included-support": "included in your case file. This supports the conclusion.",
    "left-out-support": "not included, but it supports the conclusion.",
    "misused-contradict": "included in your case file, but it contradicts the conclusion.",
    "excluded-contradict": "correctly left out. It contradicts the conclusion."
  };
  var REASON_VERDICT_SUFFIX = {
    "sound-selected": "best",
    "sound-missed": "ok",
    "flawed-selected": "poor"
  };
  var REASON_VERDICT_TEXT = {
    "sound-selected": "selected. This reasoning holds up.",
    "sound-missed": "not selected, but this reasoning holds up.",
    "flawed-selected": "selected, but this reasoning has a flaw.",
    "flawed-correctly-unselected": "not selected. Good: this reasoning has a flaw."
  };
  function classifyArtifact(role, included) {
    if (role === "supports") return included ? "included-support" : "left-out-support";
    return included ? "misused-contradict" : "excluded-contradict";
  }
  function scoreLineText(mode, score) {
    const evidenceText = `Evidence: ${score.evidence.num} of ${score.evidence.den}.`;
    const reasonText = `Reasoning: ${score.reason.num} of ${score.reason.den}.`;
    if (mode === "argument-quality") {
      return `${evidenceText} ${reasonText} Score: ${score.totalPct}%.`;
    }
    if (mode === "single" && score.credit !== "full") {
      return `${evidenceText} ${reasonText} This is not the case's credited conclusion, so no credit is given. Score: ${score.totalPct}%.`;
    }
    return `${evidenceText} ${reasonText} Conclusion credit: ${score.credit}. Score: ${score.totalPct}%.`;
  }
  function salvageBestAndCompleted(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const p = payload;
    const b = p.b;
    const c = p.c;
    if (typeof b !== "number" || !Number.isFinite(b) || b < 0 || b > 100) return null;
    if (typeof c !== "boolean") return null;
    return { best: b, completed: c };
  }
  function mountCaseWorkspace(root, config) {
    root.innerHTML = "";
    root.classList.add("ilb-case");
    root.setAttribute("role", "main");
    const mountId = `ilb-${Math.random().toString(36).slice(2, 9)}`;
    const scorm = typeof window !== "undefined" ? window.ILBScorm : void 0;
    let warnedSuspendLimit = false;
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
    const card = el("div", "ilb-case-card");
    root.appendChild(card);
    const caseStatus = el("div", "ilb-case-status");
    caseStatus.setAttribute("role", "status");
    caseStatus.setAttribute("aria-live", "polite");
    caseStatus.setAttribute("aria-atomic", "true");
    card.appendChild(caseStatus);
    const stepContainer = el("div", "ilb-step");
    card.appendChild(stepContainer);
    let viewerContainer;
    let caseFilePanel;
    const artifactGlyphs = /* @__PURE__ */ new Map();
    let currentArtifactId = null;
    let reasonSection;
    let submitBtn;
    let submitHint;
    function updateSubmitDisabledUI() {
      const disabled = !state.chosen || state.selectedReasons.size === 0;
      submitBtn.disabled = disabled;
      submitHint.hidden = !disabled;
      if (disabled) submitBtn.setAttribute("aria-describedby", submitHint.id);
      else submitBtn.removeAttribute("aria-describedby");
    }
    function persistSuspend() {
      if (!scorm || scorm.mode !== "scorm") return;
      const ok = scorm.saveSuspendData(suspendPayload(state));
      if (!ok && !warnedSuspendLimit) {
        warnedSuspendLimit = true;
        console.warn("case workspace progress exceeds SCORM suspend limit; resume disabled");
      }
    }
    function updateCaseFileStatus() {
      setText(caseStatus, `Case file: ${state.caseFile.length} of ${config.artifacts.length} artifacts`);
    }
    function renderBrief(focusHeading) {
      var _a;
      updateCaseFileStatus();
      stepContainer.innerHTML = "";
      retriggerEnter(stepContainer);
      const header = el("div", "ilb-case-header ilb-case-header--band");
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
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "ilb-btn ilb-btn-pill";
      openBtn.textContent = "Open the case file.";
      openBtn.addEventListener("click", () => {
        if (state.step !== "brief") return;
        state = openCaseFile(state);
        persistSuspend();
        enterWorkspace(true);
      });
      stepContainer.appendChild(openBtn);
      if (focusHeading) heading.focus();
    }
    function enterWorkspace(focusHeading) {
      currentArtifactId = null;
      stepContainer.innerHTML = "";
      retriggerEnter(stepContainer);
      artifactGlyphs.clear();
      const heading = document.createElement("h2");
      heading.tabIndex = -1;
      heading.textContent = "Workspace";
      stepContainer.appendChild(heading);
      const list = el("div", "ilb-artifact-list");
      for (const artifact of config.artifacts) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ilb-btn ilb-artifact-btn";
        const titleSpan = document.createElement("span");
        titleSpan.className = "ilb-artifact-title";
        titleSpan.textContent = artifact.title;
        btn.appendChild(titleSpan);
        const kindSpan = document.createElement("span");
        kindSpan.className = "ilb-artifact-kind";
        kindSpan.textContent = KIND_LABEL[artifact.kind];
        btn.appendChild(kindSpan);
        const glyph = document.createElement("span");
        glyph.className = "ilb-artifact-reviewed";
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = state.reviewed.has(artifact.id) ? "\u25CF" : "\u25CB";
        btn.appendChild(glyph);
        btn.addEventListener("click", () => handleSelectArtifact(artifact.id));
        list.appendChild(btn);
        artifactGlyphs.set(artifact.id, glyph);
      }
      stepContainer.appendChild(list);
      viewerContainer = el("div", "ilb-viewer");
      stepContainer.appendChild(viewerContainer);
      renderViewer(false);
      caseFilePanel = el("div", "ilb-case-file-panel");
      stepContainer.appendChild(caseFilePanel);
      renderCaseFilePanel(false);
      const readyBtn = document.createElement("button");
      readyBtn.type = "button";
      readyBtn.className = "ilb-btn ilb-btn-pill";
      readyBtn.textContent = "Ready to conclude";
      readyBtn.addEventListener("click", () => {
        if (state.step !== "workspace") return;
        state = goToConclude(state);
        persistSuspend();
        renderConclude(true);
      });
      stepContainer.appendChild(readyBtn);
      updateCaseFileStatus();
      if (focusHeading) heading.focus();
    }
    function handleSelectArtifact(artifactId) {
      if (state.step !== "workspace") return;
      const wasReviewed = state.reviewed.has(artifactId);
      state = reviewArtifact(config, state, artifactId);
      if (!wasReviewed) {
        const glyph = artifactGlyphs.get(artifactId);
        if (glyph) glyph.textContent = "\u25CF";
      }
      currentArtifactId = artifactId;
      persistSuspend();
      renderViewer(false);
    }
    function renderViewer(focusAction) {
      var _a, _b, _c, _d;
      viewerContainer.innerHTML = "";
      if (!currentArtifactId) {
        const empty = el("p", "ilb-viewer-empty");
        empty.textContent = "Select an artifact from the list to review it.";
        viewerContainer.appendChild(empty);
        return;
      }
      const artifact = config.artifacts.find((a) => a.id === currentArtifactId);
      if (!artifact) return;
      const h3 = document.createElement("h3");
      h3.textContent = artifact.title;
      viewerContainer.appendChild(h3);
      if (artifact.sourceLine) {
        const src = el("p", "ilb-artifact-source");
        src.textContent = artifact.sourceLine;
        viewerContainer.appendChild(src);
      }
      const body = el("div", "ilb-artifact-body");
      if (artifact.kind === "text") {
        body.innerHTML = (_a = artifact.body) != null ? _a : "";
        viewerContainer.appendChild(body);
      } else if (artifact.kind === "image") {
        const img = document.createElement("img");
        img.className = "ilb-artifact-image";
        img.src = (_b = artifact.imageUrl) != null ? _b : "";
        img.alt = artifact.imageRole === "informative" ? (_c = artifact.imageAlt) != null ? _c : "" : "";
        body.appendChild(img);
        viewerContainer.appendChild(body);
      } else if (artifact.kind === "table" && artifact.table) {
        const table = document.createElement("table");
        table.className = "ilb-artifact-table";
        const caption = document.createElement("caption");
        caption.textContent = artifact.table.caption || artifact.title;
        table.appendChild(caption);
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        for (const h of artifact.table.headers) {
          const th = document.createElement("th");
          th.scope = "col";
          th.textContent = h;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        for (const row of artifact.table.rows) {
          const tr = document.createElement("tr");
          for (const cell of row) {
            const td = document.createElement("td");
            td.textContent = cell;
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        viewerContainer.appendChild(table);
      }
      const actions = el("div", "ilb-viewer-actions");
      const included = state.caseFile.some(([id]) => id === currentArtifactId);
      const artifactIdAtRender = currentArtifactId;
      let removeBtn = null;
      let addStrongBtn = null;
      if (included) {
        removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "ilb-btn ilb-btn-pill ilb-btn-pill--ghost";
        removeBtn.textContent = "Remove from case file";
        removeBtn.addEventListener("click", () => {
          if (state.step !== "workspace" || currentArtifactId !== artifactIdAtRender) return;
          state = removeFromCaseFile(state, artifactIdAtRender);
          persistSuspend();
          updateCaseFileStatus();
          renderCaseFilePanel(false);
          renderViewer(true);
        });
        actions.appendChild(removeBtn);
      } else {
        addStrongBtn = document.createElement("button");
        addStrongBtn.type = "button";
        addStrongBtn.className = "ilb-btn ilb-btn-pill";
        addStrongBtn.textContent = "Add as strong support";
        addStrongBtn.addEventListener("click", () => handleAddToCaseFile(artifactIdAtRender, "strong"));
        actions.appendChild(addStrongBtn);
        const addWeakBtn = document.createElement("button");
        addWeakBtn.type = "button";
        addWeakBtn.className = "ilb-btn ilb-btn-pill ilb-btn-pill--ghost";
        addWeakBtn.textContent = "Add as weak support";
        addWeakBtn.addEventListener("click", () => handleAddToCaseFile(artifactIdAtRender, "weak"));
        actions.appendChild(addWeakBtn);
      }
      viewerContainer.appendChild(actions);
      if (focusAction) (_d = removeBtn != null ? removeBtn : addStrongBtn) == null ? void 0 : _d.focus();
    }
    function handleAddToCaseFile(artifactId, strength) {
      if (state.step !== "workspace" || currentArtifactId !== artifactId) return;
      state = addToCaseFile(config, state, artifactId, strength);
      persistSuspend();
      updateCaseFileStatus();
      renderCaseFilePanel(false);
      renderViewer(true);
    }
    function renderCaseFilePanel(focusHeadingAfterRemove) {
      caseFilePanel.innerHTML = "";
      const heading = document.createElement("h3");
      heading.tabIndex = -1;
      heading.textContent = "Your case file";
      caseFilePanel.appendChild(heading);
      if (state.caseFile.length === 0) {
        const empty = el("p", "ilb-case-file-empty");
        empty.textContent = "No artifacts added yet.";
        caseFilePanel.appendChild(empty);
      } else {
        const list = document.createElement("ul");
        list.className = "ilb-case-file-list";
        for (const [artifactId, strength] of state.caseFile) {
          const artifact = config.artifacts.find((a) => a.id === artifactId);
          if (!artifact) continue;
          const li = document.createElement("li");
          li.className = "ilb-case-file-row";
          const label = document.createElement("span");
          label.textContent = `${artifact.title}: `;
          const strengthSpan = document.createElement("span");
          strengthSpan.className = "ilb-case-file-strength";
          strengthSpan.textContent = strength === "strong" ? "Strong support" : "Weak support";
          label.appendChild(strengthSpan);
          li.appendChild(label);
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "ilb-btn ilb-case-file-remove";
          removeBtn.textContent = `Remove ${artifact.title} from case file`;
          removeBtn.addEventListener("click", () => handlePanelRemove(artifactId));
          li.appendChild(removeBtn);
          list.appendChild(li);
        }
        caseFilePanel.appendChild(list);
      }
      if (focusHeadingAfterRemove) heading.focus();
    }
    function handlePanelRemove(artifactId) {
      if (state.step !== "workspace") return;
      state = removeFromCaseFile(state, artifactId);
      persistSuspend();
      updateCaseFileStatus();
      renderCaseFilePanel(true);
      if (currentArtifactId === artifactId) renderViewer(false);
    }
    function renderConclude(focusHeading) {
      stepContainer.innerHTML = "";
      retriggerEnter(stepContainer);
      const heading = document.createElement("h2");
      heading.tabIndex = -1;
      heading.textContent = "Conclude";
      stepContainer.appendChild(heading);
      const conclusionGroupName = `${mountId}-conclusion`;
      const fieldset = document.createElement("fieldset");
      fieldset.className = "ilb-conclusion-group";
      const legend = document.createElement("legend");
      legend.textContent = "Choose the conclusion this case supports.";
      fieldset.appendChild(legend);
      for (const conclusion of config.conclusions) {
        const label = document.createElement("label");
        label.className = "ilb-conclusion-card";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = conclusionGroupName;
        radio.value = conclusion.id;
        radio.checked = state.chosen === conclusion.id;
        radio.addEventListener("change", () => {
          if (state.step !== "conclude") return;
          const prevChosen = state.chosen;
          state = chooseConclusion(config, state, conclusion.id);
          persistSuspend();
          if (state.chosen !== prevChosen) renderReasonSection(true);
        });
        label.appendChild(radio);
        const labelText = document.createElement("span");
        labelText.className = "ilb-conclusion-label";
        labelText.textContent = conclusion.label;
        label.appendChild(labelText);
        fieldset.appendChild(label);
      }
      stepContainer.appendChild(fieldset);
      reasonSection = el("div", "ilb-reason-section");
      stepContainer.appendChild(reasonSection);
      submitHint = el("p", "ilb-submit-hint");
      submitHint.id = `${mountId}-submit-hint`;
      submitHint.textContent = "Select at least one reason before you can submit.";
      stepContainer.appendChild(submitHint);
      submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "ilb-btn ilb-btn-pill";
      submitBtn.textContent = "Submit conclusion";
      submitBtn.addEventListener("click", () => {
        if (state.step !== "conclude" || !state.chosen || state.selectedReasons.size === 0) return;
        handleSubmit();
      });
      stepContainer.appendChild(submitBtn);
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "ilb-btn ilb-btn-pill ilb-btn-pill--ghost";
      backBtn.textContent = "Back to the case file";
      backBtn.addEventListener("click", () => {
        if (state.step !== "conclude") return;
        state = backToWorkspace(state);
        persistSuspend();
        enterWorkspace(true);
      });
      stepContainer.appendChild(backBtn);
      renderReasonSection(false);
      if (focusHeading) heading.focus();
    }
    function renderReasonSection(focusLegend) {
      reasonSection.innerHTML = "";
      updateSubmitDisabledUI();
      if (!state.chosen) return;
      const conclusion = config.conclusions.find((c) => c.id === state.chosen);
      const conclusionIdAtRender = state.chosen;
      const fieldset = document.createElement("fieldset");
      fieldset.className = "ilb-reason-group";
      const legend = document.createElement("legend");
      legend.tabIndex = -1;
      legend.textContent = `Which of these justify ${conclusion.label}? Select all that apply.`;
      fieldset.appendChild(legend);
      for (const reason of conclusion.reasons) {
        const label = document.createElement("label");
        label.className = "ilb-reason-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.selectedReasons.has(reason.id);
        checkbox.addEventListener("change", () => {
          if (state.step !== "conclude" || state.chosen !== conclusionIdAtRender) return;
          state = toggleReason(config, state, reason.id);
          persistSuspend();
          updateSubmitDisabledUI();
        });
        label.appendChild(checkbox);
        const text = document.createElement("span");
        text.textContent = reason.text;
        label.appendChild(text);
        fieldset.appendChild(label);
      }
      reasonSection.appendChild(fieldset);
      if (focusLegend) legend.focus();
    }
    function handleSubmit() {
      const result = submit(config, state);
      state = result.state;
      if (scorm && scorm.mode === "scorm") {
        scorm.setScore(state.bestPct);
        scorm.setCompleted();
      }
      persistSuspend();
      renderDebrief(true);
    }
    function renderDebrief(focusHeading) {
      const conclusion = config.conclusions.find((c) => c.id === state.chosen);
      if (!state.chosen || !conclusion) {
        state = initialState();
        renderBrief(true);
        return;
      }
      stepContainer.innerHTML = "";
      retriggerEnter(stepContainer);
      const includedIds = state.caseFile.map(([id]) => id);
      const score = scoreCase(config, state.chosen, includedIds, [...state.selectedReasons]);
      const resultHead = el("div", "ilb-result-head");
      stepContainer.appendChild(resultHead);
      const eyebrow = el("p", "ilb-eyebrow");
      eyebrow.textContent = "Case complete";
      resultHead.appendChild(eyebrow);
      const heading = document.createElement("h2");
      heading.tabIndex = -1;
      heading.textContent = conclusion.label;
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
      scoreLine.textContent = scoreLineText(config.scoringMode, score);
      resultHead.appendChild(scoreLine);
      const includedSet = new Set(includedIds);
      const artifactEntries = config.expertMap.filter((m) => m.conclusionId === state.chosen).map((m) => ({ artifactId: m.artifactId, verdict: classifyArtifact(m.role, includedSet.has(m.artifactId)) }));
      const counts = {
        "included-support": 0,
        "left-out-support": 0,
        "misused-contradict": 0,
        "excluded-contradict": 0
      };
      for (const entry of artifactEntries) counts[entry.verdict]++;
      const flaggedVerdicts = ["included-support", "left-out-support", "misused-contradict"];
      if (flaggedVerdicts.some((v) => counts[v] > 0)) {
        const chipsWrap = el("div", "ilb-quality-chips");
        chipsWrap.setAttribute("aria-hidden", "true");
        for (const v of flaggedVerdicts) {
          if (counts[v] === 0) continue;
          const chip = document.createElement("span");
          chip.className = `ilb-qchip ilb-qchip--${ARTIFACT_VERDICT_SUFFIX[v]}`;
          chip.textContent = `${counts[v]} ${v.replace(/-/g, " ")}`;
          chipsWrap.appendChild(chip);
        }
        resultHead.appendChild(chipsWrap);
      }
      if (artifactEntries.length > 0) {
        const comparisonHeading = document.createElement("h3");
        comparisonHeading.textContent = "How your case file compares";
        stepContainer.appendChild(comparisonHeading);
        const ul = document.createElement("ul");
        ul.className = "ilb-comparison-list";
        for (const entry of artifactEntries) {
          const artifact = config.artifacts.find((a) => a.id === entry.artifactId);
          if (!artifact) continue;
          const suffix = ARTIFACT_VERDICT_SUFFIX[entry.verdict];
          const li = document.createElement("li");
          li.className = suffix ? `ilb-comparison-row ilb-comparison-row--${suffix}` : "ilb-comparison-row";
          li.textContent = `${artifact.title}: ${ARTIFACT_VERDICT_TEXT[entry.verdict]}`;
          ul.appendChild(li);
        }
        stepContainer.appendChild(ul);
      }
      const reasonHeading = document.createElement("h3");
      reasonHeading.textContent = "Your reasoning";
      stepContainer.appendChild(reasonHeading);
      const reasonList = document.createElement("ul");
      reasonList.className = "ilb-reason-review-list";
      for (const reason of conclusion.reasons) {
        const selected = state.selectedReasons.has(reason.id);
        const verdict = reason.sound ? selected ? "sound-selected" : "sound-missed" : selected ? "flawed-selected" : "flawed-correctly-unselected";
        const suffix = REASON_VERDICT_SUFFIX[verdict];
        const li = document.createElement("li");
        li.className = suffix ? `ilb-comparison-row ilb-comparison-row--${suffix}` : "ilb-comparison-row";
        let text = `${reason.text}: ${REASON_VERDICT_TEXT[verdict]}`;
        if (verdict === "flawed-selected" && reason.flawNote) text += ` ${reason.flawNote}`;
        li.textContent = text;
        reasonList.appendChild(li);
      }
      stepContainer.appendChild(reasonList);
      const rationaleHeading = document.createElement("h3");
      rationaleHeading.textContent = "Expert's rationale";
      stepContainer.appendChild(rationaleHeading);
      const rationale = el("div", "ilb-expert-rationale");
      rationale.innerHTML = conclusion.expertRationale;
      stepContainer.appendChild(rationale);
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
      currentArtifactId = null;
      persistSuspend();
      renderBrief(true);
    }
    updateCaseFileStatus();
    switch (state.step) {
      case "brief":
        renderBrief(false);
        break;
      case "workspace":
        enterWorkspace(false);
        break;
      case "conclude":
        renderConclude(false);
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
    window.ILBEngine = { mount: mountCaseWorkspace };
  }
})();
