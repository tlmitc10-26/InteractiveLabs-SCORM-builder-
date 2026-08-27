import { describe, it, expect } from "vitest";
import { parseCompanionDoc, serializeCompanionDoc, type ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { validateBranchingConfig, type BranchingConfig } from "@/lib/engines/branching-scenario/schema";
import { branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Finds the 1-based line number of the first line containing `needle` in a
 *  doc built as an array of source lines — avoids hand-counting mistakes for
 *  fixtures with many lines. */
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

// ---------------------------------------------------------------------------
// The normative example (spec §2), copied VERBATIM as instructed.
//
// IMPORTANT FINDING (see final report): this example references two
// destinations — "The Timeline" and "The Holdout" — that are never declared
// as SCENE: (or ENDING:) blocks anywhere in the example. Per the grammar
// contract those are genuinely unresolved destinations: the parser reports
// an error for each occurrence and routes the choice to the shared
// "Unresolved destination" placeholder ending so the draft still loads. This
// means the example does NOT satisfy a literal "zero report errors" reading
// of the Task 1 plan — that claim is only achievable if the spec's example
// itself declared those two scenes. Filed as a spec defect, not a parser
// bug: this test asserts the actual (correct) fail-visible behavior.
// ---------------------------------------------------------------------------
const NORMATIVE_EXAMPLE = `TITLE: Jury Deliberation
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
`;

describe("parseCompanionDoc — normative example (spec §2, verbatim)", () => {
  const srcLines = NORMATIVE_EXAMPLE.split("\n");
  const { config, report } = parseCompanionDoc(NORMATIVE_EXAMPLE);

  it("never throws and returns a best-effort config that validates", () => {
    const r = validateBranchingConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("captures TITLE, ROLE, INTRO, TRACK, and FEEDBACK from the top matter", () => {
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.title).toBe("Jury Deliberation");
    expect(r.config.role).toBe("You are a juror in a criminal trial.");
    expect(r.config.intro).toContain("A verdict must be unanimous");
    expect(r.config.feedbackMode).toBe("debrief");
    expect(r.config.variables).toHaveLength(1);
    expect(r.config.variables[0]).toMatchObject({ label: "Jury trust", min: 0, max: 100, initial: 50, visible: true });
  });

  it("has zero warnings (every quality token and arrow is well-formed)", () => {
    expect(warnings(report)).toHaveLength(0);
  });

  it("flags exactly the two undeclared destinations ('The Timeline', 'The Holdout') as unresolved, each occurrence separately, routed to one shared placeholder ending", () => {
    const errs = errors(report);
    expect(errs).toHaveLength(4);
    const timelineLines = [
      lineOf(srcLines, "-> The Timeline") && srcLines.findIndex((l) => l.includes("-> The Timeline")) + 1,
    ];
    // Find both occurrences explicitly (findIndex only finds the first).
    const timelineOccurrences = srcLines.reduce<number[]>((acc, l, i) => (l.includes("-> The Timeline") ? [...acc, i + 1] : acc), []);
    const holdoutOccurrences = srcLines.reduce<number[]>((acc, l, i) => (l.includes("-> The Holdout") ? [...acc, i + 1] : acc), []);
    expect(timelineOccurrences).toHaveLength(2);
    expect(holdoutOccurrences).toHaveLength(2);
    void timelineLines;

    const errLines = errs.map((e) => e.line).sort((a, b) => a - b);
    expect(errLines).toEqual([...timelineOccurrences, ...holdoutOccurrences].sort((a, b) => a - b));
    for (const e of errs) expect(e.message).toMatch(/no scene or ending named/i);

    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.endings).toHaveLength(3); // 2 declared + 1 shared placeholder
    const placeholders = r.config.endings.filter((e) => e.id === "unresolved_destination");
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].title).toBe("Unresolved destination");
  });

  it("resolves 'Under Pressure' and the explicit 'ENDING: A verdict, but not deliberation' correctly (no error on those lines)", () => {
    const errLines = new Set(errors(report).map((e) => e.line));
    expect(errLines.has(lineOf(srcLines, "-> Under Pressure"))).toBe(false);
    expect(errLines.has(lineOf(srcLines, "-> ENDING: A verdict, but not deliberation"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A fully self-resolving fixture (author-controlled, not from the spec) —
// demonstrates a genuinely clean zero-issue import end to end.
// ---------------------------------------------------------------------------
describe("parseCompanionDoc — a fully-resolving well-formed doc", () => {
  const doc = [
    "TITLE: Clean Scenario",
    "ROLE: You are a test author.",
    "INTRO: This document exercises every grammar rule cleanly.",
    "TRACK: Trust (0 to 100, start at 50, visible)",
    "FEEDBACK: immediate",
    "START: Second Scene",
    "",
    "SCENE: First Scene",
    "Body of the first scene.",
    "",
    "- Finish well (BEST, only if Trust is at least 40) -> Good Ending",
    "- Finish poorly (POOR) -> Bad Ending",
    "",
    "SCENE: Second Scene",
    "Body of the second scene.",
    "",
    "- Go on (BEST, Trust +10) -> First Scene",
    "  Feedback: Nice work.",
    "",
    "ENDING: Good Ending",
    "A good outcome.",
    "",
    "ENDING: Bad Ending",
    "A bad outcome.",
    "",
  ].join("\n");

  const { config, report } = parseCompanionDoc(doc);

  it("produces zero issues at all", () => {
    expect(report).toHaveLength(0);
  });

  it("validates cleanly", () => {
    const r = validateBranchingConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("honors the START directive (start scene is 'Second Scene', not the first declared scene)", () => {
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    const start = r.config.scenes.find((s) => s.id === r.config.startSceneId);
    expect(start?.title).toBe("Second Scene");
  });
});

describe("parseCompanionDoc — comments", () => {
  it("skips '#' comment lines silently, wherever they appear", () => {
    const doc = [
      "# This is a template instruction.",
      "TITLE: Commented Doc",
      "# Another comment.",
      "",
      "SCENE: Only Scene",
      "# a stray comment inside the body",
      "Body text.",
      "",
      "- Finish (BEST) -> ENDING: Done",
      "",
      "ENDING: Done",
      "Done body.",
    ].join("\n");
    const { config, report } = parseCompanionDoc(doc);
    expect(report).toHaveLength(0);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.title).toBe("Commented Doc");
    expect(r.config.scenes[0].body).not.toMatch(/comment/i);
  });
});

describe("parseCompanionDoc — unknown directive", () => {
  it("reports an error and skips the line for an unrecognized ALL-CAPS-colon directive", () => {
    const lines = [
      "TITLE: Bad Directive Doc",
      "WEIRDLINE: something",
      "",
      "SCENE: Only Scene",
      "Body text.",
      "",
      "- Finish (BEST) -> ENDING: Done",
      "",
      "ENDING: Done",
      "Done body.",
    ];
    const doc = lines.join("\n");
    const { report } = parseCompanionDoc(doc);
    const errs = errors(report);
    expect(errs).toHaveLength(1);
    expect(errs[0].line).toBe(lineOf(lines, "WEIRDLINE"));
    expect(errs[0].message).toMatch(/unknown directive/i);
  });
});

describe("parseCompanionDoc — TRACK grammar", () => {
  it("accepts a track without the visible flag (defaults to not visible)", () => {
    const doc = [
      "TITLE: T",
      "TRACK: Confidence (0 to 100, start at 50)",
      "",
      "SCENE: S",
      "Body.",
      "",
      "- Go (BEST) -> ENDING: E",
      "",
      "ENDING: E",
      "Body.",
    ].join("\n");
    const { config, report } = parseCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.variables[0]).toMatchObject({ label: "Confidence", min: 0, max: 100, initial: 50, visible: false });
  });

  it("reports an error naming the expected shape for a malformed TRACK line", () => {
    const lines = [
      "TITLE: T",
      "TRACK: Broken track definition",
      "",
      "SCENE: S",
      "Body.",
      "",
      "- Go (BEST) -> ENDING: E",
      "",
      "ENDING: E",
      "Body.",
    ];
    const { report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs).toHaveLength(1);
    expect(errs[0].line).toBe(lineOf(lines, "TRACK: Broken"));
    expect(errs[0].message).toMatch(/to.*start at/i);
  });
});

describe("parseCompanionDoc — FEEDBACK directive", () => {
  it("accepts 'immediate' and 'debrief' case-insensitively", () => {
    const doc = (mode: string) =>
      ["TITLE: T", `FEEDBACK: ${mode}`, "", "SCENE: S", "Body.", "", "- Go (BEST) -> ENDING: E", "", "ENDING: E", "Body."].join("\n");
    for (const mode of ["immediate", "DEBRIEF", "Immediate"]) {
      const { config, report } = parseCompanionDoc(doc(mode));
      expect(errors(report)).toHaveLength(0);
      const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
      expect(r.config.feedbackMode).toBe(mode.toLowerCase());
    }
  });

  it("reports an error and defaults to debrief for an invalid FEEDBACK value", () => {
    const lines = ["TITLE: T", "FEEDBACK: sometimes", "", "SCENE: S", "Body.", "", "- Go (BEST) -> ENDING: E", "", "ENDING: E", "Body."];
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs).toHaveLength(1);
    expect(errs[0].line).toBe(lineOf(lines, "FEEDBACK: sometimes"));
    expect(errs[0].message).toMatch(/immediate|debrief/i);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.feedbackMode).toBe("debrief");
  });

  it("defaults silently (no issue at all) when FEEDBACK is omitted", () => {
    const doc = ["TITLE: T", "", "SCENE: S", "Body.", "", "- Go (BEST) -> ENDING: E", "", "ENDING: E", "Body."].join("\n");
    const { config, report } = parseCompanionDoc(doc);
    expect(report).toHaveLength(0);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.feedbackMode).toBe("debrief");
  });
});

describe("parseCompanionDoc — START directive", () => {
  it("reports an error and falls back to the first scene when START names an unknown scene", () => {
    const lines = [
      "TITLE: T",
      "START: Nonexistent Scene",
      "",
      "SCENE: First",
      "Body.",
      "",
      "- Go (BEST) -> ENDING: E",
      "",
      "ENDING: E",
      "Body.",
    ];
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "START:") && /nonexistent scene/i.test(e.message))).toBe(true);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    const start = r.config.scenes.find((s) => s.id === r.config.startSceneId);
    expect(start?.title).toBe("First");
  });

  it("defaults to the first declared scene when START is omitted", () => {
    const doc = ["TITLE: T", "", "SCENE: First", "Body.", "", "- Go (BEST) -> ENDING: E", "", "ENDING: E", "Body."].join("\n");
    const { config } = parseCompanionDoc(doc);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    const start = r.config.scenes.find((s) => s.id === r.config.startSceneId);
    expect(start?.title).toBe("First");
  });
});

describe("parseCompanionDoc — TITLE default", () => {
  it("defaults to 'Imported scenario' with a warning when TITLE is absent", () => {
    const doc = ["SCENE: S", "Body.", "", "- Go (BEST) -> ENDING: E", "", "ENDING: E", "Body."].join("\n");
    const { config, report } = parseCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    expect(warnings(report).some((w) => /title/i.test(w.message))).toBe(true);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.title).toBe("Imported scenario");
  });
});

