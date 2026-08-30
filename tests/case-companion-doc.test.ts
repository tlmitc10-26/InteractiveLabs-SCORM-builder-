/**
 * Test suite for src/lib/engines/case-workspace/companion-doc.ts — mirrors
 * tests/sandbox-companion-doc.test.ts's shape (normative example, per-rule
 * positive/negative cases, tolerances, report completeness, round-trip,
 * template guards), adapted to this engine's own grammar
 * (TITLE/INTRO/MODE/ARTIFACT/CONCLUSION/MAP rather than flat INPUT/OUTPUT).
 *
 * COMPARISON CONTRACT for round-trip tests (plan Task 1's required
 * statement): two `CaseConfig`s are compared "structurally equal" by
 * reshaping each into a label/title-keyed plain object (`toLabeledShape`)
 * so two configs that differ only in generated ids (this is a title-based
 * format, like both sibling formats) compare equal via `toEqual`. Rich-text
 * fields are compared via `stripTags` (crude, but sufficient: both sides of
 * a round trip go through the identical `<p>`-paragraph structure, so
 * stripping tags on both sides yields the same string even for a
 * multi-paragraph body/rationale where naive tag-stripping loses the
 * paragraph boundary — mirrors both sibling suites' own `stripTags`
 * helper). The round-trip's REPRESENTABLE set (must survive byte-for-byte
 * in meaning): title/intro/scoringMode; artifact title/kind(text,table)/
 * sourceLine/body/table(caption+headers+rows); conclusion label/credit/
 * expertRationale/reasons(text+sound+flawNote); expertMap triples+role+
 * strength. The documented LOSSY set (dropped by the serializer, per the
 * module's own doc comment): `kind: "image"` artifacts, `headerColor`, and
 * a conclusion's `body` (this format has room for exactly one prose block
 * per conclusion, and `expertRationale` — always present, since it's
 * required by schema.ts — always wins that slot).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseCaseCompanionDoc, serializeCaseCompanionDoc, type CaseConfigLike } from "@/lib/engines/case-workspace/companion-doc";
import type { ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { validateCaseConfig, caseConfigSchema, type CaseConfig } from "@/lib/engines/case-workspace/schema";
import { CASE_STARTERS, caseStarterConfig } from "@/lib/engines/case-workspace/starters";

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

function toLabeledShape(config: CaseConfig) {
  const artifactTitleOf = (id: string) => config.artifacts.find((a) => a.id === id)?.title ?? id;
  const conclusionLabelOf = (id: string) => config.conclusions.find((c) => c.id === id)?.label ?? id;
  return {
    title: config.title,
    intro: stripTags(config.intro),
    scoringMode: config.scoringMode,
    artifacts: config.artifacts.map((a) => ({
      title: a.title,
      kind: a.kind,
      sourceLine: a.sourceLine,
      body: a.body ? stripTags(a.body) : undefined,
      table: a.table ? { caption: a.table.caption, headers: a.table.headers, rows: a.table.rows } : undefined,
    })),
    conclusions: config.conclusions.map((c) => ({
      label: c.label,
      credit: c.credit,
      expertRationale: stripTags(c.expertRationale),
      reasons: c.reasons.map((r) => ({ text: r.text, sound: r.sound, flawNote: r.flawNote })),
    })),
    expertMap: config.expertMap.map((m) => ({
      artifact: artifactTitleOf(m.artifactId),
      conclusion: conclusionLabelOf(m.conclusionId),
      role: m.role,
      strength: m.strength,
    })),
  };
}

// ---------------------------------------------------------------------------
// The normative example (a small 3-artifact/2-conclusion case, per the plan).
// ---------------------------------------------------------------------------
const NORMATIVE_EXAMPLE = `TITLE: The Missing Ladder
INTRO: Review the artifacts and decide who was responsible for the fall.

MODE: best-supported

ARTIFACT: Maintenance Log (text)
Source: Facilities maintenance log, p.2
The ladder was inspected on March 3 and flagged for a cracked rung.
No repair ticket was ever filed.

ARTIFACT: Witness Statement (text)
Source: Interview with R. Alvarez
Alvarez says he saw Chen grab the ladder from the closet without checking it.

ARTIFACT: Inspection Table (table)
Caption: Ladder inspection history
| Date | Result |
| March 3 | Flagged, cracked rung |
| March 10 | Not reinspected |

CONCLUSION: Equipment failure (best)
Rationale: The log shows a known defect that was never repaired before the fall.
- The rung was flagged as cracked five days before the fall. (SOUND)
- Chen should have visually checked the ladder himself. (FLAWED: Shifts blame without addressing the unrepaired defect the log already flagged.)

CONCLUSION: Operator error (unsupported)
Rationale: Alvarez's account does not establish that Chen caused the defect.
- Alvarez saw Chen retrieve the ladder without inspecting it. (SOUND)
- Alvarez's account proves Chen was careless. (FLAWED: An eyewitness account of one action does not establish a pattern of carelessness.)

MAP: Maintenance Log supports Equipment failure (strong)
MAP: Inspection Table supports Equipment failure (weak)
MAP: Witness Statement supports Operator error (weak)
MAP: Maintenance Log contradicts Operator error (weak)
`;

describe("parseCaseCompanionDoc — normative example", () => {
  const { config, report } = parseCaseCompanionDoc(NORMATIVE_EXAMPLE);

  it("never throws and returns a config that validates with zero errors and zero warnings", () => {
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("captures TITLE, INTRO, MODE, all 3 artifacts, both conclusions, and 4 map entries", () => {
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.title).toBe("The Missing Ladder");
    expect(r.config.intro).toContain("Review the artifacts");
    expect(r.config.scoringMode).toBe("best-supported");
    expect(r.config.artifacts).toHaveLength(3);
    expect(r.config.conclusions).toHaveLength(2);
    expect(r.config.expertMap).toHaveLength(4);
  });

  it("resolves artifact kinds, source lines, and the table's caption/headers/rows", () => {
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const log = r.config.artifacts.find((a) => a.title === "Maintenance Log")!;
    expect(log.kind).toBe("text");
    expect(log.sourceLine).toBe("Facilities maintenance log, p.2");
    expect(log.body).toContain("cracked rung");
    expect(log.body).toContain("No repair ticket");
    const table = r.config.artifacts.find((a) => a.title === "Inspection Table")!;
    expect(table.kind).toBe("table");
    expect(table.table).toMatchObject({
      caption: "Ladder inspection history",
      headers: ["Date", "Result"],
      rows: [["March 3", "Flagged, cracked rung"], ["March 10", "Not reinspected"]],
    });
  });

  it("resolves conclusion credit from the (best)/(unsupported) markers, expert rationale, and reasons", () => {
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const equip = r.config.conclusions.find((c) => c.label === "Equipment failure")!;
    expect(equip.credit).toBe("full");
    expect(equip.expertRationale).toContain("known defect");
    expect(equip.reasons).toHaveLength(2);
    expect(equip.reasons[0]).toMatchObject({ sound: true });
    expect(equip.reasons[1]).toMatchObject({ sound: false, flawNote: expect.stringContaining("Shifts blame") });
    const operator = r.config.conclusions.find((c) => c.label === "Operator error")!;
    expect(operator.credit).toBe("none");
  });

  it("resolves MAP roles/strengths by title, case-insensitively against artifact/conclusion titles", () => {
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const log = r.config.artifacts.find((a) => a.title === "Maintenance Log")!;
    const equip = r.config.conclusions.find((c) => c.label === "Equipment failure")!;
    const operator = r.config.conclusions.find((c) => c.label === "Operator error")!;
    expect(r.config.expertMap).toContainEqual({ artifactId: log.id, conclusionId: equip.id, role: "supports", strength: "strong" });
    expect(r.config.expertMap).toContainEqual({ artifactId: log.id, conclusionId: operator.id, role: "contradicts", strength: "weak" });
  });
});

// ---------------------------------------------------------------------------
// ARTIFACT grammar
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — ARTIFACT grammar: kind + opaque body", () => {
  it("treats an ALL-CAPS-colon body line as opaque content, not an unknown directive (spec §6 bullet 1)", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: Memo (text)",
      "SUBJECT: Overtime dispute",
      "The memo discusses overtime.",
      "",
      "ARTIFACT: Second (text)",
      "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: R1",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: Memo supports C1 (strong)",
      "MAP: Second supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const memo = r.config.artifacts.find((a) => a.title === "Memo")!;
    expect(memo.body).toContain("SUBJECT: Overtime dispute");
    expect(memo.body).toContain("The memo discusses overtime.");
  });

  it("Source: and Caption: are recognized only as the fixed line(s) right after the ARTIFACT line — a later 'Source:'-looking line is opaque body content", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: Memo (text)",
      "Source: Real source",
      "Some body text.",
      "Source: not a real source line, just body text",
      "",
      "ARTIFACT: Second (text)",
      "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: R1",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: Memo supports C1 (strong)",
      "MAP: Second supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const memo = r.config.artifacts.find((a) => a.title === "Memo")!;
    expect(memo.sourceLine).toBe("Real source");
    expect(memo.body).toContain("not a real source line, just body text");
  });

  it("a '-' line inside an ARTIFACT body is opaque content, not a reason (spec §6 bullet 3)", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: Memo (text)",
      "- This looks like a reason line but it is body text.",
      "",
      "ARTIFACT: Second (text)",
      "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: R1",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: Memo supports C1 (strong)",
      "MAP: Second supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const memo = r.config.artifacts.find((a) => a.title === "Memo")!;
    expect(memo.body).toContain("This looks like a reason line but it is body text.");
  });

  it("errors and skips the artifact when the kind is (image), pruning it from MAP resolution", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A Photo (image)",
      "ARTIFACT: Memo (text)",
      "Body.",
      "ARTIFACT: Second (text)",
      "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: R1",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: Memo supports C1 (strong)",
      "MAP: A Photo supports C2 (strong)",
      "MAP: Second supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "A Photo (image)") && /editor-only/i.test(e.message))).toBe(true);
    expect(errs.some((e) => e.line === lineOf(lines, "MAP: A Photo") && /no artifact named/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.artifacts.some((a) => a.title === "A Photo")).toBe(false);
  });

  it("errors when the ARTIFACT line has no kind at all, and skips it", () => {
    const lines = ["TITLE: T", "INTRO: I", "MODE: best-supported", "", "ARTIFACT: No Kind Here"];
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "No Kind Here") && /must specify a kind/i.test(e.message))).toBe(true);
  });

  it("pads a table row that has fewer cells than headers, and errors", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: Tbl (table)",
      "A | B | C",
      "1 | 2",
      "",
      "ARTIFACT: Second (text)",
      "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: R1",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: Tbl supports C1 (strong)",
      "MAP: Second supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "1 | 2") && /padded/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const tbl = r.config.artifacts.find((a) => a.title === "Tbl")!;
    expect(tbl.table!.rows[0]).toEqual(["1", "2", ""]);
  });

  it("truncates a table row that has more cells than headers, and errors", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: Tbl (table)",
      "A | B",
      "1 | 2 | 3",
      "",
      "ARTIFACT: Second (text)",
      "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: R1",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: Tbl supports C1 (strong)",
      "MAP: Second supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "1 | 2 | 3") && /truncated/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const tbl = r.config.artifacts.find((a) => a.title === "Tbl")!;
    expect(tbl.table!.rows[0]).toEqual(["1", "2"]);
  });
});

// ---------------------------------------------------------------------------
// CONCLUSION grammar
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — CONCLUSION grammar: Rationale: sub-line", () => {
  it("floors a missing Rationale: line with a placeholder + error, and any plain lines before the first reason become body instead", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.",
      "ARTIFACT: B (text)", "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "This is a body line, not a rationale.",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: A supports C1 (strong)",
      "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CONCLUSION: C1") && /no "Rationale:" line/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.expertRationale).toContain("to be written");
    expect(c1.body).toContain("This is a body line, not a rationale.");
  });

  it("a multi-paragraph Rationale: (blank-line separated) round-trips as a multi-paragraph expertRationale", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.",
      "ARTIFACT: B (text)", "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: First paragraph.",
      "",
      "Second paragraph.",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: A supports C1 (strong)",
      "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.expertRationale).toBe("<p>First paragraph.</p><p>Second paragraph.</p>");
  });
});

describe("parseCaseCompanionDoc — reason lines: markers", () => {
  it("imports a reason with no marker as SOUND, with an error", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.",
      "ARTIFACT: B (text)", "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: R1",
      "- A reason with no marker at all",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: A supports C1 (strong)",
      "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "no marker at all") && /missing/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.reasons.find((rs) => rs.text.includes("no marker"))?.sound).toBe(true);
  });

  it("synthesizes a placeholder flaw note (with a warning) when FLAWED: has an empty note", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.",
      "ARTIFACT: B (text)", "Body two.",
      "",
      "CONCLUSION: C1 (best)",
      "Rationale: R1",
      "- Reason one. (SOUND)",
      "- Reason two. (FLAWED:)",
      "",
      "CONCLUSION: C2",
      "Rationale: R2",
      "- Reason A. (SOUND)",
      "- Reason B. (SOUND)",
      "",
      "MAP: A supports C1 (strong)",
      "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report).some((w) => /empty flaw note/i.test(w.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    const flawed = c1.reasons.find((rs) => !rs.sound)!;
    expect(flawed.flawNote).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MODE x credit-marker matrix (spec §6 / plan, verbatim)
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — MODE x credit-marker matrix", () => {
  function docWithMarkers(mode: string, markers: Array<string | undefined>): { text: string; lines: string[] } {
    const lines = ["TITLE: T", "INTRO: I", `MODE: ${mode}`, "", "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", ""];
    markers.forEach((marker, i) => {
      const n = i + 1;
      lines.push(`CONCLUSION: C${n}${marker ? ` (${marker})` : ""}`, `Rationale: R${n}`, "- Reason one. (SOUND)", "- Reason two. (SOUND)", "");
    });
    lines.push(`MAP: A supports C1 (strong)`, `MAP: B supports C2 (strong)`);
    return { text: lines.join("\n"), lines };
  }

  it("no (best) under best-supported: coerces the first conclusion to full credit, with an error", () => {
    const { text, lines } = docWithMarkers("best-supported", [undefined, undefined]);
    const { config, report } = parseCaseCompanionDoc(text);
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CONCLUSION: C1") && /no conclusion is marked/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.conclusions[0].credit).toBe("full");
    expect(r.config.conclusions[1].credit).toBe("none");
  });

  it("multiple (best) under best-supported: first wins, the rest are demoted to none, each with an error", () => {
    const { text, lines } = docWithMarkers("best-supported", ["best", "best"]);
    const { config, report } = parseCaseCompanionDoc(text);
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CONCLUSION: C2") && /only one conclusion may be marked/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.conclusions[0].credit).toBe("full");
    expect(r.config.conclusions[1].credit).toBe("none");
  });

  it('(defensible) under single: coerced to no credit, with an error', () => {
    const { text, lines } = docWithMarkers("single", ["best", "defensible"]);
    const { config, report } = parseCaseCompanionDoc(text);
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CONCLUSION: C2") && /not valid under "single"/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.conclusions[1].credit).toBe("none");
  });

  it("no (best) under single: coerces the first conclusion to full credit too", () => {
    const { text } = docWithMarkers("single", [undefined, undefined]);
    const { config, report } = parseCaseCompanionDoc(text);
    expect(errors(report).length).toBeGreaterThan(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.conclusions[0].credit).toBe("full");
  });

  it("argument-quality mode tolerates any credit distribution with zero mode-matrix errors", () => {
    const { text } = docWithMarkers("argument-quality", ["best", "best"]);
    const { config, report } = parseCaseCompanionDoc(text);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.conclusions[0].credit).toBe("full");
    expect(r.config.conclusions[1].credit).toBe("full");
  });

  it("no MODE given defaults to best-supported with an info-level (warning) note", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- Reason one. (SOUND)", "- Reason two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- Reason A. (SOUND)", "- Reason B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(warnings(report).some((w) => /MODE/i.test(w.message) && /best-supported/i.test(w.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.scoringMode).toBe("best-supported");
  });
});

// ---------------------------------------------------------------------------
// Duplicate titles (both artifacts and conclusions), pruned from MAP
// resolution — mirrors sandbox's stricter (not branching's) precedent.
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — duplicate titles are pruned everywhere", () => {
  it("errors naming both line numbers for a duplicate artifact title, and a MAP line naming it errors rather than resolving", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: Memo (text)", "First body.",
      "ARTIFACT: Memo (text)", "Second body.",
      "ARTIFACT: Second (text)", "Body two.",
      "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- Reason one. (SOUND)", "- Reason two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- Reason A. (SOUND)", "- Reason B. (SOUND)", "",
      "MAP: Memo supports C1 (strong)",
      "MAP: Second supports C2 (strong)",
    ];
    const firstLine = lineOf(lines, "First body.") - 1;
    const dupLine = lineOf(lines, "Second body.") - 1;
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    const dupErr = errs.find((e) => e.line === dupLine);
    expect(dupErr, JSON.stringify(report)).toBeDefined();
    expect(dupErr!.message).toContain(`line ${firstLine}`);
    expect(dupErr!.message).toContain(`line ${dupLine}`);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.artifacts.filter((a) => a.title === "Memo")).toHaveLength(1);
    expect(r.config.artifacts.find((a) => a.title === "Memo")!.body).toContain("First body");
  });

  it("errors naming both line numbers for a duplicate conclusion title, pruned from MAP resolution", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.",
      "",
      "CONCLUSION: C1 (best)", "Rationale: First rationale.", "- Reason one. (SOUND)", "- Reason two. (SOUND)", "",
      "CONCLUSION: C1", "Rationale: Second rationale.", "- Reason A. (SOUND)", "- Reason B. (SOUND)", "",
      "MAP: A supports C1 (strong)",
      "MAP: B supports C1 (strong)",
    ];
    const firstLine = lineOf(lines, "CONCLUSION: C1 (best)");
    const dupLine = lineOf(lines, "CONCLUSION: C1") === firstLine ? lines.findIndex((l, i) => l === "CONCLUSION: C1" && i + 1 !== firstLine) + 1 : lineOf(lines, "CONCLUSION: C1");
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === dupLine && e.message.includes(`line ${firstLine}`))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.conclusions.filter((c) => c.label === "C1")).toHaveLength(1);
    expect(r.config.conclusions.find((c) => c.label === "C1")!.expertRationale).toContain("First rationale");
  });
});

// ---------------------------------------------------------------------------
// MAP grammar
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — MAP grammar", () => {
  const base = [
    "TITLE: T", "INTRO: I", "MODE: best-supported", "",
    "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
    "CONCLUSION: C1 (best)", "Rationale: R1", "- Reason one. (SOUND)", "- Reason two. (SOUND)", "",
    "CONCLUSION: C2", "Rationale: R2", "- Reason A. (SOUND)", "- Reason B. (SOUND)", "",
  ];

  it("defaults strength to weak with an info-level (warning) note when absent", () => {
    const lines = [...base, "MAP: A supports C1", "MAP: B supports C2 (strong)"];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(warnings(report).some((w) => w.line === lineOf(lines, "MAP: A supports C1") && /strength/i.test(w.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const a = r.config.artifacts.find((x) => x.title === "A")!;
    const c1 = r.config.conclusions.find((x) => x.label === "C1")!;
    expect(r.config.expertMap.find((m) => m.artifactId === a.id && m.conclusionId === c1.id)?.strength).toBe("weak");
  });

  it("errors and skips a MAP line naming an unresolved artifact", () => {
    const lines = [...base, "MAP: Nonexistent supports C1 (strong)", "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)"];
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "MAP: Nonexistent") && /no artifact named/i.test(e.message))).toBe(true);
  });

  it("errors and skips a MAP line naming an unresolved conclusion", () => {
    const lines = [...base, "MAP: A supports Nonexistent (strong)", "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)"];
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "MAP: A supports Nonexistent") && /no conclusion named/i.test(e.message))).toBe(true);
  });

  it("errors and skips a duplicate (artifact, conclusion) MAP pair, keeping the first", () => {
    const lines = [...base, "MAP: A supports C1 (strong)", "MAP: A supports C1 (weak)", "MAP: B supports C2 (strong)"];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "MAP: A supports C1 (weak)") && /duplicate/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const a = r.config.artifacts.find((x) => x.title === "A")!;
    const c1 = r.config.conclusions.find((x) => x.label === "C1")!;
    const matches = r.config.expertMap.filter((m) => m.artifactId === a.id && m.conclusionId === c1.id);
    expect(matches).toHaveLength(1);
    expect(matches[0].strength).toBe("strong");
  });

  it("resolves titles case-insensitively", () => {
    const lines = [...base, "map: a SUPPORTS c1 (strong)", "MAP: B supports C2 (strong)"];
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unknown directive (outside any block)
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — unknown directive outside a block", () => {
  it("reports an error and skips the line for an unrecognized ALL-CAPS-colon directive at the top level", () => {
    const lines = ["TITLE: T", "WEIRDLINE: something", "INTRO: I", "MODE: best-supported"];
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "WEIRDLINE") && /unknown directive/i.test(e.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — floors", () => {
  it("pads to 2 artifacts when fewer than 2 valid artifacts survive", () => {
    const doc = ["TITLE: T", "INTRO: I", "MODE: best-supported"].join("\n");
    const { config, report } = parseCaseCompanionDoc(doc);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.artifacts.length).toBeGreaterThanOrEqual(2);
    expect(warnings(report).some((w) => /artifact/i.test(w.message) && /placeholder/i.test(w.message))).toBe(true);
  });

  it("pads to 2 conclusions when fewer than 2 valid conclusions survive, each fully floor-satisfied", () => {
    const doc = ["TITLE: T", "INTRO: I", "MODE: best-supported"].join("\n");
    const { config, report } = parseCaseCompanionDoc(doc);
    const r = validateCaseConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    const cfg = (r as { ok: true; config: CaseConfig }).config;
    expect(cfg.conclusions.length).toBeGreaterThanOrEqual(2);
    expect(warnings(report).some((w) => /conclusion/i.test(w.message) && /placeholder/i.test(w.message))).toBe(true);
  });

  it("pads a conclusion's reasons to 2 when fewer are declared, with an error", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- Only reason. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- Reason A. (SOUND)", "- Reason B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => /needs at least 2 reasons/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("coerces the first reason to sound when a conclusion has zero sound reasons, with an error", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (FLAWED: bad)", "- Two. (FLAWED: also bad)", "",
      "CONCLUSION: C2", "Rationale: R2", "- Reason A. (SOUND)", "- Reason B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => /at least one sound reason/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.reasons.some((rs) => rs.sound)).toBe(true);
  });

  it("synthesizes a weak supporting MAP entry when a conclusion has no supports at all", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- Reason A. (SOUND)", "- Reason B. (SOUND)", "",
      "MAP: A supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => /needs at least one supporting artifact/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(r.config.expertMap.some((m) => m.conclusionId === c1.id && m.role === "supports")).toBe(true);
  });

  it("no INTRO given floors a placeholder intro with a warning (schema requires intro)", () => {
    const lines = ["TITLE: T", "MODE: best-supported"];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(warnings(report).some((w) => /INTRO/i.test(w.message))).toBe(true);
    const r = validateCaseConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tolerances: BOM, CRLF, smart quotes
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — BOM/CRLF/smart-quote tolerance", () => {
  it("tolerates a leading UTF-8 BOM, CRLF line endings, and smart quotes, without shifting line numbers", () => {
    const lines = [
      "TITLE: Faculty’s Case",
      "INTRO: The professor’s point was “clear”.",
      "MODE: best-supported",
      "BADLINE: oops",
      "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const withBom = "﻿" + lines.join("\r\n");
    const { config, report } = parseCaseCompanionDoc(withBom);
    const errs = errors(report);
    expect(errs).toHaveLength(1);
    expect(errs[0].line).toBe(lineOf(lines, "BADLINE"));
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    expect(r.config.title).toBe("Faculty's Case");
    expect(r.config.intro).toContain("The professor's point was \"clear\".");
  });
});

// ---------------------------------------------------------------------------
// Report completeness (seeded flaws)
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — report completeness and ordering", () => {
  it("a doc with exactly 5 seeded flaws yields exactly 5 issues, all errors, at the right lines, in ascending order", () => {
    const lines = [
      /* 1 */ "TITLE: Flawed Doc",
      /* 2 */ "WEIRDLINE: something",
      /* 3 */ "INTRO: An intro.",
      /* 4 */ "MODE: best-supported",
      /* 5 */ "",
      /* 6 */ "ARTIFACT: Bad Artifact (image)",
      /* 7 */ "ARTIFACT: Good One (text)",
      /* 8 */ "Body text for good one.",
      /* 9 */ "ARTIFACT: Good Two (text)",
      /* 10 */ "Body text for good two.",
      /* 11 */ "",
      /* 12 */ "CONCLUSION: C1 (bogus)",
      /* 13 */ "Rationale: Some rationale for C1.",
      /* 14 */ "- Reason one. (SOUND)",
      /* 15 */ "- Reason two missing marker",
      /* 16 */ "",
      /* 17 */ "CONCLUSION: C2 (best)",
      /* 18 */ "Rationale: Some rationale for C2.",
      /* 19 */ "- Reason A. (SOUND)",
      /* 20 */ "- Reason B. (SOUND)",
      /* 21 */ "",
      /* 22 */ "MAP: Nonexistent Artifact supports C1 (strong)",
      /* 23 */ "MAP: Good One supports C1 (strong)",
      /* 24 */ "MAP: Good Two supports C2 (strong)",
    ];
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(report.map((r) => r.line), JSON.stringify(report)).toEqual([2, 6, 12, 15, 22]);
    expect(report.every((r) => r.severity === "error"), JSON.stringify(report)).toBe(true);
    const sorted = [...report].sort((a, b) => a.line - b.line);
    expect(report).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// INTRO is HTML-escaped before the <p> wrap
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc / serializeCaseCompanionDoc — INTRO HTML-escaping", () => {
  it("escapes &, <, > in INTRO before wrapping it in <p>", () => {
    const doc = ["TITLE: T", "INTRO: <img src=x onerror=x> a & b", "MODE: best-supported"].join("\n");
    const { config } = parseCaseCompanionDoc(doc);
    expect((config as { intro?: string }).intro).toBe("<p>&lt;img src=x onerror=x&gt; a &amp; b</p>");
  });

  it("round-trips an intro containing '&' without double-escaping, and is idempotent across a second round trip", () => {
    const original = { ...CASE_STARTERS.blank.config, title: "T", intro: "<p>Salt & pepper, to taste.</p>" };
    const doc = serializeCaseCompanionDoc(original);
    const { config } = parseCaseCompanionDoc(doc);
    const intro1 = (config as { intro?: string }).intro;
    expect(intro1).toBe("<p>Salt &amp; pepper, to taste.</p>");

    const doc2 = serializeCaseCompanionDoc({ ...original, intro: intro1! });
    const { config: config2 } = parseCaseCompanionDoc(doc2);
    expect((config2 as { intro?: string }).intro).toBe(intro1);
  });
});

