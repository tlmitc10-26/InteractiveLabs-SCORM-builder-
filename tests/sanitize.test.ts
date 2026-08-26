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

describe("sanitizePlainText", () => {
  it("escapes all HTML", () => {
    expect(sanitizePlainText('<b>x</b>')).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});
