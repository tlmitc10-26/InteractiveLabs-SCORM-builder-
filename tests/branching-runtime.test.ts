// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mountBranchingScenario } from "@/engine-runtime/branching-scenario/main";
import { branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";
import { toBranchingRuntimeConfig, type RuntimeBranchingConfig } from "@/lib/engines/branching-scenario/runtime-config";
import { initialState, applyChoice, suspendPayload } from "@/lib/engines/branching-scenario/state";
import type { ScormSession } from "@/engine-runtime/scorm-adapter";

const ENGINE_CSS_PATH = path.resolve(__dirname, "../src/engine-runtime/branching-scenario/engine.css");

const noAssets = () => { throw new Error("no assets in this config"); };

const juryConfig: RuntimeBranchingConfig = toBranchingRuntimeConfig(
  branchingStarterConfig("jury", "Jury Deliberation"),
  noAssets,
);

/** A minimal hand-built config (bypassing the zod schema, matching the
 *  pattern of tests/engine-runtime.test.ts's hand-built RuntimeSandboxConfig
 *  fixtures) exercising feedbackMode "immediate" — the jury/blank starters
 *  are both "debrief" mode, so this fixture is needed to cover the
 *  Continue-button flow at all. A visible variable is included (unlike the
 *  jury starter, which never shows a feedback panel at all since it's
 *  debrief mode) specifically so the live-region tests below can prove that
 *  the ONE live region present (vars status) stays exactly one while the
 *  feedback panel is shown — i.e. the feedback panel itself is not a live
 *  region (drive-by fix: role="status"/aria-live removed from it, since the
 *  Continue button's aria-describedby is the real, spec-guaranteed
 *  announcement mechanism). */
const immediateConfig: RuntimeBranchingConfig = {
  title: "Immediate Test",
  variables: [{ id: "confidence", label: "Confidence", initial: 50, min: 0, max: 100, visible: true }],
  scenes: [
    {
      id: "s1",
      title: "Scene One",
      body: "<p>Body one.</p>",
      choices: [
        { id: "go", label: "Go", quality: "best", effects: [], feedback: "<p>Nice choice.</p>", goTo: "scene:s2" },
      ],
    },
    {
      id: "s2",
      title: "Scene Two",
      body: "<p>Body two.</p>",
      choices: [
        { id: "finish", label: "Finish", quality: "best", effects: [], goTo: "ending:done" },
      ],
    },
  ],
  startSceneId: "s1",
  endings: [{ id: "done", title: "Done", body: "<p>The end.</p>" }],
  feedbackMode: "immediate",
  showPathInDebrief: true,
};

/** Two scenes that each author a choice with the SAME id ("go") but
 *  different targets -- the collision shape the stale-click guard exists
 *  for: without capturing which scene a button was rendered for, a stale
 *  click on a detached scene-1 button would resolve against scene 2's
 *  identically-named "go" choice once the scene has moved on. */
const staleClickConfig: RuntimeBranchingConfig = {
  title: "Stale Click Test",
  variables: [],
  scenes: [
    { id: "s1", title: "Scene One", body: "<p>1</p>", choices: [
      { id: "go", label: "Go", quality: "best", effects: [], goTo: "scene:s2" },
    ] },
    { id: "s2", title: "Scene Two", body: "<p>2</p>", choices: [
      { id: "go", label: "Go", quality: "best", effects: [], goTo: "ending:done" },
    ] },
  ],
  startSceneId: "s1",
  endings: [{ id: "done", title: "Done", body: "<p>End.</p>" }],
  feedbackMode: "debrief",
  showPathInDebrief: true,
};

/** A single self-looping scene, used to build a >200-step path (MAX_PATH in
 *  state.ts) directly via the pure state machine rather than 200+ simulated
 *  clicks, to exercise the debrief's truncation note. */
const loopConfig: RuntimeBranchingConfig = {
  title: "Loop Test",
  variables: [],
  scenes: [
    { id: "loop", title: "Loop Scene", body: "<p>Loop.</p>", choices: [
      { id: "again", label: "Again", quality: "best", effects: [], goTo: "scene:loop" },
      { id: "exit", label: "Exit", quality: "best", effects: [], goTo: "ending:done" },
    ] },
  ],
  startSceneId: "loop",
  endings: [{ id: "done", title: "Done", body: "<p>End.</p>" }],
  feedbackMode: "debrief",
  showPathInDebrief: true,
};

/** Scene "a" is authored with no title, to exercise the positional "Part N"
 *  heading fallback (N = the scene's 1-based index in config.scenes). */
const untitledSceneConfig: RuntimeBranchingConfig = {
  title: "Untitled Scene Test",
  variables: [],
  scenes: [
    { id: "a", body: "<p>A</p>", choices: [{ id: "go", label: "Go", quality: "best", effects: [], goTo: "scene:b" }] },
    { id: "b", title: "Scene B", body: "<p>B</p>", choices: [{ id: "finish", label: "Finish", quality: "best", effects: [], goTo: "ending:done" }] },
  ],
  startSceneId: "a",
  endings: [{ id: "done", title: "Done", body: "<p>End.</p>" }],
  feedbackMode: "debrief",
  showPathInDebrief: true,
};

/** Minimal mock satisfying the ScormSession contract (same shape as
 *  tests/engine-runtime.test.ts's createScormMock). */
function createScormMock(initialSuspend: unknown = null) {
  let suspend: unknown = initialSuspend;
  return {
    mode: "scorm" as const,
    setScore: vi.fn(),
    setCompleted: vi.fn(),
    saveSuspendData: vi.fn((state: unknown) => { suspend = state; return true; }),
    loadSuspendData: vi.fn(() => suspend),
    finish: vi.fn(),
  };
}

/** Clicks the visible choice button with this exact label text, throwing a
 *  clear error if it's not found — robust to button ordering. */
function clickChoice(label: string): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-choice-btn"));
  const btn = buttons.find((b) => b.textContent === label);
  if (!btn) {
    throw new Error(`no visible choice button labeled "${label}" (found: ${buttons.map((b) => b.textContent).join(" | ")})`);
  }
  btn.click();
}

