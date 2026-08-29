// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountBranchingScenario } from "@/engine-runtime/branching-scenario/main";
import { branchingStarterConfig, BRANCHING_STARTERS } from "@/lib/engines/branching-scenario/starters";
import { toBranchingRuntimeConfig, type RuntimeBranchingConfig } from "@/lib/engines/branching-scenario/runtime-config";
import { readingOrderTranscript, focusOrderTranscript, liveRegionsOf } from "@/lib/a11y/transcript";

/**
 * Screen-reader announcement contract for the Branching Scenario runtime.
 *
 * Same doctrine as tests/sr-transcript.test.ts (see that file's doc comment
 * and src/lib/a11y/transcript.ts's module doc comment): for conformant
 * markup, what a screen reader announces is spec-determined, so it is locked
 * here as an explicit, human-legible contract rather than left to a manual
 * NVDA pass to discover. Every literal below was captured from this exact
 * config's real, mounted DOM.
 *
 * This engine adds two mapping needs transcript.ts did not previously cover
 * (see that file's changes alongside this test): a plain-content <img> with
 * no explicit role (HTML-AAM gives it an implicit "img" role) for the
 * scene's informative image, and three new plain-text "carrier" elements
 * (the juror-role line, the ending's score-summary line, and the debrief's
 * whole path list, tracked as one entry rather than per list item -- see
 * the plan's "keep scope minimal" guidance and the TEXT_CARRIER_CLASSES doc
 * comment). Locking the debrief-list entry here also caught and fixed a
 * real bug in `visibleText`'s whitespace handling (see transcript.ts's
 * `visibleTextRaw` doc comment): the two adjacent inline
 * `<span class="ilb-debrief-scene">`/`<span class="ilb-debrief-choice">`
 * elements were being concatenated with their shared boundary space eaten
 * by a per-recursion-level trim, producing a spurious "Vote:Raise" run-on
 * that a real screen reader -- reading the actual, unmodified DOM text --
 * would never actually produce.
 */

function mountJury(): HTMLElement {
  document.body.innerHTML = '<div id="root"></div>';
  const config = branchingStarterConfig("jury", "Jury Deliberation");
  const runtimeConfig = toBranchingRuntimeConfig(config, (id) => `assets/${id}.png`);
  const root = document.getElementById("root")!;
  mountBranchingScenario(root, runtimeConfig);
  return root;
}

/** The visible label text of a choice button, EXCLUDING the aria-hidden A/B/C
 *  marker span the runtime prepends (visual pass, 2026-08-28) -- see
 *  main.ts's renderChoices doc comment. The accessible-name computation
 *  this file's transcript assertions rely on (computeAccessibleName, via
 *  focusOrderTranscript/readingOrderTranscript) already correctly skips
 *  aria-hidden content on its own; this helper exists only so the TEST
 *  DRIVER can find/click the right button by its plain label text too. */
function choiceLabelText(btn: Element): string | null {
  return btn.querySelector(".ilb-choice-label")?.textContent ?? null;
}

/** Clicks the choice button with exactly this visible label. Mirrors how a
 *  real pointer/keyboard-activation click reaches the runtime's click
 *  handler -- there is no lower-level "applyChoice" entry point exposed to
 *  callers outside the module, by design (see main.ts's stale-click-guard
 *  comment), so driving the DOM is the correct way to advance scenes here. */
function clickChoice(root: HTMLElement, label: string): void {
  const btn = Array.from(root.querySelectorAll<HTMLButtonElement>(".ilb-choice-btn")).find((b) => choiceLabelText(b) === label);
  if (!btn) throw new Error(`no visible choice button labeled "${label}"`);
  btn.click();
}

function oneSceneImageConfig(imageRole: "decorative" | "informative"): RuntimeBranchingConfig {
  return {
    title: "Image test",
    variables: [],
    scenes: [
      {
        id: "scene1",
        title: "Scene One",
        body: "<p>Body text.</p>",
        imageUrl: "courtroom.png",
        imageRole,
        ...(imageRole === "informative" ? { imageAlt: "A courtroom sketch" } : {}),
        choices: [{ id: "c1", label: "Choice one", quality: "best", effects: [], goTo: "ending:end1" }],
      },
    ],
    startSceneId: "scene1",
    endings: [{ id: "end1", title: "The End", body: "<p>Done.</p>" }],
    feedbackMode: "debrief",
    showPathInDebrief: true,
  };
}

