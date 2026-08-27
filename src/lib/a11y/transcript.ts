import { computeAccessibleName } from "dom-accessibility-api";

/**
 * Screen-reader announcement-contract layer.
 *
 * Doctrine: conformant screen readers implement W3C specs (accname
 * computation, ARIA/HTML-AAM role mappings, live-region processing), so for
 * conformant markup the announcement a screen reader user hears is entirely
 * spec-determined -- not a guess, not something that needs a human at a
 * machine to discover. This module encodes that determinism as a small,
 * testable "transcript" of what an AT would announce while reading or
 * tabbing through a mounted runtime, so a future markup change shows up as a
 * diff against an explicit, human-legible expectation instead of silently
 * changing what gets spoken.
 *
 * Scope, deliberately narrow: this covers exactly the element shapes our
 * engine runtime renders today (see src/engine-runtime/param-sandbox/main.ts)
 * -- headings, the handful of form control types the sandbox builds, its
 * canvas[role=img] charts, its role="status" live-region summary, and its
 * plain-text score/challenge carriers. `roleOf` below throws on any
 * focusable element shape it doesn't recognize, on purpose: if engine work
 * ever adds a new focusable control kind (a button, a link, a radio group),
 * this module MUST be extended consciously rather than silently mis-mapping
 * (or silently omitting) its announcement.
 */

export interface TranscriptEntry {
  /** Explicit `role` attribute if present, else the HTML-AAM implicit role
   *  for the element (headings additionally carry their level, e.g.
   *  "heading level 2", matching how NVDA actually announces headings). */
  role: string;
  /** Accessible name per the W3C accname algorithm (via `dom-accessibility-
   *  api`, the same implementation Testing Library uses) for anything with a
   *  genuine accessible-name concept (headings, form controls, role=img).
   *  For a plain-text/live-region "carrier" with no such concept, this is
   *  instead its current rendered text -- what an AT actually speaks when it
   *  encounters (or is notified of a change to) that content. */
  name: string;
  /** Current value for a value-bearing control: slider/spinbutton's numeric
   *  string, or a combobox/listbox's selected option text. */
  value?: string;
  /** e.g. ["checked"], ["not checked"], ["disabled"]. */
  states?: string[];
  /** Set when the entry is itself, or sits inside, a live region. */
  live?: "polite" | "assertive";
}

type ControlRole = "slider" | "spinbutton" | "checkbox" | "combobox" | "listbox" | "button" | "link";

/** Tags this module knows how to treat as a keyboard-focusable control. Any
 *  OTHER element that is (per the DOM) focusable is not walked as a control
 *  at all here -- only these tags are even considered candidates below. */
const FOCUSABLE_TAGS = new Set(["input", "select", "button", "a", "textarea"]);

function isAriaHidden(el: Element): boolean {
  return el.getAttribute("aria-hidden") === "true";
}

/** Inline tags whose text runs directly into surrounding text with no
 *  implied word boundary -- matches the elements our runtime actually uses
 *  inline (spans, labels, links). Anything else (div, h1-h6, p, ...) is
 *  treated as block-level: a screen reader reads block content as separate
 *  lines/paragraphs even when the markup has no literal whitespace between
 *  them, so `visibleText` inserts a boundary there too. */
const INLINE_TAGS = new Set(["SPAN", "A", "B", "I", "EM", "STRONG", "LABEL"]);

/** The rendered text an AT would speak for a plain-content node: concatenates
 *  text node data in document order, skipping any `aria-hidden="true"`
 *  subtree (e.g. the challenge row's decorative glyph mark), inserting a
 *  word boundary around block-level children, and collapsing whitespace.
 *  This is deliberately NOT accname computation -- these nodes (a live-
 *  region summary, the score-status strip, a challenge row) have no formal
 *  accessible-name concept; what matters is the text content itself,
 *  because that's what gets spoken. */
