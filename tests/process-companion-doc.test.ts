/**
 * Test suite for src/lib/engines/process-simulator/companion-doc.ts —
 * mirrors tests/case-companion-doc.test.ts's shape (normative example, per-
 * rule positive/negative cases, tolerances, report completeness, round-
 * trip, template guards), adapted to this engine's own grammar
 * (TITLE/INTRO/OPENING/EXPERTNOTE/ACTION rather than
 * TITLE/INTRO/MODE/ARTIFACT/CONCLUSION/MAP).
 *
 * COMPARISON CONTRACT for round-trip tests: two `ProcessConfig`s are
 * compared "structurally equal" by reshaping each into a label-keyed plain
 * object (`toLabeledShape`) so two configs that differ only in generated
 * ids (this is a label-based format, like all three sibling formats)
 * compare equal via `toEqual`. Rich-text fields are compared via
 * `stripTags`. The round-trip's REPRESENTABLE set: title/intro/opening/
 * expertNote; per action: label/required/requires(by label)/outcome/
 * consequence/consequenceNote. The documented LOSSY set: `headerColor`,
 * and any multi-paragraph rich field (collapsed to one line).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseProcessCompanionDoc, serializeProcessCompanionDoc, type ProcessConfigLike } from "@/lib/engines/process-simulator/companion-doc";
import type { ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { validateProcessConfig, processConfigSchema, type ProcessConfig } from "@/lib/engines/process-simulator/schema";
import { PROCESS_STARTERS } from "@/lib/engines/process-simulator/starters";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineOf(sourceLines: string[], needle: string): number {
  const idx = sourceLines.findIndex((l) => l.includes(needle));
  if (idx === -1) throw new Error(`fixture bug: "${needle}" not found in fixture`);
  return idx + 1;
}

function errors(report: ImportIssue[]): ImportIssue[] {
  return report.filter((r) => r.severity === "error");
}
function warnings(report: ImportIssue[]): ImportIssue[] {
  return report.filter((r) => r.severity === "warning");
}
function stripTags(s: string | undefined): string {
  return (s ?? "").replace(/<[^>]+>/g, "").trim();
}

function toLabeledShape(config: ProcessConfig) {
  const labelOf = (id: string) => config.actions.find((a) => a.id === id)?.label ?? id;
  return {
    title: config.title,
    intro: stripTags(config.intro),
    opening: stripTags(config.opening),
    expertNote: config.expertNote ? stripTags(config.expertNote) : undefined,
    actions: config.actions.map((a) => ({
      label: a.label,
      required: a.required,
      requires: a.requires ? [...a.requires].map(labelOf).sort() : undefined,
      outcome: a.outcome ? stripTags(a.outcome) : undefined,
      consequence: a.consequence ? stripTags(a.consequence) : undefined,
      consequenceNote: a.consequenceNote,
    })),
  };
}

// ---------------------------------------------------------------------------
// Normative example (spec §6)
// ---------------------------------------------------------------------------

const NORMATIVE_DOC = `TITLE: Evidence Intake
INTRO: Learn to collect and log evidence in an order that survives cross-examination.
OPENING: A sealed scene, one item to collect, and a log that must hold up in court.
EXPERTNOTE: The order that survives cross-examination is the one where nothing touched the item before the record existed.

ACTION: Photograph the item in place (required)
Outcome: The item's position is recorded before anything moves.

ACTION: Put on gloves (required)
Outcome: Contamination risk is controlled before contact.

ACTION: Collect the item (required, after: Photograph the item in place, Put on gloves)
Outcome: The item is bagged.
Consequence: The item moved before it was photographed; its position now rests on memory, not the record.
Note: Collection has two prerequisites; skipping either compromises the record.

ACTION: Ask the officer to move the item closer (distractor)
Consequence: The chain of custody now starts with an undocumented move.
Note: Convenience is not a custody procedure.
`;

describe("parseProcessCompanionDoc — normative example", () => {
  const { config, report } = parseProcessCompanionDoc(NORMATIVE_DOC);

  it("never throws and returns a config that validates with zero errors and zero warnings", () => {
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("captures TITLE/INTRO/OPENING/EXPERTNOTE and all 4 actions", () => {
    const c = config as ProcessConfig;
    expect(c.title).toBe("Evidence Intake");
    expect(stripTags(c.intro)).toContain("cross-examination");
    expect(stripTags(c.opening)).toContain("sealed scene");
    expect(stripTags(c.expertNote)).toContain("survives cross-examination");
    expect(c.actions).toHaveLength(4);
  });

  it("resolves required/distractor markers, outcome/consequence/note, and after: by label", () => {
    const c = config as ProcessConfig;
    const photo = c.actions.find((a) => a.label === "Photograph the item in place")!;
    const gloves = c.actions.find((a) => a.label === "Put on gloves")!;
    const collect = c.actions.find((a) => a.label === "Collect the item")!;
    const ask = c.actions.find((a) => a.label === "Ask the officer to move the item closer")!;
    expect(photo.required).toBe(true);
    expect(collect.required).toBe(true);
    expect(ask.required).toBe(false);
    expect(collect.requires?.sort()).toEqual([gloves.id, photo.id].sort());
    expect(stripTags(collect.consequence)).toContain("rests on memory");
    expect(collect.consequenceNote).toContain("two prerequisites");
    expect(ask.outcome).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ACTION marker grammar
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc — ACTION marker grammar", () => {
  it("coerces a missing marker to required when an Outcome: line is present, with an error", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Do the thing\nOutcome: It happened.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "Do the thing")!;
    expect(a.required).toBe(true);
    expect(errors(report).some((e) => /missing its required/.test(e.message))).toBe(true);
  });

  it("coerces a missing marker to distractor when no Outcome: line is present, with an error", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Do the thing\nConsequence: It went wrong.\nNote: Never do this.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "Do the thing")!;
    expect(a.required).toBe(false);
    expect(errors(report).some((e) => /missing its required/.test(e.message))).toBe(true);
  });

  it("coerces an unrecognized marker the same way, with a distinct error message", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Do the thing (mandatory)\nOutcome: It happened.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "Do the thing")!;
    expect(a.required).toBe(true);
    expect(errors(report).some((e) => /isn't "\(required\)"/.test(e.message))).toBe(true);
  });

  it("after: naming a distractor drops the edge with an error", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Wrong move (distractor)\nConsequence: Bad.\nNote: Bad.\n\nACTION: Real step (required, after: Wrong move)\nOutcome: Fine.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const real = c.actions.find((x) => x.label === "Real step")!;
    expect(real.requires).toBeUndefined();
    expect(errors(report).some((e) => /names "Wrong move", a distractor/.test(e.message))).toBe(true);
  });

  it("after: naming an unresolved label errors and drops that entry only", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: First (required)\nOutcome: A.\n\nACTION: Second (required, after: First, Nonexistent)\nOutcome: B.\nConsequence: C.\nNote: D.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const first = c.actions.find((x) => x.label === "First")!;
    const second = c.actions.find((x) => x.label === "Second")!;
    expect(second.requires).toEqual([first.id]);
    expect(errors(report).some((e) => /doesn't exist: "Nonexistent"/.test(e.message))).toBe(true);
  });

  it("distractor actions may not carry after: — the whole clause is dropped with an error", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: First (required)\nOutcome: A.\n\nACTION: Wrong (distractor, after: First)\nConsequence: C.\nNote: D.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const wrong = c.actions.find((x) => x.label === "Wrong")!;
    expect(wrong.requires).toBeUndefined();
    expect(errors(report).some((e) => /distractor actions must not carry after:/.test(e.message))).toBe(true);
  });

  it("caps after: at 6 entries, truncating the rest with an error", () => {
    const reqLines = Array.from({ length: 7 }, (_, i) => `ACTION: Req${i} (required)\nOutcome: O${i}.\n`).join("\n");
    const afterList = Array.from({ length: 7 }, (_, i) => `Req${i}`).join(", ");
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\n${reqLines}\nACTION: Last (required, after: ${afterList})\nOutcome: L.\nConsequence: C.\nNote: N.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const last = c.actions.find((x) => x.label === "Last")!;
    expect(last.requires).toHaveLength(6);
    expect(errors(report).some((e) => /too many prerequisites/.test(e.message))).toBe(true);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Label risk + duplicates
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc — risky labels and duplicates", () => {
  it("warns on a label containing '(' ')' or ',', naming the label (does not error -- the shipped blank starter itself uses a comma in a label)", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Do the (thing) (required)\nOutcome: O.\n`;
    const { report } = parseProcessCompanionDoc(doc);
    expect(warnings(report).some((w) => /label contains/.test(w.message))).toBe(true);
  });

  it("duplicate required labels: both lines error, the second is skipped and pruned from after: resolution", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Same name (required)\nOutcome: First.\n\nACTION: Same name (required)\nOutcome: Second.\n\nACTION: Third (required, after: Same name)\nOutcome: T.\nConsequence: C.\nNote: N.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const sameNames = c.actions.filter((a) => a.label === "Same name");
    expect(sameNames).toHaveLength(1);
    expect(stripTags(sameNames[0].outcome)).toBe("First.");
    expect(errors(report).some((e) => /duplicate required action label/.test(e.message))).toBe(true);
  });

  it("duplicate distractor labels are tolerated with a warning, both kept", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Same wrong move (distractor)\nConsequence: A.\nNote: A.\n\nACTION: Same wrong move (distractor)\nConsequence: B.\nNote: B.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    expect(c.actions.filter((a) => a.label === "Same wrong move")).toHaveLength(2);
    expect(warnings(report).some((w) => /duplicate distractor label/.test(w.message))).toBe(true);
    expect(errors(report).some((e) => /duplicate distractor/.test(e.message))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cycle breaking
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc — cycle breaking (spec §6 review #8)", () => {
  it("breaks a 2-cycle by dropping the edge on the LATER-numbered line, naming both actions", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Alpha (required, after: Beta)\nOutcome: A.\nConsequence: C.\nNote: N.\n\nACTION: Beta (required, after: Alpha)\nOutcome: B.\nConsequence: C.\nNote: N.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const alpha = c.actions.find((a) => a.label === "Alpha")!;
    const beta = c.actions.find((a) => a.label === "Beta")!;
    // Beta is declared on the later line, so ITS edge (Beta -> Alpha) is dropped.
    expect(beta.requires).toBeUndefined();
    expect(alpha.requires).toEqual([beta.id]);
    expect(errors(report).some((e) => /"Beta": its after: on "Alpha" creates a prerequisite cycle/.test(e.message))).toBe(true);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("breaks a 3-cycle, leaving an acyclic, validating graph", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: A (required, after: C)\nOutcome: A.\nConsequence: C.\nNote: N.\n\nACTION: B (required, after: A)\nOutcome: B.\nConsequence: C.\nNote: N.\n\nACTION: C (required, after: B)\nOutcome: C.\nConsequence: C.\nNote: N.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    expect(errors(report).some((e) => /creates a prerequisite cycle/.test(e.message))).toBe(true);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Field-requirement matrix coercions
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc — field-requirement matrix", () => {
  it("floors a missing Outcome: on a required action with a placeholder + error", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Bare (required)\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "Bare")!;
    expect(a.outcome).toBe("<p>Outcome to be written.</p>");
    expect(errors(report).some((e) => /need an Outcome: line/.test(e.message))).toBe(true);
  });

  it("drops an Outcome: authored on a distractor, with an error", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Wrong (distractor)\nOutcome: Should not exist.\nConsequence: C.\nNote: N.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "Wrong")!;
    expect(a.outcome).toBeUndefined();
    expect(errors(report).some((e) => /distractor actions must not carry an Outcome/.test(e.message))).toBe(true);
  });

  it("floors missing Consequence:/Note: on a distractor with placeholders + errors", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Wrong (distractor)\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "Wrong")!;
    expect(a.consequence).toBe("<p>Consequence to be written.</p>");
    expect(a.consequenceNote).toBe("Note to be written.");
    expect(errors(report).some((e) => /needs a Consequence: line/.test(e.message))).toBe(true);
    expect(errors(report).some((e) => /needs a Note: line/.test(e.message))).toBe(true);
  });

  it("floors missing Consequence:/Note: on a required action with a prerequisite", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: First (required)\nOutcome: A.\n\nACTION: Second (required, after: First)\nOutcome: B.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const second = c.actions.find((x) => x.label === "Second")!;
    expect(second.consequence).toBe("<p>Consequence to be written.</p>");
    expect(second.consequenceNote).toBe("Note to be written.");
    expect(errors(report).some((e) => /needs a Consequence: line/.test(e.message))).toBe(true);
  });

  it("drops an illegal Consequence:/Note: on a prerequisite-free required action, with errors", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Free (required)\nOutcome: A.\nConsequence: Should not exist.\nNote: Should not exist.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "Free")!;
    expect(a.consequence).toBeUndefined();
    expect(a.consequenceNote).toBeUndefined();
    expect(errors(report).some((e) => /must not carry a Consequence: line/.test(e.message))).toBe(true);
    expect(errors(report).some((e) => /Note: line only applies alongside/.test(e.message))).toBe(true);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("duplicate Outcome:/Consequence:/Note: lines: first wins, with an error", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Bare (required)\nOutcome: First.\nOutcome: Second.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "Bare")!;
    expect(stripTags(a.outcome)).toBe("First.");
    expect(errors(report).some((e) => /duplicate Outcome: line/.test(e.message))).toBe(true);
  });

  it("an unrecognized non-directive line inside an ACTION block errors and is skipped (no free bodies)", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Bare (required)\nOutcome: A.\nThis is stray prose that means nothing here.\n`;
    const { report } = parseProcessCompanionDoc(doc);
    expect(errors(report).some((e) => /unrecognized line inside its block/.test(e.message))).toBe(true);
  });

  it("a comment line between two sub-lines is invisible (comment-skipping)", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Bare (required)\nOutcome: A.\n# a faculty note\nConsequence: should not apply (prereq-free)\n`;
    const { report } = parseProcessCompanionDoc(doc);
    // Consequence is still illegal here (prereq-free required) regardless of
    // the comment sitting between it and Outcome: -- the comment must not
    // hide the Consequence: line from the "no free bodies" unknown-line scan
    // OR from being recognized and then flagged as illegal.
    expect(errors(report).some((e) => /must not carry a Consequence: line/.test(e.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc — floors", () => {
  it("pads to 4 actions / 2 required when fewer are declared, landing a config that validates", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: Only one (required)\nOutcome: A.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    expect(c.actions.length).toBeGreaterThanOrEqual(4);
    expect(c.actions.filter((a) => a.required).length).toBeGreaterThanOrEqual(2);
    expect(warnings(report).some((w) => /added placeholder required action/.test(w.message))).toBe(true);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("floors the illegally-attemptable rule with a placeholder distractor when no prereq edge and no distractor exist", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: A (required)\nOutcome: A.\n\nACTION: B (required)\nOutcome: B.\n\nACTION: C (required)\nOutcome: C.\n\nACTION: D (required)\nOutcome: D.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    expect(c.actions.some((a) => !a.required)).toBe(true);
    expect(errors(report).some((e) => /every learner would score 100 unconditionally/.test(e.message))).toBe(true);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("no INTRO/OPENING given floors placeholders with warnings (schema requires both)", () => {
    const doc = `TITLE: T\n\nACTION: A (required)\nOutcome: A.\n\nACTION: B (required, after: A)\nOutcome: B.\nConsequence: C.\nNote: N.\n\nACTION: C (required)\nOutcome: C.\n\nACTION: D (distractor)\nConsequence: D.\nNote: D.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    expect(warnings(report).some((w) => /no INTRO given/.test(w.message))).toBe(true);
    expect(warnings(report).some((w) => /no OPENING given/.test(w.message))).toBe(true);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("no TITLE given floors a placeholder title with a warning", () => {
    const doc = `INTRO: I\nOPENING: O\n\nACTION: A (required)\nOutcome: A.\n\nACTION: B (required, after: A)\nOutcome: B.\nConsequence: C.\nNote: N.\n\nACTION: C (required)\nOutcome: C.\n\nACTION: D (distractor)\nConsequence: D.\nNote: D.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    expect(c.title).toBe("Imported procedure");
    expect(warnings(report).some((w) => /no TITLE given/.test(w.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown directive outside a block
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc — unknown directive outside a block", () => {
  it("reports an error and skips the line for an unrecognized ALL-CAPS-colon directive at the top level", () => {
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\nSITUATION: not a real directive\n\nACTION: A (required)\nOutcome: A.\n\nACTION: B (required, after: A)\nOutcome: B.\nConsequence: C.\nNote: N.\n\nACTION: C (required)\nOutcome: C.\n\nACTION: D (distractor)\nConsequence: D.\nNote: D.\n`;
    const { report } = parseProcessCompanionDoc(doc);
    expect(errors(report).some((e) => /unknown directive: "SITUATION:/.test(e.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BOM/CRLF/smart-quote tolerance
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc — BOM/CRLF/smart-quote tolerance", () => {
  it("tolerates a leading UTF-8 BOM, CRLF line endings, and smart quotes, without shifting line numbers", () => {
    const doc = "﻿TITLE: Learner’s Procedure\r\nINTRO: “Quoted” intro.\r\nOPENING: O\r\n\r\nACTION: A (required)\r\nOutcome: A.\r\n\r\nACTION: B (required, after: A)\r\nOutcome: B.\r\nConsequence: C.\r\nNote: N.\r\n\r\nACTION: Bad (required)\r\n";
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    expect(c.title).toBe("Learner's Procedure");
    expect(stripTags(c.intro)).toBe('"Quoted" intro.');
    const badLine = errors(report).find((e) => /"Bad"/.test(e.message))?.line;
    const sourceLines = doc.replace(/\r\n/g, "\n").split("\n");
    expect(badLine).toBe(lineOf(sourceLines, "ACTION: Bad"));
  });
});

// ---------------------------------------------------------------------------
// Report completeness and ordering
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc — report completeness and ordering", () => {
  it("a doc with 5 seeded flaws yields issues (errors + one warning) at ascending line numbers, at the right lines", () => {
    // Flaws: (1) missing marker on "Odd one" (line 5, error); (2) label with
    // a paren on "Bad(label)" (line 8, warning); (3) after: naming a
    // distractor "Wrong move" (line 11, error); (4) duplicate required
    // label "First" (lines 14 and 17, error); (5) an unknown line inside a
    // block (line 20, error).
    const lines = [
      "TITLE: T",
      "INTRO: I",
      "OPENING: O",
      "",
      "ACTION: Odd one",
      "Outcome: has outcome so coerces required.",
      "",
      "ACTION: Bad(label) (required)",
      "Outcome: A.",
      "",
      "ACTION: Wrong move (distractor)",
      "Consequence: C.",
      "Note: N.",
      "",
      "ACTION: First (required, after: Wrong move)",
      "Outcome: A.",
      "",
      "ACTION: First (required)",
      "Outcome: B.",
      "",
      "ACTION: Stray (required)",
      "Outcome: A.",
      "stray line with no meaning",
    ];
    const doc = lines.join("\n") + "\n";
    const { report } = parseProcessCompanionDoc(doc);
    expect(report.map((r) => r.line)).toEqual([...report.map((r) => r.line)].sort((a, b) => a - b));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "ACTION: Odd one"))).toBe(true);
    expect(warnings(report).some((w) => w.line === lineOf(lines, "Bad(label)"))).toBe(true);
    expect(errs.some((e) => e.line === lineOf(lines, "after: Wrong move"))).toBe(true);
    expect(errs.some((e) => e.line === lineOf(lines, "ACTION: First (required)"))).toBe(true);
    expect(errs.some((e) => e.line === lineOf(lines, "stray line with no meaning"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

describe("parseProcessCompanionDoc / serializeProcessCompanionDoc — HTML-escaping", () => {
  it("escapes &, <, > in INTRO/OPENING/Outcome/Consequence before wrapping in <p>", () => {
    const doc = `TITLE: T\nINTRO: A & B < C > D\nOPENING: O\n\nACTION: A (required)\nOutcome: X & Y\n`;
    const { config } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    expect(c.intro).toBe("<p>A &amp; B &lt; C &gt; D</p>");
    expect(c.actions[0].outcome).toBe("<p>X &amp; Y</p>");
  });

  it("round-trips an outcome containing '&' without double-escaping, idempotent across a second round trip", () => {
    const cfg = processConfigSchema.parse({
      ...PROCESS_STARTERS.blank.config,
      title: "T",
      actions: PROCESS_STARTERS.blank.config.actions.map((a, i) =>
        i === 0 ? { ...a, outcome: "<p>Salt &amp; pepper</p>" } : a,
      ),
    });
    const text1 = serializeProcessCompanionDoc(cfg);
    const { config: cfg2 } = parseProcessCompanionDoc(text1);
    const text2 = serializeProcessCompanionDoc(cfg2 as ProcessConfig);
    expect(text1).toBe(text2);
    expect((cfg2 as ProcessConfig).actions[0].outcome).toBe("<p>Salt &amp; pepper</p>");
  });
});

// ---------------------------------------------------------------------------
// Serializer: risky-label warning + lossy header
// ---------------------------------------------------------------------------

describe("serializeProcessCompanionDoc — risky-label warning coverage", () => {
  it('flags labels containing "(", ")", ",", or "after:"', () => {
    const cfg: ProcessConfigLike = {
      title: "T", intro: "<p>I</p>", opening: "<p>O</p>",
      actions: [
        { id: "a", label: "Do (this)", required: true, outcome: "<p>A</p>" },
        { id: "b", label: "Do, that", required: true, outcome: "<p>B</p>" },
        { id: "c", label: "The after: thing", required: true, outcome: "<p>C</p>" },
        { id: "d", label: "Plain label", required: true, outcome: "<p>D</p>" },
      ],
    };
    const text = serializeProcessCompanionDoc(cfg);
    expect(text).toContain('"Do (this)"');
    expect(text).toContain('"Do, that"');
    expect(text).toContain('"The after: thing"');
    expect(text).not.toContain('"Plain label"');
  });
});

describe("serializeProcessCompanionDoc — lossy-feature header block content", () => {
  it("names the dropped header color and collapsed multi-paragraph fields", () => {
    const cfg: ProcessConfigLike = {
      title: "T", intro: "<p>Para one.</p><p>Para two.</p>", opening: "<p>O</p>", headerColor: "primary",
      actions: [
        { id: "a", label: "First", required: true, outcome: "<p>A</p>" },
        { id: "b", label: "Second", required: true, requires: ["a"], outcome: "<p>B</p>", consequence: "<p>C</p>", consequenceNote: "N" },
        { id: "c", label: "Third", required: true, outcome: "<p>C</p>" },
        { id: "d", label: "Wrong", required: false, consequence: "<p>D</p>", consequenceNote: "N" },
      ],
    };
    const text = serializeProcessCompanionDoc(cfg);
    expect(text).toContain('the header color ("primary")');
    expect(text).toContain("multi-paragraph text collapsed to one line in INTRO");
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("serializeProcessCompanionDoc — round-trip", () => {
  const MAX_FEATURE_CONFIG: ProcessConfig = processConfigSchema.parse({
    title: "Evidence Intake",
    intro: "<p>Learn to collect and log evidence in an order that survives cross-examination.</p>",
    opening: "<p>A sealed scene, one item to collect, and a log that must hold up in court.</p>",
    expertNote: "<p>The order that survives cross-examination is the one where nothing touched the item before the record existed.</p>",
    actions: [
      { id: "photo", label: "Photograph the item in place", required: true, outcome: "<p>The item's position is recorded before anything moves.</p>" },
      { id: "gloves", label: "Put on gloves", required: true, outcome: "<p>Contamination risk is controlled before contact.</p>" },
      {
        id: "collect", label: "Collect the item", required: true, requires: ["photo", "gloves"],
        outcome: "<p>The item is bagged.</p>",
        consequence: "<p>The item moved before it was photographed; its position now rests on memory, not the record.</p>",
        consequenceNote: "Collection has two prerequisites; skipping either compromises the record.",
      },
      {
        id: "ask", label: "Ask the officer to move the item closer", required: false,
        consequence: "<p>The chain of custody now starts with an undocumented move.</p>",
        consequenceNote: "Convenience is not a custody procedure.",
      },
    ],
  });

  it("round-trips a max-feature fixture: serialize -> parse -> validate ok, structurally equal via labels", () => {
    const text = serializeProcessCompanionDoc(MAX_FEATURE_CONFIG);
    const { config, report } = parseProcessCompanionDoc(text);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(toLabeledShape(r.config)).toEqual(toLabeledShape(MAX_FEATURE_CONFIG));
  });

  it("round-trips the blank starter too", () => {
    const starter = processConfigSchema.parse({ ...PROCESS_STARTERS.blank.config, title: "Blank" });
    const text = serializeProcessCompanionDoc(starter);
    const { config, report } = parseProcessCompanionDoc(text);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("produces byte-identical output when re-serializing a re-parsed max-feature doc", () => {
    const text1 = serializeProcessCompanionDoc(MAX_FEATURE_CONFIG);
    const { config } = parseProcessCompanionDoc(text1);
    const r = validateProcessConfig(config);
    if (!r.ok) throw new Error(r.errors.join("; "));
    const text2 = serializeProcessCompanionDoc(r.config);
    expect(text2).toBe(text1);
  });
});

// ---------------------------------------------------------------------------
// capRichHtml post-escape cap
// ---------------------------------------------------------------------------

describe("capRichHtml — caps the POST-escape length, not the pre-escape length", () => {
  it("a 700-'&'-character outcome (3500 chars once escaped) is truncated and still validates", () => {
    const raw = "&".repeat(700);
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: A (required)\nOutcome: ${raw}\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    const a = c.actions.find((x) => x.label === "A")!;
    expect(a.outcome!.length).toBeLessThanOrEqual(1500);
    expect(warnings(report).some((w) => /outcome is longer than 1500/.test(w.message))).toBe(true);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("a 200-character label is truncated with a warning", () => {
    const raw = "x".repeat(250);
    const doc = `TITLE: T\nINTRO: I\nOPENING: O\n\nACTION: ${raw} (required)\nOutcome: A.\n`;
    const { config, report } = parseProcessCompanionDoc(doc);
    const c = config as ProcessConfig;
    expect(c.actions[0].label.length).toBe(200);
    expect(warnings(report).some((w) => /action label is longer than 200/.test(w.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

describe("companion-doc-process-template.txt (public/, faculty-facing, serializer-generated)", () => {
  const templatePath = join(process.cwd(), "public", "companion-doc-process-template.txt");
  const readTemplate = (): string => readFileSync(templatePath, "utf8");

  const TEMPLATE_HEADER = [
    "# Welcome! This is a companion doc for building a process simulator --",
    "# learners perform actions from a menu in an order that respects each",
    "# action's prerequisites; a wrong or premature action produces a",
    "# realistic consequence and lets the learner continue. Fill in your",
    "# own actions and send this file back. No special software or",
    "# training is needed to use it.",
    "# Lines starting with # (like these) are comments and are ignored.",
    "# Each ACTION is required (part of the correct path) or a distractor",
    "# (always wrong), like this:",
    "#   ACTION: Photograph the item in place (required)",
    "#   Outcome: The item's position is recorded before anything moves.",
    "#",
    "#   ACTION: Collect the item (required, after: Photograph the item in",
    "#   place, Put on gloves)",
    "#   Outcome: The item is bagged.",
    "#   Consequence: The item moved before it was photographed; its",
    "#   position now rests on memory, not the record.",
    "#   Note: Collection has two prerequisites; skipping either",
    "#   compromises the record.",
    "#",
    "#   ACTION: Ask the officer to move the item closer (distractor)",
    "#   Consequence: The chain of custody now starts with an undocumented",
    "#   move.",
    "#   Note: Convenience is not a custody procedure.",
    "# \"after:\" lists the OTHER required actions (by label) that must be",
    "# done first -- list every one that applies, separated by commas.",
    "# Outcome:/Consequence:/Note: may appear in any order right after an",
    "# ACTION line, each at most once. Keep action labels plain: a label",
    "# containing \"(\", \")\", \",\", or \"after:\" can confuse this format when",
    "# it is read back in.",
    "# When you are done, save and share this file with whoever is",
    "# building the lesson.",
  ].join("\n");

  const TEMPLATE_CONFIG: ProcessConfig = processConfigSchema.parse({
    title: "Evidence Intake",
    intro: "<p>Learn to collect and log evidence in an order that survives cross-examination.</p>",
    opening: "<p>A sealed scene, one item to collect, and a log that must hold up in court.</p>",
    expertNote: "<p>The order that survives cross-examination is the one where nothing touched the item before the record existed.</p>",
    actions: [
      { id: "photo", label: "Photograph the item in place", required: true, outcome: "<p>The item's position is recorded before anything moves.</p>" },
      { id: "gloves", label: "Put on gloves", required: true, outcome: "<p>Contamination risk is controlled before contact.</p>" },
      {
        id: "collect", label: "Collect the item", required: true, requires: ["photo", "gloves"],
        outcome: "<p>The item is bagged.</p>",
        consequence: "<p>The item moved before it was photographed; its position now rests on memory, not the record.</p>",
        consequenceNote: "Collection has two prerequisites; skipping either compromises the record.",
      },
      {
        id: "ask", label: "Ask the officer to move the item closer", required: false,
        consequence: "<p>The chain of custody now starts with an undocumented move.</p>",
        consequenceNote: "Convenience is not a custody procedure.",
      },
    ],
  });

  it("byte-matches the header + serializer output for the template's source config (drift test)", () => {
    const generated = `${TEMPLATE_HEADER}\n\n${serializeProcessCompanionDoc(TEMPLATE_CONFIG)}`;
    expect(readTemplate()).toBe(generated);
  });

  it("parses with zero ERRORS and zero WARNINGS (a clean template)", () => {
    const { report } = parseProcessCompanionDoc(readTemplate());
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report), JSON.stringify(report)).toHaveLength(0);
  });

  it("parses to a config that validates via validateProcessConfig", () => {
    const { config } = parseProcessCompanionDoc(readTemplate());
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("has no em dashes or en dashes anywhere (faculty-facing plain punctuation)", () => {
    expect(readTemplate()).not.toMatch(/[–—]/);
  });

  it("lives outside public/engines and is absent from the engines manifest (scanner/manifest untouched)", () => {
    const manifest = readFileSync(join(process.cwd(), "public", "engines", "engines.manifest.json"), "utf8");
    expect(manifest).not.toMatch(/companion-doc-process-template/);
  });
});