// ---------------------------------------------------------------------------
// Serializer coverage: risky titles, lossy header
// ---------------------------------------------------------------------------

describe("serializeCaseCompanionDoc — risky-title warning coverage", () => {
  it("flags titles containing '(', '->', ' supports ', or ' contradicts '", () => {
    const cfg: CaseConfigLike = {
      title: "T",
      intro: "<p>I</p>",
      scoringMode: "best-supported",
      artifacts: [
        { id: "a", title: "Memo (Draft)", kind: "text", body: "<p>B</p>" },
        { id: "b", title: "A supports B", kind: "text", body: "<p>B</p>" },
        { id: "c", title: "Plain title", kind: "text", body: "<p>B</p>" },
      ],
      conclusions: [
        { id: "c1", label: "C1", credit: "full", expertRationale: "<p>R</p>", reasons: [{ id: "r1", text: "T1", sound: true }, { id: "r2", text: "T2", sound: true }] },
        { id: "c2", label: "C2", credit: "none", expertRationale: "<p>R</p>", reasons: [{ id: "r3", text: "T3", sound: true }, { id: "r4", text: "T4", sound: true }] },
      ],
      expertMap: [
        { artifactId: "a", conclusionId: "c1", role: "supports", strength: "weak" },
        { artifactId: "b", conclusionId: "c2", role: "supports", strength: "weak" },
      ],
    };
    const doc = serializeCaseCompanionDoc(cfg);
    const warningLine = doc.split("\n").find((l) => l.startsWith("# Warning:"));
    expect(warningLine, doc).toBeDefined();
    expect(warningLine).toContain("Memo (Draft)");
    expect(warningLine).toContain("A supports B");
    expect(warningLine).not.toContain("Plain title");
  });
});

