import { describe, it, expect } from "vitest";
import { validateBranchingConfig } from "@/lib/engines/branching-scenario/schema";

// Compact valid 3-scene/1-ending base fixture: intro -> middle -> final -> ending.
// Individual tests spread-modify this rather than build bespoke configs, except
// where the scenario under test needs a different topology (dead-end/unreachable/
// showIf-vs-reachability cases), which build a small dedicated scene list.
const base = {
  title: "Sample Scenario",
  intro: "<p>Intro</p>",
  role: "Tester",
  variables: [
    { id: "trust", label: "Trust", initial: 50, min: 0, max: 100, visible: false },
  ],
  scenes: [
    {
      id: "intro",
      title: "Introduction",
      body: "<p>Welcome.</p>",
      choices: [
        { id: "proceed", label: "Proceed", quality: "best", goTo: "scene:middle" },
      ],
    },
    {
      id: "middle",
      title: "Middle",
      body: "<p>Keep going.</p>",
      choices: [
        { id: "advance", label: "Advance", quality: "best", goTo: "scene:final" },
      ],
    },
    {
      id: "final",
      title: "Final",
      body: "<p>Almost there.</p>",
      choices: [
        { id: "finish", label: "Finish", quality: "best", goTo: "ending:done" },
      ],
    },
  ],
  startSceneId: "intro",
  endings: [
    { id: "done", title: "Done", body: "<p>You finished the scenario.</p>" },
  ],
};

describe("validateBranchingConfig — basic shape", () => {
  it("parses a valid config and sanitizes text fields (title plain, body rich)", () => {
    const withMarkup = {
      ...base,
      title: "Sample <b>Scenario</b>",
      scenes: [
        { ...base.scenes[0], body: "<p>Welcome.</p><script>alert(1)</script>" },
        base.scenes[1],
        base.scenes[2],
      ],
    };
    const r = validateBranchingConfig(withMarkup);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.title).toBe("Sample Scenario");
      expect(r.config.scenes[0].body).toBe("<p>Welcome.</p>");
    }
  });

  it("rejects unknown keys at top level, scene level, and choice level (strict)", () => {
    expect(validateBranchingConfig({ ...base, injected: true }).ok).toBe(false);
    expect(validateBranchingConfig({
      ...base,
      scenes: [{ ...base.scenes[0], injected: true }, base.scenes[1], base.scenes[2]],
    }).ok).toBe(false);
    expect(validateBranchingConfig({
      ...base,
      scenes: [
        { ...base.scenes[0], choices: [{ ...base.scenes[0].choices[0], injected: true }] },
        base.scenes[1],
        base.scenes[2],
      ],
    }).ok).toBe(false);
  });

  it("defaults feedbackMode to debrief and showPathInDebrief to true", () => {
    const r = validateBranchingConfig(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.feedbackMode).toBe("debrief");
      expect(r.config.showPathInDebrief).toBe(true);
    }
  });

  it("accepts a valid headerColor token and defaults it to absent (not 'primary') when unset", () => {
    const withColor = validateBranchingConfig({ ...base, headerColor: "info" });
    expect(withColor.ok).toBe(true);
    if (withColor.ok) expect(withColor.config.headerColor).toBe("info");

    const withoutColor = validateBranchingConfig(base);
    expect(withoutColor.ok).toBe(true);
    if (withoutColor.ok) expect(withoutColor.config.headerColor).toBeUndefined();
  });

  it("rejects a headerColor outside the 16 RDS token names", () => {
    const r = validateBranchingConfig({ ...base, headerColor: "maroon" });
    expect(r.ok).toBe(false);
  });

  it("rejects a startSceneId that does not name a scene", () => {
    const r = validateBranchingConfig({ ...base, startSceneId: "nowhere" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/startSceneId "nowhere" is not a scene/);
  });
});

