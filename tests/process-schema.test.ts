import { describe, it, expect } from "vitest";
import { validateProcessConfig } from "@/lib/engines/process-simulator/schema";

// Compact valid base fixture: 4 actions — one prerequisite-free required
// action, one required action gated on it, and two distractors. Individual
// tests spread-modify this rather than build bespoke configs, except where
// the rule under test needs a different shape.
const base = {
  title: "Sample Procedure",
  intro: "<p>Intro</p>",
  opening: "<p>Opening</p>",
  actions: [
    {
      id: "photograph",
      label: "Photograph the item in place",
      required: true,
      outcome: "<p>The item's position is recorded.</p>",
    },
    {
      id: "collect",
      label: "Collect the item",
      required: true,
      requires: ["photograph"],
      outcome: "<p>The item is bagged.</p>",
      consequence: "<p>The item moved before it was photographed.</p>",
      consequenceNote: "Collection depends on photographing first.",
    },
    {
      id: "ask_officer",
      label: "Ask the officer to move it",
      required: false,
      consequence: "<p>Chain of custody now starts with an undocumented move.</p>",
      consequenceNote: "Convenience is not a custody procedure.",
    },
    {
      id: "skip_gloves",
      label: "Handle the item bare-handed",
      required: false,
      consequence: "<p>The item now carries contamination risk.</p>",
      consequenceNote: "Gloves protect the evidence, not just the handler.",
    },
  ],
};

describe("validateProcessConfig — basic shape", () => {
  it("parses a valid config and sanitizes text fields (title/label plain, intro/opening/outcome/consequence rich)", () => {
    const withMarkup = {
      ...base,
      title: "Sample <b>Procedure</b>",
      actions: [
        { ...base.actions[0], outcome: "<p>The item's position is recorded.</p><script>alert(1)</script>" },
        base.actions[1],
        base.actions[2],
        base.actions[3],
      ],
    };
    const r = validateProcessConfig(withMarkup);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    if (r.ok) {
      expect(r.config.title).toBe("Sample Procedure");
      expect(r.config.actions[0].outcome).toBe("<p>The item's position is recorded.</p>");
    }
  });

  it("rejects unknown keys at top and action level (strict)", () => {
    expect(validateProcessConfig({ ...base, injected: true }).ok).toBe(false);
    expect(validateProcessConfig({
      ...base,
      actions: [{ ...base.actions[0], injected: true }, base.actions[1], base.actions[2], base.actions[3]],
    }).ok).toBe(false);
  });

  it("accepts a valid headerColor token, and it is absent (not defaulted) when unset", () => {
    const withColor = validateProcessConfig({ ...base, headerColor: "info" });
    expect(withColor.ok).toBe(true);
    if (withColor.ok) expect(withColor.config.headerColor).toBe("info");

    const withoutColor = validateProcessConfig(base);
    expect(withoutColor.ok).toBe(true);
    if (withoutColor.ok) expect(withoutColor.config.headerColor).toBeUndefined();
  });

  it("rejects a headerColor outside the RDS token names", () => {
    expect(validateProcessConfig({ ...base, headerColor: "maroon" }).ok).toBe(false);
  });

  it("rejects an id that is not letters/digits/underscore", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [{ ...base.actions[0], id: "not a valid id" }, base.actions[1], base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects fewer than 4 actions", () => {
    expect(validateProcessConfig({ ...base, actions: base.actions.slice(0, 3) }).ok).toBe(false);
  });

  it("rejects more than 24 actions", () => {
    const filler = Array.from({ length: 21 }, (_, i) => ({
      id: `filler_${i}`,
      label: `Filler ${i}`,
      required: false,
      consequence: "<p>x</p>",
      consequenceNote: "x",
    }));
    expect(validateProcessConfig({ ...base, actions: [...base.actions, ...filler] }).ok).toBe(false);
  });
});

describe("validateProcessConfig — duplicate ids", () => {
  it("rejects duplicate action ids", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], id: base.actions[0].id }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate action id "photograph"/);
  });
});

describe("validateProcessConfig — requires: [] is invalid", () => {
  it("rejects an empty requires array (absent means none; [] is invalid)", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [{ ...base.actions[0] }, { ...base.actions[1], requires: [] }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateProcessConfig — requires resolution", () => {
  it("rejects a requires entry that references an unknown action", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], requires: ["nope"] }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unknown action "nope"/);
  });

  it("rejects a requires entry that references a DISTRACTOR action", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], requires: ["ask_officer"] }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/non-required action "ask_officer"/);
  });

  it("rejects a self-reference", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], requires: ["collect"] }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/requires cannot reference itself/);
  });

  it("rejects duplicated entries within the same requires array", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [
        base.actions[0],
        { id: "third", label: "Third required", required: true, requires: ["photograph", "photograph"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        base.actions[2],
        base.actions[3],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate entry "photograph"/);
  });

  it("rejects requires on a DISTRACTOR action itself (a distractor's own prerequisites are never consulted -- state.ts attemptAction never checks them)", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], base.actions[1], { ...base.actions[2], requires: ["photograph"] }, base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/distractor actions must not carry requires/);
  });

  it("accepts a conjunctive multi-prerequisite requires array (2..6 required refs)", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [
        base.actions[0],
        { id: "gloves", label: "Put on gloves", required: true, outcome: "<p>Gloves on.</p>" },
        { ...base.actions[1], requires: ["photograph", "gloves"] },
        base.actions[3],
      ],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("CONJUNCTIVE fixture: one-of-two prerequisites met is still illegal (documented via the schema's requires array, exercised for real in state.ts)", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [
        base.actions[0],
        { id: "gloves", label: "Put on gloves", required: true, outcome: "<p>Gloves on.</p>" },
        { ...base.actions[1], requires: ["photograph", "gloves"] },
        base.actions[3],
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const collect = r.config.actions.find((a) => a.id === "collect")!;
      expect(collect.requires).toEqual(["photograph", "gloves"]);
    }
  });
});