describe("serializeCaseCompanionDoc — lossy-feature header block content", () => {
  it("names dropped image artifacts, headerColor, and conclusion body in the header comment", () => {
    const cfg: CaseConfigLike = {
      title: "T",
      intro: "<p>I</p>",
      scoringMode: "best-supported",
      headerColor: "primary",
      artifacts: [
        { id: "a", title: "A Photo", kind: "image", imageAssetId: "asset1", imageRole: "decorative" },
        { id: "b", title: "Memo", kind: "text", body: "<p>B</p>" },
      ],
      conclusions: [
        { id: "c1", label: "C1", body: "<p>Extra body</p>", credit: "full", expertRationale: "<p>R</p>", reasons: [{ id: "r1", text: "T1", sound: true }, { id: "r2", text: "T2", sound: true }] },
        { id: "c2", label: "C2", credit: "none", expertRationale: "<p>R</p>", reasons: [{ id: "r3", text: "T3", sound: true }, { id: "r4", text: "T4", sound: true }] },
      ],
      expertMap: [
        { artifactId: "b", conclusionId: "c1", role: "supports", strength: "weak" },
        { artifactId: "b", conclusionId: "c2", role: "supports", strength: "weak" },
      ],
    };
    const doc = serializeCaseCompanionDoc(cfg);
    const noteLine = doc.split("\n").find((l) => l.startsWith("# Note:"));
    expect(noteLine, doc).toBeDefined();
    expect(noteLine).toContain("image artifact");
    expect(noteLine).toContain("A Photo");
    expect(noteLine).toContain("header color");
    expect(noteLine).toContain("conclusion body");
    expect(noteLine).toContain("C1");
    // The dropped image artifact must not appear as an ARTIFACT line at all.
    expect(doc).not.toMatch(/^ARTIFACT: A Photo/m);
  });
});