describe("validateBranchingConfig — cross references", () => {
  it("rejects a goTo referencing a missing scene, naming the choice", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [
        { ...base.scenes[0], choices: [{ ...base.scenes[0].choices[0], goTo: "scene:nowhere" }] },
        base.scenes[1],
        base.scenes[2],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/scene "intro" choice "proceed": goTo scene "nowhere" does not exist/);
  });

  it("rejects a goTo referencing a missing ending, naming the choice", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [
        base.scenes[0],
        base.scenes[1],
        { ...base.scenes[2], choices: [{ ...base.scenes[2].choices[0], goTo: "ending:nowhere" }] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/scene "final" choice "finish": goTo ending "nowhere" does not exist/);
  });

  it("rejects showIf and effects referencing an unknown variable", () => {
    const showIfBad = validateBranchingConfig({
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          choices: [
            { ...base.scenes[0].choices[0], showIf: { variableId: "nope", comparator: "gte", value: 1 } },
            { id: "alt", label: "Alt", quality: "acceptable", goTo: "scene:middle" },
          ],
        },
        base.scenes[1],
        base.scenes[2],
      ],
    });
    expect(showIfBad.ok).toBe(false);
    if (!showIfBad.ok) expect(showIfBad.errors.join(" ")).toMatch(/unknown variable "nope"/);

    const effectBad = validateBranchingConfig({
      ...base,
      scenes: [
        { ...base.scenes[0], choices: [{ ...base.scenes[0].choices[0], effects: [{ variableId: "nope", delta: 5 }] }] },
        base.scenes[1],
        base.scenes[2],
      ],
    });
    expect(effectBad.ok).toBe(false);
    if (!effectBad.ok) expect(effectBad.errors.join(" ")).toMatch(/effect on unknown variable "nope"/);
  });
});

describe("validateBranchingConfig — graph validation", () => {
  it("flags a dead end: a reachable scene whose every path loops without ever reaching an ending", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [
        { id: "loopA", body: "<p>A</p>", choices: [{ id: "toB", label: "To B", quality: "best", goTo: "scene:loopB" }] },
        { id: "loopB", body: "<p>B</p>", choices: [{ id: "toA", label: "To A", quality: "best", goTo: "scene:loopA" }] },
      ],
      startSceneId: "loopA",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(" ")).toMatch(/scene "loopA" is a dead end/);
      expect(r.errors.join(" ")).toMatch(/scene "loopB" is a dead end/);
    }
  });

  it("flags a scene unreachable from the start scene", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [
        ...base.scenes,
        { id: "orphan", body: "<p>Orphan</p>", choices: [{ id: "leave", label: "Leave", quality: "best", goTo: "ending:done" }] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/scene "orphan" is unreachable from the start scene/);
  });

  it("rejects a scene where every choice has a showIf (guaranteed-exit rule)", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          choices: [{ ...base.scenes[0].choices[0], showIf: { variableId: "trust", comparator: "gte", value: 10 } }],
        },
        base.scenes[1],
        base.scenes[2],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/scene "intro": at least one choice must have no showIf \(guaranteed exit\)/);
  });

  it("proves canFinish counts only unconditional choices while reachability counts all choices: a scene whose sole ending-path is gated by showIf is a dead end even though it is reachable", () => {
    // "gate" has two choices: an unconditional loop back to itself, and a
    // showIf-gated exit straight to the ending. Structurally there IS a path
    // to an ending (through the gated choice), so a reachability-style check
    // that ignored showIf would wrongly call this scene finishable. The
    // dead-end fixed point must ignore showIf-gated choices entirely (the
    // condition might never hold at runtime), so it correctly reports a dead
    // end — while plain reachability (which DOES count the gated edge) finds
    // no unreachable-scene error at all, since "gate" is the start scene.
    const r = validateBranchingConfig({
      ...base,
      scenes: [
        {
          id: "gate",
          body: "<p>Waiting room.</p>",
          choices: [
            {
              id: "hidden_exit", label: "Hidden exit", quality: "best",
              showIf: { variableId: "trust", comparator: "gte", value: 999 },
              goTo: "ending:done",
            },
            { id: "loop_back", label: "Keep waiting", quality: "poor", goTo: "scene:gate" },
          ],
        },
      ],
      startSceneId: "gate",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(" ")).toMatch(/scene "gate" is a dead end — no guaranteed path to any ending/);
      expect(r.errors.join(" ")).not.toMatch(/unreachable/);
    }
  });
});

