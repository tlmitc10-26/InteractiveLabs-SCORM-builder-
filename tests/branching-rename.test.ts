import { describe, it, expect } from "vitest";
import {
  renameSceneId,
  renameEndingId,
  renameVariableId,
  renameChoiceId,
  type RenameableBranchingConfig,
} from "@/lib/engines/branching-scenario/rename";
import { validateBranchingConfig } from "@/lib/engines/branching-scenario/schema";

function baseConfig(): RenameableBranchingConfig {
  return {
    title: "t",
    variables: [
      { id: "trust", label: "Trust" },
      { id: "risk", label: "Risk" },
    ],
    scenes: [
      {
        id: "opening",
        body: "<p>opening</p>",
        choices: [
          { id: "go_a", goTo: "scene:middle", effects: [{ variableId: "trust", delta: 5 }] },
          { id: "go_b", goTo: "scene:other", effects: [], showIf: { variableId: "trust", comparator: "gte", value: 10 } },
        ],
      },
      {
        id: "middle",
        body: "<p>middle</p>",
        choices: [
          { id: "go_c", goTo: "ending:good", effects: [{ variableId: "risk", delta: -5 }] },
        ],
      },
      {
        id: "other",
        body: "<p>other</p>",
        choices: [
          { id: "go_d", goTo: "ending:bad", effects: [] },
        ],
      },
    ],
    startSceneId: "opening",
    endings: [
      { id: "good", title: "Good" },
      { id: "bad", title: "Bad" },
    ],
  };
}

describe("renameSceneId", () => {
  it("renames the scene's own id", () => {
    const out = renameSceneId(baseConfig(), "middle", "timeline");
    expect(out.scenes[1].id).toBe("timeline");
  });

  it("rewrites goTo scene: references across all scenes", () => {
    const out = renameSceneId(baseConfig(), "middle", "timeline");
    expect(out.scenes[0].choices[0].goTo).toBe("scene:timeline");
  });

  it("leaves goTo references to OTHER scenes untouched", () => {
    const out = renameSceneId(baseConfig(), "middle", "timeline");
    expect(out.scenes[0].choices[1].goTo).toBe("scene:other");
  });

  it("leaves goTo ending: references untouched even if the id string coincides", () => {
    const out = renameSceneId(baseConfig(), "good", "great");
    // "good" is an ending id, not a scene id — renaming it as a SCENE id
    // must not touch the ending: reference (different namespace).
    expect(out.scenes[1].choices[0].goTo).toBe("ending:good");
  });

  it("updates startSceneId when it points at the renamed scene", () => {
    const out = renameSceneId(baseConfig(), "opening", "intro");
    expect(out.startSceneId).toBe("intro");
    expect(out.scenes[0].id).toBe("intro");
  });

  it("leaves startSceneId untouched when it points elsewhere", () => {
    const out = renameSceneId(baseConfig(), "middle", "timeline");
    expect(out.startSceneId).toBe("opening");
  });

  it("does not touch choice ids", () => {
    const out = renameSceneId(baseConfig(), "middle", "timeline");
    expect(out.scenes[1].choices[0].id).toBe("go_c");
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameSceneId(cfg, "middle", "middle")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameSceneId(cfg, "middle", "timeline");
    expect(cfg).toEqual(snapshot);
  });

  it("end-to-end: renaming a scene keeps a full config valid", () => {
    const cfg = {
      ...baseConfig(),
      scenes: baseConfig().scenes.map((s) => ({ ...s, choices: s.choices.map((c) => ({ ...c, label: "x", quality: "best" })) })),
      variables: baseConfig().variables.map((v) => ({ ...v, initial: 0, min: 0, max: 100, visible: false })),
      endings: baseConfig().endings.map((e) => ({ ...e, body: "<p>x</p>" })),
    };
    const renamed = renameSceneId(cfg, "middle", "timeline");
    const result = validateBranchingConfig(renamed);
    expect(result.ok, !result.ok ? result.errors.join("; ") : "").toBe(true);
  });
});

