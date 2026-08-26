/** Pure layout math for the parameter-sandbox line chart, split out of
 *  main.ts so it can be unit-tested with a stub `measureText` instead of a
 *  real canvas (jsdom's canvas has no real font metrics).
 *
 *  Fixes the "blurry / clipped axis labels" defect: previously the chart
 *  used a single fixed `pad` on all four sides, so a y-axis label wider or
 *  taller than that pad (e.g. "15.87") could be clipped by the canvas edge.
 *  Here the left gutter is sized from the actual measured width of the
 *  y-axis min/max label text, and the top/bottom padding is sized from the
 *  font size, so a label can never clip regardless of how wide/tall the
 *  plotted numbers turn out to be. */

/** Minimal shape of CanvasRenderingContext2D this module needs, so tests can
 *  pass a stub instead of a real canvas context. */
export interface MeasureTextLike {
  measureText(text: string): { width: number };
}

export interface ChartPlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimum font size (px) for chart axis labels — never render smaller. */
export const CHART_FONT_PX = 12;

/** Breathing room (px) kept between any label's edge and the canvas edge /
 *  the plot frame. */
const CHART_LABEL_PAD = 6;

/** Computes the plot rectangle (in CSS pixels, i.e. the coordinate space
 *  used after a DPR `ctx.setTransform`) for a chart of the given CSS size,
 *  leaving gutters wide enough for the y-axis min/max label text (measured
 *  via `ctx.measureText`) and top/bottom padding sized from the font, so
 *  labels drawn per `chartLayout`'s companion drawing code can never be
 *  clipped by the canvas edge. */
export function chartLayout(
  ctx: MeasureTextLike,
  yMinLabel: string,
  yMaxLabel: string,
  cssWidth: number,
  cssHeight: number,
): ChartPlotRect {
  const yLabelWidth = Math.max(ctx.measureText(yMinLabel).width, ctx.measureText(yMaxLabel).width);
  const leftGutter = Math.ceil(yLabelWidth) + CHART_LABEL_PAD * 2;
  const rightPad = CHART_LABEL_PAD * 2;
  const bottomGutter = CHART_FONT_PX + CHART_LABEL_PAD * 2;
  // Half the font size of top padding so a y-max label, drawn with
  // textBaseline "middle" at the plot's top edge, has its top half-glyph
  // fully above y=0's... rather, fully below the canvas's top edge (y=0).
  const topPad = Math.ceil(CHART_FONT_PX / 2) + CHART_LABEL_PAD;

  const x = leftGutter;
  const y = topPad;
  const w = Math.max(10, cssWidth - leftGutter - rightPad);
  const h = Math.max(10, cssHeight - topPad - bottomGutter);
  return { x, y, w, h };
}
