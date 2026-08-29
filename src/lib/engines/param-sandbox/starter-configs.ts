import { sandboxConfigSchema, type SandboxConfig } from "./schema";

/**
 * Starter templates offered on the "New interactive" form. Each entry's
 * `config` is parsed through `sandboxConfigSchema` at module load time so an
 * invalid starter fails immediately (a test asserts this — see
 * tests/starter-configs.test.ts) rather than surfacing as a runtime bug the
 * first time someone picks it.
 *
 * `config.title` here is a placeholder ("") — the real title always comes
 * from the "New interactive" form, never from the starter. Callers should go
 * through `starterConfig(starterId, title)` below rather than reading
 * `STARTERS[id].config` directly, so the title is always the one the
 * designer actually typed.
 */
export const STARTERS: Record<string, { label: string; description: string; group: "blank" | "exemplar"; config: SandboxConfig }> = {
  blank: {
    label: "Blank",
    description: "A single slider driving a single calculated result — start from scratch.",
    group: "blank",
    config: sandboxConfigSchema.parse({
      title: "",
      inputs: [
        { id: "value", label: "Value", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
      ],
      outputs: [
        { id: "result", label: "Result", formula: "value * 2" },
      ],
      charts: [],
      challenges: [],
    }),
  },
  buoyancy: {
    label: "Buoyancy Explorer (Archimedes)",
    description: "Sliders drive formulas, charts, and challenges.",
    group: "exemplar",
    config: sandboxConfigSchema.parse({
      title: "",
      intro: "<p>Drop an object into a fluid and see how much it displaces, and how hard the fluid pushes back.</p>",
      inputs: [
        { id: "mass", label: "Object mass", type: "slider", min: 0.5, max: 20, step: 0.5, defaultValue: 5, units: "kg" },
        {
          id: "density", label: "Fluid", type: "select", defaultValue: 1000, units: "kg/m3",
          options: [
            { label: "Fresh water", value: 1000 },
            { label: "Vegetable oil", value: 920 },
            { label: "Seawater", value: 1025 },
            { label: "Glycerin", value: 1260 },
          ],
        },
      ],
      outputs: [
        { id: "volume", label: "Displaced volume", formula: "mass / density * 1000", units: "L", decimals: 2 },
        { id: "force", label: "Weight (gravity)", formula: "mass * 9.81", units: "N", decimals: 1 },
      ],
      charts: [
        { id: "volume_chart", title: "Volume vs mass", xInputId: "mass", yOutputId: "volume", samples: 40 },
      ],
      challenges: [
        { id: "displace6", prompt: "Displace more than 6 litres of fluid.", outputId: "volume", comparator: "gte", value: 6 },
      ],
    }),
  },
};

export const DEFAULT_STARTER_ID = "blank";

/** Builds a fresh, title-stamped config for the given starter id. Unknown
 *  ids fall back to the blank starter (mirrors the FormData default in
 *  `createInteractive`) rather than throwing, since this can be reached with
 *  attacker-controlled input. Re-parses through the schema so the result is
 *  a genuinely fresh object tree (no shared references back into
 *  `STARTERS`), not just a shallow spread. */
export function starterConfig(starterId: string, title: string): SandboxConfig {
  const starter = STARTERS[starterId] ?? STARTERS[DEFAULT_STARTER_ID];
  return sandboxConfigSchema.parse({ ...starter.config, title });
}