/** Same shape as `oneSceneImageConfig("informative")`, PLUS a start-scene
 *  `role` line and an `intro` block -- the combination the review round
 *  after commit 4cb0827 asked to lock explicitly: a start scene can carry
 *  an informative header image AND a role line (and an intro) at once, and
 *  main.ts's renderScene must keep them in this exact order: header image,
 *  then role line, then intro, then the h2. */
function startSceneWithRoleAndImageConfig(): RuntimeBranchingConfig {
  return {
    title: "Role + image test",
    role: "You are a new hire.",
    intro: "<p>Welcome to week one.</p>",
    variables: [],
    scenes: [
      {
        id: "scene1",
        title: "Scene One",
        body: "<p>Body text.</p>",
        imageUrl: "orientation.png",
        imageRole: "informative",
        imageAlt: "An orientation packet on a desk",
        choices: [{ id: "c1", label: "Choice one", quality: "best", effects: [], goTo: "ending:end1" }],
      },
    ],
    startSceneId: "scene1",
    endings: [{ id: "end1", title: "The End", body: "<p>Done.</p>" }],
    feedbackMode: "debrief",
    showPathInDebrief: true,
  };
}

describe("screen-reader announcement contract (jury starter, branching scenario)", () => {
  describe("1. start-scene focus-order transcript (the contract)", () => {
    it("matches the exact expected sequence a screen-reader user tabbing through the start scene hears", () => {
      const root = mountJury();
      expect(focusOrderTranscript(root)).toEqual([
        { role: "button", name: "Raise your doubts about the timeline before anyone votes" },
        { role: "button", name: "Vote with the majority to keep things moving" },
        { role: "button", name: "Ask to re-examine the evidence list first" },
      ]);
    });
  });

  describe("2. start-scene reading order", () => {
    it("matches the exact expected sequence, in DOM order, that browse-mode reading produces", () => {
      const root = mountJury();
      expect(readingOrderTranscript(root)).toEqual([
        { role: "text", name: "You are a juror in a criminal trial." },
        { role: "heading level 2", name: "The First Vote" },
        { role: "status", name: "Jury trust: 50", live: "polite" },
        { role: "button", name: "Raise your doubts about the timeline before anyone votes" },
        { role: "button", name: "Vote with the majority to keep things moving" },
        { role: "button", name: "Ask to re-examine the evidence list first" },
      ]);
    });
  });

  describe("3. post-choice transcript and focus", () => {
    it("moves to the new scene's heading, buttons, and updated variable status, with focus on the new h2", () => {
      const root = mountJury();
      clickChoice(root, "Raise your doubts about the timeline before anyone votes");

      expect(readingOrderTranscript(root)).toEqual([
        { role: "heading level 2", name: "The Timeline" },
        { role: "status", name: "Jury trust: 60", live: "polite" },
        { role: "button", name: "Walk the group through the conflict step by step" },
        { role: "button", name: "Call it a clerical error and move on" },
      ]);

      // The focus-management contract (spec §6): every scene transition
      // moves focus to the new scene's h2, which is what makes a screen
      // reader announce "The Timeline, heading level 2" the instant the
      // transition completes, without the learner having to go find it.
      expect(document.activeElement?.tagName).toBe("H2");
      expect(document.activeElement?.textContent).toBe("The Timeline");
    });
  });

  describe("4. live-region inventory", () => {
    it("exposes exactly one polite, atomic live region (the variable status) in the start scene", () => {
      const root = mountJury();
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "Jury trust: 50" }]);
    });

    it("still exposes exactly one polite, atomic live region after a choice, with the updated value", () => {
      const root = mountJury();
      clickChoice(root, "Raise your doubts about the timeline before anyone votes");
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "Jury trust: 60" }]);
    });

    it("still exposes exactly one polite, atomic live region at the ending", () => {
      const root = mountJury();
      clickChoice(root, "Raise your doubts about the timeline before anyone votes"); // -> timeline, trust 60
      clickChoice(root, "Walk the group through the conflict step by step"); // -> holdout, trust 75
      clickChoice(root, "Ask them to explain what evidence would change their mind"); // -> ending, trust 85
      expect(liveRegionsOf(root)).toEqual([{ politeness: "polite", atomic: true, text: "Jury trust: 85" }]);
    });

    it("exposes ZERO live regions for a starter with no visible variables (the blank starter)", () => {
      document.body.innerHTML = '<div id="root"></div>';
      const config = branchingStarterConfig("blank", "Blank test");
      const runtimeConfig = toBranchingRuntimeConfig(config, (id) => `assets/${id}.png`);
      const root = document.getElementById("root")!;
      mountBranchingScenario(root, runtimeConfig);
      expect(liveRegionsOf(root)).toEqual([]);
    });
  });

  describe("5. ending / debrief reading order", () => {
    it("reads the ending heading, the score line, the updated variable status, Start over, and the path debrief", () => {
      const root = mountJury();
      // Play the best path all the way to an ending: first_vote -> speak_up
      // -> timeline -> walk_through -> holdout -> invite_reasons -> ending.
      clickChoice(root, "Raise your doubts about the timeline before anyone votes");
      clickChoice(root, "Walk the group through the conflict step by step");
      clickChoice(root, "Ask them to explain what evidence would change their mind");

      const entries = readingOrderTranscript(root);
      expect(entries).toEqual([
        // NEW (visual pass, 2026-08-28): the "Scenario complete" eyebrow —
        // the ONE deliberate new visible/announced text this pass adds (see
        // main.ts's renderEnding and transcript.ts's TEXT_CARRIER_CLASSES).
        { role: "text", name: "Scenario complete" },
        { role: "heading level 2", name: "A verdict the room can stand behind" },
        { role: "text", name: "Decisions: 3 best. Score: 100%." },
        { role: "status", name: "Jury trust: 85", live: "polite" },
        { role: "button", name: "Start over" },
        { role: "heading level 3", name: "Your path" },
        {
          role: "text",
          name:
            "The First Vote: Raise your doubts about the timeline before anyone votes ( Best choice) " +
            "Other options: Vote with the majority to keep things moving, Ask to re-examine the evidence list first. " +
            "Speaking up before the vote keeps the deliberation grounded in the evidence instead of the room's momentum. " +
            "The Timeline: Walk the group through the conflict step by step ( Best choice) " +
            "Other options: Call it a clerical error and move on. " +
            "Walking the room through the conflict turns a vague unease into a concrete point the jury can actually weigh. " +
            "The Holdout: Ask them to explain what evidence would change their mind ( Best choice) " +
            "Other options: Suggest the group proceed without their input, Call a break, since the room trusts you enough to reset. " +
            "Inviting the holdout to explain their reasoning keeps deliberation open instead of forcing a verdict past it.",
        },
      ]);

      // Quality TEXT is present in the transcript's debrief entry ...
      const debriefText = entries[entries.length - 1].name;
      expect(debriefText).toContain("Best choice");
      // ... but the paired aria-hidden glyph mark is not: it contributes no
      // text of its own to the transcript (visibleText skips aria-hidden
      // subtrees), and there is no separate transcript entry for it either.
      expect(debriefText).not.toContain("●");
      const glyphs = root.querySelectorAll(".ilb-debrief-quality > [aria-hidden]");
      expect(glyphs.length).toBe(3); // one per path step
      for (const g of Array.from(glyphs)) expect(g.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("6. image contract", () => {
    it("gives an informative scene image its own transcript entry with the authored alt text, BEFORE the heading (the image is now the scene's header — spec 2's 2026-08-28 header rule)", () => {
      document.body.innerHTML = '<div id="root"></div>';
      const root = document.getElementById("root")!;
      mountBranchingScenario(root, oneSceneImageConfig("informative"));
      // NEW ORDER (visual pass, 2026-08-28): an uploaded image is now the
      // scene's HEADER (Google-Forms model — spec 2), rendered above the
      // title/body rather than after them, so its transcript entry moves
      // ahead of the heading too. This is the pass's other deliberate
      // reading-order diff (alongside the ending eyebrow).
      expect(readingOrderTranscript(root)).toEqual([
        { role: "img", name: "A courtroom sketch" },
        { role: "heading level 2", name: "Scene One" },
        { role: "button", name: "Choice one" },
      ]);
    });

    it("omits a decorative scene image from the transcript entirely", () => {
      document.body.innerHTML = '<div id="root"></div>';
      const root = document.getElementById("root")!;
      mountBranchingScenario(root, oneSceneImageConfig("decorative"));
      const img = root.querySelector("img.ilb-scene-image")!;
      expect(img.getAttribute("alt")).toBe(""); // decorative: alt="" per the runtime's image-role contract
      expect(readingOrderTranscript(root)).toEqual([
        { role: "heading level 2", name: "Scene One" },
        { role: "button", name: "Choice one" },
      ]);
    });

    it("orders the header image ahead of the role line and heading when a start scene carries both an informative image AND a role line (locks the two reading-order diffs together, not just each alone)", () => {
      document.body.innerHTML = '<div id="root"></div>';
      const root = document.getElementById("root")!;
      mountBranchingScenario(root, startSceneWithRoleAndImageConfig());
      // Full DOM order per main.ts's renderScene: header image, role line,
      // intro, h2, body, choices. The intro paragraph sits between the role
      // line and the heading in the DOM but -- like the scene's own body
      // copy -- is plain prose with no tracked category of its own (see
      // transcript.ts's TEXT_CARRIER_CLASSES / categoryOf), so it
      // contributes zero transcript entries; only the img, role-line text,
      // heading, and button entries are asserted here.
      expect(readingOrderTranscript(root)).toEqual([
        { role: "img", name: "An orientation packet on a desk" },
        { role: "text", name: "You are a new hire." },
        { role: "heading level 2", name: "Scene One" },
        { role: "button", name: "Choice one" },
      ]);
    });
  });

  describe("7. the unknown-focusable throw still guards new/unmapped control shapes", () => {
    it("throws rather than silently mis-describing a focusable <a> with no href (a shape rich scene/ending body text could introduce)", () => {
      document.body.innerHTML = '<div id="root"></div>';
      const root = document.getElementById("root")!;
      const heading = document.createElement("h2");
      heading.textContent = "Probe";
      root.appendChild(heading);
      const anchor = document.createElement("a"); // no href -- not a real "link" per HTML-AAM
      anchor.textContent = "Not really a link";
      root.appendChild(anchor);

      expect(() => readingOrderTranscript(root)).toThrow(/unmapped focusable element <a> without href/);
    });
  });
});

/**
 * Generalized smoke coverage (Task 3, spec §6): the jury-specific contract
 * above (and the blank-starter zero-live-region case in section 4) stay
 * locked exactly as they are. This loop instead runs every branching-
 * scenario starter (present and future -- e.g. the exemplar library's later
 * additions) through the transcript functions just enough to catch a thrown
 * "unmapped focusable element" error or a live-region count that violates
 * the engine's own contract, without pinning exact transcript text per
 * starter.
 */
describe("screen-reader smoke coverage (all branching-scenario starters)", () => {
  it("readingOrderTranscript/focusOrderTranscript never throw, and liveRegionsOf matches the visible-variable rule, for every starter's start scene", () => {
    for (const id of Object.keys(BRANCHING_STARTERS)) {
      document.body.innerHTML = '<div id="root"></div>';
      const config = branchingStarterConfig(id, `Starter check: ${id}`);
      const runtimeConfig = toBranchingRuntimeConfig(config, (assetId) => `assets/${assetId}.png`);
      const root = document.getElementById("root")!;
      mountBranchingScenario(root, runtimeConfig);

      expect(() => readingOrderTranscript(root), `starter "${id}"`).not.toThrow();
      expect(() => focusOrderTranscript(root), `starter "${id}"`).not.toThrow();

      // Live-region contract: exactly one polite/atomic region (the
      // variable status) when at least one variable is visible; zero when
      // none are (see the blank-starter case in section 4 above).
      const hasVisibleVar = config.variables.some((v) => v.visible);
      expect(liveRegionsOf(root), `starter "${id}"`).toHaveLength(hasVisibleVar ? 1 : 0);
    }
  });
});
