import { describe, it, expect } from "vitest";
import {
  renameArtifactId,
  renameConclusionId,
  renameReasonId,
  removeArtifactReferences,
  removeConclusionReferences,
  type RenameableCaseConfig,
} from "@/lib/engines/case-workspace/rename";
import { validateCaseConfig } from "@/lib/engines/case-workspace/schema";

function baseConfig(): RenameableCaseConfig {
  return {
    title: "t",
    intro: "<p>i</p>",
    scoringMode: "best-supported",
    artifacts: [
      { id: "memo", title: "Memo" },
      { id: "log", title: "Log" },
    ],
    conclusions: [
      {
        id: "equipment_failure",
        label: "Equipment failure",
        credit: "full",
        reasons: [
          { id: "r_sound", text: "sound" },
          { id: "r_flaw", text: "flaw" },
        ],
      },
      {
        id: "operator_error",
        label: "Operator error",
        credit: "none",
        reasons: [
          { id: "r_sound", text: "sound" },
          { id: "r_flaw", text: "flaw" },
        ],
      },
    ],
    expertMap: [
      { artifactId: "memo", conclusionId: "equipment_failure", role: "supports", strength: "strong" },
      { artifactId: "log", conclusionId: "operator_error", role: "supports", strength: "weak" },
    ],
  };
}

describe("renameArtifactId", () => {
  it("renames the artifact's own id", () => {
    const out = renameArtifactId(baseConfig(), "memo", "the_memo");
    expect(out.artifacts[0].id).toBe("the_memo");
  });

  it("rewrites expertMap artifactId references", () => {
    const out = renameArtifactId(baseConfig(), "memo", "the_memo");
    expect(out.expertMap[0].artifactId).toBe("the_memo");
  });

  it("leaves expertMap references to OTHER artifacts untouched", () => {
    const out = renameArtifactId(baseConfig(), "memo", "the_memo");
    expect(out.expertMap[1].artifactId).toBe("log");
  });

  it("leaves conclusionId references untouched even if the id string coincides", () => {
    const out = renameArtifactId(baseConfig(), "equipment_failure", "renamed");
    // "equipment_failure" is a conclusion id, not an artifact id here —
    // renaming it as an ARTIFACT id must not touch the conclusionId field.
    expect(out.expertMap[0].conclusionId).toBe("equipment_failure");
  });

  it("does not touch conclusions or reasons", () => {
    const out = renameArtifactId(baseConfig(), "memo", "the_memo");
    expect(out.conclusions).toEqual(baseConfig().conclusions);
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameArtifactId(cfg, "memo", "memo")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameArtifactId(cfg, "memo", "the_memo");
    expect(cfg).toEqual(snapshot);
  });

  it("end-to-end: renaming an artifact keeps a full config valid", () => {
    const cfg = {
      ...baseConfig(),
      artifacts: baseConfig().artifacts.map((a) => ({ ...a, kind: "text", body: "<p>x</p>" })),
      conclusions: baseConfig().conclusions.map((c) => ({
        ...c,
        expertRationale: "<p>x</p>",
        reasons: [{ id: "r_sound", text: "sound reason", sound: true }, { id: "r_flaw", text: "flawed reason", sound: false, flawNote: "note" }],
      })),
    };
    const renamed = renameArtifactId(cfg, "memo", "the_memo");
    const result = validateCaseConfig(renamed);
    expect(result.ok, !result.ok ? result.errors.join("; ") : "").toBe(true);
  });
});

