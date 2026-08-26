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
}

const ALLOWED_EXTENSIONS = new Set(["html", "js", "css", "json", "xml", "png", "jpg", "jpeg", "webp"]);
const TEXT_EXTENSIONS = new Set(["html", "js", "css", "json", "xml"]);

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

/** javascript:/data: URL schemes, checked against a tab/CR/LF-STRIPPED copy
 *  of the text (see `stripUrlWhitespace` below). Kept separate from
 *  FORBIDDEN_PATTERNS because the WHATWG URL parser strips ASCII tab and
 *  newline characters from a URL string *before* scheme-sniffing — a
 *  well-known filter-evasion trick is `href="jav&#9;ascript:alert(1)"` /
 *  literal embedded tabs, which browsers still execute as javascript: but
 *  a naive literal-substring regex would miss. Also tolerate whitespace
 *  between "data:" and "text/html" (data URL MIME parsing is lenient). */
const FORBIDDEN_URL_SCHEME_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /javascript\s*:/i, label: "javascript: URL" },
  { re: /data:\s*text\/html/i, label: "data:text/html URL" },
];

/** Strip characters the URL spec (and browsers) discard from a URL string
 *  before parsing its scheme, so scheme-obfuscation via embedded
 *  tab/newline/carriage-return can't slip past a literal-substring check. */
function stripUrlWhitespace(text: string): string {
  return text.replace(/[\t\r\n]/g, "");
}

/** HTML-only strengthening (note 4a/4b): the quoted-attribute regex above
 *  misses unquoted handlers like `onload=x()` and misses protocol-relative
 *  `//host/...` URLs sitting in src/href attributes (which the plain
 *  http(s):// URL_RE below never sees). Scoped to .html files only so it
 *  can't misfire on JSON/JS text that legitimately contains "on...=" or
 *  "//" substrings outside of markup. */
const FORBIDDEN_PATTERNS_HTML: Array<{ re: RegExp; label: string }> = [
  { re: /<[^>]+\son[a-z]+\s*=/i, label: "inline event handler attribute" },
  { re: /<[^>]+\b(?:src|href)\s*=\s*["']?\s*\/\//i, label: "protocol-relative URL (//host) in src/href attribute" },
];

const URL_RE = /\bhttps?:\/\/([a-zA-Z0-9.-]+)[^\s"'<>)]*/g;

export function scanPackage(files: Map<string, Buffer>, ctx: ScanContext): ScanReport {
  const violations: Violation[] = [];
  const engineFiles = new Set(Object.keys(ctx.engineChecksums));

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

    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const text = buf.toString("utf8");

    // Rule: forbidden patterns (common, all text files — engine files included)
    for (const { re, label } of FORBIDDEN_PATTERNS) {
      if (re.test(text)) violations.push({ file: path, rule: "forbidden-pattern", detail: label });
    }
    // javascript:/data: URL schemes: check the whitespace-stripped text so
    // tab/newline-obfuscated schemes (a real browser-URL-parsing quirk) are
    // still caught. Checking the stripped copy alone is sufficient — it
    // still matches the ordinary, non-obfuscated form.
    const urlSchemeText = stripUrlWhitespace(text);
    for (const { re, label } of FORBIDDEN_URL_SCHEME_PATTERNS) {
      if (re.test(urlSchemeText)) violations.push({ file: path, rule: "forbidden-pattern", detail: label });
    }
    if (ext === "html") {
      for (const { re, label } of FORBIDDEN_PATTERNS_HTML) {
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

    // Rule: URL allowlist
    for (const m of text.matchAll(URL_RE)) {
      const host = m[1].toLowerCase();
      const allowed = ctx.urlAllowlist.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
      if (!allowed) violations.push({ file: path, rule: "url-allowlist", detail: `URL host "${host}" is not on the approved allowlist` });
    }
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
