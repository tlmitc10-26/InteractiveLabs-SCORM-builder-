// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mountProcessSimulator, type RuntimeProcessConfig } from "@/engine-runtime/process-simulator/main";
import { processStarterConfig } from "@/lib/engines/process-simulator/starters";
import type { ScormSession } from "@/engine-runtime/scorm-adapter";

const ENGINE_CSS_PATH = path.resolve(__dirname, "../src/engine-runtime/process-simulator/engine.css");

const blankConfig: RuntimeProcessConfig = processStarterConfig("blank", "Blank Procedure");

/** Hand-built fixture (bypassing the zod schema, matching the pattern of
 *  tests/case-runtime.test.ts's richConfig): three required actions where
 *  the third CONJUNCTIVELY requires the first two, plus one distractor —
 *  exercises every focus/consequence/scoring path spec §3/§4 describes. */
const richConfig: RuntimeProcessConfig = {
  title: "Evidence Intake Drill",
  intro: "<p>Learn the procedure, then perform it.</p>",
  opening: "<p>You arrive at a sealed scene with one item to collect.</p>",
  expertNote: "<p>The order that survives review is the one where nothing touches the item before it's documented.</p>",
  actions: [
    { id: "photograph", label: "Photograph the item", required: true, outcome: "<p>The item's position is recorded.</p>" },
    { id: "gloves", label: "Put on gloves", required: true, outcome: "<p>Hands are protected; the item won't be contaminated.</p>" },
    {
      id: "collect",
      label: "Collect the item",
      required: true,
      requires: ["photograph", "gloves"],
      outcome: "<p>The item is bagged.</p>",
      consequence: "<p>The item moved before it was fully documented.</p>",
      consequenceNote: "Collection requires both photographing and gloving up first.",
    },
    {
      id: "move_early",
      label: "Ask someone to move the item",
      required: false,
      consequence: "<p>The chain of custody now starts with an undocumented move.</p>",
      consequenceNote: "Convenience is not a custody procedure.",
    },
  ],
};

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

function h2(): HTMLHeadingElement {
  return document.querySelector("h2") as HTMLHeadingElement;
}

function root(): HTMLElement {
  return document.getElementById("root")!;
}

function clickByText(selector: string, text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((b) => b.textContent === text);
  if (!btn) throw new Error(`no ${selector} with text "${text}" (found: ${Array.from(document.querySelectorAll(selector)).map((b) => b.textContent).join(" | ")})`);
  btn.click();
  return btn;
}

function actionButton(label: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-action-btn")).find(
    (b) => b.querySelector(".ilb-action-label")?.textContent === label,
  );
  if (!btn) throw new Error(`no action button labeled "${label}"`);
  return btn;
}

function clickAction(label: string): void {
  actionButton(label).click();
}

function progressText(): string {
  return document.querySelector(".ilb-process-status")!.textContent!;
}