describe("parseCompanionDoc — body paragraphs", () => {
  it("turns a blank line inside a body into two separate <p> paragraphs, in order", () => {
    const doc = [
      "TITLE: T",
      "",
      "SCENE: S",
      "First paragraph text.",
      "",
      "Second paragraph text.",
      "",
      "- Go (BEST) -> ENDING: E",
      "",
      "ENDING: E",
      "Body.",
    ].join("\n");
    const { config } = parseCompanionDoc(doc);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    const scene = r.config.scenes[0];
    const paragraphs = [...scene.body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
    expect(paragraphs).toEqual(["First paragraph text.", "Second paragraph text."]);
  });
});

describe("parseCompanionDoc — choice grammar: quality", () => {
  it("errors 'missing (QUALITY)' when a choice has an arrow but no parenthesized meta at all", () => {
    const lines = [
      "TITLE: T",
      "",
      "SCENE: S",
      "Body.",
      "",
      "- Go somewhere -> ENDING: E",
      "",
      "ENDING: E",
      "Body.",
    ];
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "- Go somewhere") && /quality/i.test(e.message))).toBe(true);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.scenes[0].choices[0].quality).toBe("acceptable"); // imported as OK
    expect(r.config.scenes[0].choices[0].label).toBe("Go somewhere");
  });

  it("errors 'missing -> destination' and routes to the placeholder when a choice has no arrow at all", () => {
    const lines = ["TITLE: T", "", "SCENE: S", "Body.", "", "- Just a label with no arrow", "", "ENDING: E", "Body."];
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "Just a label") && /destination/i.test(e.message))).toBe(true);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    const choice = r.config.scenes[0].choices[0];
    expect(choice.goTo).toBe("ending:unresolved_destination");
  });

  it("errors and imports as OK when the first meta token isn't a recognized quality", () => {
    const lines = ["TITLE: T", "", "SCENE: S", "Body.", "", "- Go (WEIRD) -> ENDING: E", "", "ENDING: E", "Body."];
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "- Go (WEIRD)") && /quality/i.test(e.message))).toBe(true);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.scenes[0].choices[0].quality).toBe("acceptable");
  });

  it("accepts BEST, OK, ACCEPTABLE, and POOR case-insensitively with zero issues", () => {
    for (const [token, expected] of [
      ["best", "best"],
      ["OK", "acceptable"],
      ["Acceptable", "acceptable"],
      ["POOR", "poor"],
    ] as const) {
      const doc = ["TITLE: T", "", "SCENE: S", "Body.", "", `- Go (${token}) -> ENDING: E`, "", "ENDING: E", "Body."].join("\n");
      const { config, report } = parseCompanionDoc(doc);
      expect(errors(report), `token ${token}`).toHaveLength(0);
      const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
      expect(r.config.scenes[0].choices[0].quality).toBe(expected);
    }
  });
});

