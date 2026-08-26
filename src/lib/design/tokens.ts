import tokens from "./tokens.json";

/** Single source of truth for the ASU/RDS Base (ASUO) theme.
 *  tokens.json is data so scripts/build-engines.mjs can read it without TS. */
export type TokenName = keyof typeof tokens.colors;

export const RDS_COLOR_NAMES = Object.keys(tokens.colors) as TokenName[];

export function colorHex(name: TokenName): string {
  return tokens.colors[name];
}

export function isTokenName(name: string): name is TokenName {
  return Object.prototype.hasOwnProperty.call(tokens.colors, name);
}

export const FONTS = tokens.fonts;
export const RADIUS = tokens.radius;
export const SPACE = tokens.space;
export const HEADINGS = tokens.headings;
export const MIN_TARGET = tokens.minTarget;

const GENERATED = "/* GENERATED FILE - edit src/lib/design/tokens.json and run npm run build:engines */";

/** :root { --rds-*: ... } block shared by both surfaces. */
export function emitRootVariables(): string {
  const lines = RDS_COLOR_NAMES.map((n) => `  --rds-${n}: ${tokens.colors[n]};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

/** Tailwind v4 @theme mapping for the app chrome (written to src/app/tokens.css). */
export function emitAppThemeCss(): string {
  const colorLines = RDS_COLOR_NAMES.map((n) => `  --color-rds-${n}: ${tokens.colors[n]};`);
  return `${GENERATED}\n${emitRootVariables()}\n\n@theme {\n${colorLines.join("\n")}\n  --font-app: ${tokens.fonts.app};\n  --radius-pill: ${tokens.radius.pill};\n}\n`;
}

/** Tokens layer prepended into the engine runtime's engine.css at build time. */
export function emitEngineTokensCss(): string {
  return `${GENERATED}\n${emitRootVariables()}\n:root {\n  --ilb-font-heading: ${tokens.fonts.lessonHeading};\n  --ilb-font-body: ${tokens.fonts.lessonBody};\n  --ilb-min-target: ${tokens.minTarget};\n}\n`;
}
