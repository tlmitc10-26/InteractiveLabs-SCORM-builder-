// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountCaseWorkspace, type RuntimeCaseConfig } from "@/engine-runtime/case-workspace/main";
import { CASE_STARTERS, caseStarterConfig } from "@/lib/engines/case-workspace/starters";
import { toCaseRuntimeConfig } from "@/lib/engines/case-workspace/runtime-config";
import { readingOrderTranscript, focusOrderTranscript, liveRegionsOf } from "@/lib/a11y/transcript";

/**
 * Screen-reader announcement contract for the Case / Evidence Workspace
 * runtime. Same doctrine as tests/sr-transcript.test.ts and
 * tests/sr-transcript-branching.test.ts (see those files' doc comments and
 * src/lib/a11y/transcript.ts's module doc comment): for conformant markup,
 * what a screen reader announces is spec-determined, so it is locked here
 * as an explicit, human-legible contract. Every literal below was captured
 * from this exact config's real, mounted DOM.
 *
 * This engine is the first to render native `<input type="radio">`
 * (transcript.ts's spec §8 extension, tests/transcript-radio.test.ts) and
 * the first to add new TEXT_CARRIER_CLASSES entries since branching's
 * "ilb-eyebrow" (see transcript.ts's TEXT_CARRIER_CLASSES doc comment): the
 * debrief's per-artifact comparison list and reason-review list, each
 * bundled as ONE reading-order entry (mirrors branching's ilb-debrief-list
 * precedent exactly).
 */

const noAssets = () => { throw new Error("no assets in this config"); };

function mountBlank(): HTMLElement {
  document.body.innerHTML = '<div id="root"></div>';
  const config = toCaseRuntimeConfig(caseStarterConfig("blank", "Blank Case"), noAssets) as RuntimeCaseConfig;
  const root = document.getElementById("root")!;
  mountCaseWorkspace(root, config);
  return root;
}

function clickByText(selector: string, text: string): void {
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((b) => b.textContent === text);
  if (!btn) throw new Error(`no ${selector} with text "${text}"`);
  btn.click();
}

function selectFirstArtifact(): void {
  const btn = document.querySelector<HTMLButtonElement>(".ilb-artifact-btn")!;
  btn.click();
}

