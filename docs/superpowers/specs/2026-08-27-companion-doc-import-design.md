# Scenario Companion Doc Import: Design Spec

**Date:** 2026-08-27
**Status:** Draft for Tamara's review
**Depends on:** Branching Scenario milestone (merged; 488 tests)

## 1. Purpose

Kill the transcription friction in branching-scenario authoring (~70 fields + ~20 clicks for a 4-scene scenario). Designers and faculty write scenarios in a plain-text **companion doc**; the editor imports it in one paste, deterministically — no AI — through the same validation gates as hand-authoring. The doc template doubles as the faculty content-collection instrument, and the parser is the deterministic twin of the future CreateAI import seam (AI later maps *messy* docs onto this same path).

## 2. The format (the contract designers write)

Line-based, case-insensitive keywords, names not ids. Example is normative:

```
TITLE: Jury Deliberation
ROLE: You are a juror in a criminal trial.
INTRO: A verdict must be unanimous. The evidence is not as tidy as it first looks.
TRACK: Jury trust (0 to 100, start at 50, visible)
FEEDBACK: debrief

SCENE: The First Vote
The foreperson calls an early vote. The room leans guilty,
but you have doubts about the timeline evidence.

- Raise your doubts before anyone votes (BEST, Jury trust +10) -> The Timeline
  Feedback: Speaking up kept the deliberation grounded.
- Vote with the majority to keep things moving (POOR, Jury trust -10) -> Under Pressure
  Feedback: Momentum is not deliberation.
- Ask to re-examine the evidence list first (OK) -> The Timeline
  Feedback: A reasonable instinct, though it delays the harder conversation.

SCENE: Under Pressure
Two jurors push to finish before the weekend.

- Remind the room the standard is reasonable doubt (BEST, Jury trust +10) -> The Holdout
  Feedback: You reframed the disagreement around the standard of proof.
- Call a break (OK, only if Jury trust is at least 60) -> The Holdout
  Feedback: The room trusted you enough to reset.
- Suggest a quick second vote (POOR, Jury trust -10) -> ENDING: A verdict, but not deliberation
  Feedback: The vote closed the case without resolving the doubts.

ENDING: A verdict the room can stand behind
The deliberation stayed grounded in evidence, and the verdict follows the standard of proof.

ENDING: A verdict, but not deliberation
The vote ended the case, but the doubts were never resolved.
```

**Rules:**
- Directives: `TITLE:`, `ROLE:`, `INTRO:`, `TRACK:`, `FEEDBACK:` (immediate|debrief), `START:` (scene name; default = first scene), `SCENE:`, `ENDING:`. Unknown directive → report error, line skipped.
- `TRACK: <Name> (<min> to <max>, start at <initial>[, visible])` — one per variable, ≤8.
- Body text = plain lines under a SCENE/ENDING until the next directive or choice. Paragraph breaks preserved (blank line = new `<p>`). Plain text only; imported text is sanitized like any authored text.
- Choice lines start `-` under a scene: `- <label> (<QUALITY>[, <Track> +N/-N ...][, only if <Track> is at least|at most N | between N and M]) -> <Destination>`.
  - QUALITY: `BEST` | `OK`/`ACCEPTABLE` | `POOR`. Required — missing → report error, choice defaults to OK with a warning? NO: **error, choice imported as OK, flagged** (import must land *something* editable; the report is the contract).
  - Destination: a scene name, an ending name, or explicit `ENDING: <name>` / `SCENE: <name>`. Resolved case-insensitively against titles; unresolved → error, choice imported pointing at a generated placeholder ending "Unresolved destination" so the draft stays loadable, flagged loudly.
  - `Feedback:` indented line(s) following a choice attach to it.
- Names → ids via the existing slugify (collision-suffixed). All ≤ schema caps; over-cap → error naming the cap.

## 3. Parser + serializer (pure modules)

- `src/lib/engines/branching-scenario/companion-doc.ts`:
  - `parseCompanionDoc(text): { config: unknown; report: ImportIssue[] }` — `ImportIssue = { line: number; severity: "error" | "warning"; message: string }`. Never throws; always returns a best-effort config plus a complete report (nothing silently dropped or assumed). The config then flows through `validateBranchingConfig` like any draft — double gate, no new trust.
  - `serializeCompanionDoc(config): string` — the reverse: generate a companion doc from an existing config (send a built scenario back to faculty for revision). Enables the definitive test harness: **parse(serialize(config)) round-trips** for the jury starter and property-style fixtures.
- Windows/Word friendly: tolerate CRLF, smart quotes (normalized), tabs/spaces for the Feedback indent, and the `–`/`—` dash variants in the `->` arrow position (accept `->`, `→`; report-warn others).

## 4. Editor UI

In the Branching editor's Scenario section: **"Import from companion doc"** disclosure — big labeled textarea (paste target), Import button, and a **"Download the template"** link (static `public/companion-doc-template.txt`, human instructions inline at top as comments the parser ignores: lines starting `#`).
- Import **replaces the current draft** → explicit confirm ("This replaces everything in this interactive. The current draft cannot be recovered.") before applying.
- After import: config lands via the normal draft-save path (validation errors appear in the existing Issues panel); the **import report** renders as its own list (line numbers + messages), focus moves to the report heading (announcement contract), report stays visible until the next import or dismiss.
- Serializer exposed as **"Copy as companion doc"** button in the same disclosure.

## 5. Out of scope (this pass)

.docx file upload/parsing (paste covers Word via clipboard; docx ingestion is a follow-up), AI mapping of unstructured docs (CreateAI phase — same seam), a sandbox-engine table format (worth doing later; friction lives in branching), localization of keywords.

## 6. Testing / acceptance

- Parser: the normative example parses to a config that validates with zero errors; every rule above has a positive + negative case (unknown directive, missing quality, unresolved destination placeholder, over-cap, CRLF/smart-quote/arrow tolerance, TRACK grammar, condition grammar incl. between, START directive, FEEDBACK directive, multi-paragraph bodies, feedback attachment).
- Round-trip: serialize(jury starter) → parse → validate ok + structurally equal (ids may differ; compare via titles/labels/qualities/effects/goTo-resolved-titles).
- Report completeness: a doc with 5 seeded flaws yields exactly 5 issues with correct line numbers.
- Editor: browser E2E — paste the normative example into a blank branching interactive, import, confirm, scenario plays end-to-end in preview, export scans clean; a flawed doc shows the report with line numbers and still lands an editable draft.
- All existing 488 tests stay green; no engine-runtime changes (this is authoring-side only — verify zero public/engines diff).

## 7. Acceptance (Tamara's bar)

Paste a scenario written in the template → one confirm click → a playable, exportable draft, with every deviation from the format named by line number. Seventy fields become one paste.
