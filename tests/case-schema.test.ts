import { describe, it, expect } from "vitest";
import { validateCaseConfig } from "@/lib/engines/case-workspace/schema";

// Compact valid base fixture: 2 text artifacts, 2 conclusions (one full credit,
// one none), each conclusion with 2 reasons (1 sound, 1 flawed with a
// flawNote), and an expertMap giving each conclusion exactly one supporting
// artifact. Individual tests spread-modify this rather than build bespoke
// configs, except where the rule under test needs different shape.
const base = {
  title: "Sample Case",
  intro: "<p>Intro</p>",
  scoringMode: "best-supported",
  artifacts: [
    { id: "memo", title: "The Memo", kind: "text", body: "<p>Body one.</p>" },
    { id: "log", title: "The Log", kind: "text", body: "<p>Body two.</p>" },
  ],
  conclusions: [
    {
      id: "equipment_failure",
      label: "Equipment failure",
      credit: "full",
      expertRationale: "<p>Because the memo says so.</p>",
      reasons: [
        { id: "r_sound", text: "The memo documents the failure.", sound: true },
        { id: "r_flawed", text: "Someone said so once.", sound: false, flawNote: "Hearsay, not evidence." },
      ],
    },
    {
      id: "operator_error",
      label: "Operator error",
      credit: "none",
      expertRationale: "<p>The log contradicts this.</p>",
      reasons: [
        { id: "r_sound", text: "The log shows correct procedure.", sound: true },
        { id: "r_flawed", text: "The operator seemed nervous.", sound: false, flawNote: "Demeanor is not evidence." },
      ],
    },
  ],
  expertMap: [
    { artifactId: "memo", conclusionId: "equipment_failure", role: "supports", strength: "strong" },
    { artifactId: "log", conclusionId: "operator_error", role: "supports", strength: "weak" },
  ],
};