describe("parseCompanionDoc — choice grammar: arrow tolerance", () => {
  it("accepts '→' with zero warnings", () => {
    const doc = ["TITLE: T", "", "SCENE: S", "Body.", "", "- Go (BEST) → ENDING: E", "", "ENDING: E", "Body."].join("\n");
    const { report } = parseCompanionDoc(doc);
    expect(report).toHaveLength(0);
  });

  it("warns 'use ->' for the en-dash arrow variant '–>' but still resolves the choice", () => {
    const lines = ["TITLE: T", "", "SCENE: S", "Body.", "", "- Go (BEST) –> ENDING: E", "", "ENDING: E", "Body."];
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    expect(errors(report)).toHaveLength(0);
    const warns = warnings(report);
    expect(warns).toHaveLength(1);
    expect(warns[0].line).toBe(lineOf(lines, "- Go (BEST)"));
    expect(warns[0].message).toMatch(/->/);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.scenes[0].choices[0].goTo).toMatch(/^ending:/);
  });
});

describe("parseCompanionDoc — choice grammar: effects and conditions", () => {
  const preamble = ["TITLE: T", "TRACK: Trust (0 to 100, start at 50, visible)", ""];

  it("resolves a positive and negative effect on a declared track", () => {
    const doc = [...preamble, "SCENE: S", "Body.", "", "- Go (BEST, Trust +10) -> ENDING: E", "", "ENDING: E", "Body."].join("\n");
    const { config, report } = parseCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    const trust = r.config.variables[0];
    expect(r.config.scenes[0].choices[0].effects).toEqual([{ variableId: trust.id, delta: 10 }]);
  });

  it("errors naming the track when an effect references an unknown track", () => {
    const lines = [...preamble, "SCENE: S", "Body.", "", "- Go (BEST, Nonexistent +5) -> ENDING: E", "", "ENDING: E", "Body."];
    const { report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "Nonexistent +5") && /nonexistent/i.test(e.message))).toBe(true);
  });

  it("resolves 'at least', 'at most', and 'between' conditions", () => {
    const cases: Array<[string, object]> = [
      ["only if Trust is at least 60", { comparator: "gte", value: 60 }],
      ["only if Trust is at most 20", { comparator: "lte", value: 20 }],
      ["only if Trust is between 10 and 90", { comparator: "between", min: 10, max: 90 }],
    ];
    for (const [cond, expected] of cases) {
      const doc = [
        ...preamble,
        "SCENE: S",
        "Body.",
        "",
        `- Go (BEST, ${cond}) -> ENDING: E`,
        "- Otherwise (OK) -> ENDING: E", // guaranteed-exit rule needs one unconditional choice
        "",
        "ENDING: E",
        "Body.",
      ].join("\n");
      const { config, report } = parseCompanionDoc(doc);
      expect(errors(report), cond).toHaveLength(0);
      const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
      const trust = r.config.variables[0];
      expect(r.config.scenes[0].choices[0].showIf).toEqual({ variableId: trust.id, ...expected });
    }
  });

  it("errors naming the track when a condition references an unknown track", () => {
    const lines = [...preamble, "SCENE: S", "Body.", "", "- Go (BEST, only if Nonexistent is at least 5) -> ENDING: E", "", "ENDING: E", "Body."];
    const { report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "only if Nonexistent") && /nonexistent/i.test(e.message))).toBe(true);
  });

  it("errors on a malformed condition (not at-least/at-most/between), naming the unrecognized token", () => {
    const lines = [...preamble, "SCENE: S", "Body.", "", "- Go (BEST, only if Trust is above 10) -> ENDING: E", "", "ENDING: E", "Body."];
    const { report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "only if Trust is above 10"))).toBe(true);
  });
});

