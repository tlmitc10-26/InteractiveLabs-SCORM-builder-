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

/** Single regex pass over the 3 entities sanitize-html's serializer always
 *  re-encodes in a text node (`&`, `<`, `>` — verified directly against
 *  sanitize-html; it leaves `"`/`'`/non-ASCII untouched in text position),
 *  undoing that re-encoding so PLAIN_TEXT_OPTIONS below returns the raw
 *  string rather than an HTML-escaped one. A single alternation (rather
 *  than three chained `.replace`s) so a value the AUTHOR already
 *  double-escaped — e.g. literally typing "&amp;lt;" to mean the four
 *  characters `&lt;` — decodes exactly once: "&amp;lt;" matches "&amp;" as
 *  one unit at position 0, decoding to "&" + the untouched literal "lt;",
 *  i.e. "&lt;" — not decoded a second time into "<". Chained replaces
 *  would get this wrong (decode "&amp;" first, THEN "&lt;" would still be
 *  there to decode again). */
function decodeTextEntities(text: string): string {
  const table: Record<string, string> = { amp: "&", lt: "<", gt: ">" };
  return text.replace(/&(amp|lt|gt);/g, (_, name: string) => table[name]);
}

const PLAIN_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "discard",
  textFilter: decodeTextEntities,
};

/**
 * Strip HTML tags for labels/units/titles/prompts: for markup, the runtime
 * mounts these fields via `textContent` (see main.ts's mount-time comment),
 * so escaping them at storage time was actively wrong — it made a stored
 * label like "Mass & weight" literally render as the text
 * "Mass &amp; weight" in an exported package, while the editor's live
 * preview (which never round-trips through this function) showed the raw
 * draft. Every real sink now escapes correctly at its own point of use
 * instead: the runtime via `textContent` (which needs no escaping at all),
 * `xmlEscape` in manifest.ts, `htmlEscape` in index-html.ts, and the
 * filename sanitizer — so escaping here would only double-escape.
 *
 * Tags are still stripped (`allowedTags: []`, `disallowedTagsMode:
 * "discard"`) — sanitize-html's default `nonTextTags` drops a `<script>`/
 * `<style>` element's inner text along with the tag itself (verified: `<b>x
 * </b>` -> `x` keeps text, but `<script>alert(1)</script>hi` -> `hi` drops
 * BOTH the tag and its content), so this remains a real sanitizer, not a
 * no-op — it just no longer entity-escapes what it lets through.
 *
 * SECURITY NOTE for src/lib/export/scanner.ts: its decoded-authoring-value
 * forbidden-pattern walk (collectStrings + scanForbiddenPatterns) now sees
 * this function's raw, unescaped output. A label that survives sanitization
 * still containing a literal "<iframe" (sanitize-html's HTML parser did not
 * recognize it as a real tag to strip — e.g. malformed markup) will now
 * trip that scanner's forbidden-pattern rule and BLOCK export, where the
 * old entity-escaped form ("&lt;iframe") never matched it. That's a
 * fail-closed change (a legitimate label can no longer contain that exact
 * substring), which is the accepted tradeoff for making textContent
 * rendering and JSON storage agree.
 */
export function sanitizePlainText(input: string): string {
  return sanitizeHtml(input, PLAIN_TEXT_OPTIONS);
}
