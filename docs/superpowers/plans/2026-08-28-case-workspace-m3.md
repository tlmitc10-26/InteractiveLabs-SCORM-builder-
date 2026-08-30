# Case Workspace M3 (Exemplar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "The Ladder Incident" exemplar per spec §7 — brief-first, then starter + committed companion doc + delivery zip. Suite baseline: 1079.

**Execution notes:** branch `feature/case-exemplar` off `main`. Same environment/gates/commit rules as M1/M2. Standing content rules apply (professional register, fictional entities, name diversity, no length cue).

### Task 1: Content brief (opus-grade content work)

`docs/exemplars/brief-ladder-incident.md`, same nine-heading structure as the six existing briefs. Contents per spec §7: learning objective (learner-visible); discipline pattern paragraph; full configuration (mode best-supported); COMPLETE artifact texts (5-7 artifacts: mix of text/table kinds — e.g., incident report, maintenance log table, witness statement, training records table, safety-policy excerpt, photo description as TEXT kind since image artifacts are editor-only in docs; every artifact with sourceLine); 3 conclusions (equipment failure best / employee negligence defensible / inadequate training or procedures — one none) each with expertRationale + 3-5 reasons (sound + flawed with flawNotes — flaw types: character reasoning, post-hoc, overreach, missing-evidence); expert map (supports/contradicts with strengths, ≥1 red-herring artifact unmapped); **witness score walkthrough**: one named learner path (case file + conclusion + reasons) with every component hand-computed (e/r/c num/den + final pct) — a locked test fixture; reasons length-cue check per spec §7's pooled formulation; verification section (map gate arithmetic like prior briefs). Verify the whole thing parses via a scratch check against the REAL parser (write brief's companion-doc section verbatim-ready, zero issues) — the Task-4 precedent. Commit `docs: Ladder Incident content brief`.

### Task 2: Transcription + starter + doc + tests

Starter in `src/lib/engines/case-workspace/starters.ts` (group "exemplar", pattern description) transcribed from the brief, zero invention; committed `docs/exemplars/ladder-incident.companion.txt` = `serializeCaseCompanionDoc({...config, title: label})` byte-parity test; extend `tests/exemplar-content.test.ts`: validates, mode/conclusion-count contract, witness walkthrough asserted through the REAL scoring functions (exact locked pct), reasons length-cue gate (spec §7 formulation: flawed uniquely-longest ≤40% of conclusions AND uniquely-shortest ≤40%; advisory mean band), red-herring present (≥1 unmapped artifact), zip <40KB via real assemble. Generic axe/starter loops pick it up. Commit `feat: Ladder Incident exemplar (starter + companion doc)`.

### Task 3: Delivery + merge prep

Full gates; browser: create from starter, play a full path to debrief, verify expert-map comparison renders; export via real route → `C:\Users\tamar\Downloads\InteractiveLabs-Ladder-Incident-scorm12.zip` (title "The Ladder Incident"); independent verification (manifest/hashes/config spot-checks). README sentence. DO NOT merge — final content review first (opus, dean/SME lens like the exemplar-library round).