describe("parseCompanionDoc — destination resolution", () => {
  it("errors and routes to the shared placeholder ending for an unresolved destination, created only once", () => {
    const doc = [
      "TITLE: T",
      "",
      "SCENE: S",
      "Body.",
      "",
      "- First (BEST) -> Nowhere",
      "- Second (OK) -> AlsoNowhere",
      "",
      "ENDING: E",
      "Body.",
    ].join("\n");
    const { config, report } = parseCompanionDoc(doc);
    expect(errors(report)).toHaveLength(2);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    const placeholders = r.config.endings.filter((e) => e.id === "unresolved_destination");
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].title).toBe("Unresolved destination");
    expect(r.config.scenes[0].choices[0].goTo).toBe("ending:unresolved_destination");
    expect(r.config.scenes[0].choices[1].goTo).toBe("ending:unresolved_destination");
  });

  it("errors 'exists as both' and resolves to the scene when a bare name matches a scene and an ending", () => {
    const doc = [
      "TITLE: T",
      "START: Chooser",
      "",
      "SCENE: Verdict",
      "Scene body.",
      "",
      "- Go (BEST) -> ENDING: Placeholder",
      "",
      "SCENE: Chooser",
      "Body.",
      "",
      "- Pick (BEST) -> Verdict",
      "",
      "ENDING: Verdict",
      "Ending body.",
      "",
      "ENDING: Placeholder",
      "Body.",
    ].join("\n");
    const { config, report } = parseCompanionDoc(doc);
    const errs = errors(report);
    expect(errs.some((e) => /exists as both/i.test(e.message))).toBe(true);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    const chooser = r.config.scenes.find((s) => s.title === "Chooser")!;
    const verdictScene = r.config.scenes.find((s) => s.title === "Verdict")!;
    expect(chooser.choices[0].goTo).toBe(`scene:${verdictScene.id}`);
  });

  it("resolves an explicit 'SCENE:'/'ENDING:' prefix against the matching namespace only", () => {
    const doc = [
      "TITLE: T",
      "",
      "SCENE: Alpha",
      "Body.",
      "",
      "- Go (BEST) -> SCENE: Alpha",
      "- Leave (BEST) -> ENDING: Alpha", // gives the scene a guaranteed unconditional exit
      "",
      "ENDING: Alpha",
      "Body.",
    ].join("\n");
    const { config, report } = parseCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.scenes[0].choices[0].goTo).toBe(`scene:${r.config.scenes[0].id}`);
  });
});