describe("renameEndingId", () => {
  it("renames the ending's own id", () => {
    const out = renameEndingId(baseConfig(), "good", "verdict_good");
    expect(out.endings[0].id).toBe("verdict_good");
  });

  it("rewrites goTo ending: references across all scenes", () => {
    const out = renameEndingId(baseConfig(), "good", "verdict_good");
    expect(out.scenes[1].choices[0].goTo).toBe("ending:verdict_good");
  });

  it("leaves goTo references to the OTHER ending untouched", () => {
    const out = renameEndingId(baseConfig(), "good", "verdict_good");
    expect(out.scenes[2].choices[0].goTo).toBe("ending:bad");
  });

  it("leaves goTo scene: references untouched even if the id string coincides", () => {
    const out = renameEndingId(baseConfig(), "middle", "timeline_ending");
    // "middle" is a scene id, not an ending id here — renaming it as an
    // ENDING id must not touch the scene: reference.
    expect(out.scenes[0].choices[0].goTo).toBe("scene:middle");
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameEndingId(cfg, "good", "good")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameEndingId(cfg, "good", "verdict_good");
    expect(cfg).toEqual(snapshot);
  });
});

describe("renameVariableId", () => {
  it("renames the variable's own id", () => {
    const out = renameVariableId(baseConfig(), "trust", "jury_trust");
    expect(out.variables[0].id).toBe("jury_trust");
  });

  it("rewrites effects[].variableId referencing the renamed id", () => {
    const out = renameVariableId(baseConfig(), "trust", "jury_trust");
    expect(out.scenes[0].choices[0].effects[0].variableId).toBe("jury_trust");
  });

  it("leaves effects referencing OTHER variables untouched", () => {
    const out = renameVariableId(baseConfig(), "trust", "jury_trust");
    expect(out.scenes[1].choices[0].effects[0].variableId).toBe("risk");
  });

  it("rewrites showIf.variableId referencing the renamed id", () => {
    const out = renameVariableId(baseConfig(), "trust", "jury_trust");
    expect(out.scenes[0].choices[1].showIf!.variableId).toBe("jury_trust");
  });

  it("leaves showIf untouched when it references a different variable", () => {
    const cfg = baseConfig();
    cfg.scenes[0].choices[1].showIf = { variableId: "risk", comparator: "gte", value: 5 };
    const out = renameVariableId(cfg, "trust", "jury_trust");
    expect(out.scenes[0].choices[1].showIf!.variableId).toBe("risk");
  });

  it("leaves choices with no showIf untouched (no crash on undefined)", () => {
    const out = renameVariableId(baseConfig(), "risk", "danger");
    expect(out.scenes[0].choices[0].showIf).toBeUndefined();
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameVariableId(cfg, "trust", "trust")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameVariableId(cfg, "trust", "jury_trust");
    expect(cfg).toEqual(snapshot);
  });
});

describe("renameChoiceId", () => {
  it("renames the choice's own id within the named scene", () => {
    const out = renameChoiceId(baseConfig(), "opening", "go_a", "speak_up");
    expect(out.scenes[0].choices[0].id).toBe("speak_up");
  });

  it("does not touch a same-named choice id in a DIFFERENT scene", () => {
    const cfg = baseConfig();
    cfg.scenes[1].choices.push({ id: "go_a", goTo: "ending:good", effects: [] });
    const out = renameChoiceId(cfg, "opening", "go_a", "speak_up");
    expect(out.scenes[0].choices[0].id).toBe("speak_up");
    expect(out.scenes[1].choices[1].id).toBe("go_a");
  });

  it("leaves other choices in the same scene untouched", () => {
    const out = renameChoiceId(baseConfig(), "opening", "go_a", "speak_up");
    expect(out.scenes[0].choices[1].id).toBe("go_b");
  });

  it("is a no-op when the scene id does not exist", () => {
    const cfg = baseConfig();
    const out = renameChoiceId(cfg, "nonexistent", "go_a", "speak_up");
    expect(out.scenes[0].choices[0].id).toBe("go_a");
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameChoiceId(cfg, "opening", "go_a", "go_a")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameChoiceId(cfg, "opening", "go_a", "speak_up");
    expect(cfg).toEqual(snapshot);
  });
});
