// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountCaseWorkspace, type RuntimeCaseConfig } from "@/engine-runtime/case-workspace/main";
import { caseStarterConfig } from "@/lib/engines/case-workspace/starters";
import { toCaseRuntimeConfig } from "@/lib/engines/case-workspace/runtime-config";
import type { ScormSession } from "@/engine-runtime/scorm-adapter";

const noAssets = () => { throw new Error("no assets in this config"); };

const blankConfig: RuntimeCaseConfig = toCaseRuntimeConfig(
  caseStarterConfig("blank", "Blank Case"),
  noAssets,
) as RuntimeCaseConfig;

/** A richer hand-built fixture (bypassing the zod schema, matching the
 *  pattern of tests/branching-runtime.test.ts's hand-built
 *  RuntimeBranchingConfig fixtures) exercising every artifact kind (text,
 *  image, table), a scoringMode of "single" (the credit GATE), and an
 *  expert map covering all four artifact/conclusion relationships the
 *  debrief's comparison list classifies: a supporting artifact the learner
 *  includes (included-support), a supporting artifact they leave out
 *  (left-out-support), a contradicting artifact they mistakenly include
 *  (misused-contradict), and a contradicting artifact they correctly leave
 *  out (excluded-contradict, no color emphasis). */
const richConfig: RuntimeCaseConfig = {
  title: "The Equipment Failure Case",
  intro: "<p>Review the artifacts and decide what happened.</p>",
  scoringMode: "single",
  artifacts: [
    { id: "memo", title: "Maintenance Memo", sourceLine: "Internal memo, p.1", kind: "text", body: "<p>The lift was flagged for service three times.</p>" },
    { id: "photo", title: "Scene Photo", kind: "image", imageUrl: "assets/scene.png", imageRole: "informative", imageAlt: "The lift mechanism after the incident" },
    {
      id: "logs",
      title: "Access Logs",
      kind: "table",
      table: { caption: "Badge swipes, 6-8pm", headers: ["Time", "Employee"], rows: [["6:02", "R. Alvarez"], ["7:45", "T. Kim"]] },
    },
    { id: "weather", title: "Weather Log", kind: "text", body: "<p>Clear skies, no precipitation.</p>" },
  ],
  conclusions: [
    {
      id: "equipment_failure",
      label: "Equipment failure",
      credit: "full",
      expertRationale: "<p>The maintenance history is the most direct explanation.</p>",
      reasons: [
        { id: "ef_sound", text: "The lift had unresolved service flags.", sound: true },
        { id: "ef_flaw", text: "T. Kim badged in that evening.", sound: false, flawNote: "Presence at the scene doesn't establish a mechanical cause." },
      ],
    },
    {
      id: "operator_error",
      label: "Operator error",
      credit: "none",
      expertRationale: "<p>The evidence does not support operator error.</p>",
      reasons: [
        { id: "oe_sound", text: "An untrained employee badged in that evening.", sound: true },
        { id: "oe_flaw", text: "Clear weather ruled out every other cause.", sound: false, flawNote: "Ruling out one alternative doesn't establish this one." },
      ],
    },
  ],
  expertMap: [
    { artifactId: "memo", conclusionId: "equipment_failure", role: "supports", strength: "strong" },
    { artifactId: "logs", conclusionId: "equipment_failure", role: "contradicts", strength: "weak" },
    { artifactId: "photo", conclusionId: "operator_error", role: "supports", strength: "weak" },
    { artifactId: "weather", conclusionId: "equipment_failure", role: "contradicts", strength: "weak" },
  ],
};

const bestSupportedConfig: RuntimeCaseConfig = { ...richConfig, scoringMode: "best-supported" };
const argumentQualityConfig: RuntimeCaseConfig = { ...richConfig, scoringMode: "argument-quality" };

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

/** The artifact-list button's full textContent is "{title}{kind label}"
 *  (the reviewed glyph is aria-hidden but its text still lands in
 *  textContent) -- resolve by title prefix instead of an exact match. */