describe("parseCompanionDoc — feedback attachment", () => {
  it("attaches a 'Feedback:' line to the immediately preceding choice", () => {
    const doc = [
      "TITLE: T",
      "",
      "SCENE: S",
      "Body.",
      "",
      "- Go (BEST) -> ENDING: E",
      "  Feedback: Nicely done.",
      "",
      "ENDING: E",
      "Body.",
    ].join("\n");
    const { config } = parseCompanionDoc(doc);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.scenes[0].choices[0].feedback).toBe("Nicely done.");
  });

  it("appends subsequent indented plain lines to the feedback with a space", () => {
    const doc = [
      "TITLE: T",
      "",
      "SCENE: S",
      "Body.",
      "",
      "- Go (BEST) -> ENDING: E",
      "  Feedback: Nicely done,",
      "  and worth remembering.",
      "",
      "ENDING: E",
      "Body.",
    ].join("\n");
    const { config } = parseCompanionDoc(doc);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.scenes[0].choices[0].feedback).toBe("Nicely done, and worth remembering.");
  });

  it("errors 'no preceding choice' for a Feedback: line before any choice exists", () => {
    const lines = ["TITLE: T", "", "SCENE: S", "Body.", "  Feedback: stray", "", "- Go (BEST) -> ENDING: E", "", "ENDING: E", "Body."];
    const { report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "Feedback: stray") && /no preceding choice/i.test(e.message))).toBe(true);
  });
});

