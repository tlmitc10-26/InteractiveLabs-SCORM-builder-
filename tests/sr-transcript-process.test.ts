// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountProcessSimulator, type RuntimeProcessConfig } from "@/engine-runtime/process-simulator/main";
import { PROCESS_STARTERS, processStarterConfig } from "@/lib/engines/process-simulator/starters";
import { readingOrderTranscript, focusOrderTranscript, liveRegionsOf } from "@/lib/a11y/transcript";

/**
 * Screen-reader announcement contract for the Process Simulator runtime.
 * Same doctrine as tests/sr-transcript-case.test.ts and its two siblings
 * (see those files' doc comments and src/lib/a11y/transcript.ts's module doc
 * comment): for conformant markup, what a screen reader announces is
 * spec-determined, so it is locked here as an explicit, human-legible
 * contract. Every literal below was captured from this exact config's real,
 * mounted DOM.
 *
 * This is the first engine to register a PER-ENTRY text carrier
 * (transcript.ts's "ilb-log-entry", spec §3 review #20) rather than a
 * whole-list carrier -- the situation log grows one entry per legally-
 * performed required action, so each entry appears as its own reading-order
 * "text" record instead of the debrief's whole-list "ilb-comparison-list"
 * carrier (reused here unchanged for the step review, exactly as it already
 * behaves in tests/sr-transcript-case.test.ts).
 */

function mountBlank(): HTMLElement {
  document.body.innerHTML = '<div id="root"></div>';
  const config: RuntimeProcessConfig = processStarterConfig("blank", "Blank Procedure");
  const root = document.getElementById("root")!;
  mountProcessSimulator(root, config);
  return root;
}

function clickByText(selector: string, text: string): void {
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((b) => b.textContent === text);
  if (!btn) throw new Error(`no ${selector} with text "${text}"`);
  btn.click();
}

function clickAction(label: string): void {
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-action-btn")).find(
    (b) => b.querySelector(".ilb-action-label")?.textContent === label,
  );
  if (!btn) throw new Error(`no action button labeled "${label}"`);
  btn.click();
}