describe("validateProcessConfig — acyclic check", () => {
  it("rejects a direct 2-cycle", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [
        { id: "a", label: "A", required: true, requires: ["b"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        { id: "b", label: "B", required: true, requires: ["a"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        base.actions[2],
        base.actions[3],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/cycle/);
  });

  it("rejects a longer transitive cycle (a -> b -> c -> a)", () => {
    const r = validateProcessConfig({
      title: base.title,
      intro: base.intro,
      opening: base.opening,
      actions: [
        { id: "a", label: "A", required: true, requires: ["c"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        { id: "b", label: "B", required: true, requires: ["a"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        { id: "c", label: "C", required: true, requires: ["b"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        base.actions[2],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/cycle/);
  });

  it("accepts a valid DAG with a diamond shape (two independent paths converging)", () => {
    const r = validateProcessConfig({
      title: base.title,
      intro: base.intro,
      opening: base.opening,
      actions: [
        { id: "start", label: "Start", required: true, outcome: "<p>x</p>" },
        { id: "branch_a", label: "Branch A", required: true, requires: ["start"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        { id: "branch_b", label: "Branch B", required: true, requires: ["start"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        { id: "converge", label: "Converge", required: true, requires: ["branch_a", "branch_b"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
      ],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("acyclic + requires-only-required together guarantee every required action is reachable from an empty done set", () => {
    // A required action's prerequisites (if any) are themselves required
    // (enforced above) and the graph is acyclic (enforced above), so
    // starting from an empty "done" set, at least one required action has
    // no unmet prerequisite at every stage — i.e. every required action is
    // reachable by *some* legal play order. This test demonstrates the
    // property directly for a nontrivial DAG rather than re-deriving it.
    const config = {
      title: base.title,
      intro: base.intro,
      opening: base.opening,
      actions: [
        { id: "start", label: "Start", required: true, outcome: "<p>x</p>" },
        { id: "mid", label: "Mid", required: true, requires: ["start"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        { id: "end", label: "End", required: true, requires: ["mid"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        base.actions[2],
      ],
    };
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    if (!r.ok) return;
    // Simulate a legal topological play order: at each step, some
    // not-yet-done required action must have all its requires satisfied.
    const required = r.config.actions.filter((a) => a.required);
    const done = new Set<string>();
    while (done.size < required.length) {
      const playable = required.find((a) => !done.has(a.id) && (a.requires ?? []).every((id) => done.has(id)));
      expect(playable, `no playable action found; done=${[...done]}`).toBeDefined();
      done.add(playable!.id);
    }
    expect(done.size).toBe(required.length);
  });
});

describe("validateProcessConfig — required-count floor", () => {
  it("rejects fewer than 2 required actions", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [
        { ...base.actions[0], required: false, outcome: undefined, consequence: "<p>x</p>", consequenceNote: "x" },
        base.actions[1],
        base.actions[2],
        base.actions[3],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/at least 2 required actions/);
  });
});

describe("validateProcessConfig — the ≥1-illegally-attemptable hard rule", () => {
  it("rejects a config with NO prerequisite edges and NO distractors (every learner would score 100 unconditionally)", () => {
    const r = validateProcessConfig({
      title: base.title,
      intro: base.intro,
      opening: base.opening,
      actions: [
        { id: "one", label: "One", required: true, outcome: "<p>x</p>" },
        { id: "two", label: "Two", required: true, outcome: "<p>x</p>" },
        { id: "three", label: "Three", required: true, outcome: "<p>x</p>" },
        { id: "four", label: "Four", required: true, outcome: "<p>x</p>" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/every learner scores 100 unconditionally/);
  });

  it("accepts a config with NO prerequisite edges but AT LEAST ONE distractor", () => {
    const r = validateProcessConfig({
      title: base.title,
      intro: base.intro,
      opening: base.opening,
      actions: [
        { id: "one", label: "One", required: true, outcome: "<p>x</p>" },
        { id: "two", label: "Two", required: true, outcome: "<p>x</p>" },
        { id: "distractor", label: "Distractor", required: false, consequence: "<p>x</p>", consequenceNote: "x" },
        { id: "four", label: "Four", required: true, outcome: "<p>x</p>" },
      ],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("accepts a config with a prerequisite edge but NO distractors", () => {
    const r = validateProcessConfig({
      title: base.title,
      intro: base.intro,
      opening: base.opening,
      actions: [
        { id: "one", label: "One", required: true, outcome: "<p>x</p>" },
        { id: "two", label: "Two", required: true, requires: ["one"], outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
        { id: "three", label: "Three", required: true, outcome: "<p>x</p>" },
        { id: "four", label: "Four", required: true, outcome: "<p>x</p>" },
      ],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("the base fixture (both a prerequisite edge and distractors) validates", () => {
    expect(validateProcessConfig(base).ok).toBe(true);
  });
});

describe("validateProcessConfig — field matrix (outcome)", () => {
  it("rejects a required action missing outcome", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [{ ...base.actions[0], outcome: undefined }, base.actions[1], base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/required actions require outcome/);
  });

  it("rejects a distractor carrying outcome", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], base.actions[1], { ...base.actions[2], outcome: "<p>x</p>" }, base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/distractor actions must not carry outcome/);
  });
});

describe("validateProcessConfig — field matrix (consequence)", () => {
  it("rejects a prerequisite-free required action carrying consequence (dead text)", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [
        { ...base.actions[0], consequence: "<p>x</p>", consequenceNote: "x" },
        base.actions[1], base.actions[2], base.actions[3],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/must not carry consequence \(dead text/);
  });

  it("rejects a required action WITH prerequisites missing consequence", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], consequence: undefined, consequenceNote: undefined }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/a required action with prerequisites requires consequence/);
  });

  it("rejects a distractor missing consequence", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], base.actions[1], { ...base.actions[2], consequence: undefined, consequenceNote: undefined }, base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/distractor actions require consequence/);
  });
});

describe("validateProcessConfig — field matrix (consequenceNote)", () => {
  it("rejects a consequence-required action missing consequenceNote", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], consequenceNote: undefined }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/consequenceNote is required wherever consequence is required/);
  });

  it("rejects consequenceNote present on a distractor missing consequence (i.e. consequenceNote without consequence)", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], base.actions[1], { ...base.actions[2], consequence: undefined }, base.actions[3]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/distractor actions require consequence/);
  });
});

describe("validateProcessConfig — unique required labels (case-insensitive)", () => {
  it("rejects two required actions with the same label, different case", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [
        base.actions[0],
        { ...base.actions[1], label: "PHOTOGRAPH THE ITEM IN PLACE" },
        base.actions[2],
        base.actions[3],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate required action label/);
  });

  it("allows a distractor label to duplicate a required action's label", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], base.actions[1], { ...base.actions[2], label: base.actions[0].label }, base.actions[3]],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("allows two distractors to share a label", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], base.actions[1], base.actions[2], { ...base.actions[3], label: base.actions[2].label }],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});

describe("validateProcessConfig — caps", () => {
  it("rejects a title over 200 chars", () => {
    expect(validateProcessConfig({ ...base, title: "x".repeat(201) }).ok).toBe(false);
  });

  it("rejects an intro over 5000 chars", () => {
    expect(validateProcessConfig({ ...base, intro: "<p>" + "x".repeat(5000) + "</p>" }).ok).toBe(false);
  });

  it("rejects an opening over 2000 chars", () => {
    expect(validateProcessConfig({ ...base, opening: "<p>" + "x".repeat(2000) + "</p>" }).ok).toBe(false);
  });

  it("rejects an expertNote over 3000 chars", () => {
    expect(validateProcessConfig({ ...base, expertNote: "<p>" + "x".repeat(3000) + "</p>" }).ok).toBe(false);
  });

  it("accepts a valid expertNote", () => {
    const r = validateProcessConfig({ ...base, expertNote: "<p>The expert path skips no step.</p>" });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("rejects a label over 200 chars", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [{ ...base.actions[0], label: "x".repeat(201) }, base.actions[1], base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a requires array with 0 entries via empty array (min 1)", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], requires: [] }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a requires array with 7 entries (max 6)", () => {
    const extras = Array.from({ length: 7 }, (_, i) => ({ id: `req_${i}`, label: `Req ${i}`, required: true, outcome: "<p>x</p>" }));
    const r = validateProcessConfig({
      title: base.title,
      intro: base.intro,
      opening: base.opening,
      actions: [
        ...extras,
        { id: "gated", label: "Gated", required: true, requires: extras.map((e) => e.id), outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a consequenceNote over 300 chars", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], consequenceNote: "x".repeat(301) }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an outcome over 1500 chars", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [{ ...base.actions[0], outcome: "<p>" + "x".repeat(1500) + "</p>" }, base.actions[1], base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a consequence over 1500 chars", () => {
    const r = validateProcessConfig({
      ...base,
      actions: [base.actions[0], { ...base.actions[1], consequence: "<p>" + "x".repeat(1500) + "</p>" }, base.actions[2], base.actions[3]],
    });
    expect(r.ok).toBe(false);
  });
});
