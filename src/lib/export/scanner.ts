import { createHash } from "node:crypto";
import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { sanitizeRichText } from "@/lib/sanitize";

export interface Violation { file: string; rule: string; detail: string }
export interface ScanReport { passed: boolean; violations: Violation[] }

export interface ScanContext {
  /** package path -> expected sha256 for audited runtime files */
  engineChecksums: Record<string, string>;
  /** hostnames allowed in URLs (admin policy). Empty = fully self-contained. */
  urlAllowlist: string[];
  /** the authoring config as it will be exported (pre-runtime-mapping) */
  authoringConfig: unknown;
  /**
   * OPTIONAL, but Task 13 MUST supply it in production: the exact bytes
   * index.html is expected to be — i.e. the same
   * buildIndexHtml({ title, configJson }) call the caller is about to
   * write into the package. When present, the scanner requires the
   * package's index.html to byte-equal this string/Buffer exactly
   * (violation "index-html-mismatch" otherwise). This is what actually
   * proves index.html is the audited launcher: a reference-only check
   * (which files does it point to) can't see executable inline JS, so
   * without this the scanner can only fall back to a much blunter rule —
   * see below. The fallback is a weaker safety net, not a substitute:
   * Task 13 wiring this field is what makes N4 airtight.
   *
   * If omitted (older callers, or this test suite exercising the
   * fallback), the scanner instead: (1) keeps the existing "only
   * checksummed/known engine paths may be <script src>/<link href>
   * targets" check, and (2) rejects ANY <script> tag (src or no src —
   * see the "hasSrc" removal note at the call site) whose body is
   * non-empty outright — inline script provenance cannot be verified
   * without the generator's exact expected output, so in fallback mode no
   * inline script content is trusted, period.
   */
  expectedIndexHtml?: string | Buffer;
}

const ALLOWED_EXTENSIONS = new Set(["html", "js", "css", "json", "xml", "png", "jpg", "jpeg", "webp"]);
const TEXT_EXTENSIONS = new Set(["html", "js", "css", "json", "xml"]);

/** A caller (Task 13) supplies the audited manifest hashes. These two paths
 *  MUST always be part of that set — a caller can't shrink/omit the set to
 *  smuggle an unaudited engine.js/scorm-adapter.js past the checksum rule
 *  (an empty or partial engineChecksums would make every real .js/.css file
 *  in the package look "not required", but rule "unapproved-code-file"
 *  below would still reject them for not being checksummed — so shrinking
 *  the set doesn't help an attacker execute code, it just breaks the
 *  export outright. We still flag it explicitly so the failure is legible.) */
const REQUIRED_ENGINE_KEYS = ["engine/engine.js", "engine/scorm-adapter.js"];

