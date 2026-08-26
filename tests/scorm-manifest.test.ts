import { describe, it, expect } from "vitest";
import { buildManifestXml } from "@/lib/scorm/manifest";
import { buildIndexHtml } from "@/lib/scorm/index-html";

describe("buildManifestXml", () => {
  const xml = buildManifestXml({
    identifier: "ILB-abc123",
    title: "Archimedes <Principle> & Buoyancy",
    files: ["index.html", "engine/engine.js", "engine/engine.css", "engine/scorm-adapter.js", "assets/a1.png"],
  });
  it("declares SCORM 1.2 schema and adlcp namespace", () => {
    expect(xml).toContain('<schema>ADL SCORM</schema>');
    expect(xml).toContain("<schemaversion>1.2</schemaversion>");
    expect(xml).toContain("http://www.adlnet.org/xsd/adlcp_rootv1p2");
  });
  it("escapes XML special characters in titles", () => {
    expect(xml).toContain("Archimedes &lt;Principle&gt; &amp; Buoyancy");
    expect(xml).not.toContain("<Principle>");
  });
  it("lists every file and launches index.html", () => {
    expect(xml).toContain('href="index.html"');
    for (const f of ["engine/engine.js", "assets/a1.png"]) expect(xml).toContain(`<file href="${f}"`);
  });
  it("marks the resource as an sco", () => {
    expect(xml).toContain('adlcp:scormtype="sco"');
  });
});

describe("buildIndexHtml", () => {
  const html = buildIndexHtml({ title: "T & T", configJson: '{"a":"</script><script>alert(1)</script>"}' });
  it("inlines config JSON with </ escaped so script contexts cannot break out", () => {
    expect(html).toContain('<script id="ilb-config" type="application/json">');
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("<\\/script>");
  });
  it("references only local engine files and no external URLs", () => {
    expect(html).toMatch(/src="engine\/scorm-adapter\.js"/);
    expect(html).toMatch(/src="engine\/engine\.js"/);
    expect(html).toMatch(/href="engine\/engine\.css"/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
