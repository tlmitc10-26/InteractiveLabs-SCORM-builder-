import { describe, it, expect } from "vitest";
import { toProcessRuntimeConfig, collectProcessAssetIds, type ProcessRuntimeConfigLike } from "@/lib/engines/process-simulator/runtime-config";

// Structural fixture — deliberately NOT run through the zod schema
// (runtime-config.ts is a light module with zero zod dependency).
const base: ProcessRuntimeConfigLike = {
  title: "Sample Procedure",
  intro: "<p>Intro</p>",
  opening: "<p>Opening</p>",
  actions: [
    { id: "a1", label: "First", required: true, outcome: "<p>x</p>" },
    { id: "a2", label: "Second", required: false, consequence: "<p>x</p>", consequenceNote: "x" },
  ],
};

describe("toProcessRuntimeConfig — pass-through (no assets in v1)", () => {
  it("returns the config unchanged", () => {
    const runtime = toProcessRuntimeConfig(base, (id) => `/api/assets/${id}`);
    expect(runtime).toEqual(base);
  });

  it("passes through headerColor and expertNote when present", () => {
    const withExtras: ProcessRuntimeConfigLike = { ...base, headerColor: "info", expertNote: "<p>Expert note.</p>" };
    const runtime = toProcessRuntimeConfig(withExtras, (id) => id);
    expect(runtime.headerColor).toBe("info");
    expect(runtime.expertNote).toBe("<p>Expert note.</p>");
  });

  it("passes through action fields (requires, outcome, consequence, consequenceNote) unchanged", () => {
    const withRequires: ProcessRuntimeConfigLike = {
      ...base,
      actions: [base.actions[0], { ...base.actions[1], requires: undefined }],
    };
    const runtime = toProcessRuntimeConfig(withRequires, (id) => id);
    expect(runtime.actions).toEqual(withRequires.actions);
  });
});

describe("collectProcessAssetIds — always empty in v1", () => {
  it("returns an empty array regardless of config content", () => {
    expect(collectProcessAssetIds(base)).toEqual([]);
  });
});