// ---------------------------------------------------------------------------
// Serializer + round-trip
// ---------------------------------------------------------------------------

const MAX_FEATURE_CONFIG: CaseConfigLike = {
  title: "The Ladder Incident",
  intro: "<p>Determine what caused the fall.</p>",
  scoringMode: "best-supported",
  artifacts: [
    {
      id: "memo", title: "Maintenance Log", kind: "text", sourceLine: "Facilities log, p.2",
      body: "<p>The ladder was flagged for a cracked rung on March 3.</p><p>No repair ticket was ever filed.</p>",
    },
    {
      id: "table1", title: "Inspection Table", kind: "table",
      table: { caption: "Ladder inspection history", headers: ["Date", "Result"], rows: [["March 3", "Flagged"], ["March 10", "Not reinspected"]] },
    },
  ],
  conclusions: [
    {
      id: "equipment_failure", label: "Equipment failure", credit: "full",
      expertRationale: "<p>The log shows an unrepaired defect.</p><p>That defect is sufficient to explain the fall.</p>",
      reasons: [
        { id: "r1", text: "The rung was flagged five days before the fall.", sound: true },
        { id: "r2", text: "Chen should have checked the ladder himself.", sound: false, flawNote: "Shifts blame without addressing the flagged defect." },
      ],
    },
    {
      id: "operator_error", label: "Operator error", credit: "none",
      expertRationale: "<p>No account establishes operator fault.</p>",
      reasons: [
        { id: "r3", text: "No witness saw operator error.", sound: true },
        { id: "r4", text: "Someone must be at fault.", sound: false, flawNote: "Assumes fault must lie with a person, not equipment." },
      ],
    },
  ],
  expertMap: [
    { artifactId: "memo", conclusionId: "equipment_failure", role: "supports", strength: "strong" },
    { artifactId: "table1", conclusionId: "equipment_failure", role: "supports", strength: "weak" },
    { artifactId: "memo", conclusionId: "operator_error", role: "contradicts", strength: "weak" },
    { artifactId: "table1", conclusionId: "operator_error", role: "supports", strength: "weak" },
  ],
};

