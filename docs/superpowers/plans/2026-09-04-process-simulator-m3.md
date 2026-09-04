# Process Simulator M3 (Exemplar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Evidence Intake" exemplar per spec §7. Suite baseline: 1365.

**Execution notes:** branch `feature/process-exemplar` off `main`. Same environment/gates/commit rules. Standing content rules + spec §7's scope statement (ONE fictional agency's SOP; local policy governs; "admissible"/"thrown out" banned; per-edge rationale table SME-signed).

### Task 1: Content brief (opus-grade)

`docs/exemplars/brief-evidence-intake.md`, nine-heading structure. ~9 required actions (secure scene, gloves, photograph, sketch/measure, collect, seal, label, log, transfer) with GENUINE order flexibility expressed in the prerequisite graph (only edges a SME would defend); ~4 distractors with realistic consequences; the scope statement verbatim in the learner-visible intro; per-edge rationale table (general principle per edge); complete outcome/consequence/consequenceNote texts; witness walkthrough through the REAL scoring functions on a rounding boundary (locked); no-giveaway gates computed (pooled mean band; no distractor uniquely longest/shortest); banned-words check. VERIFY pre-commit: the brief's §5 companion-doc block parses via the REAL parseProcessCompanionDoc with zero issues AND validates; every number is program output. Commit `docs: Evidence Intake content brief`.

### Task 2: Transcription + starter + doc + tests

Committed doc = serializer output (byte-parity vs `serializeProcessCompanionDoc({...starter.config, title: starter.label})`); starter (group "exemplar", pattern description) ≡ parse(doc) via structural parity; extend `tests/exemplar-content.test.ts`: validates, action/edge-count contract, witness fixture (exact pct through real scoring), no-giveaway gates, banned-words test ("admissible", "thrown out" absent from every learner-visible string), zip <40KB via real assemble; generic loops pick it up. Commit `feat: Evidence Intake exemplar (starter + companion doc)`.

### Task 3: Delivery prep

Full gates; browser: create from starter, play the witness path + one deliberately messy path, verify debrief accounting; export → `C:\Users\tamar\Downloads\InteractiveLabs-Evidence-Intake-scorm12.zip` (title "Evidence Intake"); independent verification. README sentence (separate commit). DO NOT merge — SME content review first (opus: law-enforcement procedure accuracy, evidence-handling realism, scope-statement adequacy, tone).
