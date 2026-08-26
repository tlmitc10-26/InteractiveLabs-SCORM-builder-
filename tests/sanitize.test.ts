import { describe, it, expect } from "vitest";
import { sanitizeRichText, sanitizePlainText } from "@/lib/sanitize";

describe("sanitizeRichText", () => {
  it("keeps allowed formatting tags", () => {
    const input = "<p>H<sub>2</sub>O is <strong>water</strong></p><ul><li>a</li></ul>";
    expect(sanitizeRichText(input)).toBe(input);
  });
  it("strips script tags entirely", () => {
    expect(sanitizeRichText('<p>hi</p><script>alert(1)</script>')).toBe("<p>hi</p>");
  });
  it("strips inline event handlers", () => {
    expect(sanitizeRichText('<p onclick="x()">hi</p>')).toBe("<p>hi</p>");
  });
  it("removes javascript: links but keeps https links", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeRichText('<a href="https://asu.edu">x</a>')).toBe('<a href="https://asu.edu">x</a>');
  });
  it("removes http:, data:, and relative hrefs (https only)", () => {
    expect(sanitizeRichText('<a href="http://x.com">x</a>')).toBe("<a>x</a>");
    expect(sanitizeRichText('<a href="data:text/html,hi">x</a>')).toBe("<a>x</a>");
  });
  it("strips iframe, img, style tags", () => {
    expect(sanitizeRichText('<iframe src="https://x"></iframe><style>p{}</style>ok')).toBe("ok");
  });
  it("is idempotent on hostile input", () => {
    const once = sanitizeRichText('<p><b onmouseover=x>a</b><script>s</script></p>');
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe("sanitizeRichText href guard edge cases", () => {
  it("rejects hrefs with leading whitespace", () => {
    expect(sanitizeRichText('<a href=" https://evil.com">x</a>')).toBe("<a>x</a>");
  });
  it("rejects https scheme without //", () => {
    expect(sanitizeRichText('<a href="https:alert(1)">x</a>')).toBe("<a>x</a>");
  });
  it("rejects uppercase javascript: scheme", () => {
    expect(sanitizeRichText('<A HREF="JAVASCRIPT:alert(1)">x</A>')).toBe("<a>x</a>");
  });
  it("accepts case-insensitive HTTPS and is idempotent", () => {
    const once = sanitizeRichText('<a href="HTTPS://evil.example/x">x</a>');
    expect(once).toBe('<a href="HTTPS://evil.example/x">x</a>');
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe("sanitizeRichText control-character stripping (N1/N2/N3 defense-in-depth)", () => {
  it("strips a raw control character out of href before validating/storing it", () => {
    // Built via fromCharCode (not a literal escape) so the control byte's
    // presence in this test is unambiguous. A raw tab inside an href is
    // never legitimate, and the WHATWG URL algorithm a browser actually
    // uses strips it before navigating — so it must not survive here either.
    const tab = String.fromCharCode(9);
    const input = `<a href="https://youtube.com${tab}@evil.example/x">c</a>`;
    const out = sanitizeRichText(input);
    expect(out).toBe('<a href="https://youtube.com@evil.example/x">c</a>');
    expect(out.includes(tab)).toBe(false);
  });
  it("is idempotent once the control character is stripped", () => {
    const newline = String.fromCharCode(10);
    const once = sanitizeRichText(`<a href="https://good.example${newline}@evil.example/x">c</a>`);
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe("sanitizePlainText", () => {
  it("escapes all HTML", () => {
    expect(sanitizePlainText('<b>x</b>')).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});