describe("serializeCaseCompanionDoc — round-trip", () => {
  it("round-trips a max-feature fixture: serialize -> parse -> validate ok, structurally equal via titles/labels", () => {
    const doc = serializeCaseCompanionDoc(MAX_FEATURE_CONFIG);
    const { config, report } = parseCaseCompanionDoc(doc);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report), JSON.stringify(report)).toHaveLength(0);

    const validated = validateCaseConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    const reparsed = (validated as { ok: true; config: CaseConfig }).config;

    const original = caseConfigSchema.parse(MAX_FEATURE_CONFIG);
    expect(toLabeledShape(reparsed)).toEqual(toLabeledShape(original));
  });

  it("round-trips the blank starter too", () => {
    const original = caseStarterConfig("blank", "Blank Round Trip");
    const doc = serializeCaseCompanionDoc(original);
    const { config, report } = parseCaseCompanionDoc(doc);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const validated = validateCaseConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    const reparsed = (validated as { ok: true; config: CaseConfig }).config;
    expect(toLabeledShape(reparsed)).toEqual(toLabeledShape(original));
  });
});

// ---------------------------------------------------------------------------
// Opus review fix round (items 1-11) — regression coverage per item.
// ---------------------------------------------------------------------------

describe("parseCaseCompanionDoc — every-conclusion supports floor: duplicate-pair interaction (review item 1)", () => {
  it("picks an artifact NOT already paired with the conclusion, when the first artifact is already paired via 'contradicts'", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A1 (text)", "Body one.",
      "ARTIFACT: A2 (text)", "Body two.",
      "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A1 contradicts C1 (weak)",
      "MAP: A1 supports C2 (strong)",
      "MAP: A2 supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => /needs at least one supporting artifact/i.test(e.message) && /"A2"/.test(e.message))).toBe(true);
    const r = validateCaseConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    const cfg = (r as { ok: true; config: CaseConfig }).config;
    const a2 = cfg.artifacts.find((a) => a.title === "A2")!;
    const c1 = cfg.conclusions.find((c) => c.label === "C1")!;
    expect(cfg.expertMap).toContainEqual({ artifactId: a2.id, conclusionId: c1.id, role: "supports", strength: "weak" });
  });

  it("errors without pushing a duplicate map entry when every artifact is already paired with the conclusion that lacks support", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A1 (text)", "Body one.",
      "ARTIFACT: A2 (text)", "Body two.",
      "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A1 contradicts C1 (weak)",
      "MAP: A2 contradicts C1 (weak)",
      "MAP: A1 supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => /already paired with it/i.test(e.message))).toBe(true);
    const cfg = config as { expertMap: Array<{ artifactId: string; conclusionId: string; role: string }> };
    expect(cfg.expertMap).toHaveLength(3); // unchanged -- no invalid entry was pushed
  });

  // NOTE on the third case named by the review ("at the 96-entry MAX_MAP cap
  // ⇒ distinct error, no push"): MAX_ARTIFACTS (16) x MAX_CONCLUSIONS (6) ==
  // MAX_MAP (96) exactly. Since expertMap can only grow via unique
  // (artifactId, conclusionId) pairs, reaching exactly 96 entries is only
  // possible by exhausting literally every (artifact, conclusion)
  // combination -- which means, by construction, every artifact is ALREADY
  // paired with any conclusion the floor might target, so `floorArtifact`
  // is never found and the "every artifact already paired" branch (tested
  // above) fires first. The at-cap branch is still implemented (defense in
  // depth against a future change to any one of these three constants) but
  // is unreachable through the public parser API under the CURRENT
  // constants, so it is not exercised via `parseCaseCompanionDoc` here.
});

