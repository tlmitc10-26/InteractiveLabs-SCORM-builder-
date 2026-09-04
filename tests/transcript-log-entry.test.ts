// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readingOrderTranscript } from "@/lib/a11y/transcript";

/**
 * Unit contract for the transcript instrument's "ilb-log-entry" carrier
 * (spec docs/superpowers/specs/2026-09-04-process-simulator-design.md §3
 * review #20; transcript.ts's TEXT_CARRIER_CLASSES doc comment) — the
 * process-simulator runtime's situation log, added to TEXT_CARRIER_CLASSES
 * as its own commit ahead of the runtime that will render it (Task 3).
 *
 * Deliberately PER-ENTRY, not per-list: every other list-shaped carrier in
 * this module (ilb-debrief-list, ilb-comparison-list, ilb-reason-review-
 * list) tracks the WHOLE list as one TranscriptEntry. The situation log
 * instead puts the carrier class on each `<li>`, so a locked transcript
 * fixture stays legible and stable as the log grows across a run (a new
 * entry appended mid-procedure adds ONE new transcript entry rather than
 * rewriting a single ever-growing whole-list entry). This file exercises
 * the instrument directly against hand-built fragments (no full engine
 * mount, matching tests/transcript-radio.test.ts's approach), independent
 * of the runtime that will eventually render this markup.
 */

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root")!;
}

describe("transcript instrument: ilb-log-entry carrier", () => {
  it("reports each log <li> as its OWN TranscriptEntry (role \"text\", name = its visible text)", () => {
    const root = mount(`
      <h3>Situation</h3>
      <p>Opening text.</p>
      <ul>
        <li class="ilb-log-entry">The item's position is recorded before anything moves.</li>
      </ul>
    `);
    const entries = readingOrderTranscript(root);
    expect(entries).toEqual([
      { role: "heading level 3", name: "Situation" },
      { role: "text", name: "The item's position is recorded before anything moves." },
    ]);
  });

  it("is PER-ENTRY, not per-list: N <li class=\"ilb-log-entry\"> produce N separate entries, unlike the whole-list carriers", () => {
    const root = mount(`
      <ul>
        <li class="ilb-log-entry">First outcome.</li>
        <li class="ilb-log-entry">Second outcome.</li>
        <li class="ilb-log-entry">Third outcome.</li>
      </ul>
    `);
    const entries = readingOrderTranscript(root);
    expect(entries).toEqual([
      { role: "text", name: "First outcome." },
      { role: "text", name: "Second outcome." },
      { role: "text", name: "Third outcome." },
    ]);
  });

  it("appending one new entry to a growing log adds exactly one new transcript entry, leaving earlier entries' text unchanged", () => {
    const root = mount(`<ul><li class="ilb-log-entry">First outcome.</li></ul>`);
    const before = readingOrderTranscript(root);
    expect(before).toEqual([{ role: "text", name: "First outcome." }]);

    root.querySelector("ul")!.insertAdjacentHTML("beforeend", `<li class="ilb-log-entry">Second outcome.</li>`);
    const after = readingOrderTranscript(root);
    expect(after).toEqual([
      { role: "text", name: "First outcome." },
      { role: "text", name: "Second outcome." },
    ]);
  });

  it("includes a visually-hidden \"Latest:\" prefix in the newest entry's text (non-color-only emphasis, spec §3 reviews #25/1.4.1)", () => {
    // The "Latest:" prefix is visually hidden via CSS (e.g. clip/sr-only),
    // NOT aria-hidden -- an aria-hidden prefix would be invisible to this
    // instrument too, defeating the point of an sr-only announcement.
    const root = mount(`
      <ul>
        <li class="ilb-log-entry">First outcome.</li>
        <li class="ilb-log-entry"><span class="sr-only">Latest: </span>Second outcome.</li>
      </ul>
    `);
    const entries = readingOrderTranscript(root);
    expect(entries[1].name).toBe("Latest: Second outcome.");
  });

  it("a log entry inside a live region reports its politeness, exactly like every other text carrier", () => {
    const root = mount(`
      <ul aria-live="polite">
        <li class="ilb-log-entry">Outcome under a live ancestor.</li>
      </ul>
    `);
    const entries = readingOrderTranscript(root);
    expect(entries).toEqual([{ role: "text", name: "Outcome under a live ancestor.", live: "polite" }]);
  });

  it("an aria-hidden log entry is skipped entirely, matching every other carrier's aria-hidden contract", () => {
    const root = mount(`
      <ul>
        <li class="ilb-log-entry">Visible outcome.</li>
        <li class="ilb-log-entry" aria-hidden="true">Hidden outcome.</li>
      </ul>
    `);
    const entries = readingOrderTranscript(root);
    expect(entries).toEqual([{ role: "text", name: "Visible outcome." }]);
  });
});