function visibleText(el: Element): string {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (isAriaHidden(child)) continue;
      const childText = visibleText(child);
      if (!childText) continue;
      const block = !INLINE_TAGS.has(child.tagName);
      if (block) out += " ";
      out += childText;
      if (block) out += " ";
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Closest aria-live value on `el` itself or an ancestor (including `el`),
 *  stopping at `root`'s parent. */
function closestLive(el: Element, root: Element): "polite" | "assertive" | undefined {
  let node: Element | null = el;
  while (node) {
    const v = node.getAttribute("aria-live");
    if (v === "polite" || v === "assertive") return v;
    if (node === root) break;
    node = node.parentElement;
  }
  return undefined;
}

/** HTML-AAM implicit role mapping for the focusable element shapes our
 *  engine runtime actually renders, or the element's own explicit `role`
 *  attribute when set. Throws on any focusable tag/type combination this
 *  module doesn't yet recognize -- see file doc comment for why that's the
 *  point, not a bug. */
function controlRoleOf(el: Element): ControlRole {
  const explicit = el.getAttribute("role");
  if (explicit) {
    if (explicit === "slider" || explicit === "spinbutton" || explicit === "checkbox"
      || explicit === "combobox" || explicit === "listbox" || explicit === "button" || explicit === "link") {
      return explicit;
    }
    throw new Error(`readingOrderTranscript: unrecognized explicit role="${explicit}" on a focusable element`);
  }
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (type === "checkbox") return "checkbox";
    throw new Error(`readingOrderTranscript: unmapped focusable element <input type="${type}"> -- extend controlRoleOf`);
  }
  if (tag === "select") {
    const size = (el as HTMLSelectElement).size;
    // HTML-AAM: a <select> with size <= 1 (including the default, 0) maps to
    // combobox; size > 1 maps to listbox.
    return size > 1 ? "listbox" : "combobox";
  }
  if (tag === "button") return "button";
  if (tag === "a") {
    if ((el as HTMLAnchorElement).hasAttribute("href")) return "link";
    throw new Error(`readingOrderTranscript: unmapped focusable element <a> without href -- extend controlRoleOf`);
  }
  throw new Error(`readingOrderTranscript: unmapped focusable element <${tag}> -- extend controlRoleOf`);
}