describe("capRichHtml — result never exceeds max, including the closing tag (review item 2)", () => {
  it("caps an oversized artifact body to at most MAX_ARTIFACT_BODY (3000)", () => {
    const longBody = "x".repeat(3000);
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", longBody,
      "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(warnings(report).some((w) => /longer than 3000/.test(w.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const a = r.config.artifacts.find((x) => x.title === "A")!;
    expect(a.body!.length).toBeLessThanOrEqual(3000);
  });

  it("caps an oversized expert rationale to at most MAX_EXPERT_RATIONALE (3000)", () => {
    const longRationale = "y".repeat(3000);
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", `Rationale: ${longRationale}`, "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(warnings(report).some((w) => /longer than 3000/.test(w.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.expertRationale.length).toBeLessThanOrEqual(3000);
  });

  it("caps an oversized conclusion body (no Rationale: found) to at most 2000 characters", () => {
    const longBody = "w".repeat(2000);
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", longBody, "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(warnings(report).some((w) => /longer than 2000/.test(w.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.body!.length).toBeLessThanOrEqual(2000);
  });

  it("caps an oversized INTRO to at most MAX_INTRO (5000)", () => {
    const longIntro = "z".repeat(5000);
    const doc = ["TITLE: T", `INTRO: ${longIntro}`, "MODE: best-supported"].join("\n");
    const { config, report } = parseCaseCompanionDoc(doc);
    expect(warnings(report).some((w) => /longer than 5000/.test(w.message))).toBe(true);
    const r = validateCaseConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    expect((config as { intro: string }).intro.length).toBeLessThanOrEqual(5000);
  });
});

describe("capRichHtml + escaping — caps the POST-escape length, not the pre-escape length (review item 3)", () => {
  it("a 700-'&'-character artifact body (3500 chars once escaped) is truncated and still validates", () => {
    const body700 = "&".repeat(700);
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", body700,
      "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(warnings(report).some((w) => /longer than 3000/.test(w.message) && /body/i.test(w.message))).toBe(true);
    const r = validateCaseConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});

describe("parseTableRow — fenced vs unfenced, empty-cell round trip (review item 4)", () => {
  it("round-trips a table with empty cells at either end unchanged, with an empty report", () => {
    const cfg: CaseConfigLike = {
      title: "T", intro: "<p>I</p>", scoringMode: "best-supported",
      artifacts: [
        { id: "a", title: "A", kind: "text", body: "<p>B</p>" },
        { id: "t", title: "Tbl", kind: "table", table: { headers: ["H1", "H2"], rows: [["", "x"], ["y", ""], ["", ""]] } },
      ],
      conclusions: [
        { id: "c1", label: "C1", credit: "full", expertRationale: "<p>R</p>", reasons: [{ id: "r1", text: "T1", sound: true }, { id: "r2", text: "T2", sound: true }] },
        { id: "c2", label: "C2", credit: "none", expertRationale: "<p>R</p>", reasons: [{ id: "r3", text: "T3", sound: true }, { id: "r4", text: "T4", sound: true }] },
      ],
      expertMap: [
        { artifactId: "a", conclusionId: "c1", role: "supports", strength: "weak" },
        { artifactId: "t", conclusionId: "c2", role: "supports", strength: "weak" },
      ],
    };
    const doc = serializeCaseCompanionDoc(cfg);
    const { config, report } = parseCaseCompanionDoc(doc);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const tbl = r.config.artifacts.find((x) => x.title === "Tbl")!;
    expect(tbl.table!.rows).toEqual([["", "x"], ["y", ""], ["", ""]]);
  });
});

describe("parseCaseCompanionDoc / serializeCaseCompanionDoc — leading-dash rationale ambiguity (review item 5)", () => {
  it("round-trips a rationale whose second paragraph begins with '-' via the serializer's dash-escape", () => {
    const cfg: CaseConfigLike = {
      title: "T", intro: "<p>I</p>", scoringMode: "best-supported",
      artifacts: [
        { id: "a", title: "A", kind: "text", body: "<p>B</p>" },
        { id: "b", title: "B", kind: "text", body: "<p>B2</p>" },
      ],
      conclusions: [
        {
          id: "c1", label: "C1", credit: "full",
          expertRationale: "<p>First paragraph.</p><p>- This paragraph happens to start with a dash but is prose.</p>",
          reasons: [{ id: "r1", text: "T1", sound: true }, { id: "r2", text: "T2", sound: true }],
        },
        { id: "c2", label: "C2", credit: "none", expertRationale: "<p>R</p>", reasons: [{ id: "r3", text: "T3", sound: true }, { id: "r4", text: "T4", sound: true }] },
      ],
      expertMap: [
        { artifactId: "a", conclusionId: "c1", role: "supports", strength: "weak" },
        { artifactId: "b", conclusionId: "c2", role: "supports", strength: "weak" },
      ],
    };
    const doc = serializeCaseCompanionDoc(cfg);
    expect(doc).toContain("\\- This paragraph happens to start with a dash but is prose.");
    const { config, report } = parseCaseCompanionDoc(doc);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.expertRationale).toBe("<p>First paragraph.</p><p>- This paragraph happens to start with a dash but is prose.</p>");
    expect(c1.reasons).toHaveLength(2);
  });

  it("a HAND-typed rationale continuation line beginning with '-' and no marker is fail-visibly treated as an attempted reason, not silently swallowed as prose", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)",
      "Rationale: First paragraph.",
      "",
      "- This looks like prose but has no marker.",
      "- Reason one. (SOUND)",
      "- Reason two. (SOUND)",
      "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => /missing "\(SOUND\)"/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.reasons.some((rs) => rs.text.includes("This looks like prose"))).toBe(true);
  });
});

describe("serializeCaseCompanionDoc — rich-text markup loss header warning (review item 6)", () => {
  it("flags an artifact body containing <ul>/<li> markup in the '# Note:' header line", () => {
    const cfg: CaseConfigLike = {
      title: "T", intro: "<p>I</p>", scoringMode: "best-supported",
      artifacts: [
        { id: "a", title: "Listy", kind: "text", body: "<p>Intro</p><ul><li>One</li><li>Two</li></ul>" },
        { id: "b", title: "Plain", kind: "text", body: "<p>Nothing special.</p>" },
      ],
      conclusions: [
        { id: "c1", label: "C1", credit: "full", expertRationale: "<p>R</p>", reasons: [{ id: "r1", text: "T1", sound: true }, { id: "r2", text: "T2", sound: true }] },
        { id: "c2", label: "C2", credit: "none", expertRationale: "<p>R</p>", reasons: [{ id: "r3", text: "T3", sound: true }, { id: "r4", text: "T4", sound: true }] },
      ],
      expertMap: [
        { artifactId: "a", conclusionId: "c1", role: "supports", strength: "weak" },
        { artifactId: "b", conclusionId: "c2", role: "supports", strength: "weak" },
      ],
    };
    const doc = serializeCaseCompanionDoc(cfg);
    const noteLine = doc.split("\n").find((l) => l.startsWith("# Note:"));
    expect(noteLine, doc).toBeDefined();
    expect(noteLine).toContain("markup");
    expect(noteLine).toContain("Listy");
    expect(noteLine).not.toContain("Plain");
  });
});

describe("parseCaseCompanionDoc — Source:/Caption:/Rationale: lookahead skips a comment line (review item 7)", () => {
  it("finds Source: even with a '#' comment line in between", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: Memo (text)",
      "# a faculty note, not part of the artifact",
      "Source: X",
      "Body text.",
      "ARTIFACT: Second (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: Memo supports C1 (strong)", "MAP: Second supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const memo = r.config.artifacts.find((a) => a.title === "Memo")!;
    expect(memo.sourceLine).toBe("X");
  });

  it("finds Rationale: even with a '#' comment line in between", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)",
      "# a faculty note",
      "Rationale: R1",
      "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.expertRationale).toContain("R1");
  });
});