describe("validateCaseConfig — basic shape", () => {
  it("parses a valid config and sanitizes text fields (title plain, body/intro rich)", () => {
    const withMarkup = {
      ...base,
      title: "Sample <b>Case</b>",
      artifacts: [
        { ...base.artifacts[0], body: "<p>Body one.</p><script>alert(1)</script>" },
        base.artifacts[1],
      ],
    };
    const r = validateCaseConfig(withMarkup);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.title).toBe("Sample Case");
      expect(r.config.artifacts[0].body).toBe("<p>Body one.</p>");
    }
  });

  it("rejects unknown keys at top, artifact, conclusion, reason, and map level (strict)", () => {
    expect(validateCaseConfig({ ...base, injected: true }).ok).toBe(false);
    expect(validateCaseConfig({
      ...base,
      artifacts: [{ ...base.artifacts[0], injected: true }, base.artifacts[1]],
    }).ok).toBe(false);
    expect(validateCaseConfig({
      ...base,
      conclusions: [{ ...base.conclusions[0], injected: true }, base.conclusions[1]],
    }).ok).toBe(false);
    expect(validateCaseConfig({
      ...base,
      conclusions: [
        { ...base.conclusions[0], reasons: [{ ...base.conclusions[0].reasons[0], injected: true }, base.conclusions[0].reasons[1]] },
        base.conclusions[1],
      ],
    }).ok).toBe(false);
    expect(validateCaseConfig({
      ...base,
      expertMap: [{ ...base.expertMap[0], injected: true }, base.expertMap[1]],
    }).ok).toBe(false);
  });

  it("rejects a scoringMode outside the enum", () => {
    expect(validateCaseConfig({ ...base, scoringMode: "majority-rule" }).ok).toBe(false);
  });

  it("accepts a valid headerColor token, and it is absent (not defaulted) when unset", () => {
    const withColor = validateCaseConfig({ ...base, headerColor: "info" });
    expect(withColor.ok).toBe(true);
    if (withColor.ok) expect(withColor.config.headerColor).toBe("info");

    const withoutColor = validateCaseConfig(base);
    expect(withoutColor.ok).toBe(true);
    if (withoutColor.ok) expect(withoutColor.config.headerColor).toBeUndefined();
  });

  it("rejects a headerColor outside the 16 RDS token names", () => {
    expect(validateCaseConfig({ ...base, headerColor: "maroon" }).ok).toBe(false);
  });

  it("rejects an id that is not letters/digits/underscore", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ ...base.artifacts[0], id: "not a valid id" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateCaseConfig — duplicate ids", () => {
  it("rejects duplicate artifact ids", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [base.artifacts[0], { ...base.artifacts[1], id: base.artifacts[0].id }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate artifact id "memo"/);
  });

  it("rejects duplicate conclusion ids", () => {
    const r = validateCaseConfig({
      ...base,
      conclusions: [base.conclusions[0], { ...base.conclusions[1], id: base.conclusions[0].id }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate conclusion id "equipment_failure"/);
  });

  it("rejects duplicate reason ids WITHIN the same conclusion", () => {
    const r = validateCaseConfig({
      ...base,
      conclusions: [
        { ...base.conclusions[0], reasons: [base.conclusions[0].reasons[0], { ...base.conclusions[0].reasons[1], id: base.conclusions[0].reasons[0].id }] },
        base.conclusions[1],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate reason.*conclusion "equipment_failure"/);
  });

  it("allows the SAME reason id to be reused across different conclusions", () => {
    // base already reuses "r_sound"/"r_flawed" ids across both conclusions —
    // this should validate cleanly (scoped per-conclusion, like branching's
    // choice ids scoped per-scene).
    const r = validateCaseConfig(base);
    expect(r.ok).toBe(true);
  });
});

describe("validateCaseConfig — expert map resolution and duplicates", () => {
  it("rejects a map entry referencing an unknown artifact", () => {
    const r = validateCaseConfig({
      ...base,
      expertMap: [{ ...base.expertMap[0], artifactId: "nope" }, base.expertMap[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unknown artifact "nope"/);
  });

  it("rejects a map entry referencing an unknown conclusion", () => {
    const r = validateCaseConfig({
      ...base,
      expertMap: [{ ...base.expertMap[0], conclusionId: "nope" }, base.expertMap[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unknown conclusion "nope"/);
  });

  it("rejects a duplicate (artifactId, conclusionId) pair", () => {
    const r = validateCaseConfig({
      ...base,
      expertMap: [...base.expertMap, { ...base.expertMap[0] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate pair/);
  });

  it("allows the same artifact mapped to a different conclusion, and vice versa", () => {
    const r = validateCaseConfig({
      ...base,
      expertMap: [
        ...base.expertMap,
        { artifactId: "memo", conclusionId: "operator_error", role: "contradicts", strength: "weak" },
        { artifactId: "log", conclusionId: "equipment_failure", role: "contradicts", strength: "strong" },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateCaseConfig — kind consistency", () => {
  it("rejects a text artifact missing body", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "memo", title: "The Memo", kind: "text" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/text artifacts require body/);
  });

  it("rejects a text artifact carrying image fields", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ ...base.artifacts[0], imageAssetId: "asset1" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/text artifacts must not carry image fields/);
  });

  it("rejects a text artifact carrying a table", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ ...base.artifacts[0], table: { headers: ["a", "b"], rows: [["1", "2"]] } }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/text artifacts must not carry a table/);
  });

  it("rejects an image artifact missing imageAssetId", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "photo", title: "Photo", kind: "image", imageRole: "decorative" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/image artifacts require imageAssetId/);
  });

  it("rejects an image artifact carrying body", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [
        { id: "photo", title: "Photo", kind: "image", imageAssetId: "asset1", imageRole: "decorative", body: "<p>x</p>" },
        base.artifacts[1],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/image artifacts must not carry body/);
  });

  it("rejects an image artifact carrying a table", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [
        {
          id: "photo", title: "Photo", kind: "image", imageAssetId: "asset1", imageRole: "decorative",
          table: { headers: ["a", "b"], rows: [["1", "2"]] },
        },
        base.artifacts[1],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/image artifacts must not carry a table/);
  });

  it("rejects a table artifact missing table", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "grid", title: "Grid", kind: "table" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/table artifacts require table/);
  });

  it("rejects a table artifact carrying body", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [
        { id: "grid", title: "Grid", kind: "table", table: { headers: ["a", "b"], rows: [["1", "2"]] }, body: "<p>x</p>" },
        base.artifacts[1],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/table artifacts must not carry body/);
  });

  it("rejects a table artifact carrying image fields", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [
        {
          id: "grid", title: "Grid", kind: "table", table: { headers: ["a", "b"], rows: [["1", "2"]] },
          imageAssetId: "asset1", imageRole: "decorative",
        },
        base.artifacts[1],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/table artifacts must not carry image fields/);
  });

  it("accepts a valid image artifact and a valid table artifact", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [
        { id: "photo", title: "Photo", kind: "image", imageAssetId: "asset1", imageRole: "informative", imageAlt: "A photo of the scene." },
        { id: "grid", title: "Grid", kind: "table", table: { caption: "Readings", headers: ["Time", "PSI"], rows: [["9:00", "40"], ["9:05", "38"]] } },
      ],
      expertMap: [
        { artifactId: "photo", conclusionId: "equipment_failure", role: "supports", strength: "strong" },
        { artifactId: "grid", conclusionId: "operator_error", role: "supports", strength: "weak" },
      ],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});

describe("validateCaseConfig — image alt model (exact branching matrix)", () => {
  const photoBase = { id: "photo", title: "Photo", kind: "image" as const };

  it("rejects imageAssetId without imageRole", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ ...photoBase, imageAssetId: "asset1" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/images require imageRole \(decorative or informative\)/);
  });

  it("rejects imageRole informative without imageAlt", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ ...photoBase, imageAssetId: "asset1", imageRole: "informative" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/informative images require imageAlt/);
  });

  it("accepts imageRole decorative without imageAlt", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ ...photoBase, imageAssetId: "asset1", imageRole: "decorative" }, base.artifacts[1]],
      expertMap: [{ artifactId: "photo", conclusionId: "equipment_failure", role: "supports", strength: "strong" }, base.expertMap[1]],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("rejects imageRole decorative carrying an imageAlt", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ ...photoBase, imageAssetId: "asset1", imageRole: "decorative", imageAlt: "A description" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/decorative images must not carry imageAlt/);
  });

  it("rejects imageRole/imageAlt present without an actual image", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "text2", title: "Text 2", kind: "text", body: "<p>x</p>", imageRole: "decorative" }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/imageRole\/imageAlt without an image/);
  });
});