function describeControl(el: Element, root: Element): TranscriptEntry {
  const role = controlRoleOf(el);
  const name = computeAccessibleName(el);
  const live = closestLive(el, root);
  const states: string[] = [];
  const disabled = (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled;
  if (disabled) states.push("disabled");

  if (role === "slider" || role === "spinbutton") {
    const value = (el as HTMLInputElement).value;
    return { role, name, value, ...(states.length ? { states } : {}), ...(live ? { live } : {}) };
  }
  if (role === "checkbox") {
    const checked = (el as HTMLInputElement).checked;
    states.unshift(checked ? "checked" : "not checked");
    return { role, name, states, ...(live ? { live } : {}) };
  }
  if (role === "combobox" || role === "listbox") {
    const select = el as HTMLSelectElement;
    const value = Array.from(select.selectedOptions).map((o) => o.text).join(", ");
    return { role, name, value, ...(states.length ? { states } : {}), ...(live ? { live } : {}) };
  }
  // button / link: no value.
  return { role, name, ...(states.length ? { states } : {}), ...(live ? { live } : {}) };
}

/** True for a purely decorative `<img alt="">` (never gets its own entry;
 *  see file doc comment). Overlay/background images in the stage are always
 *  rendered with alt="" for exactly this reason. */
function isDecorativeImg(el: Element): boolean {
  return el.tagName === "IMG" && el.getAttribute("alt") === "";
}

type Category = "heading" | "control" | "img" | "status" | "text-carrier";

function categoryOf(el: Element): Category | null {
  const role = el.getAttribute("role");
  if (role === "status") return "status";
  if (/^h[1-6]$/i.test(el.tagName)) return "heading";
  if (FOCUSABLE_TAGS.has(el.tagName.toLowerCase())) return "control";
  if (role === "img") return "img";
  if (el.classList.contains("ilb-score-status") || el.classList.contains("ilb-challenge")) return "text-carrier";
  return null;
}

function buildEntry(el: Element, category: Category, root: Element): TranscriptEntry {
  switch (category) {
    case "heading": {
      const level = el.tagName.slice(1);
      return { role: `heading level ${level}`, name: computeAccessibleName(el) };
    }
    case "control":
      return describeControl(el, root);
    case "img":
      return { role: "img", name: computeAccessibleName(el) };
    case "status": {
      const live = closestLive(el, root) ?? "polite"; // role=status implies polite by default (WAI-ARIA)
      return { role: "status", name: visibleText(el), live };
    }
    case "text-carrier": {
      const live = closestLive(el, root);
      return { role: "text", name: visibleText(el), ...(live ? { live } : {}) };
    }
  }
}

/** Walks `root`'s descendants in document order, collecting one
 *  TranscriptEntry per element that falls into one of the categories this
 *  contract covers (see file doc comment), skipping any `aria-hidden="true"`
 *  subtree and any purely decorative `<img alt="">`. A `text-carrier`
 *  element's own descendants are still walked for nested categories (none of
 *  our current carriers nest a heading/control/img/status, but this keeps
 *  the walk uniform rather than special-casing "stop here"). */
function walk(root: Element, visit: (el: Element, category: Category) => void): void {
  const recurse = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (isAriaHidden(child)) continue; // skip subtree entirely
      if (isDecorativeImg(child)) continue; // leaf; nothing to recurse into either
      const category = categoryOf(child);
      if (category) visit(child, category);
      recurse(child);
    }
  };
  recurse(root);
}

/** Full reading-order transcript: headings, focusable controls, role="img"
 *  elements, role="status" live-region containers (their CURRENT text, not
 *  an accessible name -- see file doc comment), and the visible
 *  .ilb-score-status / .ilb-challenge text carriers. Skips aria-hidden
 *  subtrees and decorative (alt="") images. This is what a screen reader
 *  user moving through the page with a virtual cursor / browse mode
 *  encounters, top to bottom. */
export function readingOrderTranscript(root: Element): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  walk(root, (el, category) => entries.push(buildEntry(el, category, root)));
  return entries;
}

/** Only the keyboard-focusable controls, in DOM (== tab) order -- the
 *  runtime's FOCUS-ORDER INVARIANT (see main.ts) guarantees DOM order and
 *  visual/tab order always agree, so no separate tabindex-aware sort is
 *  needed here. Excludes disabled controls (removed from the tab order by
 *  the browser). */
export function focusOrderTranscript(root: Element): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  walk(root, (el, category) => {
    if (category !== "control") return;
    const disabled = (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled;
    if (disabled) return;
    entries.push(describeControl(el, root));
  });
  return entries;
}

/** Every live region under `root` -- any element carrying its OWN aria-live
 *  attribute (not merely nested inside one) -- with its politeness,
 *  atomicity, and current rendered text. Atomicity follows the WAI-ARIA
 *  implicit default: role="status" (and "alert") default aria-atomic to
 *  true even with no explicit attribute; everything else defaults to false,
 *  as spec'd. */
export function liveRegionsOf(root: Element): Array<{ politeness: string; atomic: boolean; text: string }> {
  const out: Array<{ politeness: string; atomic: boolean; text: string }> = [];
  const visit = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const politeness = child.getAttribute("aria-live");
      if (politeness) {
        const explicitAtomic = child.getAttribute("aria-atomic");
        const role = child.getAttribute("role");
        const atomic = explicitAtomic !== null
          ? explicitAtomic === "true"
          : role === "status" || role === "alert";
        out.push({ politeness, atomic, text: visibleText(child) });
      }
      visit(child);
    }
  };
  visit(root);
  return out;
}