describe("parseCompanionDoc — choices must be under a SCENE", () => {
  it("errors when a choice line appears in the top matter, before any SCENE", () => {
    const lines = ["TITLE: T", "- Stray choice (BEST) -> ENDING: E", "", "SCENE: S", "Body.", "", "- Go (BEST) -> ENDING: E", "", "ENDING: E", "Body."];
    const { report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "Stray choice") && /SCENE/i.test(e.message))).toBe(true);
  });

  it("errors when a choice line appears under an ENDING", () => {
    const lines = [
      "TITLE: T",
      "",
      "SCENE: S",
      "Body.",
      "",
      "- Go (BEST) -> ENDING: E",
      "",
      "ENDING: E",
      "Body.",
      "- Stray choice (BEST) -> ENDING: E",
    ];
    const { report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "Stray choice") && /SCENE/i.test(e.message))).toBe(true);
  });
});

describe("parseCompanionDoc — duplicate scene/ending titles", () => {
  it("errors on a duplicate scene title (case-insensitive) and still lands both scenes, resolving bare references to the first", () => {
    const lines = [
      "TITLE: T",
      "",
      "SCENE: Start",
      "First body.",
      "",
      "- Go (BEST) -> ENDING: E",
      "",
      "SCENE: START",
      "Second body.",
      "",
      "- Go (BEST) -> ENDING: E",
      "",
      "SCENE: Chooser",
      "Body.",
      "",
      "- Pick (BEST) -> Start",
      "",
      "ENDING: E",
      "Body.",
    ];
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "SCENE: START") && /duplicate/i.test(e.message))).toBe(true);
    // Inspected directly (not through validateBranchingConfig): this fixture's
    // point is duplicate-title resolution, not full graph reachability —
    // "Chooser"/the second "Start" are intentionally not wired into a fully
    // playable graph here.
    type LooseScene = { id: string; title?: string; choices: Array<{ goTo: string }> };
    const scenes = (config as { scenes: LooseScene[] }).scenes;
    const startScenes = scenes.filter((s) => s.title?.toLowerCase() === "start");
    expect(startScenes).toHaveLength(2);
    const chooser = scenes.find((s) => s.title === "Chooser")!;
    expect(chooser.choices[0].goTo).toBe(`scene:${startScenes[0].id}`);
  });
});

describe("parseCompanionDoc — CRLF and smart quotes", () => {
  it("tolerates CRLF line endings and normalizes smart quotes without shifting reported line numbers", () => {
    const rawLines = [
      "TITLE: Faculty’s Doc",
      "",
      "SCENE: S",
      "The professor’s point was “clear”.",
      "",
      "- Go (BEST) → ENDING: E",
      "",
      "ENDING: E",
      "Bad TRACK: not a real track line but has a colon-space so it still just becomes body text under the ending? Actually skip.",
    ];
    // Simpler, focused doc: CRLF + smart quotes + unicode arrow, one deliberate
    // error at a known line to confirm line numbers survive normalization.
    const lines = [
      "TITLE: Faculty’s Doc",
      "BADLINE: oops",
      "",
      "SCENE: S",
      "The professor’s point was “clear”.",
      "",
      "- Go (BEST) → ENDING: E",
      "",
      "ENDING: E",
      "Body.",
    ];
    void rawLines;
    const crlfDoc = lines.join("\r\n");
    const { config, report } = parseCompanionDoc(crlfDoc);
    const errs = errors(report);
    expect(errs).toHaveLength(1);
    expect(errs[0].line).toBe(lineOf(lines, "BADLINE"));
    expect(warnings(report)).toHaveLength(0);
    const r = validateBranchingConfig(config) as { ok: true; config: BranchingConfig };
    expect(r.config.title).toBe("Faculty's Doc");
    expect(r.config.scenes[0].body).toContain("The professor's point was \"clear\".");
  });
});

