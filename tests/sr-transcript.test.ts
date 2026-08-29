// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { mountSandbox } from "@/engine-runtime/param-sandbox/main";
import { starterConfig, STARTERS } from "@/lib/engines/param-sandbox/starter-configs";
import { toRuntimeConfig } from "@/lib/engines/param-sandbox/runtime-config";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { readingOrderTranscript, focusOrderTranscript, liveRegionsOf } from "@/lib/a11y/transcript";

/**
 * Screen-reader announcement contract for the Parameter Sandbox runtime.
 *
 * Doctrine: for conformant markup, what a screen reader announces is
 * spec-determined (accname computation, ARIA/HTML-AAM role mapping,
 * live-region processing) -- not something that needs a human at NVDA to
 * discover by trial. These tests lock the exact announcements the buoyancy
 * starter produces via src/lib/a11y/transcript.ts, so any future change to
 * the runtime's markup that alters what a screen reader user hears shows up
 * as a failing assertion with the exact before/after text, not a silent
 * regression only caught (or missed) in a manual pass.
 *
 * Every expected literal below was captured from this exact config's real,
 * mounted DOM (see the module doc comment on transcript.ts for the
 * categories covered) and is now the frozen expectation.
 */

function mountBuoyancy(): HTMLElement {
  document.body.innerHTML = '<div id="root"></div>';
  const config = starterConfig("buoyancy", "Buoyancy Explorer");
  const runtimeConfig = toRuntimeConfig(config, (id) => `assets/${id}.png`);
  const root = document.getElementById("root")!;
  mountSandbox(root, runtimeConfig);
  return root;
}