describe("screen-reader announcement contract (blank starter, process simulator)", () => {
  describe("1. brief step", () => {
    it("reading order: live region, h2, Begin button", () => {
      const root = mountBlank();
      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "0 of 3 required steps done", live: "polite" },
        { role: "heading level 2", name: "Blank Procedure" },
        { role: "button", name: "Begin the procedure." },
      ]);
    });

    it("focus order: just the Begin button", () => {
      const root = mountBlank();
      expect(focusOrderTranscript(root)).toEqual([{ role: "button", name: "Begin the procedure." }]);
    });

    it("exactly one live region: progress, 0 of 3 even before beginning", () => {
      const root = mountBlank();
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "0 of 3 required steps done" }]);
    });
  });

  describe("2. procedure step: action menu", () => {
    it("reading order on entry: status, h2, Situation h3 (no log yet), Actions h3, every action button in authored order", () => {
      const root = mountBlank();
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "0 of 3 required steps done", live: "polite" },
        { role: "heading level 2", name: "Procedure" },
        { role: "heading level 3", name: "Situation" },
        { role: "heading level 3", name: "Actions" },
        { role: "button", name: "Describe the first action here" },
        { role: "button", name: "Describe a second gated action here" },
        { role: "button", name: "Describe a third independent required action here" },
        { role: "button", name: "Describe a tempting but wrong action here" },
      ]);
    });

    it("focus order on entry: every action button, none disabled", () => {
      const root = mountBlank();
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      expect(focusOrderTranscript(root)).toEqual([
        { role: "button", name: "Describe the first action here" },
        { role: "button", name: "Describe a second gated action here" },
        { role: "button", name: "Describe a third independent required action here" },
        { role: "button", name: "Describe a tempting but wrong action here" },
      ]);
    });

    it("a completed action's button stays in READING order (name + disabled state) but drops out of FOCUS order", () => {
      const root = mountBlank();
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Describe the first action here");

      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "1 of 3 required steps done", live: "polite" },
        { role: "heading level 2", name: "Procedure" },
        { role: "heading level 3", name: "Situation" },
        { role: "text", name: "Latest: Describe what becomes true in the situation once this action is legally performed." },
        { role: "heading level 3", name: "Actions" },
        { role: "button", name: "Describe the first action here", states: ["disabled"] },
        { role: "button", name: "Describe a second gated action here" },
        { role: "button", name: "Describe a third independent required action here" },
        { role: "button", name: "Describe a tempting but wrong action here" },
      ]);

      expect(focusOrderTranscript(root)).toEqual([
        { role: "button", name: "Describe a second gated action here" },
        { role: "button", name: "Describe a third independent required action here" },
        { role: "button", name: "Describe a tempting but wrong action here" },
      ]);
    });
  });

  describe("3. procedure step: consequence panel", () => {
    it("opening the consequence panel after a prior success keeps the Situation log present, replaces Actions with Consequence + Continue, and leaves the live region untouched", () => {
      const root = mountBlank();
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Describe the first action here"); // success -> log entry
      clickAction("Describe a tempting but wrong action here"); // illegal distractor

      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "1 of 3 required steps done", live: "polite" },
        { role: "heading level 2", name: "Procedure" },
        { role: "heading level 3", name: "Situation" },
        { role: "text", name: "Latest: Describe what becomes true in the situation once this action is legally performed." },
        { role: "heading level 3", name: "Consequence" },
        { role: "button", name: "Continue" },
      ]);
      expect(focusOrderTranscript(root)).toEqual([{ role: "button", name: "Continue" }]);
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "1 of 3 required steps done" }]);
    });
  });

  describe("4. debrief step", () => {
    function completeCleanly(): void {
      clickByText(".ilb-btn-pill", "Begin the procedure.");
      clickAction("Describe the first action here");
      clickAction("Describe a second gated action here");
      clickAction("Describe a third independent required action here");
    }

    it("reading order: status, eyebrow, h2 = title, score line, situation log read-back (per-entry), bundled step review, Start over", () => {
      const root = mountBlank();
      completeCleanly();

      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "3 of 3 required steps done", live: "polite" },
        { role: "text", name: "Procedure complete" },
        { role: "heading level 2", name: "Blank Procedure" },
        { role: "text", name: "Steps: 3 of 3 clean. Attempts: 3 (expert minimum 3). Score: 100%." },
        { role: "heading level 3", name: "Situation" },
        { role: "text", name: "Describe what becomes true in the situation once this action is legally performed." },
        { role: "text", name: "Describe what becomes true once this action is legally performed." },
        { role: "text", name: "Latest: Describe what becomes true once this action is legally performed." },
        { role: "heading level 3", name: "Step review" },
        {
          role: "text",
          name:
            "Describe the first action here: completed on the first try. " +
            "Describe a second gated action here: completed on the first try. " +
            "Describe a third independent required action here: completed on the first try.",
        },
        { role: "button", name: "Start over" },
      ]);
    });

    it("focuses the h2 on the automatic debrief transition, and Start over is the only focusable control", () => {
      const root = mountBlank();
      completeCleanly();
      expect(focusOrderTranscript(root)).toEqual([{ role: "button", name: "Start over" }]);
      expect(document.activeElement?.tagName).toBe("H2");
      expect(document.activeElement?.textContent).toBe("Blank Procedure");
    });

    it("exactly one live region, now reading the final 3 of 3", () => {
      const root = mountBlank();
      completeCleanly();
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "3 of 3 required steps done" }]);
    });
  });
});

/**
 * Generalized smoke coverage (mirrors the equivalent section in
 * tests/sr-transcript-case.test.ts and its siblings): runs every process-
 * simulator starter (today, just "blank") through brief -> procedure ->
 * debrief, asserting the transcript functions never throw and the
 * live-region count is exactly one at every step, without pinning exact
 * text per starter.
 */
describe("screen-reader smoke coverage (all process-simulator starters)", () => {
  it("readingOrderTranscript/focusOrderTranscript never throw, and liveRegionsOf is always exactly one region, at every step", () => {
    for (const id of Object.keys(PROCESS_STARTERS)) {
      document.body.innerHTML = '<div id="root"></div>';
      const config = processStarterConfig(id, `Starter check: ${id}`);
      const root = document.getElementById("root")!;
      mountProcessSimulator(root, config);

      const assertOneLiveRegion = () => {
        expect(() => readingOrderTranscript(root), `starter "${id}"`).not.toThrow();
        expect(() => focusOrderTranscript(root), `starter "${id}"`).not.toThrow();
        expect(liveRegionsOf(root), `starter "${id}"`).toHaveLength(1);
      };

      assertOneLiveRegion(); // brief

      clickByText(".ilb-btn-pill", "Begin the procedure.");
      assertOneLiveRegion(); // procedure, menu

      // Drive every required action to completion, in an order that
      // respects prerequisites — the starter's own action order already
      // satisfies this (each action's `requires`, if any, only names
      // earlier-appearing required actions).
      for (const action of config.actions.filter((a) => a.required)) {
        clickAction(action.label);
        assertOneLiveRegion();
      }
      // debrief reached automatically by the last click above
      assertOneLiveRegion();
    }
  });
});
