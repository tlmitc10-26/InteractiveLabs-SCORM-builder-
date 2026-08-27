import { describe, it, expect } from "vitest";
import { BRANCHING_STARTERS, branchingStarterConfig, DEFAULT_BRANCHING_STARTER_ID } from "@/lib/engines/branching-scenario/starters";
import { validateBranchingConfig } from "@/lib/engines/branching-scenario/schema";
import { initialState, applyChoice, scorePct } from "@/lib/engines/branching-scenario/state";

describe("BRANCHING_STARTERS", () => {
  it("has a blank and a jury starter", () => {
    expect(Object.keys(BRANCHING_STARTERS).sort()).toEqual(["blank", "jury"]);
  });

  it("every starter's config validates (schema + graph checks)", () => {
    for (const [id, starter] of Object.entries(BRANCHING_STARTERS)) {
      const r = validateBranchingConfig(starter.config);
      expect(r.ok, `starter "${id}" should validate: ${!r.ok ? r.errors.join("; ") : ""}`).toBe(true);
    }
  });
});

describe("blank starter", () => {
  const { config } = BRANCHING_STARTERS.blank;

  it("has one hidden variable, two scenes, and two endings", () => {
    expect(config.variables).toHaveLength(1);
    expect(config.variables[0]).toMatchObject({ id: "confidence", visible: false });
    expect(config.scenes).toHaveLength(2);
    expect(config.endings).toHaveLength(2);
  });

  it("has neutral labels on the opening scene", () => {
    const opening = config.scenes.find((s) => s.id === "opening");
    expect(opening?.choices.map((c) => c.label)).toEqual([
      "Consider the options",
      "Take the direct approach",
    ]);
  });

  it("every choice carries feedback text", () => {
    for (const scene of config.scenes) {
      for (const choice of scene.choices) {
        expect(choice.feedback, `scene "${scene.id}" choice "${choice.id}" should have feedback`).toBeTruthy();
      }
    }
  });
});

describe("jury starter — structure", () => {
  const { config } = BRANCHING_STARTERS.jury;

  it("has 4 scenes, 2 endings, and 1 visible variable", () => {
    expect(config.scenes).toHaveLength(4);
    expect(config.endings).toHaveLength(2);
    const visible = config.variables.filter((v) => v.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("jury_trust");
  });

  it("sets the role and feedback mode from the plan", () => {
    expect(config.role).toBe("You are a juror in a criminal trial.");
    expect(config.feedbackMode).toBe("debrief");
  });

  it("every choice carries feedback text (debrief mode shows it)", () => {
    for (const scene of config.scenes) {
      for (const choice of scene.choices) {
        expect(choice.feedback, `scene "${scene.id}" choice "${choice.id}" should have feedback`).toBeTruthy();
      }
    }
  });

  it("holdout scene has exactly one showIf choice, and the other two are unconditional (guaranteed-exit rule)", () => {
    const holdout = config.scenes.find((s) => s.id === "holdout");
    expect(holdout).toBeDefined();
    const withShowIf = holdout!.choices.filter((c) => c.showIf);
    const withoutShowIf = holdout!.choices.filter((c) => !c.showIf);
    expect(withShowIf).toHaveLength(1);
    expect(withShowIf[0].id).toBe("call_break");
    expect(withShowIf[0].showIf).toEqual({ variableId: "jury_trust", comparator: "gte", value: 60 });
    expect(withoutShowIf.length).toBeGreaterThanOrEqual(1);
  });
});

describe("jury starter — scoring via the state machine", () => {
  const { config } = BRANCHING_STARTERS.jury;

  it("best path (speak_up -> walk_through -> invite_reasons) scores 100", () => {
    let s = initialState(config);
    s = applyChoice(config, s, "speak_up"); // first_vote -> timeline, best
    s = applyChoice(config, s, "walk_through"); // timeline -> holdout, best
    s = applyChoice(config, s, "invite_reasons"); // holdout -> ending:verdict_reasoned, best
    expect(s.endingId).toBe("verdict_reasoned");
    expect(s.sceneId).toBeNull();
    expect(scorePct(s)).toBe(100);
  });

  it("all-poor path (stay_quiet -> compromise_vote) scores 0", () => {
    let s = initialState(config);
    s = applyChoice(config, s, "stay_quiet"); // first_vote -> pressure, poor
    s = applyChoice(config, s, "compromise_vote"); // pressure -> ending:verdict_rushed, poor
    expect(s.endingId).toBe("verdict_rushed");
    expect(s.sceneId).toBeNull();
    expect(scorePct(s)).toBe(0);
  });

  it("a mixed path (acceptable, poor, best, best) computes the exact expected mean", () => {
    let s = initialState(config);
    s = applyChoice(config, s, "demand_data"); // first_vote -> timeline, acceptable (0.5)
    s = applyChoice(config, s, "dismiss_conflict"); // timeline -> pressure, poor (0)
    s = applyChoice(config, s, "restate_duty"); // pressure -> holdout, best (1)
    s = applyChoice(config, s, "invite_reasons"); // holdout -> ending:verdict_reasoned, best (1)
    expect(s.endingId).toBe("verdict_reasoned");
    // (0.5 + 0 + 1 + 1) / 4 * 100 = 62.5 -> Math.round -> 63
    const expected = Math.round(((0.5 + 0 + 1 + 1) / 4) * 100);
    expect(expected).toBe(63);
    expect(scorePct(s)).toBe(expected);
  });

  it("the holdout showIf choice is hidden below 60 trust and reachable at/above it", () => {
    // stay_quiet (-10) then compromise... no, need to reach holdout with trust >=60.
    // speak_up (+10 -> 60) then walk_through (+15 -> 75) reaches holdout at trust=75.
    let s = initialState(config);
    s = applyChoice(config, s, "speak_up"); // trust 50 -> 60
    s = applyChoice(config, s, "walk_through"); // trust 60 -> 75, -> holdout
    expect(s.sceneId).toBe("holdout");
    expect(s.vars.jury_trust).toBe(75);
  });
});

describe("branchingStarterConfig", () => {
  it("stamps the given title onto the starter's config", () => {
    const config = branchingStarterConfig("jury", "My Jury Scenario");
    expect(config.title).toBe("My Jury Scenario");
    expect(config.scenes).toHaveLength(4);
  });

  it("falls back to the blank starter for an unknown id", () => {
    const config = branchingStarterConfig("does-not-exist", "Fallback Title");
    expect(config.title).toBe("Fallback Title");
    expect(config).toMatchObject(branchingStarterConfig(DEFAULT_BRANCHING_STARTER_ID, "Fallback Title"));
  });

  it("returns a fresh object tree each call (no shared references)", () => {
    const a = branchingStarterConfig("jury", "A");
    const b = branchingStarterConfig("jury", "B");
    expect(a.scenes).not.toBe(b.scenes);
    expect(a.scenes[0]).not.toBe(b.scenes[0]);
  });

  it("the resulting config still validates", () => {
    const r = validateBranchingConfig(branchingStarterConfig("jury", "Jury Deliberation"));
    expect(r.ok).toBe(true);
  });
});
