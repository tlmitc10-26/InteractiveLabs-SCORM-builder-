// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { computeAccessibleName } from "dom-accessibility-api";
import { ImportPanel } from "@/app/interactives/[id]/editor-shared";
import type { ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";

// React warns "the current testing environment is not configured to support
// act(...)" unless this global is set -- normally set up by a testing-
// library adapter, which this repo doesn't have (see file doc comment).
// Setting it directly is the documented workaround for a bare react-dom
// harness; it only affects this file's own test worker.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom smoke coverage for ImportPanel's a11y contract (Task 3 review gap:
 * the shared panel extracted in Task 2 had no component-level test of its
 * own, only the engine-specific editors that render it). ImportPanel is
 * engine-agnostic (generic over TConfig, parameterized by parse/serialize),
 * so a minimal stub config/parse exercises exactly the same rendered markup
 * both editors use.
 *
 * No React Testing Library in this repo's devDependencies -- the existing
 * component-test precedent (tests/stage-authoring.test.ts) mounts via
 * react-dom/client's createRoot + React's act() and drives/queries the raw
 * DOM directly. This file follows that same pattern rather than introducing
 * a new one.
 */

type StubConfig = { title: string };

function stubParse(report: ImportIssue[]): (text: string) => { config: unknown; report: ImportIssue[] } {
  return () => ({ config: { title: "Imported" }, report });
}

describe("ImportPanel (shared, engine-agnostic) a11y contract", () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // handleImportClick gates the apply on window.confirm(confirmText) --
    // stub it to accept, matching a user who confirms the replace-warning.
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    confirmSpy.mockRestore();
  });

  function renderPanel(report: ImportIssue[]) {
    const onApply = vi.fn();
    act(() => {
      root.render(createElement(ImportPanel<StubConfig>, {
        config: { title: "Current draft" },
        parse: stubParse(report),
        serialize: () => "",
        templateHref: "/template.txt",
        confirmText: "Replace the current draft?",
        onApply,
      }));
    });
    return { onApply };
  }

  /** Opens the <details> disclosure (the panel's contents are collapsed
   *  behind a <summary> by default), types non-empty text into the paste
   *  textarea, and clicks Import -- the same path a real user takes before
   *  a report can appear at all. */
  function performImport() {
    const summary = container.querySelector("summary")!;
    act(() => { summary.click(); });

    const textarea = container.querySelector("textarea")!;
    // React installs its own per-instance "value" setter on a controlled
    // field's DOM node to keep an internal value tracker in sync, so a
    // plain `textarea.value = "..."` assignment updates that tracker too --
    // by the time the "input" event dispatches, React's own
    // updateValueIfChanged sees no difference from the tracked value and
    // never fires onChange. Going through the NATIVE prototype setter
    // (bypassing React's override) leaves the tracker stale, so the
    // dispatched event is correctly recognized as a real change. Standard
    // React-testing workaround; not needed for the plain-DOM vanilla
    // runtimes elsewhere in this repo's tests (e.g. axe.test.ts's slider),
    // which have no React value tracker to fight.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      nativeSetter.call(textarea, "TITLE: Test\n");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const importBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Import")!;
    act(() => { importBtn.click(); });
  }

  it("gives the paste-a-companion-doc textarea a real accessible label (not just placeholder/title text)", () => {
    renderPanel([]);
    const summary = container.querySelector("summary")!;
    act(() => { summary.click(); }); // <details> starts collapsed; the textarea only exists once open
    const textarea = container.querySelector("textarea")!;
    expect(computeAccessibleName(textarea)).toBe("Paste a companion doc");
  });

  it("moves focus to the import report's h3 heading after a successful import", () => {
    renderPanel([]);
    performImport();

    const heading = container.querySelector("h3")!;
    expect(heading.textContent).toBe("Import report");
    expect(document.activeElement).toBe(heading);
  });

  it("lists every report issue together with its line number", () => {
    const report: ImportIssue[] = [
      { line: 3, severity: "error", message: "unknown directive" },
      { line: 7, severity: "warning", message: "samples defaulted to 40" },
    ];
    renderPanel(report);
    performImport();

    const items = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual([
      "Line 3: unknown directive",
      "Line 7: samples defaulted to 40",
    ]);
  });

  it("confirms the replace warning and hands the parsed config to onApply", () => {
    const { onApply } = renderPanel([]);
    performImport();

    expect(confirmSpy).toHaveBeenCalledWith("Replace the current draft?");
    expect(onApply).toHaveBeenCalledWith({ title: "Imported" });
  });
});