function artifactButtonText(title: string): string {
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-artifact-btn")).find((b) => b.textContent?.startsWith(title));
  return btn?.textContent ?? title;
}

function chooseConclusionRadio(label: string): void {
  const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const radio = radios.find((r) => r.closest(".ilb-conclusion-card")?.textContent === label);
  if (!radio) throw new Error(`no conclusion radio labeled "${label}"`);
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
}

function toggleReasonCheckbox(text: string): void {
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const box = boxes.find((b) => b.closest(".ilb-reason-row")?.textContent === text);
  if (!box) throw new Error(`no reason checkbox with text "${text}"`);
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("mountCaseWorkspace", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).ILBScorm;
  });

  describe("brief step", () => {
    it("sets role=\"main\" on the mounted root", () => {
      mountCaseWorkspace(root(), blankConfig);
      expect(root().getAttribute("role")).toBe("main");
    });

    it("renders the case title as h2 (tabindex -1), the intro, and the Open button; does not focus on initial mount", () => {
      mountCaseWorkspace(root(), blankConfig);
      expect(h2().textContent).toBe("Blank Case");
      expect(h2().getAttribute("tabindex")).toBe("-1");
      expect(document.querySelector(".ilb-intro")).toBeTruthy();
      expect(document.activeElement).not.toBe(h2());
      expect(document.querySelector(".ilb-btn-pill")!.textContent).toBe("Open the case file.");
    });

    it("exposes exactly one live region (the case-file status), reading 0 of N even before opening the case file", () => {
      mountCaseWorkspace(root(), blankConfig);
      const regions = document.querySelectorAll("[aria-live]");
      expect(regions.length).toBe(1);
      const status = document.querySelector(".ilb-case-status")!;
      expect(status.getAttribute("role")).toBe("status");
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect(status.getAttribute("aria-atomic")).toBe("true");
      expect(status.textContent).toBe("Case file: 0 of 2 artifacts");
    });

    it("clicking Open the case file transitions to Workspace and focuses its h2", () => {
      mountCaseWorkspace(root(), blankConfig);
      clickByText(".ilb-btn-pill", "Open the case file.");
      expect(h2().textContent).toBe("Workspace");
      expect(document.activeElement).toBe(h2());
    });
  });

  describe("workspace step", () => {
    function openWorkspace(config: RuntimeCaseConfig = richConfig): void {
      mountCaseWorkspace(root(), config);
      clickByText(".ilb-btn-pill", "Open the case file.");
    }

    it("lists every artifact with title + kind label, and an unreviewed glyph", () => {
      openWorkspace();
      const buttons = Array.from(document.querySelectorAll(".ilb-artifact-btn"));
      expect(buttons).toHaveLength(4);
      expect(buttons[0].querySelector(".ilb-artifact-title")!.textContent).toBe("Maintenance Memo");
      expect(buttons[0].querySelector(".ilb-artifact-kind")!.textContent).toBe("Text");
      const glyph = buttons[0].querySelector(".ilb-artifact-reviewed")!;
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      expect(glyph.textContent).toBe("○");
    });

    it("shows a placeholder in the viewer until an artifact is selected", () => {
      openWorkspace();
      expect(document.querySelector(".ilb-viewer-empty")!.textContent).toBe("Select an artifact from the list to review it.");
    });

    it("selecting a text artifact renders its h3/sourceLine/body and marks it reviewed (glyph flips in place, list untouched)", () => {
      openWorkspace();
      const listBefore = document.querySelector(".ilb-artifact-list")!;
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      expect(document.querySelector(".ilb-viewer h3")!.textContent).toBe("Maintenance Memo");
      expect(document.querySelector(".ilb-artifact-source")!.textContent).toBe("Internal memo, p.1");
      expect(document.querySelector(".ilb-artifact-body")!.textContent).toContain("flagged for service");
      // The artifact list itself was never rebuilt (same node identity) —
      // this is what lets the clicked button keep keyboard focus.
      expect(document.querySelector(".ilb-artifact-list")).toBe(listBefore);
      const glyph = document.querySelectorAll(".ilb-artifact-reviewed")[0];
      expect(glyph.textContent).toBe("●");
    });

    it("renders an image artifact via the runtime-config imageUrl and the alt matrix", () => {
      openWorkspace();
      clickByText(".ilb-artifact-btn", artifactButtonText("Scene Photo"));
      const img = document.querySelector(".ilb-artifact-image") as HTMLImageElement;
      expect(img.src).toContain("assets/scene.png");
      expect(img.alt).toBe("The lift mechanism after the incident");
    });

    it("renders a table artifact as a real <table> with a caption and th scope", () => {
      openWorkspace();
      clickByText(".ilb-artifact-btn", artifactButtonText("Access Logs"));
      const table = document.querySelector(".ilb-artifact-table") as HTMLTableElement;
      expect(table).toBeTruthy();
      expect(table.querySelector("caption")!.textContent).toBe("Badge swipes, 6-8pm");
      const headers = Array.from(table.querySelectorAll("th"));
      expect(headers.map((h) => h.textContent)).toEqual(["Time", "Employee"]);
      expect(headers.every((h) => h.getAttribute("scope") === "col")).toBe(true);
      expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    });

    it("falls back to the artifact title for a table's caption when none is authored", () => {
      const noCaption: RuntimeCaseConfig = {
        ...richConfig,
        artifacts: richConfig.artifacts.map((a) => (a.id === "logs" ? { ...a, table: { ...a.table!, caption: undefined } } : a)),
      };
      openWorkspace(noCaption);
      clickByText(".ilb-artifact-btn", artifactButtonText("Access Logs"));
      expect(document.querySelector(".ilb-artifact-table caption")!.textContent).toBe("Access Logs");
    });

    it("shows two Add buttons for an artifact not yet in the case file", () => {
      openWorkspace();
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      const actions = Array.from(document.querySelectorAll(".ilb-viewer-actions .ilb-btn"));
      expect(actions.map((b) => b.textContent)).toEqual(["Add as strong support", "Add as weak support"]);
    });

    it("Add as strong support swaps to a single Remove button, updates the case-file panel and the live region, and focuses Remove", () => {
      openWorkspace();
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");

      const actions = Array.from(document.querySelectorAll(".ilb-viewer-actions .ilb-btn"));
      expect(actions.map((b) => b.textContent)).toEqual(["Remove from case file"]);
      expect(document.activeElement).toBe(actions[0]);

      expect(document.querySelector(".ilb-case-status")!.textContent).toBe("Case file: 1 of 4 artifacts");
      const row = document.querySelector(".ilb-case-file-row")!;
      expect(row.textContent).toContain("Maintenance Memo: Strong support");
    });

    it("clicking Remove in the viewer reverts to the two Add buttons and updates the panel/status", () => {
      openWorkspace();
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
      clickByText(".ilb-viewer-actions .ilb-btn", "Remove from case file");

      const actions = Array.from(document.querySelectorAll(".ilb-viewer-actions .ilb-btn"));
      expect(actions.map((b) => b.textContent)).toEqual(["Add as strong support", "Add as weak support"]);
      expect(document.querySelector(".ilb-case-status")!.textContent).toBe("Case file: 0 of 4 artifacts");
      expect(document.querySelector(".ilb-case-file-empty")!.textContent).toBe("No artifacts added yet.");
    });

    it("removing an artifact from the case-file PANEL (not the viewer) also swaps the viewer's buttons back, and focuses the panel heading", () => {
      openWorkspace();
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");

      clickByText(".ilb-case-file-remove", "Remove Maintenance Memo from case file");

      expect(document.querySelector(".ilb-case-file-empty")).toBeTruthy();
      const panelHeading = document.querySelector(".ilb-case-file-panel h3")!;
      expect(document.activeElement).toBe(panelHeading);
      const actions = Array.from(document.querySelectorAll(".ilb-viewer-actions .ilb-btn"));
      expect(actions.map((b) => b.textContent)).toEqual(["Add as strong support", "Add as weak support"]);
    });

    it("\"Ready to conclude\" is present and enabled even with an empty case file", () => {
      openWorkspace();
      const readyBtn = Array.from(document.querySelectorAll(".ilb-btn-pill")).find((b) => b.textContent === "Ready to conclude") as HTMLButtonElement;
      expect(readyBtn).toBeTruthy();
      expect(readyBtn.disabled).toBe(false);
    });

    it("clicking Ready to conclude transitions to Conclude and focuses its h2", () => {
      openWorkspace();
      clickByText(".ilb-btn-pill", "Ready to conclude");
      expect(h2().textContent).toBe("Conclude");
      expect(document.activeElement).toBe(h2());
    });

    it("stale-closure safety: an Add button captured for one artifact is a no-op once the viewer has moved to a different artifact", () => {
      openWorkspace();
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      const staleAddStrong = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-viewer-actions .ilb-btn")).find((b) => b.textContent === "Add as strong support")!;

      // Move on to a different artifact — this removes staleAddStrong from
      // the DOM (renderViewer rebuilds .ilb-viewer-actions), but a held JS
      // reference to it can still be clicked programmatically.
      clickByText(".ilb-artifact-btn", artifactButtonText("Weather Log"));
      staleAddStrong.click();

      // The stale click must not have added Maintenance Memo to the case file.
      expect(document.querySelector(".ilb-case-status")!.textContent).toBe("Case file: 0 of 4 artifacts");
    });
  });

  describe("conclude step", () => {
    function openConclude(config: RuntimeCaseConfig = richConfig): void {
      mountCaseWorkspace(root(), config);
      clickByText(".ilb-btn-pill", "Open the case file.");
      clickByText(".ilb-btn-pill", "Ready to conclude");
    }

    it("renders one native radio per conclusion in a styled label card, none checked initially", () => {
      openConclude();
      const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      expect(radios).toHaveLength(2);
      expect(radios.every((r) => r.closest("label")?.classList.contains("ilb-conclusion-card"))).toBe(true);
      expect(radios.every((r) => !r.checked)).toBe(true);
      // All radios share one name -- exactly one group.
      expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    });

    it("no reason group is shown before a conclusion is chosen, and Submit is disabled with a visible + programmatic explanation", () => {
      openConclude();
      expect(document.querySelector(".ilb-reason-group")).toBeNull();
      const submitBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-btn-pill")).find((b) => b.textContent === "Submit conclusion")!;
      expect(submitBtn.disabled).toBe(true);
      const describedbyId = submitBtn.getAttribute("aria-describedby");
      expect(describedbyId).toBeTruthy();
      const hint = document.getElementById(describedbyId!)!;
      expect(hint.textContent).toBe("Select at least one reason before you can submit.");
      // Visible: not aria-hidden, not [hidden].
      expect(hint.getAttribute("aria-hidden")).not.toBe("true");
      expect(hint.hidden).toBe(false);
    });

    it("choosing a conclusion reveals its reasons as a checkbox group with a legend naming it, and focuses the legend", () => {
      openConclude();
      chooseConclusionRadio("Equipment failure");
      const legend = document.querySelector(".ilb-reason-group legend")!;
      expect(legend.textContent).toBe("Which of these justify Equipment failure? Select all that apply.");
      expect(document.activeElement).toBe(legend);
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      expect(boxes).toHaveLength(2);
    });

    it("changing the conclusion resets the reason selection and re-focuses the (new) legend, without touching the live region", () => {
      openConclude();
      chooseConclusionRadio("Equipment failure");
      toggleReasonCheckbox("The lift had unresolved service flags.");
      expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);

      const liveTextBefore = document.querySelector(".ilb-case-status")!.textContent;
      chooseConclusionRadio("Operator error");
      expect(document.querySelector(".ilb-case-status")!.textContent).toBe(liveTextBefore); // untouched — spec §3: the live region is NOT used for this

      const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      expect(boxes.every((b) => !b.checked)).toBe(true);
      const legend = document.querySelector(".ilb-reason-group legend")!;
      expect(legend.textContent).toBe("Which of these justify Operator error? Select all that apply.");
      expect(document.activeElement).toBe(legend);
    });

    it("Submit becomes enabled once >=1 reason is selected, and disabled again if unchecked back to zero", () => {
      openConclude();
      chooseConclusionRadio("Equipment failure");
      const submitBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ilb-btn-pill")).find((b) => b.textContent === "Submit conclusion")!;
      expect(submitBtn.disabled).toBe(true);
      toggleReasonCheckbox("The lift had unresolved service flags.");
      expect(submitBtn.disabled).toBe(false);
      toggleReasonCheckbox("The lift had unresolved service flags.");
      expect(submitBtn.disabled).toBe(true);
    });

    it("\"Back to the case file\" returns to Workspace, preserving the case file, and focuses its h2", () => {
      mountCaseWorkspace(root(), richConfig);
      clickByText(".ilb-btn-pill", "Open the case file.");
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
      clickByText(".ilb-btn-pill", "Ready to conclude");

      clickByText(".ilb-btn-pill.ilb-btn-pill--ghost", "Back to the case file");
      expect(h2().textContent).toBe("Workspace");
      expect(document.activeElement).toBe(h2());
      expect(document.querySelector(".ilb-case-status")!.textContent).toBe("Case file: 1 of 4 artifacts");
    });

    it("restores mid-conclude with the chosen conclusion pre-checked and its reasons pre-checked (no legend focus on step entry)", () => {
      const scorm = createScormMock({ v: 1, cf: [], rv: [], ch: "equipment_failure", sel: ["ef_sound"], b: 0, c: false, step: "conclude" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;
      mountCaseWorkspace(root(), richConfig);

      const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      expect(radios.find((r) => r.checked)?.closest(".ilb-conclusion-card")?.textContent).toContain("Equipment failure");
      const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      expect(boxes.filter((b) => b.checked)).toHaveLength(1);
      expect(document.activeElement).not.toBe(document.querySelector(".ilb-reason-group legend"));
    });
  });

  describe("submit + debrief", () => {
    function submitAs(config: RuntimeCaseConfig, chosenLabel: string, reasonTexts: string[], caseFileTitles: [string, "strong" | "weak"][] = []): void {
      mountCaseWorkspace(root(), config);
      clickByText(".ilb-btn-pill", "Open the case file.");
      for (const [title, strength] of caseFileTitles) {
        clickByText(".ilb-artifact-btn", artifactButtonText(title));
        clickByText(".ilb-viewer-actions .ilb-btn", strength === "strong" ? "Add as strong support" : "Add as weak support");
      }
      clickByText(".ilb-btn-pill", "Ready to conclude");
      chooseConclusionRadio(chosenLabel);
      for (const text of reasonTexts) toggleReasonCheckbox(text);
      clickByText(".ilb-btn-pill", "Submit conclusion");
    }

    it("submitting moves to Debrief: eyebrow, aria-hidden numeral, h2 = chosen conclusion label, and focuses the h2", () => {
      submitAs(richConfig, "Equipment failure", ["The lift had unresolved service flags."], [["Maintenance Memo", "strong"]]);
      expect(document.querySelector(".ilb-eyebrow")!.textContent).toBe("Case complete");
      expect(h2().textContent).toBe("Equipment failure");
      expect(document.activeElement).toBe(h2());
      const numeral = document.querySelector(".ilb-score-num")!;
      expect(numeral.getAttribute("aria-hidden")).toBe("true");
    });

    it("single mode, credited conclusion + full evidence/reasoning: score line shows the component breakdown and 100%", () => {
      submitAs(richConfig, "Equipment failure", ["The lift had unresolved service flags."], [["Maintenance Memo", "strong"]]);
      expect(document.querySelector(".ilb-score-line")!.textContent).toBe(
        "Evidence: 1 of 1. Reasoning: 1 of 1. Conclusion credit: full. Score: 100%.",
      );
      expect(document.querySelector(".ilb-score-num")!.textContent).toBe("100%");
    });

    it("single mode GATE: choosing the non-credited conclusion scores 0 regardless of evidence/reasoning quality", () => {
      submitAs(richConfig, "Operator error", ["An untrained employee badged in that evening."], [["Scene Photo", "weak"]]);
      expect(document.querySelector(".ilb-score-line")!.textContent).toBe(
        "Evidence: 1 of 1. Reasoning: 1 of 1. This is not the case's credited conclusion, so no credit is given. Score: 0%.",
      );
    });

    it("best-supported mode: score line names the conclusion credit without gating the total to zero", () => {
      submitAs(bestSupportedConfig, "Operator error", ["An untrained employee badged in that evening."], [["Scene Photo", "weak"]]);
      const line = document.querySelector(".ilb-score-line")!.textContent!;
      expect(line).toContain("Conclusion credit: none.");
      expect(line).not.toContain("credited conclusion");
    });

    it("argument-quality mode: score line never mentions conclusion credit", () => {
      submitAs(argumentQualityConfig, "Operator error", ["An untrained employee badged in that evening."], [["Scene Photo", "weak"]]);
      const line = document.querySelector(".ilb-score-line")!.textContent!;
      expect(line).not.toContain("credit");
      expect(line).toMatch(/^Evidence: \d+ of \d+\. Reasoning: \d+ of \d+\. Score: \d+%\.$/);
    });

    it("per-artifact comparison classifies all four relationships using only the three existing status palettes (plus a neutral, unflagged fourth)", () => {
      submitAs(richConfig, "Equipment failure", ["The lift had unresolved service flags."], [
        ["Maintenance Memo", "strong"], // supports, included -> best
        ["Access Logs", "weak"], // contradicts, included -> poor (misused)
        // Weather Log: contradicts, left out -> neutral (excluded-contradict)
      ]);
      const rows = Array.from(document.querySelectorAll(".ilb-comparison-row"));
      const byTitle = new Map(rows.map((r) => [r.textContent!.split(":")[0], r]));

      const memoRow = byTitle.get("Maintenance Memo")!;
      expect(memoRow.className).toContain("ilb-comparison-row--best");
      expect(memoRow.textContent).toContain("included in your case file. This supports the conclusion.");

      const logsRow = byTitle.get("Access Logs")!;
      expect(logsRow.className).toContain("ilb-comparison-row--poor");
      expect(logsRow.textContent).toContain("included in your case file, but it contradicts the conclusion.");

      const weatherRow = byTitle.get("Weather Log")!;
      expect(weatherRow.className).not.toContain("--best");
      expect(weatherRow.className).not.toContain("--ok");
      expect(weatherRow.className).not.toContain("--poor");
      expect(weatherRow.textContent).toContain("correctly left out. It contradicts the conclusion.");

      // Scene Photo is mapped only to Operator error, not the chosen
      // Equipment failure conclusion -- absent from this comparison list.
      expect(byTitle.has("Scene Photo")).toBe(false);

      // Quality chips (aria-hidden decorative summary) reflect the SAME counts.
      const chips = Array.from(document.querySelectorAll(".ilb-qchip"));
      expect(chips.map((c) => c.className)).toEqual(
        expect.arrayContaining([expect.stringContaining("--best"), expect.stringContaining("--poor")]),
      );
      expect(document.querySelector(".ilb-quality-chips")!.getAttribute("aria-hidden")).toBe("true");
    });

    it("reason review shows sound/flawed x selected/missed, with flawNote appearing only for a SELECTED flawed reason", () => {
      submitAs(richConfig, "Equipment failure", ["The lift had unresolved service flags.", "T. Kim badged in that evening."], [["Maintenance Memo", "strong"]]);
      const rows = Array.from(document.querySelectorAll(".ilb-reason-review-list .ilb-comparison-row"));
      const soundRow = rows.find((r) => r.textContent!.startsWith("The lift had unresolved service flags"))!;
      expect(soundRow.className).toContain("--best");
      expect(soundRow.textContent).toBe("The lift had unresolved service flags.: selected. This reasoning holds up.");

      const flawedSelectedRow = rows.find((r) => r.textContent!.startsWith("T. Kim badged in"))!;
      expect(flawedSelectedRow.className).toContain("--poor");
      expect(flawedSelectedRow.textContent).toContain("Presence at the scene doesn't establish a mechanical cause.");
    });

    it("an unselected flawed reason is neutral and does NOT show its flawNote", () => {
      submitAs(richConfig, "Equipment failure", ["The lift had unresolved service flags."], [["Maintenance Memo", "strong"]]);
      const rows = Array.from(document.querySelectorAll(".ilb-reason-review-list .ilb-comparison-row"));
      const flawedUnselected = rows.find((r) => r.textContent!.startsWith("T. Kim badged in"))!;
      expect(flawedUnselected.className).not.toContain("--best");
      expect(flawedUnselected.className).not.toContain("--ok");
      expect(flawedUnselected.className).not.toContain("--poor");
      expect(flawedUnselected.textContent).not.toContain("Presence at the scene");
    });

    it("renders the chosen conclusion's expert rationale", () => {
      submitAs(richConfig, "Equipment failure", ["The lift had unresolved service flags."], [["Maintenance Memo", "strong"]]);
      expect(document.querySelector(".ilb-expert-rationale")!.textContent).toContain("The maintenance history is the most direct explanation.");
    });

    it("Start over returns to Brief, clears the case file/conclusion, and focuses the new h2", () => {
      submitAs(richConfig, "Equipment failure", ["The lift had unresolved service flags."], [["Maintenance Memo", "strong"]]);
      clickByText(".ilb-btn-pill", "Start over");
      expect(h2().textContent).toBe("The Equipment Failure Case");
      expect(document.activeElement).toBe(h2());
      clickByText(".ilb-btn-pill", "Open the case file.");
      expect(document.querySelector(".ilb-case-status")!.textContent).toBe("Case file: 0 of 4 artifacts");
    });
  });

  describe("SCORM reporting", () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).ILBScorm;
    });

    it("never calls setScore/setCompleted through brief, workspace, or conclude — only saveSuspendData", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountCaseWorkspace(root(), richConfig);
      expect(scorm.setScore).not.toHaveBeenCalled();
      expect(scorm.setCompleted).not.toHaveBeenCalled();

      clickByText(".ilb-btn-pill", "Open the case file.");
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
      clickByText(".ilb-btn-pill", "Ready to conclude");
      chooseConclusionRadio("Equipment failure");
      toggleReasonCheckbox("The lift had unresolved service flags.");

      expect(scorm.setScore).not.toHaveBeenCalled();
      expect(scorm.setCompleted).not.toHaveBeenCalled();
      expect(scorm.saveSuspendData).toHaveBeenCalled();
    });

    it("submit calls setScore(bestPct) then setCompleted() exactly once", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountCaseWorkspace(root(), richConfig);
      clickByText(".ilb-btn-pill", "Open the case file.");
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
      clickByText(".ilb-btn-pill", "Ready to conclude");
      chooseConclusionRadio("Equipment failure");
      toggleReasonCheckbox("The lift had unresolved service flags.");
      clickByText(".ilb-btn-pill", "Submit conclusion");

      expect(scorm.setScore).toHaveBeenCalledTimes(1);
      expect(scorm.setScore).toHaveBeenCalledWith(100);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
      const order = [...scorm.setScore.mock.invocationCallOrder, ...scorm.setCompleted.mock.invocationCallOrder];
      expect(scorm.setScore.mock.invocationCallOrder[0]).toBeLessThan(scorm.setCompleted.mock.invocationCallOrder[0]);
      void order;
    });

    it("Start over never lowers the reported score or un-completes, and does not re-call setScore/setCompleted", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountCaseWorkspace(root(), richConfig);
      clickByText(".ilb-btn-pill", "Open the case file.");
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
      clickByText(".ilb-btn-pill", "Ready to conclude");
      chooseConclusionRadio("Equipment failure");
      toggleReasonCheckbox("The lift had unresolved service flags.");
      clickByText(".ilb-btn-pill", "Submit conclusion");
      expect(scorm.setScore).toHaveBeenCalledTimes(1);

      clickByText(".ilb-btn-pill", "Start over");
      expect(scorm.setScore).toHaveBeenCalledTimes(1); // not called again
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1); // not called again
      expect(scorm.saveSuspendData).toHaveBeenCalled(); // but position IS persisted
    });
  });

  describe("suspend/restore round-trip", () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).ILBScorm;
    });

    it("resumes mid-workspace on remount with the case file, reviewed set, and status text restored", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountCaseWorkspace(root(), richConfig);
      clickByText(".ilb-btn-pill", "Open the case file.");
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");

      const savedPayload = scorm.saveSuspendData.mock.calls.at(-1)![0];
      document.body.innerHTML = '<div id="root"></div>';
      const scorm2 = createScormMock(savedPayload);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm2 as unknown as ScormSession;

      mountCaseWorkspace(root(), richConfig);
      expect(h2().textContent).toBe("Workspace");
      expect(document.querySelector(".ilb-case-status")!.textContent).toBe("Case file: 1 of 4 artifacts");
      expect(document.querySelectorAll(".ilb-artifact-reviewed")[0].textContent).toBe("●"); // Maintenance Memo (first artifact) reviewed
      expect(document.activeElement).not.toBe(h2()); // no focus-steal on resume
    });

    it("resumes at debrief on remount, re-asserting setScore/setCompleted, with the score line recomputed identically", () => {
      const scorm = createScormMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountCaseWorkspace(root(), richConfig);
      clickByText(".ilb-btn-pill", "Open the case file.");
      clickByText(".ilb-artifact-btn", artifactButtonText("Maintenance Memo"));
      clickByText(".ilb-viewer-actions .ilb-btn", "Add as strong support");
      clickByText(".ilb-btn-pill", "Ready to conclude");
      chooseConclusionRadio("Equipment failure");
      toggleReasonCheckbox("The lift had unresolved service flags.");
      clickByText(".ilb-btn-pill", "Submit conclusion");
      const originalScoreLine = document.querySelector(".ilb-score-line")!.textContent;

      const savedPayload = scorm.saveSuspendData.mock.calls.at(-1)![0];
      document.body.innerHTML = '<div id="root"></div>';
      const scorm2 = createScormMock(savedPayload);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm2 as unknown as ScormSession;

      mountCaseWorkspace(root(), richConfig);
      expect(h2().textContent).toBe("Equipment failure");
      expect(document.querySelector(".ilb-score-line")!.textContent).toBe(originalScoreLine);
      expect(scorm2.setScore).toHaveBeenCalledWith(100);
      expect(scorm2.setCompleted).toHaveBeenCalledTimes(1);
    });

    it("salvages best score and completion from a payload that fails full restore (stale artifact id) but carries well-formed b/c", () => {
      const scorm = createScormMock({
        v: 1, cf: [["not-a-real-artifact", "strong"]], rv: [], sel: [], b: 100, c: true, step: "workspace",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ILBScorm = scorm as unknown as ScormSession;

      mountCaseWorkspace(root(), richConfig);
      expect(scorm.setScore).toHaveBeenCalledWith(100);
      expect(scorm.setCompleted).toHaveBeenCalledTimes(1);
      // Positionally fresh: back at the brief step, not stuck on the stale payload.
      expect(h2().textContent).toBe("The Equipment Failure Case");
    });
  });
});
