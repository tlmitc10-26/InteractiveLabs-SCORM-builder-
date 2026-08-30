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
 * engine runtimes render today (see src/engine-runtime/param-sandbox/main.ts
 * and src/engine-runtime/branching-scenario/main.ts) -- headings, the
 * handful of form control types the sandbox builds plus the branching
 * runtime's choice/Continue/Start-over buttons, its canvas[role=img] charts
 * and the branching runtime's scene images, role="status" live-region
 * summaries, and a short, explicit list of plain-text carriers (the
 * sandbox's score/challenge strips; the branching runtime's role line,
 * score line, and path-debrief list). `controlRoleOf` below throws on any
 * focusable element shape it doesn't recognize, on purpose: if engine work
 * ever adds a new focusable control kind (a new link shape, say), this
 * module MUST be extended consciously rather than silently mis-mapping (or
 * silently omitting) its announcement. Native `<input type="radio">` and its
 * checked state (spec docs/superpowers/specs/2026-08-28-case-workspace-
 * design.md §8) is one such conscious extension, added for the case-
 * workspace runtime's Conclude step -- mirrors the pre-existing checkbox
 * checked-state path exactly.
 *
 * Review round F6: <fieldset><legend> is DELIBERATELY out of this module's
 * contract -- `categoryOf` has no case for it (a legend carries no
 * standalone accessible-name concept of its own the way a heading or
 * control does; it contributes to the FIELDSET's accessible name instead),
 * so it never gets a TranscriptEntry here, and its text is invisible to
 * both readingOrderTranscript and focusOrderTranscript. The compensating
 * control for the one place this actually matters -- the case workspace's
 * Conclude step, where choosing a conclusion moves focus onto the (new)
 * reason group's own legend so its text is what gets announced next (spec
 * §3: "focus moves to the reason group's legend") -- is the explicit
 * `document.activeElement`/`.textContent` assertions in
 * tests/sr-transcript-case.test.ts (e.g. "choosing a conclusion flips its
 * radio to checked and reveals its two reason checkboxes, unchecked"),
 * which check the focused legend directly rather than relying on this
 * module to have captured it as a transcript entry.
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

type ControlRole = "slider" | "spinbutton" | "checkbox" | "radio" | "combobox" | "listbox" | "button" | "link";

/** Tags this module knows how to treat as a keyboard-focusable control. Any
 *  OTHER element that is (per the DOM) focusable is not walked as a control
 *  at all here -- only these tags are even considered candidates below. */
const FOCUSABLE_TAGS = new Set(["input", "select", "button", "a", "textarea"]);

function isAriaHidden(el: Element): boolean {
  return el.getAttribute("aria-hidden") === "true";
}

/** True when `el` itself carries the `hidden` content attribute, or sits
 *  inside an ancestor that does (e.g. the branching-scenario runtime's
 *  feedback panel toggling `.hidden` between scene transitions). A hidden
 *  element is removed from the accessibility tree entirely — nothing under
 *  it is ever announced or focusable — so the transcript/live-region walks
 *  below must skip it exactly like an aria-hidden subtree, or a live region
 *  that merely stays hidden (never actually used this run) would still be
 *  double-counted as present. */
function isHidden(el: Element): boolean {
  return (el as HTMLElement).hidden || el.closest("[hidden]") !== null;
}

/** Inline tags whose text runs directly into surrounding text with no
 *  implied word boundary -- matches the elements our runtime actually uses
 *  inline (spans, labels, links). Anything else (div, h1-h6, p, ...) is
 *  treated as block-level: a screen reader reads block content as separate
 *  lines/paragraphs even when the markup has no literal whitespace between
 *  them, so `visibleText` inserts a boundary there too. */
const INLINE_TAGS = new Set(["SPAN", "A", "B", "I", "EM", "STRONG", "LABEL"]);

/** Recursive collector behind `visibleText` below -- concatenates RAW text
 *  node data in document order, skipping any `aria-hidden="true"` subtree,
 *  and inserting a word boundary around block-level children. Deliberately
 *  does NOT collapse/trim whitespace itself (that happens exactly once, in
 *  `visibleText`, after the whole subtree is assembled): collapsing at each
 *  recursion level instead would trim away a real, meaningful trailing/
 *  leading space that lives inside one inline child's own text right at the
 *  boundary with an adjacent inline sibling (e.g. the branching runtime's
 *  debrief list, where a `<span>The First Vote: </span>` is immediately
 *  followed by `<span>Raise your doubts...</span>` with no separate text
 *  node between them) -- collapsing per-level previously ate that boundary
 *  space entirely, producing an incorrect "Vote:Raise" run-on in the
 *  transcript that a real screen reader, reading the actual (unmodified)
 *  DOM text, would never actually produce. */
function visibleTextRaw(el: Element): string {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (isAriaHidden(child)) continue;
      const childText = visibleTextRaw(child);
      if (!childText) continue;
      const block = !INLINE_TAGS.has(child.tagName);
      if (block) out += " ";
      out += childText;
      if (block) out += " ";
    }
  }
  return out;
}