describe("mountProcessSimulator", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).ILBScorm;
  });

  describe("brief step", () => {
    it("sets role=\"main\" on the mounted root", () => {
      mountProcessSimulator(root(), blankConfig);
      expect(root().getAttribute("role")).toBe("main");
    });

    it("renders the title as h2 (tabindex -1), the intro, and the Begin button; does not focus on initial mount", () => {
      mountProcessSimulator(root(), richConfig);
      expect(h2().textContent).toBe("Evidence Intake Drill");
      expect(h2().getAttribute("tabindex")).toBe("-1");
      expect(document.querySelector(".ilb-intro")).toBeTruthy();
      expect(document.activeElement).not.toBe(h2());
      expect(document.querySelector(".ilb-btn-pill")!.textContent).toBe("Begin the procedure.");
    });

    it("exposes exactly one live region (progress), reading 0 of N even before beginning", () => {
      mountProcessSimulator(root(), richConfig);
      const regions = document.querySelectorAll("[aria-live]");
      expect(regions.length).toBe(1);
      const status = document.querySelector(".ilb-process-status")!;
      expect(status.getAttribute("role")).toBe("status");
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect(status.getAttribute("aria-atomic")).toBe("true");
      expect(status.textContent).toBe("0 of 3 required steps done");
    });

    it("clicking Begin the procedure transitions to Procedure and focuses its h2", () => {
      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      expect(h2().textContent).toBe("Procedure");
      expect(document.activeElement).toBe(h2());
    });
  });

  describe("procedure step: success path", () => {
    function begin(config: RuntimeProcessConfig = richConfig): void {
      mountProcessSimulator(root(), config);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
    }

    it("shows the opening in the Situation panel and every action as a real button in authored order, none disabled", () => {
      begin();
      expect(document.querySelector(".ilb-situation-opening")!.textContent).toContain("sealed scene");
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-action-btn"));
      expect(buttons.map((b) => b.querySelector(".ilb-action-label")!.textContent)).toEqual([
        "Photograph the item", "Put on gloves", "Collect the item", "Ask someone to move the item",
      ]);
      expect(buttons.every((b) => !b.disabled)).toBe(true);
      expect(document.querySelectorAll(".ilb-log-entry")).toHaveLength(0);
    });

    it("a legal action appends its outcome to the log, disables its button with an aria-hidden glyph, and focuses the Situation h3", () => {
      begin();
      clickAction("Photograph the item");

      const entries = Array.from(document.querySelectorAll(".ilb-log-entry"));
      expect(entries).toHaveLength(1);
      expect(entries[0].textContent).toContain("The item's position is recorded.");

      const btn = actionButton("Photograph the item");
      expect(btn.disabled).toBe(true);
      const glyph = btn.querySelector(".ilb-action-done-glyph")!;
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      // Accessible name stays exactly the label — the glyph never contributes.
      expect(btn.textContent).not.toBe("Photograph the item"); // visible text includes the glyph char...
      expect(btn.querySelector(".ilb-action-label")!.textContent).toBe("Photograph the item"); // ...but the label span alone is verbatim

      const situationHeading = document.querySelector(".ilb-situation h3")!;
      expect(document.activeElement).toBe(situationHeading);
      expect(progressText()).toBe("1 of 3 required steps done");
    });

    it("the newest log entry alone carries the latest-emphasis, which MOVES as the log grows", () => {
      begin();
      clickAction("Photograph the item");
      let entries = Array.from(document.querySelectorAll(".ilb-log-entry"));
      expect(entries[0].classList.contains("ilb-log-entry--latest")).toBe(true);
      expect(entries[0].querySelector(".ilb-sr-only")!.textContent).toBe("Latest: ");

      clickAction("Put on gloves");
      entries = Array.from(document.querySelectorAll(".ilb-log-entry"));
      expect(entries).toHaveLength(2);
      expect(entries[0].classList.contains("ilb-log-entry--latest")).toBe(false);
      expect(entries[0].querySelector(".ilb-sr-only")).toBeNull();
      expect(entries[1].classList.contains("ilb-log-entry--latest")).toBe(true);
      expect(entries[1].querySelector(".ilb-sr-only")!.textContent).toBe("Latest: ");
    });

    it("CONJUNCTIVE prerequisite: performing only one of two prerequisites still makes the third action illegal", () => {
      begin();
      clickAction("Photograph the item"); // only one of collect's two prerequisites
      clickAction("Collect the item"); // premature: gloves not done
      expect(document.querySelector(".ilb-consequence-text")).toBeTruthy();
      expect(document.querySelector(".ilb-log-entry")).toBeTruthy(); // photograph's entry still there, untouched
      expect(document.querySelectorAll(".ilb-log-entry")).toHaveLength(1); // collect did NOT get logged
    });

    it("completing all conjunctive prerequisites makes the gated action legal", () => {
      begin();
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item");
      expect(document.querySelectorAll(".ilb-log-entry")).toHaveLength(3);
    });
  });

  describe("procedure step: failure path (consequence panel)", () => {
    function begin(config: RuntimeProcessConfig = richConfig): void {
      mountProcessSimulator(root(), config);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
    }

    it("a premature required action replaces ONLY the Actions sub-container with a consequence panel, preserving Situation and the live-region TEXT", () => {
      begin();
      const progressBefore = progressText();
      const situationBefore = document.querySelector(".ilb-situation")!;

      clickAction("Collect the item"); // premature: neither prerequisite done

      expect(document.querySelector(".ilb-action-list")).toBeNull(); // the menu is gone
      expect(document.querySelector(".ilb-consequence-text")!.textContent).toContain("moved before it was fully documented");
      const continueBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-btn-pill")).find((b) => b.textContent === "Continue")!;
      expect(continueBtn).toBeTruthy();

      // Situation persists (same node identity — never torn down).
      expect(document.querySelector(".ilb-situation")).toBe(situationBefore);
      // The live region's TEXT is unchanged by opening the consequence panel.
      expect(progressText()).toBe(progressBefore);

      const consequenceHeading = document.querySelector(".ilb-actions h3")!;
      expect(consequenceHeading.textContent).toBe("Consequence");
      expect(document.activeElement).toBe(consequenceHeading);
    });

    it("any distractor click is illegal unconditionally and shows its own consequence", () => {
      begin();
      clickAction("Ask someone to move the item");
      expect(document.querySelector(".ilb-consequence-text")!.textContent).toContain("undocumented move");
    });

    it("Continue rebuilds the action menu, keeps the live-region text unchanged, and refocuses the attempted action's button BY ID (still enabled)", () => {
      begin();
      const progressBefore = progressText();
      clickAction("Collect the item");
      clickByText(".ilb-btn-pill", "Continue");

      expect(document.querySelector(".ilb-action-list")).toBeTruthy(); // menu rebuilt
      expect(progressText()).toBe(progressBefore); // still unchanged
      const btn = actionButton("Collect the item");
      expect(btn.disabled).toBe(false); // an illegal attempt never marks an action done
      expect(document.activeElement).toBe(btn);
    });

    it("the attempt is recorded and nothing locks: the same action can be attempted again immediately", () => {
      begin();
      clickAction("Collect the item");
      clickByText(".ilb-btn-pill", "Continue");
      clickAction("Collect the item"); // still premature
      expect(document.querySelector(".ilb-consequence-text")).toBeTruthy();
    });

    it("99-saturation via UI clicks: repeated illegal attempts on the same action cap its recorded count at 99", () => {
      begin();
      for (let i = 0; i < 120; i++) {
        clickAction("Ask someone to move the item");
        clickByText(".ilb-btn-pill", "Continue");
      }
      // Completing the procedure cleanly afterward and reading the debrief's
      // step review is the observable proof the runtime never counted past
      // 99 for this action (scoring is path-independent at/after saturation).
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item");
      const distractorRow = Array.from(document.querySelectorAll(".ilb-comparison-row")).find((r) => r.textContent!.startsWith("Ask someone to move the item"))!;
      expect(distractorRow.textContent).toContain("99 times");
    });
  });

  describe("debrief", () => {
    function completeCleanly(config: RuntimeProcessConfig = richConfig): void {
      mountProcessSimulator(root(), config);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item");
    }

    it("completing the last required action transitions automatically to Debrief and focuses its h2", () => {
      completeCleanly();
      expect(document.querySelector(".ilb-eyebrow")!.textContent).toBe("Procedure complete");
      expect(h2().textContent).toBe("Evidence Intake Drill");
      expect(document.activeElement).toBe(h2());
      expect(document.querySelector(".ilb-score-num")!.getAttribute("aria-hidden")).toBe("true");
    });

    it("a flawless run scores 100 with the exact score-line format", () => {
      completeCleanly();
      expect(document.querySelector(".ilb-score-line")!.textContent).toBe(
        "Steps: 3 of 3 clean. Attempts: 3 (expert minimum 3). Score: 100%.",
      );
      expect(document.querySelector(".ilb-score-num")!.textContent).toBe("100%");
    });

    it("one premature attempt on the gated action produces the correctly-computed score line", () => {
      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Collect the item"); // premature (1 attempt recorded)
      clickByText(".ilb-btn-pill", "Continue");
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item"); // now legal

      // clean = 2 (photograph, gloves); totalAttempts = 3 + 1 = 4; correctness=2/3, efficiency=3/4
      // total = (60*2/3 + 40*3/4)/100 = (40+30)/100 = 70
      expect(document.querySelector(".ilb-score-line")!.textContent).toBe(
        "Steps: 2 of 3 clean. Attempts: 4 (expert minimum 3). Score: 70%.",
      );
    });

    it("renders the full situation log read-back, in completion order", () => {
      completeCleanly();
      const entries = Array.from(document.querySelectorAll(".ilb-situation-log .ilb-log-entry"));
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.textContent)).toEqual([
        expect.stringContaining("position is recorded"),
        expect.stringContaining("won't be contaminated"),
        expect.stringContaining("item is bagged"),
      ]);
    });

    it("step review: a clean action is best, a recovered action is ok with its consequenceNote, an attempted distractor is poor with its consequenceNote and attempt count", () => {
      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Ask someone to move the item"); // distractor hit #1
      clickByText(".ilb-btn-pill", "Continue");
      clickAction("Collect the item"); // premature #1
      clickByText(".ilb-btn-pill", "Continue");
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item"); // now legal, after one failure

      const rows = Array.from(document.querySelectorAll(".ilb-comparison-row"));
      const photographRow = rows.find((r) => r.textContent!.startsWith("Photograph the item"))!;
      expect(photographRow.className).toContain("--best");
      expect(photographRow.textContent).toBe("Photograph the item: completed on the first try.");

      const collectRow = rows.find((r) => r.textContent!.startsWith("Collect the item"))!;
      expect(collectRow.className).toContain("--ok");
      expect(collectRow.textContent).toContain("completed after 1 premature attempt.");
      expect(collectRow.textContent).toContain("Collection requires both photographing and gloving up first.");

      const distractorRow = rows.find((r) => r.textContent!.startsWith("Ask someone to move the item"))!;
      expect(distractorRow.className).toContain("--poor");
      expect(distractorRow.textContent).toContain("attempted 1 time.");
      expect(distractorRow.textContent).toContain("Convenience is not a custody procedure.");
    });

    it("renders the authored expertNote", () => {
      completeCleanly();
      expect(document.querySelector(".ilb-expert-note")!.textContent).toContain("nothing touches the item before it's documented");
    });

    it("omits the expertNote heading/section entirely when none is authored", () => {
      const { expertNote: _drop, ...noExpertNote } = richConfig;
      void _drop;
      completeCleanly(noExpertNote as RuntimeProcessConfig);
      const headings = Array.from(document.querySelectorAll("h3")).map((h) => h.textContent);
      expect(headings).not.toContain("Expert note");
      expect(document.querySelector(".ilb-expert-note")).toBeNull();
    });

    it("Start over returns to Brief, resets progress to 0 of N, and focuses the new h2", () => {
      completeCleanly();
      clickByText(".ilb-btn-pill", "Start over");
      expect(h2().textContent).toBe("Evidence Intake Drill");
      expect(document.activeElement).toBe(h2());
      expect(progressText()).toBe("0 of 3 required steps done");
    });
  });

  describe("SCORM reporting", () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).ILBScorm;
    });

    it("never calls setScore/setCompleted through brief or mid-procedure — only saveSuspendData", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountProcessSimulator(root(), richConfig);
      expect(scorm.setScore).not.toHaveBeenCalled();
      expect(scorm.setCompleted).not.toHaveBeenCalled();

      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Photograph the item");
      clickAction("Collect the item"); // still premature (gloves missing)

      expect(scorm.setScore).not.toHaveBeenCalled();
      expect(scorm.setCompleted).not.toHaveBeenCalled();
      expect(scorm.saveSuspendData).toHaveBeenCalled();
    });

    it("the last required action calls setScore(bestPct) then setCompleted() exactly once, in that order", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item");

      expect(scorm.setScore).toHaveBeenCalledTimes(1);
      expect(scorm.setScore).toHaveBeenCalledWith(100);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
      expect(scorm.setScore.mock.invocationCallOrder[0]).toBeLessThan(scorm.setCompleted.mock.invocationCallOrder[0]);
    });

    it("Start over never lowers the reported score or un-completes, and does not re-call setScore/setCompleted", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item");
      expect(scorm.setScore).toHaveBeenCalledTimes(1);

      clickByText(".ilb-btn-pill", "Start over");
      expect(scorm.setScore).toHaveBeenCalledTimes(1);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
      expect(scorm.saveSuspendData).toHaveBeenCalled(); // but position IS persisted
    });
  });

  describe("suspend/restore round-trip", () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).ILBScorm;
    });

    it("resumes mid-procedure on remount with done actions disabled, the log restored, and the live region re-stated — no focus-steal", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Photograph the item");

      const savedPayload = scorm.saveSuspendData.mock.calls.at(-1)![0];
      document.body.innerHTML = '<div id="root"></div>';
      const scorm2 = createScormMock(savedPayload);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm2 as unknown as ScormSession;

      mountProcessSimulator(root(), richConfig);
      expect(h2().textContent).toBe("Procedure");
      expect(progressText()).toBe("1 of 3 required steps done");
      expect(document.querySelectorAll(".ilb-log-entry")).toHaveLength(1);
      expect(actionButton("Photograph the item").disabled).toBe(true);
      expect(document.activeElement).not.toBe(h2());
    });

    it("resumes cleanly from a suspend saved WHILE a consequence panel was open — lands back on the action menu with the attempt preserved, efficiency identical to no-suspend", () => {
      // Run A: no suspend in between.
      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Ask someone to move the item"); // consequence panel open, 1 attempt recorded
      clickByText(".ilb-btn-pill", "Continue");
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item");
      const scoreLineNoSuspend = document.querySelector(".ilb-score-line")!.textContent;

      // Run B: suspend while the consequence panel is still showing, then resume.
      document.body.innerHTML = '<div id="root"></div>';
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;
      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Ask someone to move the item"); // consequence panel now open

      const savedPayload = scorm.saveSuspendData.mock.calls.at(-1)![0];
      document.body.innerHTML = '<div id="root"></div>';
      const scorm2 = createScormMock(savedPayload);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm2 as unknown as ScormSession;
      mountProcessSimulator(root(), richConfig);

      // Landed back on the action menu (no persisted "consequence open" state), not focus-stolen.
      expect(document.querySelector(".ilb-action-list")).toBeTruthy();
      expect(document.activeElement).not.toBe(h2());

      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item");
      expect(document.querySelector(".ilb-score-line")!.textContent).toBe(scoreLineNoSuspend);
    });

    it("resumes at debrief on remount, re-asserting setScore/setCompleted, with the score line recomputed identically", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountProcessSimulator(root(), richConfig);
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Photograph the item");
      clickAction("Put on gloves");
      clickAction("Collect the item");
      const originalScoreLine = document.querySelector(".ilb-score-line")!.textContent;

      const savedPayload = scorm.saveSuspendData.mock.calls.at(-1)![0];
      document.body.innerHTML = '<div id="root"></div>';
      const scorm2 = createScormMock(savedPayload);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm2 as unknown as ScormSession;

      mountProcessSimulator(root(), richConfig);
      expect(h2().textContent).toBe("Evidence Intake Drill");
      expect(document.querySelector(".ilb-score-line")!.textContent).toBe(originalScoreLine);
      expect(scorm2.setScore).toHaveBeenCalledWith(100);
      expect(scorm2.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("salvages best score and completion from a payload that fails full restore (stale action id) but carries well-formed b/c", () => {
      const scorm = createScormMock({
        v: 1, done: ["not-a-real-action"], at: [], b: 87, c: true, step: "procedure",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      expect(() => mountProcessSimulator(root(), richConfig)).not.toThrow();
      expect(scorm.setScore).toHaveBeenCalledWith(87);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
      // Positionally fresh: back at brief, not stuck on the stale payload.
      expect(h2().textContent).toBe("Evidence Intake Drill");
      expect(progressText()).toBe("0 of 3 required steps done");
    });

    it("mounts usable at Brief (no throw) for a hostile payload with the wrong version, salvaging nothing (no b/c to salvage)", () => {
      const scorm = createScormMock({ v: 2, garbage: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      expect(() => mountProcessSimulator(root(), richConfig)).not.toThrow();
      expect(scorm.setScore).not.toHaveBeenCalled();
      expect(scorm.setCompleted).not.toHaveBeenCalled();
      expect(h2().textContent).toBe("Evidence Intake Drill");
    });
  });

  describe("engine.css source rules (audited-pattern parity with the other three engines)", () => {
    const css = readFileSync(ENGINE_CSS_PATH, "utf8");

    it("defines a 24px minimum height for buttons", () => {
      expect(css).toMatch(/\.ilb-process button[^{]*\{[^}]*min-height:\s*24px/);
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

    it("uses only already-approved hex literals (the three status-palette sets)", () => {
      const hexLiterals = css.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
      const approved = new Set(["#365409", "#f2f7ec", "#644a00", "#7a5a00", "#fff8e1", "#8b1f1f", "#fbeeee", "#fff"]);
      for (const hex of hexLiterals) {
        expect(approved.has(hex.toLowerCase()) || approved.has(hex), `unapproved hex literal: ${hex}`).toBe(true);
      }
    });

    describe("reduced-motion neutralizes the step-transition animation", () => {
      const reducedMotionBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1];

      it("has a reduced-motion block to inspect", () => {
        expect(reducedMotionBlock).toBeDefined();
      });

      it("neutralizes the .ilb-enter step-transition animation", () => {
        expect(reducedMotionBlock).toMatch(/\.ilb-enter\s*\{[^}]*animation:\s*none/);
      });
    });
  });
});
