import { describe, it, expect } from "vitest";
import {
  toCaseRuntimeConfig,
  collectCaseAssetIds,
  type CaseWorkspaceConfigLike,
} from "@/lib/engines/case-workspace/runtime-config";

// Structural fixture — deliberately NOT run through the zod schema
// (runtime-config.ts is a light module with zero zod dependency; its input
// is CaseWorkspaceConfigLike, which a validated CaseConfig structurally
// satisfies, but tests here exercise the structural contract directly —
// mirrors tests/branching-state.test.ts's runtime-config describe block).
const base: CaseWorkspaceConfigLike = {
  title: "Sample Case",
  intro: "<p>Intro</p>",
  scoringMode: "best-supported",
  artifacts: [
    { id: "memo", title: "The Memo", kind: "text", body: "<p>Body.</p>" },
    { id: "log", title: "The Log", kind: "text", body: "<p>Body.</p>" },
  ],
  conclusions: [{ id: "c1" }],
  expertMap: [],
};

describe("toCaseRuntimeConfig / collectCaseAssetIds", () => {
  const withImages: CaseWorkspaceConfigLike = {
    ...base,
    artifacts: [
      { id: "photo1", title: "Photo 1", kind: "image", imageAssetId: "asset-1", imageRole: "decorative" },
      { id: "photo2", title: "Photo 2", kind: "image", imageAssetId: "asset-2", imageRole: "informative", imageAlt: "A description" },
    ],
  };

  it("replaces imageAssetId with imageUrl and drops imageAssetId", () => {
    const runtime = toCaseRuntimeConfig(withImages, (id) => `/api/assets/${id}`);
    expect(runtime.artifacts[0]).not.toHaveProperty("imageAssetId");
    expect(runtime.artifacts[0].imageUrl).toBe("/api/assets/asset-1");
    expect(runtime.artifacts[1].imageUrl).toBe("/api/assets/asset-2");
    expect(runtime.artifacts[1].imageRole).toBe("informative");
    expect(runtime.artifacts[1].imageAlt).toBe("A description");
  });

  it("leaves artifacts without an image untouched (no imageUrl key)", () => {
    const runtime = toCaseRuntimeConfig(base, (id) => `/api/assets/${id}`);
    expect(runtime.artifacts[0]).not.toHaveProperty("imageUrl");
    expect(runtime.artifacts[0]).not.toHaveProperty("imageAssetId");
  });

  it("passes through non-artifact fields unchanged (title/intro/scoringMode/conclusions/expertMap)", () => {
    const runtime = toCaseRuntimeConfig(base, (id) => id);
    expect(runtime.title).toBe(base.title);
    expect(runtime.intro).toBe(base.intro);
    expect(runtime.scoringMode).toBe(base.scoringMode);
    expect(runtime.conclusions).toEqual(base.conclusions);
    expect(runtime.expertMap).toEqual(base.expertMap);
  });

  it("passes through non-image artifact fields (sourceLine, table) unchanged", () => {
    const withTable: CaseWorkspaceConfigLike = {
      ...base,
      artifacts: [{ id: "grid", title: "Grid", sourceLine: "Exhibit A", kind: "table", table: { headers: ["a", "b"], rows: [["1", "2"]] } }],
    };
    const runtime = toCaseRuntimeConfig(withTable, (id) => id);
    expect(runtime.artifacts[0].sourceLine).toBe("Exhibit A");
    expect(runtime.artifacts[0].table).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("collects asset ids referenced by artifacts only", () => {
    expect(collectCaseAssetIds(withImages).sort()).toEqual(["asset-1", "asset-2"]);
    expect(collectCaseAssetIds(base)).toEqual([]);
  });

  it("de-duplicates repeated asset ids across artifacts", () => {
    const shared: CaseWorkspaceConfigLike = {
      ...base,
      artifacts: [
        { id: "photo1", title: "Photo 1", kind: "image", imageAssetId: "asset-shared", imageRole: "decorative" },
        { id: "photo2", title: "Photo 2", kind: "image", imageAssetId: "asset-shared", imageRole: "decorative" },
      ],
    };
    expect(collectCaseAssetIds(shared)).toEqual(["asset-shared"]);
  });
});
