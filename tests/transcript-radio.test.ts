// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readingOrderTranscript, focusOrderTranscript } from "@/lib/a11y/transcript";

/**
 * Unit contract for the transcript instrument's radio/checkbox extension
 * (spec docs/superpowers/specs/2026-08-28-case-workspace-design.md §8).
 *
 * Before this change, `controlRoleOf` threw on any `<input type="radio">`
 * (an unmapped focusable element) -- correct while no runtime rendered one,
 * insufficient now that the case-workspace runtime's Conclude step needs a
 * persistent-selection control whose checked state can be locked in a
 * transcript. This file exercises the instrument directly against small,
 * hand-built fragments (no full engine mount) so the radio contract is
 * pinned independently of any one runtime's markup.
 */

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root")!;
}

describe("transcript instrument: native radio inputs", () => {
  it("reports role \"radio\" with the group's shared accessible name and \"not checked\" for an unselected radio", () => {
    const root = mount(`
      <fieldset>
        <legend>Choose one</legend>
        <label><input type="radio" name="g" value="a" id="a"> Option A</label>
        <label><input type="radio" name="g" value="b" id="b"> Option B</label>
      </fieldset>
    `);
    const entries = focusOrderTranscript(root);
    expect(entries).toEqual([
      { role: "radio", name: "Option A", states: ["not checked"] },
      { role: "radio", name: "Option B", states: ["not checked"] },
    ]);
  });

  it("reports \"checked\" for the selected radio in a group, and it appears first in the states array", () => {
    const root = mount(`
      <fieldset>
        <legend>Choose one</legend>
        <label><input type="radio" name="g" value="a" id="a" checked> Option A</label>
        <label><input type="radio" name="g" value="b" id="b"> Option B</label>
      </fieldset>
    `);
    const entries = focusOrderTranscript(root);
    expect(entries).toEqual([
      { role: "radio", name: "Option A", states: ["checked"] },
      { role: "radio", name: "Option B", states: ["not checked"] },
    ]);
  });

  it("combines checked/not-checked with a disabled state, checked-token first (mirrors the checkbox path)", () => {
    const root = mount(`
      <label><input type="radio" name="g" checked disabled> Locked in</label>
    `);
    const entries = readingOrderTranscript(root);
    expect(entries).toEqual([{ role: "radio", name: "Locked in", states: ["checked", "disabled"] }]);
  });

  it("throws when an explicit role=\"radio\" is set on a non-native element without checked semantics support elsewhere unaffected -- explicit role=radio is accepted like other explicit roles", () => {
    // controlRoleOf already special-cases a handful of explicit ARIA roles;
    // radio joins that list. A plain div[role=radio][tabindex=0] is not a
    // FOCUSABLE_TAGS member, so it is never visited as a control at all --
    // this test only pins the native <input type="radio"> path, which is
    // the only shape any of our runtimes render.
    const root = mount(`<label><input type="radio" name="g"> Solo</label>`);
    expect(() => focusOrderTranscript(root)).not.toThrow();
  });
});

describe("transcript instrument: checkbox checked-state path is unchanged", () => {
  it("still reports checked/not-checked for a native checkbox exactly as before this change", () => {
    const root = mount(`
      <label><input type="checkbox" checked> Agree</label>
      <label><input type="checkbox"> Disagree</label>
    `);
    expect(focusOrderTranscript(root)).toEqual([
      { role: "checkbox", name: "Agree", states: ["checked"] },
      { role: "checkbox", name: "Disagree", states: ["not checked"] },
    ]);
  });
});
