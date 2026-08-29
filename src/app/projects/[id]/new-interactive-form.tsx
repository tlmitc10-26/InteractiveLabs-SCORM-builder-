"use client";

// Engine + starter picker for the "New interactive" form (Task 8). A client
// component because the starter <select>'s options must update reactively
// as the designer switches engines — the surrounding page stays a server
// component and hands this the engines/starters metadata as serializable
// props (sourced from dispatch.ts's ENGINE_ADAPTERS, so this file never
// needs its own per-engine knowledge).
//
// Submits straight to the `createInteractive` server action (imported here,
// same as any other client-importable server action) via the form's
// `action`. `createInteractive` re-validates the engine/starter pair
// server-side and falls back to a safe default on anything unrecognized
// (see src/app/actions.ts), so this component only needs to get the common
// case right, not defend against a tampered POST.
//
// The engine choice is a real radio group (`<input type="radio"
// name="engine">` inside a `<fieldset>`/`<legend>`), not a styled
// non-native control — arrow-key navigation between engines and Tab
// in/out of the group come from the browser for free, and the checked
// state is exposed to assistive tech by the input itself (no extra aria
// wiring needed here).

import { useId, useState } from "react";
import { createInteractive } from "@/app/actions";

export type StarterMetaProp = { id: string; label: string; description: string; group: "blank" | "exemplar" };
export type EngineMetaProp = { id: string; label: string; blurb: string; starters: StarterMetaProp[] };

export function NewInteractiveForm({ projectId, engines }: { projectId: string; engines: EngineMetaProp[] }) {
  const [engineId, setEngineId] = useState(engines[0]?.id ?? "");
  const engine = engines.find((e) => e.id === engineId) ?? engines[0];
  const [starterId, setStarterId] = useState(engine?.starters[0]?.id ?? "");
  const starterSelectId = useId();
  const starterDescriptionId = useId();
  const selectedStarter = engine?.starters.find((s) => s.id === starterId);

  function handleEngineChange(id: string) {
    setEngineId(id);
    // Reset the starter selection to the newly-chosen engine's first
    // (default) starter — the previously-selected starter id almost
    // certainly doesn't exist for the other engine.
    const next = engines.find((e) => e.id === id);
    setStarterId(next?.starters[0]?.id ?? "");
  }

  if (!engine) return null;

  return (
    <form action={createInteractive} className="mt-2 space-y-3">
      <input type="hidden" name="projectId" value={projectId} />

      {/* Explicit mb-3: the parent's space-y utility proved unreliable here
          (measured 0px gap), and the title input's focus ring painted over
          the engine card above it without real spacing. */}
      <fieldset className="m-0 mb-3 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold text-gray-700">Interactive type</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {engines.map((e) => {
            const checked = e.id === engineId;
            return (
              <label key={e.id} className={`rds-engine-card${checked ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name="engine"
                  value={e.id}
                  checked={checked}
                  onChange={() => handleEngineChange(e.id)}
                  className="rds-engine-radio mt-0.5 shrink-0"
                />
                <span>
                  <span className="block font-medium">{e.label}</span>
                  <span className="block text-xs text-gray-600">{e.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input name="title" placeholder={`New ${engine.label} title`} maxLength={200}
          className="flex-1 rounded border border-gray-300 px-3 py-2" />
        <label htmlFor={starterSelectId} className="sr-only">Starter template</label>
        <select id={starterSelectId} name="starter" value={starterId} onChange={(e) => setStarterId(e.target.value)}
          aria-describedby={starterDescriptionId}
          className="rounded border border-gray-300 px-3 py-2 text-sm">
          <optgroup label="Start blank">
            {engine.starters.filter((s) => s.group === "blank").map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </optgroup>
          <optgroup label="Exemplars">
            {engine.starters.filter((s) => s.group === "exemplar").map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </optgroup>
        </select>
        <button className="btn btn-primary">New {engine.label}</button>
      </div>
      {/* Visible text (not a hover-only title tooltip -- the WCAG gap this
          replaces) describing whichever starter is currently selected.
          aria-describedby above wires it to the select itself, so a screen
          reader announces it right after the select's name/value, and
          changing the selection with the keyboard updates this text live
          since it's plain rendered content, not something needing its own
          live region. */}
      {selectedStarter && (
        <p id={starterDescriptionId} className="text-xs text-gray-600">{selectedStarter.description}</p>
      )}
    </form>
  );
}
