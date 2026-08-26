/** WCAG 2.x contrast math (sRGB relative luminance). Pure; used by the editor
 *  (live badges), the schema (export blocking), and tests. */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i.exec(hex.trim());
  if (!m) throw new Error(`invalid hex color "${hex}"`);
  const h = m[1] ? m[1].split("").map((c) => c + c).join("") : m[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 1.4.11 non-text minimum. */
export const meetsNonText = (ratio: number): boolean => ratio >= 3;
/** WCAG 1.4.3 body-text minimum. */
export const meetsBodyText = (ratio: number): boolean => ratio >= 4.5;

export function ratioLabel(ratio: number): string {
  // Floor, never round: the displayed ratio must never overstate compliance
  // (2.95 must show 2.9:1, not 3.0:1).
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}