/** The rendered text an AT would speak for a plain-content node: `visibleTextRaw`'s
 *  concatenation, with whitespace collapsed and the ends trimmed exactly
 *  once for the whole subtree -- matching how collapsible whitespace works
 *  for rendered/accessible text generally (runs of whitespace anywhere in
 *  the subtree collapse to one space; only the very start/end of the whole
 *  result is trimmed). This is deliberately NOT accname computation --
 *  these nodes (a live-region summary, the score-status strip, a challenge
 *  row, the branching runtime's role/score-line/debrief-list carriers) have
 *  no formal accessible-name concept; what matters is the text content
 *  itself, because that's what gets spoken. */
function visibleText(el: Element): string {
  return visibleTextRaw(el).replace(/\s+/g, " ").trim();
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
    if (explicit === "slider" || explicit === "spinbutton" || explicit === "checkbox" || explicit === "radio"
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
    if (type === "radio") return "radio";
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
  if (role === "checkbox" || role === "radio") {
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

/** Class names of plain-text/live-region "carrier" elements this contract
 *  tracks -- see the `text-carrier` case in buildEntry and the file doc
 *  comment. Param-sandbox: the score-status strip and each challenge row.
 *  Branching scenario: the juror-role line, the ending's score-summary
 *  line, and the debrief's whole ordered path list (tracked as ONE entry
 *  covering the full rendered text of every step, per-item quality glyphs
 *  and all -- the plan's own "keep scope minimal" guidance prefers this
 *  over adding "list"/"listitem" categories and a per-step entry shape).
 *  The runtime visual pass (2026-08-28) adds one more: the ending's
 *  "Scenario complete" eyebrow -- the ONE deliberate new visible/announced
 *  text that pass introduces (see src/engine-runtime/branching-scenario/
 *  main.ts's renderEnding). Case workspace (M1) reuses "ilb-score-line" and
 *  "ilb-eyebrow" as-is (both are generic, not namespaced per engine -- the
 *  "ilb-" convention is shared vocabulary across runtimes) and adds its own
 *  two PURE-TEXT lists (no interactive controls inside either <li>, same
 *  shape as "ilb-debrief-list" above): the debrief's per-artifact
 *  comparison list and its reason-review list -- both are graded feedback
 *  a screen-reader user must be able to confirm reads correctly, so they
 *  get the same whole-list-as-one-entry treatment rather than being left
 *  untracked like ordinary prose (e.g. an artifact's own body text, or the
 *  expert-rationale block, which stay untracked exactly like branching's
 *  scene/ending body copy). Review round F5 adds one more: "ilb-case-file-
 *  strength" -- the Strong/Weak support label inside each case-file-panel
 *  row (workspace step) -- as its OWN carrier, separate from the row's
 *  artifact-title text (which stays untracked prose exactly like the debrief
 *  carriers' own untracked neighbors above), so a screen-reader user gets an
 *  explicit reading-order confirmation of which strength they assigned to
 *  an artifact, not just a sighted-only cue. */
const TEXT_CARRIER_CLASSES = [
  "ilb-score-status", "ilb-challenge", "ilb-role", "ilb-score-line", "ilb-debrief-list", "ilb-eyebrow",
  "ilb-comparison-list", "ilb-reason-review-list", "ilb-case-file-strength",
];

function categoryOf(el: Element): Category | null {
  const role = el.getAttribute("role");
  if (role === "status") return "status";
  if (/^h[1-6]$/i.test(el.tagName)) return "heading";
  if (FOCUSABLE_TAGS.has(el.tagName.toLowerCase())) return "control";
  // role="img" covers the sandbox's canvas chart (no implicit role of its
  // own); a plain <img> tag already HAS an implicit HTML-AAM role of "img"
  // with no explicit attribute needed -- this only ever sees a NON-
  // decorative <img> here, since `walk` skips alt="" images as a leaf
  // before categoryOf is ever called on them.
  if (role === "img" || el.tagName === "IMG") return "img";
  if (TEXT_CARRIER_CLASSES.some((cls) => el.classList.contains(cls))) return "text-carrier";
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
      if (isHidden(child)) continue; // skip subtree entirely (removed from a11y tree)
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
      if (isHidden(child)) continue; // skip subtree entirely (removed from a11y tree)
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
