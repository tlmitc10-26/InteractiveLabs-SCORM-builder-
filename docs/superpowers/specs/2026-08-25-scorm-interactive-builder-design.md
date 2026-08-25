# Interactive Lesson SCORM Builder: Design Spec

**Date:** 2026-08-25
**Status:** Approved by Tamara Mitchell (2026-08-25)
**Working title:** Interactive Lesson Builder (ILB)

## 1. Purpose

A web application for instructional designers that builds *concept-experimentation interactives*: simulations and manipulable models where learners apply complex concepts by making decisions, changing parameters, and seeing consequences. Not a page-lesson tool (not a Rise substitute). Output is a SCORM 1.2 package ready for upload through the Canvas SCORM LTI tool.

Security-first: designers and (later) AI never author executable code. All executable code is a small library of hand-written, audited "engines." Designer input produces only JSON content validated against each engine's schema. Export is gated by a compliance scanner that fails closed.

## 2. Deployment lifecycle

| Phase | Runtime | Storage | AI | Auth |
|---|---|---|---|---|
| v1 (now) | Local `npm run dev` | SQLite via Prisma; assets in local `uploads/` | None (null provider; AI UI hidden) | None |
| v2 | Vercel (frontend + API routes) | Railway Postgres; Railway volume or S3-compatible asset store | CreateAI token via GenerationProvider | Sign-in (NextAuth), roles: admin / designer |

The v1 code must reach v2 by configuration and adapter swap, not rewrite.

## 3. Architecture

Next.js (App Router) + TypeScript + Tailwind. Single repo, single app. Server logic in Next API routes / server actions behind three interfaces:

- **StorageAdapter**: Prisma models for Project, Interactive, Asset, Policy. SQLite locally, Postgres later. No raw SQL in app code.
- **AssetStore**: `put/get/delete/list` for uploaded binaries. Local-disk implementation now; S3-compatible later.
- **GenerationProvider**: `draftContent(engineId, brief) -> JSON` and `refineContent(engineId, config, instruction) -> JSON`. v1 ships `NullProvider` (feature-flagged off; no AI buttons render). The CreateAI implementation added later returns schema-constrained JSON only. Provider output is always re-validated against the engine schema and sanitized before use; the provider is untrusted.

### Auth seam (v1)

No sign-in in v1. All routes assume a single implicit user. Route handlers take a `context.user` argument populated by a stub, so NextAuth session wiring later touches one module. Admin-only surfaces (policy) have no UI in v1; policy is a seeded database record editable only by direct DB access or a maintenance script.

## 4. Engines

An engine is: one audited vanilla JS/CSS runtime file set + one JSON Schema (content model) + one editor panel + live preview. Engines are versioned; each release is checksummed (SHA-256) and the checksums stored with the engine registry. The preview renders the actual runtime with the current config: preview and export are byte-identical runtimes.

### 4.1 Parameter Sandbox (build first)

Learners manipulate inputs and watch a model respond. Covers chemistry, physics, nutrition math, statistics, any calculable concept.

- **Inputs:** sliders, numeric fields, toggles, select lists; each with label, range/step, units, default.
- **Model:** designer-defined formulas over the inputs. Formulas are written in a small arithmetic expression language (numbers, input references, `+ - * / ^`, parentheses, and a fixed function whitelist: `min, max, abs, round, floor, ceil, sqrt, pow, exp, ln, log10, sin, cos, tan, pi, e`). Parsed and evaluated by our own interpreter. **Never** `eval`/`Function`. Parse errors surface in the editor at authoring time.
- **Outputs:** live values with units; charts (line, bar) plotting outputs across an input's range to show patterns across data.
- **Visual state layer:** uploaded images used as backgrounds and state images. Overlay primitives driven by model outputs: fill level (e.g., water rising in a container), position, rotation, scale, opacity, and image swap keyed to output ranges (image packs: N images mapped to N value bands). Example target: Archimedes principle with a submitted container image, rising water fill, and live displaced-volume readout.
- **Challenges (optional):** prompts with completion criteria ("get output X into range Y"). Meeting all challenges = 100 score; otherwise proportional. With no challenges defined, interaction time/exploration completes the SCO with full score.

### 4.2 Branching Scenario / Role Simulation

The justice-trial pattern. Roles, scenes (text + optional image), decision points, variables that compound across choices (e.g., jury trust), conditional branching on variables, consequence displays, endings, and a debrief screen showing the learner's path against alternative paths. Scoring: designer marks decision quality weights; score derives from path quality; completion on reaching any ending.

### 4.3 Case / Evidence Workspace

Artifact viewer (text excerpts, images, small data tables), evidence tagging/weighing against designer-defined criteria, a conclusion builder (select findings + rationale), and feedback comparing the learner's evidence use to the expert map. Score from evidence-selection accuracy and conclusion match.

### 4.4 Process Simulator

Multi-step professional procedure. Steps have prerequisites; wrong-order or wrong-choice moves produce realistic consequence states (not just "incorrect"). Performance summary at the end. Score from efficiency and correctness.

### 4.5 Dialogue Simulation (deferred, designed-for)

Pre-authored dialogue trees with personas. Schema fits the same engine pattern. A future runtime-AI conversation mode would require an admin-allowlisted network endpoint and is explicitly out of scope until the admin policy system and governance review exist.

## 5. Builder interface

- **Dashboard:** project list, each project holding one or more interactives.
- **New Interactive:** engine gallery with a working mini-demo of each engine.
- **Editor:** split view. Left: structured form for the engine's schema (sections, repeatable rows, drag-reorder). Right: live preview running the real engine runtime, updating as the designer edits. Validation errors shown inline at the field.
- **Asset manager:** shared per project. Upload flow: extension + magic-byte type check (PNG, JPEG, WebP, SVG excluded in v1), size cap from policy, re-encode raster images (strips EXIF/metadata), stored by content hash, referenced from configs by asset ID only.
- **Export:** one button. Runs validation, then the compliance scanner, then either downloads the `.zip` or shows the violation report. No partial exports.

