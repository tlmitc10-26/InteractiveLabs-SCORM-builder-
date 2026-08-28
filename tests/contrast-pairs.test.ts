import { describe, it, expect } from "vitest";
import { contrastRatio, meetsBodyText, meetsNonText, ratioLabel } from "@/lib/design/contrast";
import { colorHex } from "@/lib/design/tokens";

/**
 * Contrast gate for the runtime visual pass (2026-08-28): every NEW color
 * pair introduced by src/engine-runtime/branching-scenario/engine.css and
 * src/engine-runtime/param-sandbox/engine.css (see the plan's Task 4 and
 * spec §4/§6) is asserted here via the real WCAG math in
 * src/lib/design/contrast.ts -- the same module the editor's live badges and
 * the schema's export-blocking use, so a token change or a literal edit in
 * either engine.css re-verifies these pairs automatically wherever they
 * resolve through colorHex() rather than a bare hex string.
 *
 * Token resolution: every color that already lives in tokens.json is pulled
 * in via colorHex(<name>) below, never re-typed as a hex literal, so a token
 * value change re-verifies this suite without an edit here.
 *
 * The ONLY hardcoded (non-token) hex literals in this file are the
 * approved mock-exception values spec §4 names (the ending's quality-chip/
 * timeline-node palette plus the AAA text variants): #365409, #644a00,
 * #7a5a00, #f2f7ec, #fff8e1, #fbeeee, and #8b1f1f. (#446d12, also named in
 * that spec sentence, is NOT a new literal -- it's simply the existing
 * --rds-success hex value, so it's resolved via colorHex("success") below
 * instead of being re-typed.)
 *
 * (History: the mock's `.qchip.ok` border was `#b8860b` -- a literal
 * outside spec §4's approved list, sitting at exactly 3.0:1; the shipped
 * border uses `#7a5a00` instead. And per Tamara's 2026-08-28 review, TEXT
 * on the tinted status surfaces -- quality chips, the sandbox score
 * banner's complete state -- is held to SC 1.4.6 AAA (7:1), not just AA:
 * token success (5.6:1 on #f2f7ec) and #7a5a00 (6.0:1 on #fff8e1) pass AA
 * but miss AAA there, so the shipped text colors are the darkened AAA
 * variants #365409 and #644a00, with the lighter values retained for
 * borders/glyphs where SC 1.4.11's 3:1 is the applicable bar.)
 *
 * Threshold doctrine applied throughout: WCAG 2.x "large text" (the 3:1
 * SC 1.4.3 allowance) requires >=18pt (24px) regular weight, or >=14pt
 * (~18.66px) BOLD. Every text pair asserted below is either bold at <18.66px
 * or regular weight at a small size, so none qualifies for the large-text
 * allowance -- SC 1.4.3's normal 4.5:1 minimum applies to all of them
 * (meetsBodyText). Aria-hidden decorative glyphs (the qchip/timeline glyph
 * marks) carry no independent WCAG text-contrast obligation at all -- their
 * meaning is fully redundant with adjacent visible text per this codebase's
 * redundancy doctrine (spec §1) -- but per the plan's Task 4 instruction
 * they are still held to the 4.5:1 bar informationally "where it clears
 * anyway", framed instead under SC 1.4.11 (non-text contrast, 3:1) as the
 * technically-applicable rule for a graphical state indicator.
 */