/** Forbidden executable/injection patterns, applied to ALL text files
 *  (including audited engine files: integrity is enforced by checksum too,
 *  but the runtime must never contain eval/new Function etc. — belt and
 *  braces, so a compromised "audited" build still trips this scan). */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\beval\s*\(/, label: "eval() call" },
  { re: /new\s+Function\s*\(/, label: "new Function() constructor" },
  // Quoted-attribute form. Applies to all text kinds (html/js/css/json/xml);
  // safe against false positives elsewhere because it requires a real quote
  // character immediately after "=" (a JSON-escaped `\"` does not match).
  { re: /\bon[a-z]+\s*=\s*["']/i, label: "inline event handler (on*=)" },
  { re: /<iframe\b/i, label: "iframe element" },
  { re: /document\.write\s*\(/, label: "document.write() call" },
  { re: /import\s*\(/, label: "dynamic import()" },
];

/** javascript:/data: URL schemes that can carry executable/markup content,
 *  checked against a tab/CR/LF-STRIPPED copy of the text (see
 *  `stripUrlWhitespace` below). Kept separate from FORBIDDEN_PATTERNS
 *  because the WHATWG URL parser strips ASCII tab and newline characters
 *  from a URL string *before* scheme-sniffing — a well-known filter-evasion
 *  trick is embedding a literal tab inside the scheme name
 *  (`href="jav\tascript:alert(1)"`), which browsers still execute as
 *  javascript: but a naive literal-substring regex would miss. Also
 *  tolerates whitespace between "data:" and the MIME type (data URL MIME
 *  parsing is lenient), and covers the other script/markup-carrying data:
 *  MIME types beyond text/html (M1: svg can carry <script>, xhtml is XML
 *  that browsers render as a full document/DOM). */
const FORBIDDEN_URL_SCHEME_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /javascript\s*:/i, label: "javascript: URL" },
  { re: /data:\s*text\/html/i, label: "data:text/html URL" },
  { re: /data:\s*image\/svg\+xml/i, label: "data:image/svg+xml URL" },
  { re: /data:\s*application\/xhtml\+xml/i, label: "data:application/xhtml+xml URL" },
];

/** Strip characters the URL spec (and browsers) discard from a URL string
 *  before parsing its scheme/authority, so obfuscation via embedded
 *  tab/newline/carriage-return can't slip past a literal-substring check
 *  or reshape how `new URL()` resolves the authority. */
function stripUrlWhitespace(text: string): string {
  return text.replace(/[\t\r\n]/g, "");
}

/** HTML-only strengthening: the quoted-attribute regex above misses
 *  unquoted handlers like `onload=x()` and misses protocol-relative
 *  `//host/...` URLs sitting in src/href attributes (which the http(s)://
 *  URL_TOKEN_RE below never sees — it has no scheme at all). Scoped to
 *  .html files only so it can't misfire on JSON/JS text that legitimately
 *  contains "on...=" or "//" substrings outside of markup. */
const FORBIDDEN_PATTERNS_HTML: Array<{ re: RegExp; label: string }> = [
  { re: /<[^>]+\son[a-z]+\s*=/i, label: "inline event handler attribute" },
  { re: /<[^>]+\b(?:src|href)\s*=\s*["']?\s*\/\//i, label: "protocol-relative URL (//host) in src/href attribute" },
];

/** CSS-only strengthening (I2): protocol-relative references in @import /
 *  url(...) — CSS syntax differs from HTML attributes so the HTML patterns
 *  above don't apply. Legitimate engine.css is still checksummed (rule
 *  "unapproved-code-file" handles any *other* .css outright), so this is
 *  belt-and-braces for the one .css file that's allowed to exist. */
const FORBIDDEN_PATTERNS_CSS: Array<{ re: RegExp; label: string }> = [
  { re: /@import\s+(?:url\(\s*)?["']?\s*\/\//i, label: "protocol-relative URL (//host) in @import" },
  { re: /url\(\s*["']?\s*\/\//i, label: "protocol-relative URL (//host) in url()" },
];

/** Broad URL-token finder: case-insensitive scheme (catches `HTTPS://`,
 *  C1), and the token body is NOT restricted to ASCII (catches IDN /
 *  non-ASCII hosts, C2 — an ASCII-only character class would fail to match
 *  at all right after "://" when the host starts with a non-ASCII
 *  character, silently dropping the whole URL from detection). Each
 *  matched token is handed to the real WHATWG URL parser below rather than
 *  compared as a raw string.
 *
 *  Deliberately does NOT exclude tab/CR/LF from the token body (only a
 *  literal space, quote, angle bracket, or ")" ends a token). An earlier
 *  version excluded `\s` (which includes tab/CR/LF) and the CALLER
 *  pre-stripped tab/CR/LF from the whole text before tokenizing — but
 *  that collapses e.g. "word\thttps://evil.com" into
 *  "wordhttps://evil.com" BEFORE the regex ever runs, destroying the
 *  `\b` word-boundary the match depends on and producing a false
 *  negative (the URL is simply never found). Instead: tokenize the RAW
 *  text (so a real preceding tab still counts as a non-word character
 *  and the boundary fires normally), let tab/CR/LF ride along inside a
 *  match if they occur mid-token (so a control-character-obfuscated URL
 *  is still captured whole), then strip them from just that token before
 *  handing it to `new URL()` — see below. */
const URL_TOKEN_RE = /\bhttps?:\/\/[^ "'<>)]+/gi;

/** Parse each http(s) token in `text` with the real WHATWG URL constructor
 *  and check its (already lowercased/punycoded/userinfo-stripped)
 *  hostname against the allowlist. Shared between the per-file text scan
 *  and the authoring-config string walk below (N1/N2/N3) so both paths
 *  apply the exact same logic. Callers may pass either raw text (tab/CR/LF
 *  intact — this function strips them per-token, see URL_TOKEN_RE above)
 *  or an already-stripped string (the config-string walk); either way
 *  `stripUrlWhitespace` on an already-clean token is a no-op. */
function scanUrlTokensForAllowlist(text: string, file: string, urlAllowlist: string[], violations: Violation[]): void {
  for (const m of text.matchAll(URL_TOKEN_RE)) {
    const token = stripUrlWhitespace(m[0]);
    let url: URL;
    try {
      url = new URL(token);
    } catch {
      violations.push({ file, rule: "invalid-url", detail: `unparseable URL "${token}"` });
      continue;
    }
    const host = url.hostname;
    if (!host) {
      violations.push({ file, rule: "invalid-url", detail: `URL "${token}" has no hostname` });
      continue;
    }
    const allowed = urlAllowlist.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
    if (!allowed) violations.push({ file, rule: "url-allowlist", detail: `URL host "${host}" is not on the approved allowlist` });
  }
}

function scanForbiddenUrlSchemes(text: string, file: string, violations: Violation[]): void {
  for (const { re, label } of FORBIDDEN_URL_SCHEME_PATTERNS) {
    if (re.test(text)) violations.push({ file, rule: "forbidden-pattern", detail: label });
  }
}

/** Recursively collect every string value out of an arbitrary JSON-shaped
 *  value (the authoring config). Guards against cycles defensively — the
 *  config is normally JSON-safe, but ctx.authoringConfig is typed
 *  `unknown` and a hostile/buggy caller could hand in a self-referencing
 *  object. */
function collectStrings(value: unknown, out: string[], seen: Set<unknown>): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return out;
    seen.add(value);
    const items = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const item of items) collectStrings(item, out, seen);
  }
  return out;
}

export function scanPackage(files: Map<string, Buffer>, ctx: ScanContext): ScanReport {
  const violations: Violation[] = [];
  const engineFiles = new Set(Object.keys(ctx.engineChecksums));

  // Rule: the audited engine-checksum set itself can't be empty or missing
  // its required keys — a caller shrinking it to "nothing is checksummed"
  // must not silently make every engine file pass-by-default elsewhere.
  if (engineFiles.size === 0) {
    violations.push({ file: "engine/", rule: "missing-engine-checksum", detail: "ctx.engineChecksums must not be empty" });
  } else {
    for (const key of REQUIRED_ENGINE_KEYS) {
      if (!engineFiles.has(key)) {
        violations.push({ file: key, rule: "missing-engine-checksum", detail: `required engine checksum "${key}" is missing from ctx.engineChecksums` });
      }
    }
  }

  // Rule: required files present
  for (const required of ["imsmanifest.xml", "index.html", ...engineFiles]) {
    if (!files.has(required)) violations.push({ file: required, rule: "missing-file", detail: "required file missing from package" });
  }

  for (const [path, buf] of files) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";

    // Rule: file-type allowlist
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      violations.push({ file: path, rule: "file-type", detail: `file extension ".${ext}" is not allowed in packages` });
      continue;
    }

    // Rule: engine checksum verification (applies even though the file is
    // ALSO subject to the forbidden-pattern scan below — both must pass).
    if (engineFiles.has(path)) {
      const actual = createHash("sha256").update(buf).digest("hex");
      if (actual !== ctx.engineChecksums[path]) {
        violations.push({ file: path, rule: "checksum-mismatch", detail: "engine file does not match the audited build" });
      }
    }

    // Rule (I1, CRITICAL): only checksummed engine files may be executable
    // code. Without this, a package-relative, non-checksummed .js/.css
    // (e.g. content/tracker.js) sails through every other rule — it's not
    // an engine path (no checksum to verify), it's not an absolute/
    // protocol-relative URL (no external-script/url-allowlist match), and
    // it need not contain any FORBIDDEN_PATTERNS literal at all (a script
    // can exfiltrate document.cookie via string concatenation with zero
    // banned substrings). Any .js/.css outside engineChecksums is rejected
    // outright, regardless of its content.
    if ((ext === "js" || ext === "css") && !engineFiles.has(path)) {
      violations.push({ file: path, rule: "unapproved-code-file", detail: `${ext} files must be a checksummed engine file — "${path}" is not present in ctx.engineChecksums` });
    }

    // Rule (N4): index.html must be the exact audited launcher — not
    // merely "doesn't reference unaudited files" (below), because inline
    // JS is executable and unchecksummed. Preferred path: byte-equal
    // comparison against ctx.expectedIndexHtml, the exact bytes the caller
    // is about to package. Fallback (see ScanContext.expectedIndexHtml
    // doc): reject any inline <script> with non-empty content outright.
    if (path === "index.html") {
      if (ctx.expectedIndexHtml !== undefined) {
        const expected = Buffer.isBuffer(ctx.expectedIndexHtml) ? ctx.expectedIndexHtml : Buffer.from(ctx.expectedIndexHtml, "utf8");
        if (!buf.equals(expected)) {
          violations.push({ file: path, rule: "index-html-mismatch", detail: "index.html does not byte-match the audited launcher (buildIndexHtml output)" });
        }
      } else {
        const htmlText = buf.toString("utf8");
        // No "hasSrc" exception here at all, deliberately: an earlier
        // version tried to skip enforcement for tags that "have a real
        // src" (so the audited engine/scorm-adapter script tags wouldn't
        // trip this), first via a `\bsrc` check (defeated by a decoy
        // `data-src=` attribute) and then via a whitespace-anchored
        // `src=` check (still defeated by a decoy attribute whose OWN
        // quoted value contains " src=", e.g. `data-x=" src=y"` — the
        // regex has no idea it's inside a different attribute's string).
        // There is no attribute-presence check that can't be spoofed by
        // an attacker-controlled attribute value using nothing but a
        // regex. So: don't try. Flag ANY <script>...</script> pair (any
        // attributes, matched case-insensitively with whitespace/newlines
        // tolerated in the tag, e.g. <SCRIPT>, <script\n>, <script
        // type=module>) whose body is non-empty. A legitimate reference
        // like <script src="engine/engine.js"></script> has an EMPTY body
        // and never trips this; the real launcher's non-empty mount IIFE
        // is validated by the byte-equal ctx.expectedIndexHtml path above,
        // which is why that path is the one Task 13 must wire up.
        for (const m of htmlText.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
          const body = m[1];
          if (body.trim().length > 0) {
            violations.push({ file: path, rule: "inline-script", detail: "index.html contains a <script> with a non-empty inline body that cannot be verified without ctx.expectedIndexHtml" });
          }
        }
      }
    }

    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const text = buf.toString("utf8");

    // Rule: forbidden patterns (common, all text files — engine files included)
    for (const { re, label } of FORBIDDEN_PATTERNS) {
      if (re.test(text)) violations.push({ file: path, rule: "forbidden-pattern", detail: label });
    }
    // javascript:/data: scheme check: run against the whole-text
    // whitespace-stripped copy (N1/N2/N3, part b) — a literal tab/newline
    // embedded INSIDE the scheme keyword itself (`jav\tascript:`) must not
    // be able to hide the literal substring match. This check has no `\b`
    // boundary dependency, so whole-text stripping is safe here (unlike
    // the URL-allowlist tokenizer just below, which strips per-token
    // instead — see URL_TOKEN_RE's comment for why).
    const strippedText = stripUrlWhitespace(text);
    scanForbiddenUrlSchemes(strippedText, path, violations);
    if (ext === "html") {
      for (const { re, label } of FORBIDDEN_PATTERNS_HTML) {
        if (re.test(text)) violations.push({ file: path, rule: "forbidden-pattern", detail: label });
      }
    }
    if (ext === "css") {
      for (const { re, label } of FORBIDDEN_PATTERNS_CSS) {
        if (re.test(text)) violations.push({ file: path, rule: "forbidden-pattern", detail: label });
      }
    }

    // external <script src> (absolute or protocol-relative). Leading
    // whitespace inside the attribute value is trimmed before the anchor
    // check — sanitize-html and some HTML parsers leave leading whitespace
    // in an href/src value untouched (see src/lib/sanitize.ts), and an
    // anchored `^` regex would otherwise miss `src=" https://evil"`.
    const scriptSrcs = [...text.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const src of scriptSrcs) {
      if (/^[a-z]+:|^\/\//i.test(src.trim())) violations.push({ file: path, rule: "external-script", detail: `script src "${src}" is not package-relative` });
    }

    // Rule: index.html (and any other html file) must load ONLY audited
    // code — every package-relative <script src> / <link href> target must
    // itself be a checksummed engine path. Absolute/protocol-relative
    // targets are skipped here (already covered by external-script /
    // url-allowlist above); this closes the gap where an attacker adds a
    // stray package-relative reference like `<script src="content/tracker.js">`
    // that names a file which is package-relative (so external-script
    // doesn't fire) and may not even need to exist as a real map entry to
    // be flagged.
    if (ext === "html") {
      const refs = [
        ...text.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi),
        ...text.matchAll(/<link[^>]*\shref\s*=\s*["']([^"']+)["']/gi),
      ].map((m) => m[1]);
      for (const ref of refs) {
        const trimmed = ref.trim();
        if (/^[a-z]+:|^\/\//i.test(trimmed)) continue; // absolute/protocol-relative: handled above
        if (!engineFiles.has(trimmed)) {
          violations.push({ file: path, rule: "unapproved-code-file", detail: `references non-checksummed file "${ref}" — only audited engine paths may be loaded` });
        }
      }
    }

    // Rule: URL allowlist, via real WHATWG URL parsing (C1/C2/C3). Run
    // against the RAW text (not strippedText) — see URL_TOKEN_RE's
    // comment: pre-stripping the whole text here would collapse a
    // preceding word character into the URL and break the `\b` boundary
    // the tokenizer depends on. Per-token stripping happens inside
    // scanUrlTokensForAllowlist itself.
    scanUrlTokensForAllowlist(text, path, ctx.urlAllowlist, violations);
  }

  // Rule (N1/N2/N3, part a): scan the AUTHORING CONFIG'S ACTUAL string
  // values — not just content/config.json's JSON-serialized bytes — for
  // URL-allowlist/scheme violations, after stripping the same control
  // characters a browser strips from a URL before parsing it.
  //
  // Why this is a separate pass from the per-file text scan above: a real
  // control character (e.g. an authored tab) inside a config string gets
  // JSON-escaped as the two-ASCII-character sequence \t when
  // JSON.stringify writes content/config.json. Those two literal
  // characters are not whitespace, so they don't truncate a token — but
  // they DO become part of it, and a stray artifact from the *next*
  // escaped quote (`\"` closing the JSON string) can land in the same
  // token. That extra backslash changes how `new URL()` resolves the
  // authority for a "special" scheme (http/https treat backslash like a
  // path separator in some parser states), which can silently resolve the
  // token back to the innocent-looking prefix host instead of the real
  // one after "@" — i.e. a JSON-round-trip artifact, not a whitespace
  // problem, defeats the raw-byte scan even though `new URL()` itself
  // handles a real control character correctly. Walking the config's
  // actual (pre-serialization) string values and stripping control
  // characters there reproduces exactly what the browser will see at
  // runtime (JSON/JS string escapes decoded back to the real characters,
  // then the URL parser's own whitespace-stripping), independent of which
  // file the value round-trips through.
  for (const raw of collectStrings(ctx.authoringConfig, [], new Set())) {
    const decoded = stripUrlWhitespace(raw);
    scanForbiddenUrlSchemes(decoded, "content/config.json", violations);
    scanUrlTokensForAllowlist(decoded, "content/config.json", ctx.urlAllowlist, violations);
  }

  // Rule: config revalidation + sanitizer idempotence
  const result = validateSandboxConfig(ctx.authoringConfig);
  if (!result.ok) {
    for (const e of result.errors) violations.push({ file: "content/config.json", rule: "schema", detail: e });
  } else {
    const intro = (ctx.authoringConfig as { intro?: string }).intro;
    if (typeof intro === "string" && sanitizeRichText(intro) !== intro) {
      violations.push({ file: "content/config.json", rule: "sanitizer", detail: "intro is not sanitizer-stable (sanitize(x) != x)" });
    }
  }

  return { passed: violations.length === 0, violations };
}