describe("screen-reader announcement contract (buoyancy starter)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("1. focus-order transcript (the contract)", () => {
    it("matches the exact expected sequence a screen-reader user tabbing through the sandbox hears", () => {
      const root = mountBuoyancy();
      expect(focusOrderTranscript(root)).toEqual([
        { role: "slider", name: "Object mass (kg)", value: "5" },
        { role: "spinbutton", name: "Object mass, exact value", value: "5" },
        { role: "combobox", name: "Fluid (kg/m3)", value: "Fresh water" },
      ]);
    });
  });

  describe("2. reading-order transcript", () => {
    it("matches the exact expected sequence, in DOM order, that browse-mode reading produces", () => {
      vi.useFakeTimers();
      const root = mountBuoyancy();
      // Settle the debounced outputs summary so its text reflects the
      // default values before snapshotting.
      vi.advanceTimersByTime(500);

      expect(readingOrderTranscript(root)).toEqual([
        { role: "heading level 2", name: "Buoyancy Explorer" },
        { role: "slider", name: "Object mass (kg)", value: "5" },
        { role: "spinbutton", name: "Object mass, exact value", value: "5" },
        { role: "combobox", name: "Fluid (kg/m3)", value: "Fresh water" },
        { role: "status", name: "Displaced volume: 5. Weight (gravity): 49.1", live: "polite" },
        // jsdom has no real <canvas> 2D context (no `canvas` npm package
        // installed), so drawChart's `ctx` is null and it returns before
        // ever setting the dynamic aria-label -- the chart keeps the static
        // label main.ts gives it at creation. In a real browser this
        // becomes the dynamic "Volume vs mass chart: x from ... y from ...,
        // current point (...)" label; that variant is exercised by the
        // generated NVDA script instead (docs/a11y/nvda-check-param-
        // sandbox.md), which is meant to run in a real browser + NVDA.
        { role: "img", name: "Volume vs mass chart" },
        { role: "heading level 2", name: "Challenges" },
        {
          role: "text",
          name: "Score: 0% — 0 of 1 challenges met. (preview — grades record only in the course)",
          live: "polite",
        },
        { role: "text", name: "Not met yet Displace more than 6 litres of fluid.", live: "polite" },
      ]);
    });
  });

  describe("3. live-region contract", () => {
    it("exposes exactly two live regions, with the spec-determined politeness/atomicity for each", () => {
      vi.useFakeTimers();
      const root = mountBuoyancy();
      vi.advanceTimersByTime(500);

      const regions = liveRegionsOf(root);
      expect(regions).toEqual([
        // role="status" (the outputs summary): WAI-ARIA's implicit default
        // for role="status" is aria-atomic="true", even though main.ts
        // never sets aria-atomic explicitly.
        { politeness: "polite", atomic: true, text: "Displaced volume: 5. Weight (gravity): 49.1" },
        // The challenges panel: aria-live="polite" with no role -- no
        // implicit atomic default applies, so it's false.
        {
          politeness: "polite",
          atomic: false,
          text: "Challenges Score: 0% — 0 of 1 challenges met. (preview — grades record only in the course) Not met yet Displace more than 6 litres of fluid.",
        },
      ]);
    });

    it("debounces the outputs summary but updates the challenges region immediately on the same input", () => {
      vi.useFakeTimers();
      const root = mountBuoyancy();
      vi.advanceTimersByTime(500);
      const [outputsBefore, challengesBefore] = liveRegionsOf(root);

      const slider = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      slider.value = "8"; // volume=8 (meets the >=6 challenge), force=78.48->78.5
      slider.dispatchEvent(new Event("input", { bubbles: true }));

      // Immediately (before the 500ms debounce fires): the outputs summary
      // must NOT have changed yet, but the challenges region (score status +
      // challenge-met text) updates synchronously, in the same tick.
      const [outputsImmediate, challengesImmediate] = liveRegionsOf(root);
      expect(outputsImmediate.text).toBe(outputsBefore.text);
      expect(outputsImmediate.text).not.toBe("Displaced volume: 8. Weight (gravity): 78.5");
      expect(challengesImmediate.text).not.toBe(challengesBefore.text);
      expect(challengesImmediate.text).toBe(
        "Challenges Score: 100% — 1 of 1 challenges met. Lesson complete. (preview — grades record only in the course) Met Displace more than 6 litres of fluid.",
      );

      // After the debounce settles: the outputs summary catches up to the
      // new values; the challenges region text is unchanged from the
      // immediate update above (no double-announcement).
      vi.advanceTimersByTime(500);
      const [outputsSettled, challengesSettled] = liveRegionsOf(root);
      expect(outputsSettled.text).toBe("Displaced volume: 8. Weight (gravity): 78.5");
      expect(challengesSettled.text).toBe(challengesImmediate.text);
    });

    it("never mutates a live region's text when a re-render produces identical values (churn guard)", () => {
      vi.useFakeTimers();
      const root = mountBuoyancy();
      vi.advanceTimersByTime(500);

      const outputsNode = root.querySelector('[role="status"]')!;
      const challengesNode = root.querySelector(".ilb-challenges")!;
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const r of records) mutations.push(`${(r.target as Element).nodeName ?? r.target.nodeType}:${r.type}`);
      });
      observer.observe(outputsNode, { characterData: true, childList: true, subtree: true });
      observer.observe(challengesNode, { characterData: true, childList: true, subtree: true });

      const slider = document.querySelector('input[type="range"][data-input="mass"]') as HTMLInputElement;
      // Re-fire "input" with the SAME value already committed (5) -- render()
      // runs again but every computed output/challenge/score text is
      // byte-identical to what's already in the DOM.
      slider.value = "5";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(500);

      expect(observer.takeRecords().length + mutations.length).toBe(0);
      observer.disconnect();
    });
  });

  describe("4. aria-hidden and decorative content are excluded from the transcript", () => {
    it("excludes the challenge row's aria-hidden glyph mark", () => {
      const root = mountBuoyancy();
      const mark = root.querySelector(".ilb-challenge-mark")!;
      expect(mark.getAttribute("aria-hidden")).toBe("true");

      // The mark carries no text of its own, but assert structurally too:
      // the only entry contributed by the challenge row is the single
      // "text" carrier for the row itself (locked in test group 2 above),
      // not a second entry for the mark.
      const textEntries = readingOrderTranscript(root).filter((e) => e.role === "text");
      expect(textEntries).toHaveLength(2); // score-status + one challenge row
    });

    it("excludes a decorative stage background image and a decorative transform-overlay image (both alt=\"\")", () => {
      document.body.innerHTML = '<div id="root"></div>';
      const config: RuntimeSandboxConfig = {
        title: "Visual test",
        inputs: [{ id: "x", label: "X", type: "slider", min: 0, max: 20, step: 1, defaultValue: 5 }],
        outputs: [{ id: "y", label: "Y", formula: "x * 2" }],
        charts: [],
        challenges: [],
        visual: {
          backgroundUrl: "beaker.png",
          overlays: [
            {
              id: "obj", type: "transform", outputId: "y", box: { x: 10, y: 10, w: 20, h: 20 },
              url: "obj.png", property: "opacity", inMin: 0, inMax: 40, outMin: 0, outMax: 1,
            },
          ],
        },
      };
      const root = document.getElementById("root")!;
      mountSandbox(root, config);

      const decorativeImgs = root.querySelectorAll('img[alt=""]');
      expect(decorativeImgs.length).toBeGreaterThanOrEqual(2); // stage bg + overlay img

      const entries = readingOrderTranscript(root);
      expect(entries.some((e) => e.role === "img")).toBe(false); // no chart in this config, no role=img anywhere
      // No entry at all for either decorative image, or for the stage's
      // plain overlay <div> holder -- only the heading, the slider + its
      // paired spinbutton, the (not-yet-settled, still empty) outputs
      // summary, and the exploration-lesson score-status text.
      expect(entries).toEqual([
        { role: "heading level 2", name: "Visual test" },
        { role: "slider", name: "X", value: "5" },
        { role: "spinbutton", name: "X, exact value", value: "5" },
        { role: "status", name: "", live: "polite" },
        {
          role: "text",
          name: "Exploration lesson — interacting records a score of 100%. (preview — grades record only in the course)",
        },
      ]);
    });
  });
});

/**
 * Generalized smoke coverage (Task 3, spec §6): the buoyancy-specific
 * contract above stays locked exactly as it is. This loop instead runs
 * every param-sandbox starter (present and future -- e.g. the exemplar
 * library's later additions) through the transcript functions just enough
 * to catch a thrown "unmapped focusable element" error or a live-region
 * count that violates the engine's own contract, without pinning exact
 * transcript text per starter.
 */
describe("screen-reader smoke coverage (all param-sandbox starters)", () => {
  it("readingOrderTranscript/focusOrderTranscript never throw, and liveRegionsOf matches the challenges-panel rule, for every starter", () => {
    for (const id of Object.keys(STARTERS)) {
      document.body.innerHTML = '<div id="root"></div>';
      const config = starterConfig(id, `Starter check: ${id}`);
      const runtimeConfig = toRuntimeConfig(config, (assetId) => `assets/${assetId}.png`);
      const root = document.getElementById("root")!;
      mountSandbox(root, runtimeConfig);

      expect(() => readingOrderTranscript(root), `starter "${id}"`).not.toThrow();
      expect(() => focusOrderTranscript(root), `starter "${id}"`).not.toThrow();

      // Live-region contract (see main.ts's mountSandbox): the outputs
      // summary status is always rendered (one region); the challenges
      // panel adds a second region only when the starter has at least one
      // challenge.
      const expectedCount = config.challenges.length > 0 ? 2 : 1;
      expect(liveRegionsOf(root), `starter "${id}"`).toHaveLength(expectedCount);
    }
  });
});