describe("parseCaseCompanionDoc — empty reason text (review item 8)", () => {
  it("synthesizes a placeholder reason text (with a warning) when the marker is present but the text before it is empty", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- (SOUND)", "- Reason two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report).some((w) => /empty text/i.test(w.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.reasons.some((rs) => rs.text.length > 0)).toBe(true);
  });
});

describe("collectArtifactTitles / collectConclusionTitles — capped-out declarations never shadow a later duplicate (review item 9)", () => {
  it("a title repeated only AFTER the artifact cap gets 'too many artifacts' both times, never a misleading 'duplicate' message", () => {
    const lines: string[] = ["TITLE: T", "INTRO: I", "MODE: best-supported", ""];
    for (let n = 1; n <= 16; n++) lines.push(`ARTIFACT: Filler ${n} (text)`, `Body ${n}.`);
    lines.push("ARTIFACT: Extra (text)", "Extra body one.");
    lines.push("ARTIFACT: Extra (text)", "Extra body two.");
    lines.push(
      "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: Filler 1 supports C1 (strong)", "MAP: Filler 2 supports C2 (strong)",
    );
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    const extraErrs = errors(report).filter((e) => /"Extra"/.test(e.message));
    expect(extraErrs, JSON.stringify(extraErrs)).toHaveLength(2);
    expect(extraErrs.every((e) => /too many artifacts/i.test(e.message))).toBe(true);
    expect(extraErrs.some((e) => /duplicate/i.test(e.message))).toBe(false);
  });

  it("a title repeated only AFTER the conclusion cap gets 'too many conclusions' both times, never a misleading 'duplicate' message", () => {
    const lines: string[] = ["TITLE: T", "INTRO: I", "MODE: best-supported", "", "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", ""];
    for (let n = 1; n <= 6; n++) lines.push(`CONCLUSION: Filler ${n}${n === 1 ? " (best)" : ""}`, `Rationale: R${n}`, "- One. (SOUND)", "- Two. (SOUND)", "");
    lines.push("CONCLUSION: Extra", "Rationale: Extra one.", "- One. (SOUND)", "- Two. (SOUND)", "");
    lines.push("CONCLUSION: Extra", "Rationale: Extra two.", "- One. (SOUND)", "- Two. (SOUND)", "");
    lines.push("MAP: A supports Filler 1 (strong)", "MAP: B supports Filler 2 (strong)");
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    const extraErrs = errors(report).filter((e) => /"Extra"/.test(e.message));
    expect(extraErrs, JSON.stringify(extraErrs)).toHaveLength(2);
    expect(extraErrs.every((e) => /too many conclusions/i.test(e.message))).toBe(true);
    expect(extraErrs.some((e) => /duplicate/i.test(e.message))).toBe(false);
  });
});