describe("validateCaseConfig — table shape", () => {
  it("rejects a row whose length does not equal the header length", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [
        { id: "grid", title: "Grid", kind: "table", table: { headers: ["Time", "PSI"], rows: [["9:00", "40", "extra"]] } },
        base.artifacts[1],
      ],
      expertMap: [{ artifactId: "grid", conclusionId: "equipment_failure", role: "supports", strength: "strong" }, base.expertMap[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/row 0.*length 3.*header length 2/);
  });

  it("accepts a table without a caption (runtime falls back to artifact title)", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [
        { id: "grid", title: "Grid", kind: "table", table: { headers: ["Time", "PSI"], rows: [["9:00", "40"]] } },
        base.artifacts[1],
      ],
      expertMap: [{ artifactId: "grid", conclusionId: "equipment_failure", role: "supports", strength: "strong" }, base.expertMap[1]],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("accepts a table with a caption", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [
        { id: "grid", title: "Grid", kind: "table", table: { caption: "Readings", headers: ["Time", "PSI"], rows: [["9:00", "40"]] } },
        base.artifacts[1],
      ],
      expertMap: [{ artifactId: "grid", conclusionId: "equipment_failure", role: "supports", strength: "strong" }, base.expertMap[1]],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("rejects fewer than 2 headers", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "grid", title: "Grid", kind: "table", table: { headers: ["Time"], rows: [["9:00"]] } }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects more than 5 headers", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{
        id: "grid", title: "Grid", kind: "table",
        table: { headers: ["a", "b", "c", "d", "e", "f"], rows: [["1", "2", "3", "4", "5", "6"]] },
      }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects 0 rows", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "grid", title: "Grid", kind: "table", table: { headers: ["a", "b"], rows: [] } }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects 9 rows (cap is 8)", () => {
    const rows = Array.from({ length: 9 }, (_, i) => [`${i}`, `${i}`]);
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "grid", title: "Grid", kind: "table", table: { headers: ["a", "b"], rows } }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateCaseConfig — flawNote requirement", () => {
  it("rejects a flawed reason (sound=false) with no flawNote", () => {
    const r = validateCaseConfig({
      ...base,
      conclusions: [
        {
          ...base.conclusions[0],
          reasons: [base.conclusions[0].reasons[0], { id: "r_flawed", text: "No note here.", sound: false }],
        },
        base.conclusions[1],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/flawed reasons require flawNote/);
  });

  it("accepts a sound reason (sound=true) with no flawNote", () => {
    const r = validateCaseConfig(base);
    expect(r.ok).toBe(true);
  });
});

describe("validateCaseConfig — per-conclusion requirements", () => {
  it("rejects a conclusion with zero supporting artifacts in the expert map", () => {
    const r = validateCaseConfig({
      ...base,
      // Both entries now support equipment_failure only — operator_error is
      // never a conclusionId anywhere in the map (kept at 2 entries so the
      // array-length min(2) cap doesn't mask the business rule under test).
      expertMap: [base.expertMap[0], { artifactId: "log", conclusionId: "equipment_failure", role: "supports", strength: "weak" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/conclusion "operator_error": needs at least one supporting artifact/);
  });

  it('does not count a "contradicts" map entry as satisfying the "needs a supports" requirement', () => {
    const r = validateCaseConfig({
      ...base,
      expertMap: [base.expertMap[0], { ...base.expertMap[1], role: "contradicts" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/conclusion "operator_error": needs at least one supporting artifact/);
  });

  it("rejects a conclusion where every reason is flawed (needs at least one sound reason)", () => {
    const r = validateCaseConfig({
      ...base,
      conclusions: [
        {
          ...base.conclusions[0],
          reasons: [
            { id: "r_flawed1", text: "Flaw one.", sound: false, flawNote: "note" },
            { id: "r_flawed2", text: "Flaw two.", sound: false, flawNote: "note" },
          ],
        },
        base.conclusions[1],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/conclusion "equipment_failure": needs at least one sound reason/);
  });
});

describe("validateCaseConfig — unmapped artifact legality", () => {
  it("does not error when an artifact appears in NO expert map entry (legal red herring)", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [...base.artifacts, { id: "herring", title: "Red Herring", kind: "text", body: "<p>Irrelevant.</p>" }],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });
});

describe("validateCaseConfig — scoring mode rules", () => {
  it('"single" requires exactly one conclusion with credit "full" — rejects zero', () => {
    const r = validateCaseConfig({
      ...base,
      scoringMode: "single",
      conclusions: [{ ...base.conclusions[0], credit: "none" }, base.conclusions[1]],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/requires exactly one conclusion with credit "full"/);
  });

  it('"single" rejects two conclusions with credit "full"', () => {
    const r = validateCaseConfig({
      ...base,
      scoringMode: "single",
      conclusions: [{ ...base.conclusions[0], credit: "full" }, { ...base.conclusions[1], credit: "full" }],
    });
    expect(r.ok).toBe(false);
  });

  it('"single" forbids credit "partial" even alongside exactly one "full"', () => {
    const r = validateCaseConfig({
      ...base,
      scoringMode: "single",
      conclusions: [base.conclusions[0], { ...base.conclusions[1], credit: "partial" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/forbids credit "partial"/);
  });

  it('"single" accepts exactly one "full" and the rest "none"', () => {
    const r = validateCaseConfig({ ...base, scoringMode: "single" });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it('"best-supported" requires exactly one conclusion with credit "full" — rejects zero', () => {
    const r = validateCaseConfig({
      ...base,
      scoringMode: "best-supported",
      conclusions: [{ ...base.conclusions[0], credit: "none" }, base.conclusions[1]],
    });
    expect(r.ok).toBe(false);
  });

  it('"best-supported" ALLOWS credit "partial" (unlike "single")', () => {
    const r = validateCaseConfig({
      ...base,
      scoringMode: "best-supported",
      conclusions: [base.conclusions[0], { ...base.conclusions[1], credit: "partial" }],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it('"argument-quality" tolerates credit distributions that would fail under "single"/"best-supported" (zero full)', () => {
    const r = validateCaseConfig({
      ...base,
      scoringMode: "argument-quality",
      conclusions: [{ ...base.conclusions[0], credit: "none" }, base.conclusions[1]],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it('"argument-quality" tolerates multiple "full" conclusions', () => {
    const r = validateCaseConfig({
      ...base,
      scoringMode: "argument-quality",
      conclusions: [{ ...base.conclusions[0], credit: "full" }, { ...base.conclusions[1], credit: "full" }],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it('"argument-quality" tolerates "partial" credit', () => {
    const r = validateCaseConfig({
      ...base,
      scoringMode: "argument-quality",
      conclusions: [base.conclusions[0], { ...base.conclusions[1], credit: "partial" }],
    });
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("mode switching never bricks a draft: the same config validates under best-supported and argument-quality", () => {
    const bs = validateCaseConfig({ ...base, scoringMode: "best-supported" });
    const aq = validateCaseConfig({ ...base, scoringMode: "argument-quality" });
    expect(bs.ok).toBe(true);
    expect(aq.ok).toBe(true);
  });
});

describe("validateCaseConfig — caps", () => {
  const textArtifact = (id: string) => ({ id, title: id, kind: "text" as const, body: "<p>x</p>" });

  it("rejects 1 artifact (min is 2)", () => {
    expect(validateCaseConfig({ ...base, artifacts: [base.artifacts[0]] }).ok).toBe(false);
  });

  it("rejects 17 artifacts (max is 16)", () => {
    const artifacts = Array.from({ length: 17 }, (_, i) => textArtifact(`a${i}`));
    expect(validateCaseConfig({ ...base, artifacts }).ok).toBe(false);
  });

  it("rejects 1 conclusion (min is 2)", () => {
    expect(validateCaseConfig({ ...base, conclusions: [base.conclusions[0]] }).ok).toBe(false);
  });

  it("rejects 7 conclusions (max is 6)", () => {
    const conclusions = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`, label: `C${i}`, credit: "none" as const, expertRationale: "<p>x</p>",
      reasons: [
        { id: "r1", text: "one", sound: true },
        { id: "r2", text: "two", sound: false, flawNote: "note" },
      ],
    }));
    // one conclusion still needs credit full for best-supported to matter here,
    // but the array-length cap should fire regardless (zod-level, checked first).
    expect(validateCaseConfig({ ...base, conclusions }).ok).toBe(false);
  });

  it("rejects 1 reason in a conclusion (min is 2)", () => {
    const r = validateCaseConfig({
      ...base,
      conclusions: [{ ...base.conclusions[0], reasons: [base.conclusions[0].reasons[0]] }, base.conclusions[1]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects 7 reasons in a conclusion (max is 6)", () => {
    const reasons = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, text: `reason ${i}`, sound: true }));
    const r = validateCaseConfig({
      ...base,
      conclusions: [{ ...base.conclusions[0], reasons }, base.conclusions[1]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects 1 expertMap entry (min is 2)", () => {
    expect(validateCaseConfig({ ...base, expertMap: [base.expertMap[0]] }).ok).toBe(false);
  });

  it("rejects 97 expertMap entries (max is 96)", () => {
    // 16 artifacts x 6 conclusions = 96 possible DISTINCT pairs — the schema
    // max. A 97th entry necessarily repeats one of those pairs, so this
    // config fails BOTH the array-length cap and (independently) the
    // duplicate-pair rule; either is sufficient for ok:false, which is what
    // this test is asserting (the cap, specifically, is exercised by every
    // other 96-entries-worth-of-fixture test passing elsewhere in this file).
    const artifacts = Array.from({ length: 16 }, (_, i) => textArtifact(`a${i}`));
    const conclusions = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, label: `C${i}`, credit: i === 0 ? ("full" as const) : ("none" as const), expertRationale: "<p>x</p>",
      reasons: [
        { id: "r1", text: "one", sound: true },
        { id: "r2", text: "two", sound: false, flawNote: "note" },
      ],
    }));
    const expertMap: Array<{ artifactId: string; conclusionId: string; role: "supports"; strength: "weak" }> = [];
    for (const a of artifacts) {
      for (const c of conclusions) {
        expertMap.push({ artifactId: a.id, conclusionId: c.id, role: "supports", strength: "weak" });
      }
    }
    expect(expertMap).toHaveLength(96);
    expertMap.push({ ...expertMap[0] }); // 97th entry, duplicating the first pair
    expect(validateCaseConfig({ ...base, artifacts, conclusions, expertMap }).ok).toBe(false);
  });

  it("rejects a title over 200 chars", () => {
    expect(validateCaseConfig({ ...base, title: "x".repeat(201) }).ok).toBe(false);
  });

  it("rejects an artifact title over 120 chars", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ ...base.artifacts[0], title: "x".repeat(121) }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a table header over 60 chars", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "grid", title: "Grid", kind: "table", table: { headers: ["x".repeat(61), "b"], rows: [["1", "2"]] } }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a table cell over 120 chars", () => {
    const r = validateCaseConfig({
      ...base,
      artifacts: [{ id: "grid", title: "Grid", kind: "table", table: { headers: ["a", "b"], rows: [["x".repeat(121), "2"]] } }, base.artifacts[1]],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a reason text over 300 chars", () => {
    const r = validateCaseConfig({
      ...base,
      conclusions: [
        { ...base.conclusions[0], reasons: [{ ...base.conclusions[0].reasons[0], text: "x".repeat(301) }, base.conclusions[0].reasons[1]] },
        base.conclusions[1],
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a flawNote over 300 chars", () => {
    const r = validateCaseConfig({
      ...base,
      conclusions: [
        { ...base.conclusions[0], reasons: [base.conclusions[0].reasons[0], { ...base.conclusions[0].reasons[1], flawNote: "x".repeat(301) }] },
        base.conclusions[1],
      ],
    });
    expect(r.ok).toBe(false);
  });
});
