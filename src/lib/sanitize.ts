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
 *
 * DEFENSE-IN-DEPTH (N1/N2/N3 follow-up): a raw C0 control character (code
 * points 0-31, plus DEL/127) inside an href is never legitimate, and the
 * WHATWG URL algorithm the browser actually uses strips ASCII tab/newline/
 * CR from a URL *before* parsing it — so an href that visually starts with
 * a safe host followed by a control character and then "@evil.example"
 * looks safe here but the browser navigates to evil.example. Stripping
 * control characters from href up front, before the scheme check and
 * before storing it, means the sanitizer's own output never carries this
 * ambiguity forward. Implemented as an explicit code-point filter (not a
 * regex literal) to sidestep any tooling/encoding layer mangling escaped
 * control-character regex syntax.
 */
function stripControlChars(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    const isC0 = code <= 31;
    const isDel = code === 127;
    if (isC0 || isDel) continue;
    out += ch;
  }
  return out;
}

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "b", "strong", "i", "em", "ul", "ol", "li", "sub", "sup", "a"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["https"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => {
      const attribsOut: Record<string, string> = {};
      const href = stripControlChars(attribs.href ?? "");
      if (/^https:\/\//i.test(href)) {
        attribsOut.href = href;
      }
      return { tagName: "a", attribs: attribsOut };
    },
  },
};

/** Allowlist HTML subset for designer rich-text fields. */
export function sanitizeRichText(input: string): string {
  return sanitizeHtml(input, RICH_TEXT_OPTIONS);
}

/**
 * Escape everything: for labels, units, titles.
 *
 * sanitize-html's "escape" mode only escapes tag/entity-forming characters
 * (`<`, `>`, `&`) — verified directly against sanitize-html: it leaves `"`
 * and `'` untouched. That's fine as long as the value is only ever placed
 * in an HTML text position, but plain-text fields (label/units/title) are
 * exactly the kind of field a future call site could plausibly interpolate
 * into an HTML attribute (e.g. a title="..." tooltip). A value like
 * `kg" onmouseover="x` would then break out of the attribute and inject a
 * live handler even though it contains no `<`/`>`/`&` at all. Escaping
 * quotes here too closes that off regardless of which position (text or
 * attribute) the caller ends up using.
 */
export function sanitizePlainText(input: string): string {
  const escaped = sanitizeHtml(input, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: "escape" });
  return escaped.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
