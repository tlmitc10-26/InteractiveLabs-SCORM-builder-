import sanitizeHtml from "sanitize-html";

/**
 * SECURITY: the `transformTags.a` handler below is the ACTUAL href
 * enforcement for this allowlist — not `allowedSchemes` / `allowProtocolRelative`.
 *
 * sanitize-html's built-in scheme check has gaps that let a malicious href
 * through *unmodified* when it doesn't match a recognized absolute-URL shape,
 * because unrecognized values fall back to being treated as relative URLs
 * (which pass through untouched since no `allowedSchemes` entry applies to
 * relative refs). Verified directly against sanitize-html with only
 * `allowedSchemes: ["https"]` + `allowProtocolRelative: false` (no
 * transformTags):
 *   - `<a href=" https://evil.com">`   (leading whitespace) -> passes through unmodified
 *   - `<a href="https:alert(1)">`      (scheme without `//`) -> passes through unmodified
 * `allowedSchemes` is defense-in-depth only. Do NOT remove transformTags,
 * and do NOT rely on allowedSchemes alone for href enforcement.
 *
 * This matters because sanitizeRichText output is injected into innerHTML
 * in the exported SCORM runtime, and the export scanner (Task 12) enforces
 * sanitize(x) === x as its compliance gate — a bypass here is a bypass there.
 */
const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "b", "strong", "i", "em", "ul", "ol", "li", "sub", "sup", "a"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["https"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => {
      const attribsOut: Record<string, string> = {};
      if (/^https:\/\//i.test(attribs.href ?? "")) {
        attribsOut.href = attribs.href;
      }
      return { tagName: "a", attribs: attribsOut };
    },
  },
};

/** Allowlist HTML subset for designer rich-text fields. */
export function sanitizeRichText(input: string): string {
  return sanitizeHtml(input, RICH_TEXT_OPTIONS);
}

/** Escape everything: for labels, units, titles. */
export function sanitizePlainText(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: "escape" });
}
