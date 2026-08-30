import { describe, it, expect } from "vitest";
import { CASE_STARTERS, caseStarterConfig, DEFAULT_CASE_STARTER_ID } from "@/lib/engines/case-workspace/starters";
import { validateCaseConfig } from "@/lib/engines/case-workspace/schema";

describe("CASE_STARTERS", () => {
  it("every starter's config validates (schema + cross-field checks)", () => {
    for (const [id, starter] of Object.entries(CASE_STARTERS)) {
      const r = validateCaseConfig(starter.config);
      expect(r.ok, `starter "${id}" should validate: ${!r.ok ? r.errors.join("; ") : ""}`).toBe(true);
    }
  });

  it("has unique starter ids", () => {
    const ids = Object.keys(CASE_STARTERS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every starter has a non-empty description and a valid group", () => {
    for (const [id, starter] of Object.entries(CASE_STARTERS)) {
      expect(starter.description.length, `starter "${id}" description should be non-empty`).toBeGreaterThan(0);
      expect(["blank", "exemplar"], `starter "${id}" group should be "blank" or "exemplar"`).toContain(starter.group);
    }
  });

  it("has exactly one blank-group starter", () => {
    const blanks = Object.values(CASE_STARTERS).filter((s) => s.group === "blank");
    expect(blanks).toHaveLength(1);
  });
});

describe("blank starter", () => {
  const { config } = CASE_STARTERS.blank;

  it("has 2 text artifacts, 2 conclusions, and a minimal expert map", () => {
    expect(config.artifacts).toHaveLength(2);
    expect(config.artifacts.every((a) => a.kind === "text")).toBe(true);
    expect(config.conclusions).toHaveLength(2);
    expect(config.expertMap).toHaveLength(2);
  });

  it("is scored best-supported with exactly one full-credit conclusion", () => {
    expect(config.scoringMode).toBe("best-supported");
    const full = config.conclusions.filter((c) => c.credit === "full");
    expect(full).toHaveLength(1);
  });

  it("every conclusion has at least 2 reasons, at least 1 sound, and a flawNote on every flawed reason", () => {
    for (const c of config.conclusions) {
      expect(c.reasons.length).toBeGreaterThanOrEqual(2);
      expect(c.reasons.some((r) => r.sound)).toBe(true);
      for (const r of c.reasons) {
        if (!r.sound) expect(r.flawNote, `conclusion "${c.id}" reason "${r.id}" flawNote`).toBeTruthy();
      }
    }
  });

  it("every conclusion has at least one supporting artifact in the expert map", () => {
    for (const c of config.conclusions) {
      const supports = config.expertMap.filter((m) => m.conclusionId === c.id && m.role === "supports");
      expect(supports.length, `conclusion "${c.id}" supports`).toBeGreaterThanOrEqual(1);
    }
  });

  it("has a non-empty intro (the learning objective, learner-visible per spec §2)", () => {
    expect(config.intro.length).toBeGreaterThan(0);
  });
});

describe("caseStarterConfig", () => {
  it("stamps the given title onto the starter's config", () => {
    const config = caseStarterConfig("blank", "My Case");
    expect(config.title).toBe("My Case");
    expect(config.artifacts).toHaveLength(2);
  });

  it("falls back to the blank starter for an unknown id", () => {
    const config = caseStarterConfig("does-not-exist", "Fallback Title");
    expect(config.title).toBe("Fallback Title");
    expect(config).toMatchObject(caseStarterConfig(DEFAULT_CASE_STARTER_ID, "Fallback Title"));
  });

  it("returns a fresh object tree each call (no shared references)", () => {
    const a = caseStarterConfig("blank", "A");
    const b = caseStarterConfig("blank", "B");
    expect(a.artifacts).not.toBe(b.artifacts);
    expect(a.artifacts[0]).not.toBe(b.artifacts[0]);
  });

  it("the resulting config still validates", () => {
    const r = validateCaseConfig(caseStarterConfig("blank", "My Case"));
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});