describe("screen-reader announcement contract (blank starter, case workspace)", () => {
  describe("1. brief step", () => {
    it("reading order: live region, h2, Open button", () => {
      const root = mountBlank();
      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "Case file: 0 of 2 artifacts", live: "polite" },
        { role: "heading level 2", name: "Blank Case" },
        { role: "button", name: "Open the case file." },
      ]);
    });

    it("focus order: just the Open button", () => {
      const root = mountBlank();
      expect(focusOrderTranscript(root)).toEqual([{ role: "button", name: "Open the case file." }]);
    });

    it("exactly one live region: case-file status, 0 of 2 even before opening", () => {
      const root = mountBlank();
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "Case file: 0 of 2 artifacts" }]);
    });
  });

  describe("2. workspace step", () => {
    it("reading order before any artifact is selected: status, h2, artifact buttons, case-file heading, Ready button", () => {
      const root = mountBlank();
      clickByText(".ilb-btn-pill", "Open the case file.");
      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "Case file: 0 of 2 artifacts", live: "polite" },
        { role: "heading level 2", name: "Workspace" },
        { role: "button", name: "Artifact OneText" },
        { role: "button", name: "Artifact TwoText" },
        { role: "heading level 3", name: "Your case file" },
        { role: "button", name: "Ready to conclude" },
      ]);
    });

    it("selecting an artifact inserts the viewer's h3 + two Add buttons between the artifact list and the case-file panel", () => {
      const root = mountBlank();
      clickByText(".ilb-btn-pill", "Open the case file.");
      selectFirstArtifact();
      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "Case file: 0 of 2 artifacts", live: "polite" },
        { role: "heading level 2", name: "Workspace" },
        { role: "button", name: "Artifact OneText" },
        { role: "button", name: "Artifact TwoText" },
        { role: "heading level 3", name: "Artifact One" },
        { role: "button", name: "Add as strong support" },
        { role: "button", name: "Add as weak support" },
        { role: "heading level 3", name: "Your case file" },
        { role: "button", name: "Ready to conclude" },
      ]);
    });

    it("adding the artifact swaps the viewer's two Add buttons for one Remove button, adds a disambiguated Remove row to the case-file panel, and updates the live region", () => {
      const root = mountBlank();
      clickByText(".ilb-btn-pill", "Open the case file.");
      selectFirstArtifact();
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");

      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "Case file: 1 of 2 artifacts", live: "polite" },
        { role: "heading level 2", name: "Workspace" },
        { role: "button", name: "Artifact OneText" },
        { role: "button", name: "Artifact TwoText" },
        { role: "heading level 3", name: "Artifact One" },
        { role: "button", name: "Remove from case file" },
        { role: "heading level 3", name: "Your case file" },
        // F5 (review): the case-file row's strength ("Strong support" /
        // "Weak support") is now its own tracked text-carrier
        // (.ilb-case-file-strength, TEXT_CARRIER_CLASSES) -- previously this
        // whole row was untracked prose, so a screen-reader user had no
        // reading-order confirmation of which strength they'd assigned.
        { role: "text", name: "Strong support" },
        { role: "button", name: "Remove Artifact One from case file" },
        { role: "button", name: "Ready to conclude" },
      ]);
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "Case file: 1 of 2 artifacts" }]);
    });
  });

  describe("3. conclude step", () => {
    function enterConclude(): void {
      clickByText(".ilb-btn-pill", "Open the case file.");
      clickByText(".ilb-btn-pill", "Ready to conclude");
    }

    it("reading order before a conclusion is chosen: two unchecked radios, no reason group, Submit disabled", () => {
      const root = mountBlank();
      enterConclude();
      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "Case file: 0 of 2 artifacts", live: "polite" },
        { role: "heading level 2", name: "Conclude" },
        { role: "radio", name: "Conclusion A", states: ["not checked"] },
        { role: "radio", name: "Conclusion B", states: ["not checked"] },
        { role: "button", name: "Submit conclusion", states: ["disabled"] },
        { role: "button", name: "Back to the case file" },
      ]);
    });

    it("choosing a conclusion flips its radio to checked and reveals its two reason checkboxes, unchecked", () => {
      const root = mountBlank();
      enterConclude();
      const radio = document.querySelector('input[type="radio"]') as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));

      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "Case file: 0 of 2 artifacts", live: "polite" },
        { role: "heading level 2", name: "Conclude" },
        { role: "radio", name: "Conclusion A", states: ["checked"] },
        { role: "radio", name: "Conclusion B", states: ["not checked"] },
        {
          role: "checkbox",
          name: "A sound reason that genuinely follows from the evidence for Conclusion A.",
          states: ["not checked"],
        },
        { role: "checkbox", name: "A plausible-sounding but flawed reason for Conclusion A.", states: ["not checked"] },
        { role: "button", name: "Submit conclusion", states: ["disabled"] },
        { role: "button", name: "Back to the case file" },
      ]);

      // The focus-management contract (spec §3): choosing a conclusion moves
      // focus to the reason group's legend, NOT via the live region.
      expect(document.activeElement?.tagName).toBe("LEGEND");
      expect(document.activeElement?.textContent).toBe("Which of these justify Conclusion A? Select all that apply.");
    });

    it("checking a reason flips its checkbox state and enables Submit", () => {
      const root = mountBlank();
      enterConclude();
      const radio = document.querySelector('input[type="radio"]') as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      const box = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));

      const entries = readingOrderTranscript(root);
      const checkboxEntry = entries.find((e) => e.role === "checkbox" && e.name.startsWith("A sound reason"));
      expect(checkboxEntry).toEqual({
        role: "checkbox",
        name: "A sound reason that genuinely follows from the evidence for Conclusion A.",
        states: ["checked"],
      });
      const submitEntry = entries.find((e) => e.name === "Submit conclusion");
      expect(submitEntry).toEqual({ role: "button", name: "Submit conclusion" }); // no longer disabled
    });

    it("exactly one live region throughout Conclude, untouched by conclusion/reason changes", () => {
      const root = mountBlank();
      enterConclude();
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "Case file: 0 of 2 artifacts" }]);
      const radio = document.querySelector('input[type="radio"]') as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "Case file: 0 of 2 artifacts" }]);
    });
  });

  describe("4. debrief step", () => {
    function submitWithCaseFileAndBothReasons(): void {
      clickByText(".ilb-btn-pill", "Open the case file.");
      selectFirstArtifact();
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
      clickByText(".ilb-btn-pill", "Ready to conclude");
      const radio = document.querySelector('input[type="radio"]') as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      for (const box of boxes) {
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
      clickByText(".ilb-btn-pill", "Submit conclusion");
    }

    it("reading order: eyebrow, h2 = chosen label, score line, bundled comparison list, bundled reason-review list, headings, Start over", () => {
      const root = mountBlank();
      submitWithCaseFileAndBothReasons();

      expect(readingOrderTranscript(root)).toEqual([
        { role: "status", name: "Case file: 1 of 2 artifacts", live: "polite" },
        { role: "text", name: "Case complete" },
        { role: "heading level 2", name: "Conclusion A" },
        { role: "text", name: "Evidence: 1 of 1. Reasoning: 0 of 1. Conclusion credit: full. Score: 70%." },
        { role: "heading level 3", name: "How your case file compares" },
        { role: "text", name: "Artifact One: included in your case file. This supports the conclusion." },
        { role: "heading level 3", name: "Your reasoning" },
        {
          role: "text",
          name:
            "A sound reason that genuinely follows from the evidence for Conclusion A.: selected. This reasoning holds up. " +
            "A plausible-sounding but flawed reason for Conclusion A.: selected, but this reasoning has a flaw. " +
            "Explain the reasoning flaw here — this note appears to the learner after they select this reason.",
        },
        { role: "heading level 3", name: "Expert's rationale" },
        { role: "button", name: "Start over" },
      ]);
    });

    it("focuses the h2 (the chosen conclusion's label) on submit, and Start over is the only focusable control", () => {
      const root = mountBlank();
      submitWithCaseFileAndBothReasons();
      expect(focusOrderTranscript(root)).toEqual([{ role: "button", name: "Start over" }]);
    });

    it("exactly one live region, still the case-file status (now reflecting the final case file)", () => {
      const root = mountBlank();
      submitWithCaseFileAndBothReasons();
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "Case file: 1 of 2 artifacts" }]);
    });
  });
});