describe("renameConclusionId", () => {
  it("renames the conclusion's own id, keeping its reasons", () => {
    const out = renameConclusionId(baseConfig(), "equipment_failure", "failure");
    expect(out.conclusions[0].id).toBe("failure");
    expect(out.conclusions[0].reasons).toEqual(baseConfig().conclusions[0].reasons);
  });

  it("rewrites expertMap conclusionId references", () => {
    const out = renameConclusionId(baseConfig(), "equipment_failure", "failure");
    expect(out.expertMap[0].conclusionId).toBe("failure");
  });

  it("leaves expertMap references to the OTHER conclusion untouched", () => {
    const out = renameConclusionId(baseConfig(), "equipment_failure", "failure");
    expect(out.expertMap[1].conclusionId).toBe("operator_error");
  });

  it("leaves artifactId references untouched even if the id string coincides", () => {
    const out = renameConclusionId(baseConfig(), "memo", "renamed");
    // "memo" is an artifact id, not a conclusion id here — renaming it as a
    // CONCLUSION id must not touch the artifactId field.
    expect(out.expertMap[0].artifactId).toBe("memo");
  });

  it("does not touch artifacts", () => {
    const out = renameConclusionId(baseConfig(), "equipment_failure", "failure");
    expect(out.artifacts).toEqual(baseConfig().artifacts);
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameConclusionId(cfg, "equipment_failure", "equipment_failure")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameConclusionId(cfg, "equipment_failure", "failure");
    expect(cfg).toEqual(snapshot);
  });
});

describe("renameReasonId", () => {
  it("renames the reason's own id within the named conclusion", () => {
    const out = renameReasonId(baseConfig(), "equipment_failure", "r_sound", "the_sound_reason");
    expect(out.conclusions[0].reasons[0].id).toBe("the_sound_reason");
  });

  it("does not touch a same-named reason id in a DIFFERENT conclusion", () => {
    const out = renameReasonId(baseConfig(), "equipment_failure", "r_sound", "the_sound_reason");
    expect(out.conclusions[1].reasons[0].id).toBe("r_sound");
  });

  it("leaves other reasons in the same conclusion untouched", () => {
    const out = renameReasonId(baseConfig(), "equipment_failure", "r_sound", "the_sound_reason");
    expect(out.conclusions[0].reasons[1].id).toBe("r_flaw");
  });

  it("is a no-op when the conclusion id does not exist", () => {
    const cfg = baseConfig();
    const out = renameReasonId(cfg, "nonexistent", "r_sound", "the_sound_reason");
    expect(out.conclusions[0].reasons[0].id).toBe("r_sound");
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameReasonId(cfg, "equipment_failure", "r_sound", "r_sound")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameReasonId(cfg, "equipment_failure", "r_sound", "the_sound_reason");
    expect(cfg).toEqual(snapshot);
  });
});

describe("removeArtifactReferences", () => {
  it("removes expertMap entries referencing the deleted artifact", () => {
    const out = removeArtifactReferences(baseConfig(), "memo");
    expect(out.expertMap).toEqual([{ artifactId: "log", conclusionId: "operator_error", role: "supports", strength: "weak" }]);
  });

  it("leaves entries referencing OTHER artifacts untouched", () => {
    const out = removeArtifactReferences(baseConfig(), "memo");
    expect(out.expertMap.some((m) => m.artifactId === "log")).toBe(true);
  });

  it("does not touch config.artifacts — callers remove the artifact's own entry separately", () => {
    const out = removeArtifactReferences(baseConfig(), "memo");
    expect(out.artifacts).toEqual(baseConfig().artifacts);
  });

  it("is a no-op (aside from a fresh expertMap array) when the artifact id is unused", () => {
    const out = removeArtifactReferences(baseConfig(), "nonexistent");
    expect(out.expertMap).toEqual(baseConfig().expertMap);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    removeArtifactReferences(cfg, "memo");
    expect(cfg).toEqual(snapshot);
  });
});

describe("removeConclusionReferences", () => {
  it("removes expertMap entries referencing the deleted conclusion", () => {
    const out = removeConclusionReferences(baseConfig(), "equipment_failure");
    expect(out.expertMap).toEqual([{ artifactId: "log", conclusionId: "operator_error", role: "supports", strength: "weak" }]);
  });

  it("does not touch config.conclusions — callers remove the conclusion's own entry separately", () => {
    const out = removeConclusionReferences(baseConfig(), "equipment_failure");
    expect(out.conclusions).toEqual(baseConfig().conclusions);
  });

  it("is a no-op (aside from a fresh expertMap array) when the conclusion id is unused", () => {
    const out = removeConclusionReferences(baseConfig(), "nonexistent");
    expect(out.expertMap).toEqual(baseConfig().expertMap);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    removeConclusionReferences(cfg, "equipment_failure");
    expect(cfg).toEqual(snapshot);
  });
});
