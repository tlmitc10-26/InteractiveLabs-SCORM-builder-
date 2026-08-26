# Interactive Lesson Builder (ILB)

Build concept-experimentation interactives (parameter sandboxes, simulations) and export
them as SCORM 1.2 packages for the Canvas LMS SCORM tool.

Spec: `docs/superpowers/specs/2026-08-25-scorm-interactive-builder-design.md`

## Run locally

    npm install
    cp .env.example .env
    npx prisma migrate dev
    npm run db:seed
    npm run build:engines   # only needed after editing src/engine-runtime/**
    npm run dev             # http://localhost:3000

Prisma 7 requires an explicit driver adapter even for local SQLite (see
`src/lib/db-adapter.ts`); `DATABASE_URL` (from `.env`) must be set before
`prisma migrate dev`, `npm run db:seed`, or `scripts/set-policy.ts` will run.

## Tests

    npm test

123+ tests across schema validation, the formula interpreter, the sanitizer,
asset upload/validation, engine-runtime build output, SCORM manifest/adapter
generation, package assembly, the compliance scanner, and a golden
deterministic-export regression test (`tests/golden-export.test.ts`).

## Security model (summary)

- Only audited engine runtimes (`src/engine-runtime/**`, built to `public/engines/**`
  with SHA-256 checksums recorded in the engine manifest) are executable code.
  Designers author JSON configs, never code.
- Formulas run through our own recursive-descent interpreter (`src/lib/formula/`);
  there is no `eval` or `new Function` anywhere in the codebase.
- Rich text (`intro` fields) passes an https-only allowlist sanitizer
  (`src/lib/sanitize.ts`) that strips control characters before scheme checks;
  plain-text fields (labels, units, titles) are fully HTML-escaped.
- Uploaded assets are magic-byte checked against their declared type, capped by
  admin policy (`Policy.maxAssetBytes`), and re-encoded through `sharp` to strip
  embedded metadata before storage.
- Export fails closed behind the compliance scanner (`src/lib/export/scanner.ts`):
  a URL allowlist (empty by default — fully self-contained packages only), a
  forbidden-pattern scan (eval/inline handlers/iframes/`javascript:`/`data:`
  schemes), engine checksum verification, a file-type allowlist, byte-exact
  verification that `index.html` matches the audited launcher output, and
  schema revalidation + sanitizer-idempotence of the authoring config. Every
  export attempt is recorded in `ExportRecord`.
- Policy (URL allowlist, asset size/type caps) is the admin-only `Policy` row,
  maintained via `scripts/set-policy.ts` — there is no designer-facing policy UI
  in v1.

## Canvas import

Export downloads a zip SCORM 1.2 package. Upload it in Canvas via the SCORM LTI
tool; any import mode works (graded imports receive both completion and a
0-100 score).

## Roadmap

Branching Scenario, Case/Evidence Workspace, and Process Simulator engines; sign-in +
admin policy UI; Vercel + Railway deployment; CreateAI generation provider.