describe("parseCompanionDoc — caps", () => {
  it("keeps only the first 40 scenes and flags the 41st", () => {
    const lines: string[] = ["TITLE: Cap Test", ""];
    for (let i = 1; i <= 41; i++) {
      lines.push(`SCENE: Scene ${i}`, `Body ${i}.`, "", "- Finish (BEST) -> ENDING: Done", "");
    }
    lines.push("ENDING: Done", "Done body.");
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    expect(config as { scenes: unknown[] }).toMatchObject({});
    const scenes = (config as { scenes: Array<{ title?: string }> }).scenes;
    expect(scenes).toHaveLength(40);
    expect(scenes.some((s) => s.title === "Scene 41")).toBe(false);
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "SCENE: Scene 41") && /(cap|max|too many)/i.test(e.message))).toBe(true);
  });

  it("keeps only the first 6 choices in a scene and flags the 7th", () => {
    const lines: string[] = ["TITLE: Cap Test", "", "SCENE: S", "Body.", ""];
    for (let i = 1; i <= 7; i++) lines.push(`- Choice ${i} (BEST) -> ENDING: Done`);
    lines.push("", "ENDING: Done", "Done body.");
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const scene = (config as { scenes: Array<{ choices: Array<{ label: string }> }> }).scenes[0];
    expect(scene.choices).toHaveLength(6);
    expect(scene.choices.some((c) => c.label === "Choice 7")).toBe(false);
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "Choice 7") && /(cap|max|too many)/i.test(e.message))).toBe(true);
  });

  it("keeps only the first 8 tracks and flags the 9th", () => {
    const lines: string[] = ["TITLE: Cap Test"];
    for (let i = 1; i <= 9; i++) lines.push(`TRACK: Track ${i} (0 to 100, start at 50)`);
    lines.push("", "SCENE: S", "Body.", "", "- Go (BEST) -> ENDING: Done", "", "ENDING: Done", "Done body.");
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const variables = (config as { variables: Array<{ label: string }> }).variables;
    expect(variables).toHaveLength(8);
    expect(variables.some((v) => v.label === "Track 9")).toBe(false);
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "TRACK: Track 9") && /(cap|max|too many)/i.test(e.message))).toBe(true);
  });

  it("keeps only the first 8 endings and flags the 9th", () => {
    const lines: string[] = ["TITLE: Cap Test", "", "SCENE: S", "Body.", "", "- Go (BEST) -> ENDING: End1", ""];
    for (let i = 1; i <= 9; i++) lines.push(`ENDING: End${i}`, `Body ${i}.`, "");
    const { config, report } = parseCompanionDoc(lines.join("\n"));
    const endings = (config as { endings: Array<{ title: string }> }).endings;
    expect(endings).toHaveLength(8);
    expect(endings.some((e) => e.title === "End9")).toBe(false);
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "ENDING: End9") && /(cap|max|too many)/i.test(e.message))).toBe(true);
  });
});