Streamlined is a requirement: the target user is an instructional designer, not a developer. No JSON is ever shown in the primary flow (a read-only "advanced" inspector is acceptable later).

## 6. SCORM packaging

- SCORM 1.2, single SCO.
- `imsmanifest.xml` generated per export (title, identifier, resource file list).
- Our SCORM API adapter: discovers the LMS API object, sets `cmi.core.lesson_status` (completed/passed), `cmi.core.score.raw` (0-100, plus min/max), and `cmi.core.exit`; commits on state changes and `beforeunload`. Suspend data stores in-progress state (`cmi.suspend_data`, respecting the 4096-char 1.2 limit) so learners resume mid-interactive.
- Because Canvas's SCORM upload lets the uploader choose graded (completion / completion+score) or ungraded page view, every package always reports both completion and score; the package works identically under any of Canvas's import modes.
- Package layout: `imsmanifest.xml`, `index.html`, `engine/` (runtime JS/CSS), `content/config.json`, `assets/`.

## 7. Security model and compliance gate

Layered, admin-controlled. Designers cannot see or modify policy.

**By construction (generation-time constraints):**
- Only audited engine runtimes are executable code. Designer/AI input is data (JSON), validated against the engine schema (strict: unknown keys rejected).
- Rich-text fields accept a sanitized subset (bold, italic, lists, sub/superscript for chemistry notation, links with `https:` only, subject to URL policy below). Sanitization server-side with an allowlist sanitizer; everything else escaped.
- Formula fields go through our parser; anything outside the grammar is an authoring-time error.
- Asset uploads validated as in section 5.

**At export (compliance scanner), all must pass or export fails closed:**
1. Every URL in config/content is on the admin allowlist. Default allowlist is empty: fully self-contained packages. (Approved-CDN entries and any future allowlist growth are admin decisions.)
2. No `eval`, `new Function`, inline event handlers (`on*=`), `javascript:`/`data:text/html` URLs, external `<script src>`, or `<iframe>` anywhere in the package output.
3. Engine runtime files byte-match the registered SHA-256 checksums for that engine version.
4. Only expected file types present in the package (html, js, css, json, xml, approved image types).
5. Config revalidates against schema; all text fields pass the sanitizer idempotently (sanitize(x) == x).
6. Scanner emits a human-readable report; on failure, each violation lists file, location, and rule.

**Policy record (admin-only):** URL allowlist, upload size caps, allowed asset types, blocked-pattern set version. Seeded with strictest defaults. Admin UI ships with auth in v2; in v1 changes require the maintenance script.

## 8. Data model (Prisma)

- `Project` (id, title, timestamps)
- `Interactive` (id, projectId, engineId, engineVersion, title, config JSON, timestamps)
- `Asset` (id, projectId, filename, mimeType, byteSize, contentHash, createdAt)
- `Policy` (singleton: allowlistJson, maxAssetBytes, allowedAssetTypes, version)
- `ExportRecord` (id, interactiveId, createdAt, scannerReportJson, passed) for auditability

## 9. Error handling

- Editor: field-level validation inline; save is always allowed (drafts may be invalid), export is not.
- Export: fail closed with the violation report; nothing written on failure. `ExportRecord` rows are kept for both passes and failures.
- Runtime (in Canvas): engine wraps SCORM API discovery in graceful fallback (standalone preview mode when no LMS API found, which is also how local preview works); model evaluation errors show a designer-attributable message, never a blank screen.
- Uploads: reject with specific reason (type, size, decode failure).

## 10. Testing

- **Scanner suite:** fixture packages containing each disallowed pattern (eval, inline handlers, off-allowlist URLs, tampered engine file, smuggled file type, malformed manifest); every fixture must be blocked. This suite is the security regression net and grows with every new bypass idea.
- **Schema/sanitizer unit tests** including hostile strings (script tags, javascript: URLs, event-handler attributes, oversized inputs).
- **Formula interpreter tests:** grammar acceptance/rejection, precedence, division-by-zero and NaN handling, function whitelist enforcement.
- **Golden exports:** stable input config produces a byte-stable package (modulo timestamps); manifest validates against the SCORM 1.2 schema.
- **Engine runtime tests** in-browser (Playwright): interactions work, SCORM calls fire with expected values against a mock API.
- **Manual QA:** import into a Canvas sandbox via the SCORM tool in each of the three import modes; verify grade passback and resume.

## 11. Build order

1. **Skeleton:** Next.js app, Prisma/SQLite, dashboard, project CRUD, adapter interfaces, policy seed.
2. **Parameter Sandbox engine** + editor + live preview + asset upload path (exercises the visual-state and image systems hardest).
3. **Export pipeline:** SCORM wrapper, manifest, zip, compliance scanner + scanner test suite. First real Canvas import test.
4. **Branching Scenario engine.**
5. **Case/Evidence Workspace and Process Simulator engines.**
6. **Hardening + deploy prep:** golden tests, policy maintenance script, Vercel config, documentation.

Auth, CreateAI provider, Railway migration, admin policy UI, and the sandboxed custom-block escape hatch (approach C) are explicitly post-v1.

## 12. Out of scope for v1

- Sign-in / roles (seam only)
- AI generation (null provider only)
- Dialogue Simulation engine
- Runtime AI conversation in packages
- SCORM 2004
- Custom-block escape hatch (future approach C: sandboxed iframe, admin-approved)
- Multi-user collaboration