describe("contrast-pairs: branching scenario visual pass", () => {
  describe("quality chips (.ilb-qchip--best/ok/poor) -- status text held to SC 1.4.6 AAA, 7:1 (Tamara's bar; see header note)", () => {
    it("best: #365409 text on #f2f7ec background (AAA)", () => {
      const ratio = contrastRatio("#365409", "#f2f7ec");
      expect(ratioLabel(ratio)).toBe("7.9:1");
      expect(ratio).toBeGreaterThanOrEqual(7);
    });
    it("ok: #644a00 text on #fff8e1 background (AAA)", () => {
      const ratio = contrastRatio("#644a00", "#fff8e1");
      expect(ratioLabel(ratio)).toBe("7.8:1");
      expect(ratio).toBeGreaterThanOrEqual(7);
    });
    it("poor: #8b1f1f text on #fbeeee background (AAA)", () => {
      const ratio = contrastRatio("#8b1f1f", "#fbeeee");
      expect(ratioLabel(ratio)).toBe("8.0:1");
      expect(ratio).toBeGreaterThanOrEqual(7);
    });
  });

  describe("quality chip borders -- SC 1.4.11, 3:1 (the 1px border delineates the chip component)", () => {
    it("best border: --rds-success on #f2f7ec", () => {
      const ratio = contrastRatio(colorHex("success"), "#f2f7ec");
      expect(meetsNonText(ratio)).toBe(true);
    });
    it("poor border: --rds-danger on #fbeeee", () => {
      const ratio = contrastRatio(colorHex("danger"), "#fbeeee");
      expect(ratioLabel(ratio)).toBe("5.4:1");
      expect(meetsNonText(ratio)).toBe(true);
    });
    it("ok border: #7a5a00 on #fff8e1 (aligned to the approved chip-text literal; replaces the mock's threshold-edge #b8860b)", () => {
      const ratio = contrastRatio("#7a5a00", "#fff8e1");
      expect(ratioLabel(ratio)).toBe("6.0:1");
      expect(meetsNonText(ratio)).toBe(true);
    });
  });

  describe("debrief timeline nodes (.ilb-tnode--best/ok/poor) -- glyph is aria-hidden (no SC obligation; redundant with the step's visible quality text), held to SC 1.4.11's 3:1 and asserted at SC 1.4.3's 4.5:1 informationally since it clears", () => {
    it("best: #fff glyph on --rds-success background", () => {
      const ratio = contrastRatio("#ffffff", colorHex("success"));
      expect(ratioLabel(ratio)).toBe("6.1:1");
      expect(meetsNonText(ratio)).toBe(true);
      expect(meetsBodyText(ratio)).toBe(true);
    });
    it("poor: #fff glyph on --rds-danger background", () => {
      const ratio = contrastRatio("#ffffff", colorHex("danger"));
      expect(ratioLabel(ratio)).toBe("6.2:1");
      expect(meetsNonText(ratio)).toBe(true);
      expect(meetsBodyText(ratio)).toBe(true);
    });
    it("ok: #fff glyph on #7a5a00 background", () => {
      const ratio = contrastRatio("#ffffff", "#7a5a00");
      expect(ratioLabel(ratio)).toBe("6.3:1");
      expect(meetsNonText(ratio)).toBe(true);
      expect(meetsBodyText(ratio)).toBe(true);
    });
  });

  describe("ending eyebrow (.ilb-eyebrow) -- SC 1.4.3, 4.5:1 (13px bold is not large text)", () => {
    it("#747474 (--rds-dark-1) on white", () => {
      const ratio = contrastRatio(colorHex("dark-1"), "#ffffff");
      expect(ratioLabel(ratio)).toBe("4.6:1");
      expect(meetsBodyText(ratio)).toBe(true);
    });
  });

  describe("choice-marker circle (.ilb-choice-marker) -- SC 1.4.3, 4.5:1 (15px bold is not large text)", () => {
    it("resting: --rds-dark-2 text on --rds-light-2 background", () => {
      const ratio = contrastRatio(colorHex("dark-2"), colorHex("light-2"));
      expect(ratioLabel(ratio)).toBe("8.0:1");
      expect(meetsBodyText(ratio)).toBe(true);
    });
    it("hover/focus (.ilb-choice-card:hover .ilb-choice-marker): white text on --rds-primary background", () => {
      const ratio = contrastRatio("#ffffff", colorHex("primary"));
      expect(ratioLabel(ratio)).toBe("8.8:1");
      expect(meetsBodyText(ratio)).toBe(true);
    });
  });

  describe("meter-chip value (.ilb-meter-value) -- SC 1.4.3, 4.5:1 (14px bold is not large text)", () => {
    it("--rds-primary value text on --rds-light-1 chip background", () => {
      const ratio = contrastRatio(colorHex("primary"), colorHex("light-1"));
      expect(ratioLabel(ratio)).toBe("8.5:1");
      expect(meetsBodyText(ratio)).toBe(true);
    });
  });

  describe("pill buttons (.ilb-btn-pill / .ilb-btn-pill--ghost) -- SC 1.4.3, 4.5:1 (button label text)", () => {
    it("primary pill: white text on --rds-primary background", () => {
      const ratio = contrastRatio("#ffffff", colorHex("primary"));
      expect(meetsBodyText(ratio)).toBe(true);
    });
    it("ghost pill: --rds-primary text on white background", () => {
      const ratio = contrastRatio(colorHex("primary"), "#ffffff");
      expect(meetsBodyText(ratio)).toBe(true);
    });
  });

  describe("feedback panel glyph (.ilb-feedback-glyph) -- aria-hidden decorative icon, fully redundant with the feedback paragraph's own text; no WCAG SC applies. Recorded informationally only, NOT asserted against a threshold.", () => {
    it("--rds-secondary glyph on #fff8e1 panel background (informational: does not clear 3:1, and does not need to)", () => {
      const ratio = contrastRatio(colorHex("secondary"), "#fff8e1");
      expect(ratioLabel(ratio)).toBe("1.4:1");
      // Deliberately not asserting meetsNonText/meetsBodyText here -- see
      // this block's doc comment. This value is a record for reviewers, not
      // a gate.
    });
  });

  describe("scene-card / choice-card borders -- pure decoration (card boundary already implied by shadow + surrounding whitespace); recorded informationally, not gated", () => {
    it("scene-card border: --rds-light-3 on white", () => {
      const ratio = contrastRatio(colorHex("light-3"), "#ffffff");
      expect(ratioLabel(ratio)).toBe("1.2:1");
    });
    it("choice-card resting border: --rds-light-4 on white", () => {
      const ratio = contrastRatio(colorHex("light-4"), "#ffffff");
      expect(ratioLabel(ratio)).toBe("1.5:1");
    });
  });

  describe("brand-band gold rule vs. band -- SC 1.4.11 non-text 3:1 NOT required (pure decoration: a bottom border with no informational role); asserted informationally since it clears comfortably anyway", () => {
    it("--rds-secondary rule on --rds-primary band (default headerColor)", () => {
      const ratio = contrastRatio(colorHex("secondary"), colorHex("primary"));
      expect(ratioLabel(ratio)).toBe("5.6:1");
      expect(meetsNonText(ratio)).toBe(true); // clears comfortably though not required
    });
  });
});