describe("parseCompanionDoc — report completeness and ordering", () => {
  it("a doc with exactly 5 seeded flaws yields exactly 5 issues, at the right lines, in ascending line order", () => {
    const lines = [
      /* 1 */ "TITLE: Flawed Doc",
      /* 2 */ "FEEDBACK: sometimes",
      /* 3 */ "",
      /* 4 */ "SCENE: Start",
      /* 5 */ "Body text for start scene.",
      /* 6 */ "  Feedback: stray",
      /* 7 */ "",
      /* 8 */ "- Good choice (BEST) -> End",
      /* 9 */ "- Bad choice (BEST) -> Nowhere",
      /* 10 */ "- Another (WEIRD) -> End",
      /* 11 */ "",
      /* 12 */ "WEIRDLINE: something",
      /* 13 */ "",
      /* 14 */ "ENDING: End",
      /* 15 */ "Ending body text.",
    ];
    const { report } = parseCompanionDoc(lines.join("\n"));
    expect(report).toHaveLength(5);
    expect(report.map((r) => r.line)).toEqual([2, 6, 9, 10, 12]);
    expect(report.every((r) => r.severity === "error")).toBe(true);
    // Ascending order guaranteed regardless of internal pass1/pass2 collection order.
    const sorted = [...report].sort((a, b) => a.line - b.line);
    expect(report).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Serializer + round-trip
// ---------------------------------------------------------------------------

describe("serializeCompanionDoc — round-trip", () => {
  it("round-trips the jury starter: serialize -> parse -> validate ok, structurally equal by title/label/quality/effects/destination-title/feedback-text/track-defs/feedbackMode/start-scene", () => {
    const original = branchingStarterConfig("jury", "Jury Deliberation");
    const doc = serializeCompanionDoc(original);
    const { config, report } = parseCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);

    const validated = validateBranchingConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    const reparsed = (validated as { ok: true; config: BranchingConfig }).config;

    expect(reparsed.title).toBe(original.title);
    expect(reparsed.role).toBe(original.role);
    expect(reparsed.feedbackMode).toBe(original.feedbackMode);

    expect(reparsed.variables.map((v) => ({ label: v.label, min: v.min, max: v.max, initial: v.initial, visible: v.visible }))).toEqual(
      original.variables.map((v) => ({ label: v.label, min: v.min, max: v.max, initial: v.initial, visible: v.visible })),
    );

    const origStart = original.scenes.find((s) => s.id === original.startSceneId);
    const newStart = reparsed.scenes.find((s) => s.id === reparsed.startSceneId);
    expect(newStart?.title).toBe(origStart?.title);

    const titleOf = (cfg: BranchingConfig, goTo: string): string | undefined => {
      const [kind, id] = goTo.split(":");
      return kind === "scene" ? cfg.scenes.find((s) => s.id === id)?.title : cfg.endings.find((e) => e.id === id)?.title;
    };
    const varLabel = (cfg: BranchingConfig, variableId: string): string | undefined => cfg.variables.find((v) => v.id === variableId)?.label;

    expect(reparsed.scenes).toHaveLength(original.scenes.length);
    original.scenes.forEach((origScene, i) => {
      const newScene = reparsed.scenes[i];
      expect(newScene.title).toBe(origScene.title);
      expect(newScene.choices).toHaveLength(origScene.choices.length);
      origScene.choices.forEach((origChoice, j) => {
        const newChoice = newScene.choices[j];
        expect(newChoice.label).toBe(origChoice.label);
        expect(newChoice.quality).toBe(origChoice.quality);
        expect(newChoice.effects.map((e) => ({ label: varLabel(reparsed, e.variableId), delta: e.delta }))).toEqual(
          origChoice.effects.map((e) => ({ label: varLabel(original, e.variableId), delta: e.delta })),
        );
        expect(titleOf(reparsed, newChoice.goTo)).toBe(titleOf(original, origChoice.goTo));
        expect(stripTags(newChoice.feedback)).toBe(stripTags(origChoice.feedback));
        if (origChoice.showIf) {
          expect(newChoice.showIf?.comparator).toBe(origChoice.showIf.comparator);
          expect(newChoice.showIf?.value).toBe(origChoice.showIf.value);
          expect(newChoice.showIf?.min).toBe(origChoice.showIf.min);
          expect(newChoice.showIf?.max).toBe(origChoice.showIf.max);
        } else {
          expect(newChoice.showIf).toBeUndefined();
        }
      });
    });

    expect(reparsed.endings).toHaveLength(original.endings.length);
    for (const origEnding of original.endings) {
      expect(reparsed.endings.some((e) => e.title === origEnding.title)).toBe(true);
    }
  });

  it("round-trips the blank starter too (serializer output must re-parse cleanly in general, not just for one fixture)", () => {
    const original = branchingStarterConfig("blank", "Blank Test");
    const doc = serializeCompanionDoc(original);
    const { config, report } = parseCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const validated = validateBranchingConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
  });

  it("omits the START directive when the start scene is the first scene, and includes it otherwise", () => {
    const jury = branchingStarterConfig("jury", "Jury Deliberation");
    const juryDoc = serializeCompanionDoc(jury);
    // jury's startSceneId IS its first scene -> no START line expected.
    expect(juryDoc).not.toMatch(/^START:/m);

    const reordered: BranchingConfig = { ...jury, startSceneId: jury.scenes[1].id };
    const reorderedDoc = serializeCompanionDoc(reordered);
    expect(reorderedDoc).toMatch(/^START:/m);
  });
});