describe("parseCaseCompanionDoc — cap overflows and table column overflow (review item 11 coverage)", () => {
  it("errors and caps the 7th reason in a single conclusion (max 6)", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: A (text)", "Body.", "ARTIFACT: B (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1",
      "- One. (SOUND)", "- Two. (SOUND)", "- Three. (SOUND)", "- Four. (SOUND)", "- Five. (SOUND)", "- Six. (SOUND)", "- Seven. (SOUND)",
      "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: A supports C1 (strong)", "MAP: B supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report).some((e) => /too many reasons/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const c1 = r.config.conclusions.find((c) => c.label === "C1")!;
    expect(c1.reasons).toHaveLength(6);
  });

  it("errors and skips a MAP line once the map is already at its cap (96 = 16 artifacts x 6 conclusions)", () => {
    const lines: string[] = ["TITLE: T", "INTRO: I", "MODE: best-supported", ""];
    for (let n = 1; n <= 16; n++) lines.push(`ARTIFACT: A${n} (text)`, `Body ${n}.`);
    lines.push("");
    for (let c = 1; c <= 6; c++) {
      lines.push(`CONCLUSION: C${c}${c === 1 ? " (best)" : ""}`, `Rationale: R${c}`, "- One. (SOUND)", "- Two. (SOUND)", "");
    }
    for (let a = 1; a <= 16; a++) {
      for (let c = 1; c <= 6; c++) lines.push(`MAP: A${a} supports C${c} (weak)`);
    }
    lines.push("MAP: A1 contradicts C1 (weak)"); // the 97th entry attempt -- map already at the 96 cap
    const { report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report).some((e) => /too many expert map entries/i.test(e.message))).toBe(true);
  });

  it("errors and drops extra columns when a table header row declares more than 5 columns", () => {
    const lines = [
      "TITLE: T", "INTRO: I", "MODE: best-supported", "",
      "ARTIFACT: Tbl (table)",
      "| A | B | C | D | E | F |",
      "| 1 | 2 | 3 | 4 | 5 | 6 |",
      "",
      "ARTIFACT: Second (text)", "Body two.", "",
      "CONCLUSION: C1 (best)", "Rationale: R1", "- One. (SOUND)", "- Two. (SOUND)", "",
      "CONCLUSION: C2", "Rationale: R2", "- A. (SOUND)", "- B. (SOUND)", "",
      "MAP: Tbl supports C1 (strong)", "MAP: Second supports C2 (strong)",
    ];
    const { config, report } = parseCaseCompanionDoc(lines.join("\n"));
    expect(errors(report).some((e) => /more than 5 columns/i.test(e.message))).toBe(true);
    const r = validateCaseConfig(config) as { ok: true; config: CaseConfig };
    const tbl = r.config.artifacts.find((a) => a.title === "Tbl")!;
    expect(tbl.table!.headers).toEqual(["A", "B", "C", "D", "E"]);
    expect(tbl.table!.rows[0]).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("serializeCaseCompanionDoc — idempotent across a second parse -> serialize cycle (review item 11 coverage)", () => {
  it("produces byte-identical output when re-serializing a re-parsed max-feature doc", () => {
    const doc1 = serializeCaseCompanionDoc(MAX_FEATURE_CONFIG);
    const { config: config1 } = parseCaseCompanionDoc(doc1);
    const validated1 = validateCaseConfig(config1) as { ok: true; config: CaseConfig };
    const doc2 = serializeCaseCompanionDoc(validated1.config);
    const { config: config2 } = parseCaseCompanionDoc(doc2);
    const validated2 = validateCaseConfig(config2) as { ok: true; config: CaseConfig };
    const doc3 = serializeCaseCompanionDoc(validated2.config);
    expect(doc3).toBe(doc2);
  });
});

// ---------------------------------------------------------------------------
// The committed template (public/companion-doc-case-template.txt)
// ---------------------------------------------------------------------------

describe("companion-doc-case-template.txt (public/, faculty-facing, serializer-generated)", () => {
  const templatePath = join(process.cwd(), "public", "companion-doc-case-template.txt");
  const readTemplate = (): string => readFileSync(templatePath, "utf8");

  const TEMPLATE_HEADER = [
    "# Welcome! This is a companion doc for building a case workspace --",
    "# learners examine artifacts, build a case file, and commit to a",
    "# conclusion backed by sound reasoning. Fill in your own artifacts,",
    "# conclusions, and expert map and send this file back. No special",
    "# software or training is needed to use it.",
    "# Lines starting with # (like these) are comments and are ignored.",
    "# A case has ARTIFACTs the learner examines (text or table -- images",
    "# are added directly in the app), CONCLUSIONs the learner can choose",
    "# from, and a MAP connecting each artifact to the conclusions it",
    "# supports or contradicts, like this:",
    "#   ARTIFACT: Maintenance Log (text)",
    "#   Source: Facilities log, p.2",
    "#   The ladder was flagged for a cracked rung and never repaired.",
    "#",
    "#   CONCLUSION: Equipment failure (best)",
    "#   Rationale: The log shows an unrepaired defect.",
    "#   - The rung was flagged five days before the fall. (SOUND)",
    "#   - Someone must have been careless. (FLAWED: Assumes a person is",
    "#     at fault instead of the unrepaired equipment the log names.)",
    "#",
    "#   MAP: Maintenance Log supports Equipment failure (strong)",
    "# Everything between an ARTIFACT/CONCLUSION line and the next such",
    "# line is that artifact's or conclusion's own content -- lines like",
    "# \"Source:\" and \"Rationale:\" are only special right where they",
    "# appear above. Mark the one credited conclusion with (best); mark",
    "# others (defensible) or (unsupported). MODE controls scoring:",
    "# single, best-supported, or argument-quality. A table artifact",
    "# uses a header row and rows of cells fenced with \"|\", for example:",
    "#   ARTIFACT: Inspection Table (table)",
    "#   | Date | Result |",
    "#   | March 3 | Flagged, cracked rung |",
    "# Keep artifact/conclusion titles plain: a title containing \"(\",",
    "# \"->\", \" supports \", or \" contradicts \" can confuse this format",
    "# when it is read back in.",
    "# When you are done, save and share this file with whoever is",
    "# building the lesson.",
  ].join("\n");

  const TEMPLATE_CONFIG: CaseConfig = caseConfigSchema.parse({
    title: "Who Shorted the Register?",
    intro: "<p>Review the artifacts below and decide what most likely happened at closing.</p>",
    scoringMode: "best-supported",
    artifacts: [
      {
        id: "register_log", title: "Register Log", kind: "text", sourceLine: "POS system export, 9:52 PM",
        body: "<p>The register was $40 short at closing count.</p><p>The till was counted twice by two different staff members.</p>",
      },
      {
        id: "shift_schedule", title: "Shift Schedule", kind: "table",
        table: { caption: "Closing shift, Tuesday", headers: ["Time", "Staff on register"], rows: [["6:00-8:00", "Priya"], ["8:00-10:00", "Jordan"]] },
      },
    ],
    conclusions: [
      {
        id: "miscount", label: "The till was miscounted", credit: "full",
        expertRationale: "<p>A single register error of this size is common and does not require assuming misconduct.</p>",
        reasons: [
          { id: "counted_twice", text: "The till was independently recounted and both counts agree it was short.", sound: true },
          { id: "someone_stole", text: "Jordan was alone on register during part of the shift.", sound: false, flawNote: "Being alone on register is not evidence of taking money -- it describes half the staff on any shift." },
        ],
      },
      {
        id: "theft", label: "Money was taken", credit: "none",
        expertRationale: "<p>Nothing in the log or schedule points to a specific person or a missing-cash pattern beyond one shortfall.</p>",
        reasons: [
          { id: "no_pattern", text: "A single shortfall on one night is not a pattern of theft.", sound: true },
          { id: "shortfall_exists", text: "The register was short, so someone must have taken the money.", sound: false, flawNote: "A shortfall has many ordinary causes (miscounting, a pricing error); it does not by itself point to theft." },
        ],
      },
    ],
    expertMap: [
      { artifactId: "register_log", conclusionId: "miscount", role: "supports", strength: "strong" },
      { artifactId: "shift_schedule", conclusionId: "miscount", role: "supports", strength: "weak" },
      { artifactId: "shift_schedule", conclusionId: "theft", role: "supports", strength: "weak" },
      { artifactId: "register_log", conclusionId: "theft", role: "contradicts", strength: "weak" },
    ],
  });

  it("byte-matches the header + serializer output for the template's source config (drift test)", () => {
    const generated = `${TEMPLATE_HEADER}\n\n${serializeCaseCompanionDoc(TEMPLATE_CONFIG)}`;
    expect(readTemplate()).toBe(generated);
  });

  it("parses with zero ERRORS and zero WARNINGS (a clean template)", () => {
    const { report } = parseCaseCompanionDoc(readTemplate());
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report), JSON.stringify(report)).toHaveLength(0);
  });

  it("parses to a config that validates via validateCaseConfig", () => {
    const { config } = parseCaseCompanionDoc(readTemplate());
    const r = validateCaseConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("has no em dashes or en dashes anywhere (faculty-facing plain punctuation)", () => {
    expect(readTemplate()).not.toMatch(/[–—]/);
  });

  it("lives outside public/engines and is absent from the engines manifest (scanner/manifest untouched)", () => {
    const manifest = readFileSync(join(process.cwd(), "public", "engines", "engines.manifest.json"), "utf8");
    expect(manifest).not.toMatch(/companion-doc-case-template/);
  });
});
