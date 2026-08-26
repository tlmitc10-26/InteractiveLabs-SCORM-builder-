import sanitizeHtml from "sanitize-html";

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
