import { describe, it, expect } from "vitest";
import { PROCESS_STARTERS, processStarterConfig, DEFAULT_PROCESS_STARTER_ID } from "@/lib/engines/process-simulator/starters";
import { validateProcessConfig } from "@/lib/engines/process-simulator/schema";

describe("PROCESS_STARTERS", () => {
  it("every starter's config validates (schema + cross-field checks)", () => {
    for (const [id, starter] of Object.entries(PROCESS_STARTERS)) {
      const r = validateProcessConfig(starter.config);
      expect(r.ok, `starter "${id}" should validate: ${!r.ok ? r.errors.join("; ") : ""}`).toBe(true);
    }
  });

  it("has unique starter ids", () => {
    const ids = Object.keys(PROCESS_STARTERS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every starter has a non-empty description and a valid group", () => {
    for (const [id, starter] of Object.entries(PROCESS_STARTERS)) {
      expect(starter.description.length, `starter "${id}" description should be non-empty`).toBeGreaterThan(0);
      expect(["blank", "exemplar"], `starter "${id}" group should be "blank" or "exemplar"`).toContain(starter.group);
    }
  });

  it("has exactly one blank-group starter", () => {
    const blanks = Object.values(PROCESS_STARTERS).filter((s) => s.group === "blank");
    expect(blanks).toHaveLength(1);
  });
});

describe("blank starter — the gradeable shape (spec §5 review #4)", () => {
  const { config } = PROCESS_STARTERS.blank;

  it("has at least 4 actions (schema floor) with at least 2 required", () => {
    expect(config.actions.length).toBeGreaterThanOrEqual(4);
    expect(config.actions.filter((a) => a.required).length).toBeGreaterThanOrEqual(2);
  });

  it("has exactly one prerequisite edge", () => {
    const edges = config.actions.filter((a) => a.requires && a.requires.length > 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].requires).toHaveLength(1);
  });

  it("has exactly one distractor", () => {
    const distractors = config.actions.filter((a) => !a.required);
    expect(distractors).toHaveLength(1);
  });

  it("satisfies the ≥1-illegally-attemptable rule via BOTH a prerequisite edge and a distractor", () => {
    const hasPrereqEdge = config.actions.some((a) => a.required && a.requires && a.requires.length > 0);
    const hasDistractor = config.actions.some((a) => !a.required);
    expect(hasPrereqEdge).toBe(true);
    expect(hasDistractor).toBe(true);
  });

  it("has a non-empty intro and opening (learner-visible per spec §2)", () => {
    expect(config.intro.length).toBeGreaterThan(0);
    expect(config.opening.length).toBeGreaterThan(0);
  });
});

describe("processStarterConfig", () => {
  it("stamps the given title onto the starter's config", () => {
    const config = processStarterConfig("blank", "My Procedure");
    expect(config.title).toBe("My Procedure");
  });

  it("falls back to the blank starter for an unknown id", () => {
    const config = processStarterConfig("does-not-exist", "Fallback Title");
    expect(config.title).toBe("Fallback Title");
    expect(config).toMatchObject(processStarterConfig(DEFAULT_PROCESS_STARTER_ID, "Fallback Title"));
  });

  it("returns a fresh object tree each call (no shared references)", () => {
    const a = processStarterConfig("blank", "A");
    const b = processStarterConfig("blank", "B");
    expect(a.actions).not.toBe(b.actions);
    expect(a.actions[0]).not.toBe(b.actions[0]);
  });

  it("the resulting config still validates", () => {
    const r = validateProcessConfig(processStarterConfig("blank", "My Procedure"));
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});
