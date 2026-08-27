// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mountBranchingScenario } from "@/engine-runtime/branching-scenario/main";
import { branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";
import { toBranchingRuntimeConfig, type RuntimeBranchingConfig } from "@/lib/engines/branching-scenario/runtime-config";
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
 *  Continue-button flow at all. */
const immediateConfig: RuntimeBranchingConfig = {
  title: "Immediate Test",
  variables: [],
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

    it("renders exactly one polite, atomic live region for the visible variable", () => {
      mountBranchingScenario(document.getElementById("root")!, juryConfig);
      const statuses = document.querySelectorAll('[role="status"]');
      // One for the vars status; the feedback panel also carries role=status
      // but starts hidden — count only the visible/announced one here.
      const varsStatus = document.querySelector(".ilb-vars-status")!;
      expect(varsStatus.getAttribute("role")).toBe("status");
      expect(varsStatus.getAttribute("aria-live")).toBe("polite");
      expect(varsStatus.getAttribute("aria-atomic")).toBe("true");
      expect(varsStatus.textContent).toBe("Jury trust: 50");
      expect(statuses.length).toBeGreaterThanOrEqual(1);
    });

    it("omits the vars status region entirely when no variable is visible", () => {
      const { config: blank } = { config: branchingStarterConfig("blank", "Blank") };
      const runtime = toBranchingRuntimeConfig(blank, noAssets);
      mountBranchingScenario(document.getElementById("root")!, runtime);
      expect(document.querySelector(".ilb-vars-status")).toBeNull();
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
      expect(scoreLine.textContent).toBe("Decisions: 3 best, 0 acceptable, 0 poor. Score: 100%.");
    });

    it("no choice buttons remain at the ending; a Start over button appears instead", () => {
      playBestPath();
      expect(document.querySelectorAll(".ilb-choices .ilb-choice-btn:not(.ilb-start-over-btn)").length).toBe(0);
      expect(document.querySelector(".ilb-start-over-btn")).toBeTruthy();
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