describe("validateBranchingConfig — duplicate ids", () => {
  it("rejects duplicate scene ids", () => {
    expect(validateBranchingConfig({
      ...base,
      scenes: [base.scenes[0], { ...base.scenes[1], id: "intro" }, base.scenes[2]],
    }).ok).toBe(false);
  });

  it("rejects duplicate choice ids within the same scene", () => {
    expect(validateBranchingConfig({
      ...base,
      scenes: [
        { ...base.scenes[0], choices: [base.scenes[0].choices[0], { ...base.scenes[0].choices[0] }] },
        base.scenes[1],
        base.scenes[2],
      ],
    }).ok).toBe(false);
  });

  it("rejects duplicate variable ids", () => {
    expect(validateBranchingConfig({
      ...base,
      variables: [base.variables[0], { ...base.variables[0] }],
    }).ok).toBe(false);
  });

  it("rejects duplicate ending ids", () => {
    expect(validateBranchingConfig({
      ...base,
      endings: [base.endings[0], { ...base.endings[0] }],
    }).ok).toBe(false);
  });
});

describe("validateBranchingConfig — image alt model", () => {
  it("rejects imageAssetId without imageRole", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [{ ...base.scenes[0], imageAssetId: "asset1" }, base.scenes[1], base.scenes[2]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/scene "intro": images require imageRole \(decorative or informative\)/);
  });

  it("rejects imageRole informative without imageAlt", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [{ ...base.scenes[0], imageAssetId: "asset1", imageRole: "informative" }, base.scenes[1], base.scenes[2]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/scene "intro": informative images require imageAlt/);
  });

  it("accepts imageRole decorative without imageAlt", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [{ ...base.scenes[0], imageAssetId: "asset1", imageRole: "decorative" }, base.scenes[1], base.scenes[2]],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects imageRole decorative carrying an imageAlt (forbidden to avoid confusion)", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [
        { ...base.scenes[0], imageAssetId: "asset1", imageRole: "decorative", imageAlt: "A description" },
        base.scenes[1],
        base.scenes[2],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/scene "intro": decorative images must not carry imageAlt/);
  });

  it("rejects imageRole/imageAlt present without an actual image", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [{ ...base.scenes[0], imageRole: "decorative" }, base.scenes[1], base.scenes[2]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/scene "intro": imageRole\/imageAlt without an image/);
  });
});

describe("validateBranchingConfig — caps and enums", () => {
  it("rejects 41 scenes (cap is 40)", () => {
    const manyScenes = Array.from({ length: 41 }, (_, i) => ({
      id: `s${i}`,
      body: "<p>x</p>",
      choices: [{ id: "c", label: "Go", quality: "best", goTo: i === 40 ? "ending:done" : `scene:s${i + 1}` }],
    }));
    const r = validateBranchingConfig({ ...base, scenes: manyScenes, startSceneId: "s0" });
    expect(r.ok).toBe(false);
  });

  it("rejects 7 choices in a scene (cap is 6)", () => {
    const manyChoices = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`, label: `Choice ${i}`, quality: "best", goTo: "ending:done",
    }));
    const r = validateBranchingConfig({
      ...base,
      scenes: [{ ...base.scenes[0], choices: manyChoices }, base.scenes[1], base.scenes[2]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a choice quality outside the enum", () => {
    const r = validateBranchingConfig({
      ...base,
      scenes: [
        { ...base.scenes[0], choices: [{ ...base.scenes[0].choices[0], quality: "great" }] },
        base.scenes[1],
        base.scenes[2],
      ],
    });
    expect(r.ok).toBe(false);
  });
});