function h2(): HTMLHeadingElement {
  return document.querySelector("h2") as HTMLHeadingElement;
}

describe("mountBranchingScenario", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).ILBScorm;
  });

  describe("start scene", () => {
    it("renders the start scene's h2 (tabindex -1) and its 3 visible choice buttons", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      expect(h2().textContent).toBe("The First Vote");
      expect(h2().getAttribute("tabindex")).toBe("-1");
      const buttons = document.querySelectorAll(".ilb-choice-btn");
      expect(buttons.length).toBe(3);
      expect(Array.from(buttons).map((b) => b.textContent)).toEqual([
        "Raise your doubts about the timeline before anyone votes",
        "Vote with the majority to keep things moving",
        "Ask to re-examine the evidence list first",
      ]);
    });

    it("shows the role line and intro only on the start scene", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      expect(document.querySelector(".ilb-role")!.textContent).toBe("You are a juror in a criminal trial.");
    });

    it("sets role=\"main\" on the mounted root", () => {
      const root = document.getElementById("root")!;
      mountBranchingScenario(root, juryConfig);
      expect(root.getAttribute("role")).toBe("main");
    });

    it("does not focus the start scene's h2 on initial mount", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      expect(document.activeElement).not.toBe(h2());
    });

    it("renders EXACTLY one live region (the vars status) for the jury starter, since it never needs a feedback panel", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      // The jury starter is feedbackMode "debrief", so the feedback panel is
      // never even constructed (main.ts's `needsFeedbackPanel`) -- there
      // must be exactly one [aria-live] element in the whole document, not
      // two-with-one-hidden.
      const liveRegions = document.querySelectorAll("[aria-live]");
      expect(liveRegions.length).toBe(1);
      const varsStatus = document.querySelector(".ilb-vars-status")!;
      expect(varsStatus).toBe(liveRegions[0]);
      expect(varsStatus.getAttribute("role")).toBe("status");
      expect(varsStatus.getAttribute("aria-live")).toBe("polite");
      expect(varsStatus.getAttribute("aria-atomic")).toBe("true");
      expect(varsStatus.textContent).toBe("Jury trust: 50");
    });

    it("renders EXACTLY one live region (vars status) across every state of a scenario with a visible variable, INCLUDING while feedback is shown", () => {
      // immediateConfig has a visible variable AND (unlike jury) a feedback
      // panel that actually gets constructed and shown. The feedback panel
      // must never itself count as a second live region — its announcement
      // guarantee is the Continue button's aria-describedby, not aria-live.
      mountBranchingScenario(document.getElementById("root")!, immediateConfig);
      const oneLiveRegion = () => {
        const liveRegions = document.querySelectorAll("[aria-live]");
        expect(liveRegions.length).toBe(1);
        expect(liveRegions[0]).toBe(document.querySelector(".ilb-vars-status"));
      };

      oneLiveRegion(); // start scene, before any choice

      clickChoice("Go"); // feedback panel now visible (Continue button focused)
      const feedback = document.querySelector(".ilb-feedback") as HTMLElement;
      expect(feedback.hidden).toBe(false);
      expect(feedback.hasAttribute("role")).toBe(false);
      expect(feedback.hasAttribute("aria-live")).toBe(false);
      oneLiveRegion(); // still exactly one -- the feedback panel isn't it

      (document.querySelector(".ilb-continue-btn") as HTMLButtonElement).click();
      oneLiveRegion(); // after the deferred transition to Scene Two
    });

    it("renders ZERO live regions for the blank starter (debrief mode, no visible variable)", () => {
      const blank = branchingStarterConfig("blank", "Blank");
      const runtime = toBranchingRuntimeConfig(blank, noAssets);
      mountBranchingScenario(document.getElementById("root")!, runtime);
      expect(document.querySelector(".ilb-vars-status")).toBeNull();
      expect(document.querySelectorAll("[aria-live]").length).toBe(0);
    });
  });

  describe("scene transitions", () => {
    it("clicking a choice transitions to the target scene and moves focus to the new h2", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      clickChoice("Raise your doubts about the timeline before anyone votes"); // speak_up
      expect(h2().textContent).toBe("The Timeline");
      expect(document.activeElement).toBe(h2());
    });

    it("updates the vars status text exactly once when the effect changes the visible variable", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      clickChoice("Raise your doubts about the timeline before anyone votes"); // speak_up: +10 -> 60
      expect(document.querySelector(".ilb-vars-status")!.textContent).toBe("Jury trust: 60");
    });

    it("produces zero DOM mutations on the vars status node when the chosen effect leaves the variable unchanged", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      const status = document.querySelector(".ilb-vars-status")!;
      const records: MutationRecord[] = [];
      const mo = new MutationObserver((muts) => records.push(...muts));
      mo.observe(status, { childList: true, characterData: true, subtree: true });

      clickChoice("Ask to re-examine the evidence list first"); // demand_data: effects []
      mo.disconnect();

      expect(records.length).toBe(0);
      // Sanity: the scene really did change (this isn't a no-op click).
      expect(h2().textContent).toBe("The Timeline");
      expect(status.textContent).toBe("Jury trust: 50");
    });

    it("hides a showIf choice below its threshold and shows it once the threshold is met", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      // stay_quiet (-10 -> 40) -> pressure -> restate_duty (+10 -> 50) -> holdout at trust 50 (< 60).
      clickChoice("Vote with the majority to keep things moving"); // stay_quiet
      clickChoice("Remind the room the standard is reasonable doubt, not convenience"); // restate_duty
      expect(h2().textContent).toBe("The Holdout");
      expect(document.querySelector(".ilb-vars-status")!.textContent).toBe("Jury trust: 50");
      const labels = Array.from(document.querySelectorAll(".ilb-choice-btn")).map((b) => b.textContent);
      expect(labels).not.toContain("Call a break, since the room trusts you enough to reset");
      expect(labels).toHaveLength(2);
    });

    it("shows the showIf choice once trust reaches the threshold", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      // speak_up (+10 -> 60) -> walk_through (+15 -> 75) -> holdout at trust 75 (>= 60).
      clickChoice("Raise your doubts about the timeline before anyone votes"); // speak_up
      clickChoice("Walk the group through the conflict step by step"); // walk_through
      expect(h2().textContent).toBe("The Holdout");
      expect(document.querySelector(".ilb-vars-status")!.textContent).toBe("Jury trust: 75");
      const labels = Array.from(document.querySelectorAll(".ilb-choice-btn")).map((b) => b.textContent);
      expect(labels).toContain("Call a break, since the room trusts you enough to reset");
      expect(labels).toHaveLength(3);
    });

    it("ignores a stale click on a detached button from a previous scene, even when the current scene authors a same-id choice", () => {
      mountBranchingScenario(document.getElementById("root")!, staleClickConfig);
      const goBtn = document.querySelector(".ilb-choice-btn") as HTMLButtonElement; // "Go" in s1
      goBtn.click(); // s1 -> s2
      expect(h2().textContent).toBe("Scene Two");

      // Stale: the SAME (now detached) button element, clicked again. s2
      // also authors a choice id "go" -- without the captured-scene guard
      // this would incorrectly resolve against s2's own "go" and advance
      // straight to the ending.
      goBtn.click();
      expect(h2().textContent).toBe("Scene Two"); // still here, not "Done"
    });
  });

  describe("immediate feedback mode", () => {
    beforeEach(() => {
      document.body.innerHTML = '<div id="root"></div>';
    });

    it("shows the feedback panel with a Continue button instead of transitioning, and moves focus to Continue", () => {
      mountBranchingScenario(document.getElementById("root")!, immediateConfig);
      clickChoice("Go");
      // Scene has not transitioned yet.
      expect(h2().textContent).toBe("Scene One");
      const feedback = document.querySelector(".ilb-feedback") as HTMLElement;
      expect(feedback.hidden).toBe(false);
      expect(feedback.textContent).toContain("Nice choice.");
      const continueBtn = document.querySelector(".ilb-continue-btn") as HTMLButtonElement;
      expect(continueBtn).toBeTruthy();
      expect(document.activeElement).toBe(continueBtn);
    });

    it("Continue's aria-describedby points at the feedback text's id, so the accessible-description algorithm guarantees it's spoken on focus", () => {
      mountBranchingScenario(document.getElementById("root")!, immediateConfig);
      clickChoice("Go");
      const continueBtn = document.querySelector(".ilb-continue-btn") as HTMLButtonElement;
      const describedbyId = continueBtn.getAttribute("aria-describedby");
      expect(describedbyId).toBeTruthy();
      const feedbackP = document.getElementById(describedbyId!);
      expect(feedbackP).toBeTruthy();
      expect(feedbackP!.textContent).toContain("Nice choice.");
    });

    it("Continue performs the deferred transition and moves focus to the new h2", () => {
      mountBranchingScenario(document.getElementById("root")!, immediateConfig);
      clickChoice("Go");
      const continueBtn = document.querySelector(".ilb-continue-btn") as HTMLButtonElement;
      continueBtn.click();
      expect(h2().textContent).toBe("Scene Two");
      expect(document.activeElement).toBe(h2());
      expect((document.querySelector(".ilb-feedback") as HTMLElement).hidden).toBe(true);
    });

    it("transitions immediately (no feedback panel) for a choice with no feedback text, even in immediate mode", () => {
      mountBranchingScenario(document.getElementById("root")!, immediateConfig);
      clickChoice("Go");
      (document.querySelector(".ilb-continue-btn") as HTMLButtonElement).click();
      expect(h2().textContent).toBe("Scene Two");
      clickChoice("Finish"); // no feedback field on this choice
      // Reached the ending directly, no feedback panel shown.
      expect((document.querySelector(".ilb-feedback") as HTMLElement).hidden).toBe(true);
      expect(h2().textContent).toBe("Done");
    });
  });

  describe("ending + debrief", () => {
    function playBestPath(): void {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      clickChoice("Raise your doubts about the timeline before anyone votes"); // speak_up, best
      clickChoice("Walk the group through the conflict step by step"); // walk_through, best
      clickChoice("Ask them to explain what evidence would change their mind"); // invite_reasons, best
    }

    it("renders the ending h2 + body, focuses the ending h2, and shows the exact score line", () => {
      playBestPath();
      expect(h2().textContent).toBe("A verdict the room can stand behind");
      expect(document.activeElement).toBe(h2());
      const scoreLine = document.querySelector(".ilb-score-line")!;
      // Zero categories are omitted entirely (not "3 best, 0 acceptable, 0 poor").
      expect(scoreLine.textContent).toBe("Decisions: 3 best. Score: 100%.");
    });

    it("lists every non-zero quality category, comma-joined, and omits zero categories", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      clickChoice("Vote with the majority to keep things moving"); // stay_quiet, poor
      clickChoice("Suggest a quick second vote to test the waters"); // compromise_vote, poor -> ending verdict_rushed
      const scoreLine = document.querySelector(".ilb-score-line")!;
      expect(scoreLine.textContent).toBe("Decisions: 2 poor. Score: 0%.");
    });

    it("no choice buttons remain at the ending; a Start over button appears instead", () => {
      playBestPath();
      // Start-over no longer carries .ilb-choice-btn (drive-by fix), so this
      // query needs no :not() exclusion to prove zero scenario-choice
      // buttons remain.
      expect(document.querySelectorAll(".ilb-choices .ilb-choice-btn").length).toBe(0);
      expect(document.querySelector(".ilb-start-over-btn")).toBeTruthy();
      expect(document.querySelector(".ilb-start-over-btn")!.classList.contains("ilb-choice-btn")).toBe(false);
    });

    it("renders the debrief ol with scene, chosen label, quality text+glyph, and other options", () => {
      playBestPath();
      const items = Array.from(document.querySelectorAll(".ilb-debrief-list > li"));
      expect(items).toHaveLength(3);

      const first = items[0];
      expect(first.querySelector(".ilb-debrief-scene")!.textContent).toContain("The First Vote");
      expect(first.querySelector(".ilb-debrief-choice")!.textContent).toBe(
        "Raise your doubts about the timeline before anyone votes",
      );
      expect(first.querySelector(".ilb-debrief-quality")!.textContent).toContain("Best choice");
      expect(first.querySelector('[aria-hidden="true"]')).toBeTruthy();
      const other = first.querySelector(".ilb-debrief-other")!;
      expect(other.textContent).toBe(
        "Other options: Vote with the majority to keep things moving, Ask to re-examine the evidence list first.",
      );
      // feedbackMode "debrief": per-choice feedback appears here.
      expect(first.querySelector(".ilb-debrief-feedback")!.textContent).toContain(
        "Speaking up before the vote keeps the deliberation grounded",
      );
    });

    it("debrief 'Other options' reflects what was ACTUALLY visible at that moment, not every authored choice (low-trust holdout: call_break excluded)", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      // stay_quiet (-10 -> 40) -> restate_duty (+10 -> 50): holdout reached at trust 50 (< 60), call_break hidden.
      clickChoice("Vote with the majority to keep things moving"); // stay_quiet
      clickChoice("Remind the room the standard is reasonable doubt, not convenience"); // restate_duty
      clickChoice("Ask them to explain what evidence would change their mind"); // invite_reasons -> ending

      const items = Array.from(document.querySelectorAll(".ilb-debrief-list > li"));
      const holdoutStep = items.find((li) => li.querySelector(".ilb-debrief-scene")!.textContent!.includes("The Holdout"))!;
      const other = holdoutStep.querySelector(".ilb-debrief-other")!;
      expect(other.textContent).toBe("Other options: Suggest the group proceed without their input.");
      expect(other.textContent).not.toContain("Call a break");
    });

    it("debrief 'Other options' includes a showIf choice that WAS visible at that moment (high-trust holdout: call_break included)", () => {
      playBestPath(); // speak_up -> walk_through -> invite_reasons; trust is 75 (>= 60) entering holdout.
      const items = Array.from(document.querySelectorAll(".ilb-debrief-list > li"));
      const holdoutStep = items.find((li) => li.querySelector(".ilb-debrief-scene")!.textContent!.includes("The Holdout"))!;
      const other = holdoutStep.querySelector(".ilb-debrief-other")!;
      expect(other.textContent).toContain("Suggest the group proceed without their input");
      expect(other.textContent).toContain("Call a break, since the room trusts you enough to reset");
    });

    it("falls back to the positional 'Part N' heading for an untitled scene, in both the scene view and the debrief", () => {
      mountBranchingScenario(document.getElementById("root")!, untitledSceneConfig);
      expect(h2().textContent).toBe("Part 1"); // scene "a" has no title; it's config.scenes[0]
      clickChoice("Go");
      expect(h2().textContent).toBe("Scene B");
      clickChoice("Finish");
      expect(h2().textContent).toBe("Done");
      const firstStep = document.querySelector(".ilb-debrief-list > li .ilb-debrief-scene")!;
      expect(firstStep.textContent).toContain("Part 1");
    });

    it("prepends a truncation note to the debrief when the restored path was capped (state.truncated)", () => {
      let s = initialState(loopConfig);
      for (let i = 0; i < 205; i++) s = applyChoice(loopConfig, s, "again");
      expect(s.truncated).toBe(true);

      const scorm = createScormMock(suspendPayload(s, 0, false));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;
      try {
        mountBranchingScenario(document.getElementById("root")!, loopConfig);
        clickChoice("Exit");
        expect(document.querySelector(".ilb-debrief-truncated-note")!.textContent).toBe(
          "This summary shows your most recent decisions.",
        );
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).ILBScorm;
      }
    });

    it("Start over resets to the start scene, clears the debrief, and focuses the new h2", () => {
      playBestPath();
      (document.querySelector(".ilb-start-over-btn") as HTMLButtonElement).click();
      expect(h2().textContent).toBe("The First Vote");
      expect(document.activeElement).toBe(h2());
      expect(document.querySelector(".ilb-debrief-list")).toBeNull();
      expect(document.querySelectorAll(".ilb-choice-btn")).toHaveLength(3);
      expect(document.querySelector(".ilb-vars-status")!.textContent).toBe("Jury trust: 50");
    });
  });

  describe("SCORM reporting", () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).ILBScorm;
    });

    it("reports high-water score on each transition and completes exactly once at the ending", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      expect(scorm.setScore).not.toHaveBeenCalled();
      expect(scorm.setCompleted).not.toHaveBeenCalled();

      clickChoice("Raise your doubts about the timeline before anyone votes"); // best -> pct 100 so far
      expect(scorm.setScore).toHaveBeenLastCalledWith(100);
      expect(scorm.setCompleted).not.toHaveBeenCalled();

      clickChoice("Walk the group through the conflict step by step"); // best -> still 100
      clickChoice("Ask them to explain what evidence would change their mind"); // best -> ending, 100
      expect(scorm.setScore).toHaveBeenLastCalledWith(100);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
      expect(scorm.saveSuspendData).toHaveBeenCalled();
    });

    it("never downgrades the reported score even after Start Over resets the run", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      clickChoice("Raise your doubts about the timeline before anyone votes");
      clickChoice("Walk the group through the conflict step by step");
      clickChoice("Ask them to explain what evidence would change their mind");
      expect(scorm.setScore).toHaveBeenLastCalledWith(100);
      const completedCalls = scorm.setCompleted.mock.calls.length;

      (document.querySelector(".ilb-start-over-btn") as HTMLButtonElement).click();
      expect(scorm.setScore).toHaveBeenLastCalledWith(100); // never downgraded to 0
      expect(scorm.setCompleted).toHaveBeenCalledTimes(completedCalls); // not called again
    });
  });

  describe("suspend/restore round-trip", () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).ILBScorm;
    });

    it("resumes mid-scenario on remount with vars, scene, and score restored", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      clickChoice("Raise your doubts about the timeline before anyone votes"); // -> timeline, trust 60

      // Remount fresh DOM with a scorm mock preloaded from the captured save.
      const savedPayload = scorm.saveSuspendData.mock.calls.at(-1)![0];
      document.body.innerHTML = '<div id="root"></div>';
      const scorm2 = createScormMock(savedPayload);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm2 as unknown as ScormSession;

      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      expect(h2().textContent).toBe("The Timeline");
      expect(document.querySelector(".ilb-vars-status")!.textContent).toBe("Jury trust: 60");
      expect(scorm2.setScore).toHaveBeenCalledWith(100); // re-asserted on mount
    });

    it("resumes at the ending + debrief on remount when the run was already completed", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      playBestPath();

      const savedPayload = scorm.saveSuspendData.mock.calls.at(-1)![0];
      document.body.innerHTML = '<div id="root"></div>';
      const scorm2 = createScormMock(savedPayload);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm2 as unknown as ScormSession;

      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      expect(h2().textContent).toBe("A verdict the room can stand behind");
      expect(document.querySelector(".ilb-debrief-list")).toBeTruthy();
      expect(scorm2.setScore).toHaveBeenCalledWith(100);
      expect(scorm2.setCompleted).toHaveBeenCalledTimes(1);
    });

    function playBestPath(): void {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      clickChoice("Raise your doubts about the timeline before anyone votes");
      clickChoice("Walk the group through the conflict step by step");
      clickChoice("Ask them to explain what evidence would change their mind");
    }

    it("salvages best score and completion from a payload that fails full restore (stale scene id) but carries well-formed b/c", () => {
      const scorm = createScormMock({
        v: 1, s: "no-such-scene", e: null, vars: { jury_trust: 50 }, d: [], p: [], t: false, b: 100, c: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      // Salvaged grade re-asserted on mount, even though the position couldn't be restored.
      expect(scorm.setScore).toHaveBeenCalledWith(100);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
      // Positionally fresh: back at the real start scene, not stuck on the stale id.
      expect(h2().textContent).toBe("The First Vote");

      // High-water holds: a subsequent poor choice (a 1-step poor path scores 0) must not downgrade the reported 100.
      clickChoice("Vote with the majority to keep things moving"); // stay_quiet, poor
      expect(scorm.setScore).toHaveBeenLastCalledWith(100);
    });
  });

  describe("engine.css source rules (audited-pattern parity with param-sandbox)", () => {
    const css = readFileSync(ENGINE_CSS_PATH, "utf8");

    it("defines a 24px minimum height for choice buttons", () => {
      expect(css).toMatch(/\.ilb-scenario button[^{]*\{[^}]*min-height:\s*24px/);
    });

    it("defines focus-visible outline styles using --rds-primary", () => {
      expect(css).toMatch(/button:focus-visible[^{]*\{[^}]*outline:\s*3px solid var\(--rds-primary\)[^}]*outline-offset:\s*2px/);
    });

    it("defines the sr-only utility class", () => {
      expect(css).toMatch(/\.ilb-sr-only\s*\{/);
    });

    it("defines a reduced-motion override", () => {
      expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    });
  });
});
