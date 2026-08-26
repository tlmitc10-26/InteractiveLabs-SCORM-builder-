// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import axe from "axe-core";
import { mountSandbox } from "@/engine-runtime/param-sandbox/main";
import { starterConfig } from "@/lib/engines/param-sandbox/starter-configs";
import { toRuntimeConfig } from "@/lib/engines/param-sandbox/runtime-config";
import { sandboxConfigSchema, type SandboxConfig } from "@/lib/engines/param-sandbox/schema";

/** Renders every violation (id, impact, help, and each offending node's
 *  outerHTML) so a failure tells you exactly what to fix without re-running
 *  axe locally. */
function describeViolations(violations: axe.Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `    - ${n.html}`).join("\n");
      return `[${v.id}] impact=${v.impact} — ${v.help}\n${nodes}`;
    })
    .join("\n\n");
}

// color-contrast is disabled below: axe measures it from jsdom's computed
// layout/paint, which doesn't exist in this environment (no real rendering,
// so background/foreground colors resolve unreliably). Our own math
// (src/lib/design/contrast.ts) verifies every fill-overlay color against the
// stage background at both authoring time (live badge) and validation time
// (export-blocking), which is the real guarantee for this rule.
const AXE_OPTIONS: Parameters<typeof axe.run>[1] = {
  rules: { "color-contrast": { enabled: false } },
};

async function auditBody() {
  const results = await axe.run(document.body, AXE_OPTIONS);
  if (results.violations.length > 0) {
    throw new Error(`axe found ${results.violations.length} violation(s):\n\n${describeViolations(results.violations)}`);
  }
  return results;
}

describe("axe-core accessibility gate", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("has zero violations for the buoyancy starter's runtime config", async () => {
    const config = starterConfig("buoyancy", "Buoyancy Explorer");
    const runtimeConfig = toRuntimeConfig(config, (id) => `assets/${id}.png`);
    mountSandbox(document.getElementById("root")!, runtimeConfig);

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });

  it("has zero violations for a config with a fill overlay and a chart", async () => {
    const config: SandboxConfig = sandboxConfigSchema.parse({
      title: "Visual scene demo",
      intro: "<p>Watch the tank fill as you increase the flow rate.</p>",
      inputs: [
        { id: "flow", label: "Flow rate", type: "slider", min: 0, max: 10, step: 0.5, defaultValue: 3, units: "L/min" },
      ],
      outputs: [
        { id: "level", label: "Tank level", formula: "flow * 8", units: "%", decimals: 0 },
      ],
      charts: [
        { id: "level_chart", title: "Level vs flow", xInputId: "flow", yOutputId: "level", samples: 20 },
      ],
      challenges: [
        { id: "fill80", prompt: "Fill the tank past 80%.", outputId: "level", comparator: "gte", value: 80 },
      ],
      visual: {
        // No backgroundAssetId: the fill color is checked against the stage
        // background, so it must clear the 3:1 non-text contrast gate
        // (primary/#8c1d40 on light-1/#fafafa is ~8.8:1 — well clear).
        overlays: [
          { id: "tank", type: "fill", outputId: "level", inMin: 0, inMax: 100, color: { token: "primary" }, box: { x: 10, y: 10, w: 30, h: 80 } },
        ],
      },
    });
    const runtimeConfig = toRuntimeConfig(config, (id) => `assets/${id}.png`);
    mountSandbox(document.getElementById("root")!, runtimeConfig);

    const results = await auditBody();
    expect(results.violations).toEqual([]);
  });
});