/**
 * Generalized smoke coverage (mirrors the equivalent section in
 * tests/sr-transcript.test.ts and tests/sr-transcript-branching.test.ts):
 * runs every case-workspace starter (today, just "blank"; M3's future
 * exemplar joins this loop automatically) through brief -> workspace ->
 * conclude -> debrief, asserting the transcript functions never throw and
 * the live-region count is exactly one at every step, without pinning
 * exact text per starter.
 */
describe("screen-reader smoke coverage (all case-workspace starters)", () => {
  it("readingOrderTranscript/focusOrderTranscript never throw, and liveRegionsOf is always exactly one region, at every step", () => {
    for (const id of Object.keys(CASE_STARTERS)) {
      document.body.innerHTML = '<div id="root"></div>';
      const config = toCaseRuntimeConfig(caseStarterConfig(id, `Starter check: ${id}`), noAssets) as RuntimeCaseConfig;
      const root = document.getElementById("root")!;
      mountCaseWorkspace(root, config);

      const assertOneLiveRegion = () => {
        expect(() => readingOrderTranscript(root), `starter "${id}"`).not.toThrow();
        expect(() => focusOrderTranscript(root), `starter "${id}"`).not.toThrow();
        expect(liveRegionsOf(root), `starter "${id}"`).toHaveLength(1);
      };

      assertOneLiveRegion(); // brief

      clickByText(".ilb-btn-pill", "Open the case file.");
      assertOneLiveRegion(); // workspace

      clickByText(".ilb-btn-pill", "Ready to conclude");
      assertOneLiveRegion(); // conclude, before choosing

      const radio = document.querySelector<HTMLInputElement>('input[type="radio"]')!;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      assertOneLiveRegion(); // conclude, reason selected

      clickByText(".ilb-btn-pill", "Submit conclusion");
      assertOneLiveRegion(); // debrief
    }
  });
});
