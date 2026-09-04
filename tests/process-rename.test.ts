import { describe, it, expect } from "vitest";
import { renameActionId, removeActionReferences, type RenameableProcessConfig } from "@/lib/engines/process-simulator/rename";
import { validateProcessConfig } from "@/lib/engines/process-simulator/schema";

function baseConfig(): RenameableProcessConfig {
  return {
    title: "t",
    intro: "<p>i</p>",
    opening: "<p>o</p>",
    actions: [
      { id: "photograph", label: "Photograph" },
      { id: "collect", label: "Collect", requires: ["photograph"] },
      { id: "log", label: "Log", requires: ["photograph", "collect"] },
      { id: "shortcut", label: "Shortcut" },
    ],
  };
}

describe("renameActionId", () => {
  it("renames the action's own id", () => {
    const out = renameActionId(baseConfig(), "photograph", "the_photo");
    expect(out.actions[0].id).toBe("the_photo");
  });

  it("rewrites requires references in OTHER actions", () => {
    const out = renameActionId(baseConfig(), "photograph", "the_photo");
    expect(out.actions[1].requires).toEqual(["the_photo"]);
    expect(out.actions[2].requires).toEqual(["the_photo", "collect"]);
  });

  it("leaves requires references to OTHER (non-renamed) ids untouched", () => {
    const out = renameActionId(baseConfig(), "collect", "the_collect");
    expect(out.actions[1].id).toBe("the_collect");
    expect(out.actions[2].requires).toEqual(["photograph", "the_collect"]);
  });

  it("leaves actions with no requires array untouched", () => {
    const out = renameActionId(baseConfig(), "photograph", "the_photo");
    expect(out.actions[3]).toEqual(baseConfig().actions[3]);
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameActionId(cfg, "photograph", "photograph")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameActionId(cfg, "photograph", "the_photo");
    expect(cfg).toEqual(snapshot);
  });

  it("end-to-end: renaming an action keeps a full config valid", () => {
    const cfg: RenameableProcessConfig = {
      title: "t",
      intro: "<p>i</p>",
      opening: "<p>o</p>",
      actions: [
        { id: "photograph", label: "Photograph", required: true, outcome: "<p>x</p>" },
        {
          id: "collect", label: "Collect", required: true, requires: ["photograph"],
          outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x",
        },
        { id: "log", label: "Log", required: true, outcome: "<p>x</p>" },
        { id: "shortcut", label: "Shortcut", required: false, consequence: "<p>x</p>", consequenceNote: "x" },
      ],
    };
    const renamed = renameActionId(cfg, "photograph", "the_photo");
    const result = validateProcessConfig(renamed);
    expect(result.ok, !result.ok ? result.errors.join("; ") : "").toBe(true);
    if (result.ok) expect(result.config.actions[1].requires).toEqual(["the_photo"]);
  });
});

describe("removeActionReferences", () => {
  it("prunes the deleted/toggled action's id from every other action's requires array", () => {
    const out = removeActionReferences(baseConfig(), "photograph");
    expect(out.actions[1].requires).toBeUndefined(); // "collect" had ONLY photograph -> field dropped entirely, not []
    expect(out.actions[2].requires).toEqual(["collect"]); // "log" had [photograph, collect] -> photograph pruned
  });

  it("never leaves an empty array — drops the requires field entirely when nothing remains (schema: [] is invalid)", () => {
    const out = removeActionReferences(baseConfig(), "photograph");
    expect(out.actions[1]).not.toHaveProperty("requires");
  });

  it("does not touch config.actions' own entries — callers remove the action's own array entry separately", () => {
    const out = removeActionReferences(baseConfig(), "photograph");
    expect(out.actions.map((a) => a.id)).toEqual(["photograph", "collect", "log", "shortcut"]);
  });

  it("is a no-op (aside from a fresh actions array) when the action id is never referenced", () => {
    const out = removeActionReferences(baseConfig(), "shortcut");
    expect(out.actions).toEqual(baseConfig().actions);
  });

  it("leaves actions with no requires array untouched", () => {
    const out = removeActionReferences(baseConfig(), "collect");
    expect(out.actions[0]).toEqual(baseConfig().actions[0]);
    expect(out.actions[3]).toEqual(baseConfig().actions[3]);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    removeActionReferences(cfg, "photograph");
    expect(cfg).toEqual(snapshot);
  });

  it("required->distractor toggle cascade: pruning inbound requires then flipping required keeps the config valid", () => {
    const cfg: RenameableProcessConfig = {
      title: "t",
      intro: "<p>i</p>",
      opening: "<p>o</p>",
      actions: [
        { id: "photograph", label: "Photograph", required: true, outcome: "<p>x</p>" },
        {
          id: "collect", label: "Collect", required: true, requires: ["photograph"],
          outcome: "<p>x</p>", consequence: "<p>x</p>", consequenceNote: "x",
        },
        { id: "log", label: "Log", required: true, outcome: "<p>x</p>" },
        { id: "shortcut", label: "Shortcut", required: false, consequence: "<p>x</p>", consequenceNote: "x" },
      ],
    };
    // Toggle "collect" from required to distractor: cascade prunes every
    // inbound requires entry pointing at it (none here), and the caller
    // flips required + drops outcome + adds consequence/consequenceNote
    // (the toggle's own-field responsibility, not rename.ts's).
    const pruned = removeActionReferences(cfg, "collect");
    const toggled = {
      ...pruned,
      actions: pruned.actions.map((a) =>
        a.id === "collect"
          ? { ...a, required: false, outcome: undefined, consequence: "<p>x</p>", consequenceNote: "x" }
          : a,
      ),
    };
    const result = validateProcessConfig(toggled);
    expect(result.ok, !result.ok ? result.errors.join("; ") : "").toBe(true);
  });
});