describe("contrast-pairs: parameter sandbox visual pass", () => {
  describe("output unit (.ilb-output-units) -- SC 1.4.3, 4.5:1 (14px regular weight)", () => {
    it("--rds-dark-1 on white", () => {
      const ratio = contrastRatio(colorHex("dark-1"), "#ffffff");
      expect(ratioLabel(ratio)).toBe("4.6:1");
      expect(meetsBodyText(ratio)).toBe(true);
    });
  });

  describe("section label (.ilb-section-label) -- SC 1.4.3, 4.5:1 (12px bold is not large text)", () => {
    it("--rds-dark-1 on white", () => {
      const ratio = contrastRatio(colorHex("dark-1"), "#ffffff");
      expect(meetsBodyText(ratio)).toBe(true);
    });
  });

  describe("output value (.ilb-output-value) -- SC 1.4.3, 4.5:1 (26px bold IS large text at 3:1, but this clears the stricter 4.5:1 anyway)", () => {
    it("--rds-primary on white", () => {
      const ratio = contrastRatio(colorHex("primary"), "#ffffff");
      expect(meetsBodyText(ratio)).toBe(true);
    });
  });

  describe("score banner (.ilb-score-banner) -- SC 1.4.3, 4.5:1 (15px bold is not large text)", () => {
    it("neutral: --rds-dark-2 on --rds-light-2", () => {
      const ratio = contrastRatio(colorHex("dark-2"), colorHex("light-2"));
      expect(ratioLabel(ratio)).toBe("8.0:1");
      expect(meetsBodyText(ratio)).toBe(true);
    });
    it("complete (.complete): #365409 text on #f2f7ec -- status text held to SC 1.4.6 AAA, 7:1", () => {
      const ratio = contrastRatio("#365409", "#f2f7ec");
      expect(ratioLabel(ratio)).toBe("7.9:1");
      expect(ratio).toBeGreaterThanOrEqual(7);
    });
    it("complete border: --rds-success on #f2f7ec -- SC 1.4.11, 3:1", () => {
      const ratio = contrastRatio(colorHex("success"), "#f2f7ec");
      expect(meetsNonText(ratio)).toBe(true);
    });
  });

  describe("challenge chip (.ilb-challenge) -- neutral glyph is aria-decorative (redundant with the chip's own text label); met-state text reuses the branching pass's approved success-on-#f2f7ec pair", () => {
    it("neutral glyph mark: --rds-dark-1 on --rds-light-1 (informational: this specific pairing does not clear 4.5:1, which is fine -- the glyph is decorative, its state is also carried by the row's own visible text)", () => {
      const ratio = contrastRatio(colorHex("dark-1"), colorHex("light-1"));
      expect(ratioLabel(ratio)).toBe("4.4:1");
      // Deliberately not asserting a hard threshold here -- see block doc
      // comment. Recorded for reviewers.
    });
    it("met state border: --rds-success on #f2f7ec -- SC 1.4.11, 3:1 (the chip's TEXT is not success-colored; it inherits --rds-dark, asserted next)", () => {
      const ratio = contrastRatio(colorHex("success"), "#f2f7ec");
      expect(meetsNonText(ratio)).toBe(true);
    });
    it("met state text: inherited --rds-dark on the #f2f7ec tint -- SC 1.4.3, 4.5:1 (clears AAA too)", () => {
      const ratio = contrastRatio(colorHex("dark"), "#f2f7ec");
      expect(meetsBodyText(ratio)).toBe(true);
      expect(ratio).toBeGreaterThanOrEqual(7);
    });
  });
});
