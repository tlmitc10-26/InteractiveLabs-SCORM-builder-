#!/usr/bin/env node
/**
 * Renders the demo lab-beaker illustration used by the "Buoyancy Lab v2"
 * interactive to `uploads-source/beaker-demo.png` (800x640, transparent
 * background, PNG with alpha).
 *
 * Committed and reusable: re-run any time the SVG below changes, or to
 * regenerate the PNG from scratch (e.g. after a `git clean`). The SVG is
 * drawn so the beaker's INTERIOR (the water-fill area) sits exactly at
 * x=260..540, y=140..548 of the 800x640 canvas -- callers computing an
 * overlay box for water-fill should derive it from those coordinates.
 *
 * Usage: node scripts/make-demo-beaker.mjs
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const OUT_DIR = path.join(projectRoot, "uploads-source");
const OUT_FILE = path.join(OUT_DIR, "beaker-demo.png");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640">
  <!-- lab beaker: glass walls, open top with small spout, base line; drawn so the
       INTERIOR (water area) is exactly x=260..540, y=140..548 -->
  <g fill="none" stroke="#484848" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 250 120 L 250 520 Q 250 558 288 558 L 512 558 Q 550 558 550 520 L 550 120" />
    <path d="M 250 120 L 232 100" />
    <path d="M 550 120 L 568 100" />
  </g>
  <g stroke="#9aa0a6" stroke-width="4">
    <line x1="524" y1="200" x2="550" y2="200" />
    <line x1="524" y1="290" x2="550" y2="290" />
    <line x1="524" y1="380" x2="550" y2="380" />
    <line x1="524" y1="470" x2="550" y2="470" />
  </g>
</svg>`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const png = await sharp(Buffer.from(svg), { density: 96 })
    .resize(800, 640)
    .png()
    .toBuffer();
  await writeFile(OUT_FILE, png);

  const meta = await sharp(png).metadata();
  console.log(`wrote ${OUT_FILE}`);
  console.log(`  ${meta.width}x${meta.height}, channels=${meta.channels}, hasAlpha=${meta.hasAlpha}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
