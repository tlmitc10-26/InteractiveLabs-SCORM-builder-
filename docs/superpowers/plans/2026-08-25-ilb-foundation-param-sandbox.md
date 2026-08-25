# ILB Foundation + Parameter Sandbox + Export Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-running Next.js app where a designer builds a Parameter Sandbox interactive (formula model + visual states + uploaded images), previews it live, and exports a SCORM 1.2 zip that passes a fail-closed compliance scanner and imports into Canvas.

**Architecture:** Next.js App Router + Prisma/SQLite. All executable learner-facing code is a hand-authored engine runtime, built by esbuild into a checksummed static bundle. Designer input is JSON validated by Zod schemas; text passes an allowlist sanitizer; formulas pass our own interpreter (never `eval`). Export assembles files in memory, runs the scanner, and only then writes the zip.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Tailwind, Prisma + SQLite, Zod, sanitize-html, jszip, sharp, esbuild, Vitest (+jsdom).

**Spec:** `docs/superpowers/specs/2026-08-25-scorm-interactive-builder-design.md`. Covers spec build-order phases 1-3. Engines 4.2-4.4 are separate future plans.

---

## File Map

```
prisma/schema.prisma              # Project, Interactive, Asset, Policy, ExportRecord
prisma/seed.ts                    # strict default Policy singleton
src/lib/db.ts                     # PrismaClient singleton
src/lib/sanitize.ts               # richText + plainText sanitizers
src/lib/formula/parser.ts         # tokenizer + recursive-descent parser -> AST
src/lib/formula/evaluate.ts       # AST evaluator + identifier collection
src/lib/engines/param-sandbox/schema.ts   # Zod authoring schema + validate + toRuntimeConfig
src/lib/engines/registry.ts       # reads public/engines/engines.manifest.json
src/lib/ai/provider.ts            # GenerationProvider interface + NullProvider
src/lib/assets/store.ts           # AssetStore interface + LocalDiskAssetStore (uploads/)
src/lib/assets/validate.ts        # magic-byte sniff, size cap, sharp re-encode
src/lib/scorm/manifest.ts         # imsmanifest.xml builder
src/lib/scorm/index-html.ts       # package index.html template (inline config)
src/lib/export/scanner.ts         # compliance scanner over PackageFiles
src/lib/export/package.ts         # assemble PackageFiles + zip
src/engine-runtime/formula.ts     # re-export of src/lib/formula for bundling
src/engine-runtime/param-sandbox/main.ts  # engine runtime (window.ILBEngine)
src/engine-runtime/param-sandbox/engine.css
src/engine-runtime/scorm-adapter.ts       # window.ILBScorm
scripts/build-engines.mjs         # esbuild -> public/engines/... + engines.manifest.json
public/engines/param-sandbox/1.0.0/{engine.js,engine.css,preview.html}  # build output (committed)
public/engines/scorm/1.0.0/scorm-adapter.js                             # build output (committed)
public/engines/engines.manifest.json                                    # id/version/files/sha256
src/app/page.tsx                            # dashboard (projects)
src/app/projects/[id]/page.tsx              # project: interactives + assets
src/app/interactives/[id]/page.tsx          # editor shell (server)
src/app/interactives/[id]/editor.tsx        # client editor: form + preview iframe
src/app/api/assets/route.ts                 # POST upload
src/app/api/assets/[id]/route.ts            # GET binary (preview serving)
src/app/api/interactives/[id]/export/route.ts  # POST -> zip or 422 report
src/app/actions.ts                          # server actions: CRUD
tests/**                                    # mirrors src/lib + fixtures
```

Conventions used throughout: TypeScript strict; JSON persisted in SQLite as strings via `JSON.stringify`; all new-file code blocks in this plan are the complete file unless a step says "add to".

---

### Task 1: Scaffold app + test runner

**Files:**
- Create: entire Next.js scaffold (generated), `vitest.config.ts`, modify `package.json`, `.gitignore`

- [ ] **Step 1: Scaffold Next.js in the repo root**

Run (PowerShell, from repo root; the trailing `.` targets the current dir):
```powershell
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --no-import-alias --use-npm --turbopack
```
Expected: scaffold completes; `src/app/page.tsx` exists. If it complains the directory is non-empty, it still proceeds since only `docs/` and `.git` exist; if it refuses, scaffold into `tmp-app` and move contents up (`Get-ChildItem tmp-app -Force | Move-Item -Destination .` then remove `tmp-app`).

- [ ] **Step 2: Install runtime + dev dependencies**

```powershell
npm i zod sanitize-html jszip sharp @prisma/client
npm i -D prisma vitest @vitest/coverage-v8 jsdom @types/sanitize-html esbuild tsx
```
Expected: installs clean (sharp ships prebuilt binaries for win32-x64).

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 4: Add scripts to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"build:engines": "node scripts/build-engines.mjs",
"db:seed": "tsx prisma/seed.ts"
```

- [ ] **Step 5: Append to `.gitignore`**

```
uploads/
*.db
*.db-journal
```

- [ ] **Step 6: Verify dev server boots**

Run: `npm run dev` in background, fetch `http://localhost:3000`, expect HTTP 200, then stop it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind, Vitest, deps"
```

---

### Task 2: Prisma schema + policy seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/db.ts`
- Create: `.env` (SQLite URL)

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Project {
  id           String        @id @default(cuid())
  title        String
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  interactives Interactive[]
  assets       Asset[]
}

model Interactive {
  id            String         @id @default(cuid())
  projectId     String
  project       Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  engineId      String
  engineVersion String
  title         String
  configJson    String         @default("{}")
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  exports       ExportRecord[]
}

model Asset {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  filename    String
  mimeType    String
  byteSize    Int
  contentHash String
  createdAt   DateTime @default(now())
}

model Policy {
  id                Int    @id @default(1)
  allowlistJson     String @default("[]")
  maxAssetBytes     Int    @default(5242880)
  allowedAssetTypes String @default("image/png,image/jpeg,image/webp")
  version           Int    @default(1)
}

model ExportRecord {
  id            String      @id @default(cuid())
  interactiveId String
  interactive   Interactive @relation(fields: [interactiveId], references: [id], onDelete: Cascade)
  passed        Boolean
  reportJson    String
  createdAt     DateTime    @default(now())
}
```

- [ ] **Step 2: Create `.env`**

```
DATABASE_URL="file:./dev.db"
```

- [ ] **Step 3: Create `src/lib/db.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: Create `prisma/seed.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.policy.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 }, // schema defaults = strictest policy (empty allowlist)
  });
  console.log("Policy seeded");
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 5: Migrate and seed**

```powershell
npx prisma migrate dev --name init
npm run db:seed
```
Expected: migration applied, "Policy seeded" printed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Prisma schema (Project/Interactive/Asset/Policy/ExportRecord) + strict policy seed"
```

---

### Task 3: Sanitizer (TDD)

**Files:**
- Create: `tests/sanitize.test.ts`, `src/lib/sanitize.ts`

- [ ] **Step 1: Write failing tests `tests/sanitize.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { sanitizeRichText, sanitizePlainText } from "@/lib/sanitize";

describe("sanitizeRichText", () => {
  it("keeps allowed formatting tags", () => {
    const input = "<p>H<sub>2</sub>O is <strong>water</strong></p><ul><li>a</li></ul>";
    expect(sanitizeRichText(input)).toBe(input);
  });
  it("strips script tags entirely", () => {
    expect(sanitizeRichText('<p>hi</p><script>alert(1)</script>')).toBe("<p>hi</p>");
  });
  it("strips inline event handlers", () => {
    expect(sanitizeRichText('<p onclick="x()">hi</p>')).toBe("<p>hi</p>");
  });
  it("removes javascript: links but keeps https links", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeRichText('<a href="https://asu.edu">x</a>')).toBe('<a href="https://asu.edu">x</a>');
  });
  it("removes http:, data:, and relative hrefs (https only)", () => {
    expect(sanitizeRichText('<a href="http://x.com">x</a>')).toBe("<a>x</a>");
    expect(sanitizeRichText('<a href="data:text/html,hi">x</a>')).toBe("<a>x</a>");
  });
  it("strips iframe, img, style tags", () => {
    expect(sanitizeRichText('<iframe src="https://x"></iframe><style>p{}</style>ok')).toBe("ok");
  });
  it("is idempotent on hostile input", () => {
    const once = sanitizeRichText('<p><b onmouseover=x>a</b><script>s</script></p>');
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe("sanitizePlainText", () => {
  it("escapes all HTML", () => {
    expect(sanitizePlainText('<b>x</b>')).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/sanitize.test.ts`
Expected: FAIL (cannot resolve `@/lib/sanitize`).

- [ ] **Step 3: Implement `src/lib/sanitize.ts`**

```ts
import sanitizeHtml from "sanitize-html";

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "b", "strong", "i", "em", "ul", "ol", "li", "sub", "sup", "a"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["https"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  exclusiveFilter: (frame) =>
    frame.tag === "a" && frame.attribs.href !== undefined && !/^https:\/\//i.test(frame.attribs.href),
};

/** Allowlist HTML subset for designer rich-text fields. */
export function sanitizeRichText(input: string): string {
  // sanitize-html drops non-https schemes from allowedSchemes; the exclusiveFilter
  // above is defense in depth. Run twice is unnecessary: output is stable (tested).
  return sanitizeHtml(input, RICH_TEXT_OPTIONS);
}

/** Escape everything: for labels, units, titles. */
export function sanitizePlainText(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: "escape" });
}
```

Note: if the `exclusiveFilter` behavior for `<a href="http://...">` yields `<a href>x</a>` instead of `<a>x</a>`, replace the filter with a `transformTags` entry that deletes non-https hrefs:
```ts
transformTags: {
  a: (tag, attribs) =>
    /^https:\/\//i.test(attribs.href ?? "") ? { tagName: "a", attribs: { href: attribs.href } } : { tagName: "a", attribs: {} },
},
```
Adjust until the tests pass exactly as written; the tests are the contract.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/sanitize.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/sanitize.test.ts src/lib/sanitize.ts
git commit -m "feat: allowlist sanitizers for rich text (https-only links) and plain text"
```

---

### Task 4: Formula interpreter (TDD)

**Files:**
- Create: `tests/formula.test.ts`, `src/lib/formula/parser.ts`, `src/lib/formula/evaluate.ts`

Grammar (recursive descent): `expr := term (('+'|'-') term)*` ; `term := factor (('*'|'/') factor)*` ; `factor := unary ('^' factor)?` (right-assoc) ; `unary := '-' unary | primary` ; `primary := NUMBER | IDENT | IDENT '(' expr (',' expr)* ')' | '(' expr ')'`. Constants `pi`, `e`. Function whitelist per spec: min, max, abs, round, floor, ceil, sqrt, pow, exp, ln, log10, sin, cos, tan.

- [ ] **Step 1: Write failing tests `tests/formula.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseFormula } from "@/lib/formula/parser";
import { evaluateFormula, collectIdentifiers } from "@/lib/formula/evaluate";

function evalOk(src: string, vars: Record<string, number> = {}): number {
  const r = parseFormula(src);
  if (!r.ok) throw new Error(r.error);
  return evaluateFormula(r.ast, vars);
}

describe("parseFormula/evaluateFormula", () => {
  it("arithmetic with precedence", () => {
    expect(evalOk("2 + 3 * 4")).toBe(14);
    expect(evalOk("(2 + 3) * 4")).toBe(20);
    expect(evalOk("2 ^ 3 ^ 2")).toBe(512); // right-assoc
    expect(evalOk("-3 ^ 2")).toBe(-9);     // unary binds looser than ^
  });
  it("variables and constants", () => {
    expect(evalOk("mass / volume", { mass: 10, volume: 4 })).toBe(2.5);
    expect(evalOk("2 * pi")).toBeCloseTo(6.2831853, 5);
  });
  it("whitelisted functions", () => {
    expect(evalOk("min(3, 2, 5)")).toBe(2);
    expect(evalOk("round(sqrt(2) * 100)")).toBe(141);
    expect(evalOk("log10(1000)")).toBeCloseTo(3);
  });
  it("rejects unknown functions at parse time", () => {
    const r = parseFormula("fetch(1)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown function/i);
  });
  it("rejects garbage and out-of-grammar syntax", () => {
    expect(parseFormula("2 +").ok).toBe(false);
    expect(parseFormula("a; alert(1)").ok).toBe(false);
    expect(parseFormula("a[0]").ok).toBe(false);
    expect(parseFormula("").ok).toBe(false);
  });
  it("throws a FormulaError naming unknown variables at eval time", () => {
    const r = parseFormula("x + y");
    if (!r.ok) throw new Error("should parse");
    expect(() => evaluateFormula(r.ast, { x: 1 })).toThrow(/unknown variable "y"/i);
  });
  it("division by zero and NaN become an error, never NaN output", () => {
    const r = parseFormula("1 / x");
    if (!r.ok) throw new Error("should parse");
    expect(() => evaluateFormula(r.ast, { x: 0 })).toThrow(/not a finite number/i);
    const s = parseFormula("sqrt(0 - 1)");
    if (!s.ok) throw new Error("should parse");
    expect(() => evaluateFormula(s.ast, {})).toThrow(/not a finite number/i);
  });
  it("collectIdentifiers returns variable refs, not constants/functions", () => {
    const r = parseFormula("min(mass, 2) * pi + depth");
    if (!r.ok) throw new Error("should parse");
    expect(collectIdentifiers(r.ast).sort()).toEqual(["depth", "mass"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/formula.test.ts` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `src/lib/formula/parser.ts`**

```ts
export type AstNode =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "unary"; op: "-"; operand: AstNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: AstNode; right: AstNode }
  | { kind: "call"; name: string; args: AstNode[] };

export type ParseResult = { ok: true; ast: AstNode } | { ok: false; error: string };

export const FORMULA_FUNCTIONS = [
  "min", "max", "abs", "round", "floor", "ceil", "sqrt",
  "pow", "exp", "ln", "log10", "sin", "cos", "tan",
] as const;

export const FORMULA_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; name: string }
  | { type: "op"; op: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new Error(`invalid number at position ${i}`);
      tokens.push({ type: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ type: "ident", name: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/^(),".includes(c)) { tokens.push({ type: "op", op: c }); i++; continue; }
    throw new Error(`unexpected character "${c}" at position ${i}`);
  }
  return tokens;
}

export function parseFormula(src: string): ParseResult {
  try {
    const tokens = tokenize(src);
    if (tokens.length === 0) throw new Error("empty formula");
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (op: string) => peek()?.type === "op" && (peek() as { op: string }).op === op;
    const expect = (op: string) => {
      if (!isOp(op)) throw new Error(`expected "${op}"`);
      pos++;
    };

    function expr(): AstNode {
      let left = term();
      while (isOp("+") || isOp("-")) {
        const op = (tokens[pos++] as { op: "+" | "-" }).op;
        left = { kind: "binary", op, left, right: term() };
      }
      return left;
    }
    function term(): AstNode {
      let left = factor();
      while (isOp("*") || isOp("/")) {
        const op = (tokens[pos++] as { op: "*" | "/" }).op;
        left = { kind: "binary", op, left, right: factor() };
      }
      return left;
    }
    function factor(): AstNode {
      const base = unary();
      if (isOp("^")) { pos++; return { kind: "binary", op: "^", left: base, right: factor() }; }
      return base;
    }
    function unary(): AstNode {
      if (isOp("-")) { pos++; return { kind: "unary", op: "-", operand: unary() }; }
      return primary();
    }
    function primary(): AstNode {
      const t = peek();
      if (!t) throw new Error("unexpected end of formula");
      if (t.type === "num") { pos++; return { kind: "num", value: t.value }; }
      if (t.type === "ident") {
        pos++;
        if (isOp("(")) {
          if (!(FORMULA_FUNCTIONS as readonly string[]).includes(t.name)) {
            throw new Error(`unknown function "${t.name}"`);
          }
          pos++; // consume (
          const args: AstNode[] = [expr()];
          while (isOp(",")) { pos++; args.push(expr()); }
          expect(")");
          return { kind: "call", name: t.name, args };
        }
        return { kind: "var", name: t.name };
      }
      if (t.type === "op" && t.op === "(") { pos++; const inner = expr(); expect(")"); return inner; }
      throw new Error(`unexpected token "${"op" in t ? t.op : ""}"`);
    }

    const ast = expr();
    if (pos !== tokens.length) throw new Error("unexpected trailing input");
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

Note the unary/`^` interaction: `-3 ^ 2` parses as `-(3^2)` because `unary` is reached only inside `factor`'s base... it is NOT — with the grammar above, `factor := unary ('^' factor)?` gives `(-3)^2 = 9`, which fails the test. Fix: make `unary` sit ABOVE factor: `term := unary (('*'|'/') unary)*` is wrong too. Correct structure that satisfies `-3 ^ 2 === -9` and `2^3^2 === 512`:

```ts
function unary(): AstNode {
  if (isOp("-")) { pos++; return { kind: "unary", op: "-", operand: unary() }; }
  return factor();
}
function term(): AstNode {
  let left = unary();
  while (isOp("*") || isOp("/")) {
    const op = (tokens[pos++] as { op: "*" | "/" }).op;
    left = { kind: "binary", op, left, right: unary() };
  }
  return left;
}
function factor(): AstNode {
  const base = primary();
  if (isOp("^")) { pos++; return { kind: "binary", op: "^", left: base, right: unaryForExponent() }; }
  return base;
}
function unaryForExponent(): AstNode {
  if (isOp("-")) { pos++; return { kind: "unary", op: "-", operand: unaryForExponent() }; }
  return factor();
}
```

Use this corrected set (drop the earlier `factor`/`unary` pair). The tests are the contract; `-3 ^ 2` must be `-9`.

- [ ] **Step 4: Implement `src/lib/formula/evaluate.ts`**

```ts
import { AstNode, FORMULA_CONSTANTS } from "./parser";

export class FormulaError extends Error {}

const FUNCTION_IMPLS: Record<string, (...args: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, round: Math.round,
  floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, pow: Math.pow,
  exp: Math.exp, ln: Math.log, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
};

export function evaluateFormula(ast: AstNode, vars: Record<string, number>): number {
  const result = evalNode(ast, vars);
  if (!Number.isFinite(result)) throw new FormulaError("result is not a finite number");
  return result;
}

function evalNode(node: AstNode, vars: Record<string, number>): number {
  switch (node.kind) {
    case "num": return node.value;
    case "var": {
      if (node.name in vars) return vars[node.name];
      if (node.name in FORMULA_CONSTANTS) return FORMULA_CONSTANTS[node.name];
      throw new FormulaError(`unknown variable "${node.name}"`);
    }
    case "unary": return -evalNode(node.operand, vars);
    case "binary": {
      const l = evalNode(node.left, vars);
      const r = evalNode(node.right, vars);
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": {
          const v = l / r;
          if (!Number.isFinite(v)) throw new FormulaError("result is not a finite number (division by zero)");
          return v;
        }
        case "^": return Math.pow(l, r);
      }
    }
    case "call": {
      const fn = FUNCTION_IMPLS[node.name];
      if (!fn) throw new FormulaError(`unknown function "${node.name}"`);
      return fn(...node.args.map((a) => evalNode(a, vars)));
    }
  }
}

/** Variable references only (constants and function names excluded). */
export function collectIdentifiers(ast: AstNode): string[] {
  const out = new Set<string>();
  walk(ast);
  return [...out];
  function walk(n: AstNode): void {
    if (n.kind === "var" && !(n.name in FORMULA_CONSTANTS)) out.add(n.name);
    else if (n.kind === "unary") walk(n.operand);
    else if (n.kind === "binary") { walk(n.left); walk(n.right); }
    else if (n.kind === "call") n.args.forEach(walk);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/formula.test.ts` — Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add tests/formula.test.ts src/lib/formula
git commit -m "feat: safe formula interpreter (own parser/evaluator, function whitelist, no eval)"
```

---

### Task 5: Parameter Sandbox authoring schema (TDD)

**Files:**
- Create: `tests/param-sandbox-schema.test.ts`, `src/lib/engines/param-sandbox/schema.ts`

- [ ] **Step 1: Write failing tests `tests/param-sandbox-schema.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { validateSandboxConfig, toRuntimeConfig, emptySandboxConfig } from "@/lib/engines/param-sandbox/schema";

const valid = {
  title: "Archimedes Principle",
  intro: "<p>Explore <strong>buoyancy</strong>.</p>",
  inputs: [
    { id: "mass", label: "Object mass", type: "slider", min: 0.1, max: 10, step: 0.1, defaultValue: 1, units: "kg" },
    { id: "density", label: "Fluid", type: "select", defaultValue: 1000, units: "kg/m3",
      options: [{ label: "Water", value: 1000 }, { label: "Oil", value: 900 }] },
  ],
  outputs: [
    { id: "volume", label: "Displaced volume", formula: "mass / density * 1000", units: "L", decimals: 2 },
  ],
  charts: [
    { id: "c1", title: "Volume vs mass", xInputId: "mass", yOutputId: "volume", samples: 40 },
  ],
  visual: {
    backgroundAssetId: "asset_abc",
    overlays: [
      { id: "water", type: "fill", outputId: "volume", inMin: 0, inMax: 10, color: "#4a90d9",
        box: { x: 20, y: 10, w: 60, h: 80 } },
    ],
  },
  challenges: [
    { id: "ch1", prompt: "Displace more than 5 L", outputId: "volume", comparator: "gte", value: 5 },
  ],
};

describe("validateSandboxConfig", () => {
  it("accepts a valid config and sanitizes text fields", () => {
    const r = validateSandboxConfig({ ...valid, intro: '<p>ok</p><script>x</script>' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.intro).toBe("<p>ok</p>");
  });
  it("rejects unknown keys (strict)", () => {
    const r = validateSandboxConfig({ ...valid, injected: "x" });
    expect(r.ok).toBe(false);
  });
  it("rejects formulas that fail to parse", () => {
    const r = validateSandboxConfig({
      ...valid,
      outputs: [{ id: "v", label: "v", formula: "eval(1)" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unknown function/i);
  });
  it("rejects formulas referencing undefined inputs/outputs", () => {
    const r = validateSandboxConfig({
      ...valid,
      outputs: [{ id: "v", label: "v", formula: "massTypo * 2" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/massTypo/);
  });
  it("allows outputs to reference earlier outputs", () => {
    const r = validateSandboxConfig({
      ...valid,
      outputs: [
        { id: "volume", label: "V", formula: "mass / density * 1000" },
        { id: "double", label: "2V", formula: "volume * 2" },
      ],
    });
    expect(r.ok).toBe(true);
  });
  it("rejects duplicate input/output ids and bad id charset", () => {
    expect(validateSandboxConfig({ ...valid, inputs: [valid.inputs[0], valid.inputs[0]] }).ok).toBe(false);
    expect(validateSandboxConfig({
      ...valid, inputs: [{ ...valid.inputs[0], id: "bad id!" }],
    }).ok).toBe(false);
  });
  it("rejects charts referencing unknown ids", () => {
    const r = validateSandboxConfig({
      ...valid, charts: [{ id: "c", title: "t", xInputId: "nope", yOutputId: "volume", samples: 10 }],
    });
    expect(r.ok).toBe(false);
  });
  it("emptySandboxConfig validates", () => {
    expect(validateSandboxConfig(emptySandboxConfig("New interactive")).ok).toBe(true);
  });
});

describe("toRuntimeConfig", () => {
  it("replaces asset ids with resolved urls", () => {
    const r = validateSandboxConfig(valid);
    if (!r.ok) throw new Error("valid fixture");
    const rt = toRuntimeConfig(r.config, (assetId) => `assets/${assetId}.png`);
    expect(rt.visual?.backgroundUrl).toBe("assets/asset_abc.png");
    expect((rt.visual as { backgroundAssetId?: string }).backgroundAssetId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/param-sandbox-schema.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/engines/param-sandbox/schema.ts`**

```ts
import { z } from "zod";
import { parseFormula } from "@/lib/formula/parser";
import { collectIdentifiers } from "@/lib/formula/evaluate";
import { sanitizeRichText, sanitizePlainText } from "@/lib/sanitize";

const idPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const safeId = z.string().min(1).max(40).regex(idPattern, "ids must be letters/digits/underscore");
const plain = (max: number) => z.string().max(max).transform(sanitizePlainText);
const rich = (max: number) => z.string().max(max).transform(sanitizeRichText);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const inputSchema = z.object({
  id: safeId,
  label: plain(120),
  type: z.enum(["slider", "number", "toggle", "select"]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  defaultValue: z.number(),
  units: plain(20).optional(),
  options: z.array(z.object({ label: plain(80), value: z.number() }).strict()).max(20).optional(),
}).strict();

const outputSchema = z.object({
  id: safeId,
  label: plain(120),
  formula: z.string().min(1).max(500),
  units: plain(20).optional(),
  decimals: z.number().int().min(0).max(8).optional(),
}).strict();

const chartSchema = z.object({
  id: safeId,
  title: plain(120),
  xInputId: safeId,
  yOutputId: safeId,
  samples: z.number().int().min(2).max(200),
}).strict();

const boxSchema = z.object({
  x: z.number().min(0).max(100), y: z.number().min(0).max(100),
  w: z.number().min(0).max(100), h: z.number().min(0).max(100),
}).strict();

const overlaySchema = z.discriminatedUnion("type", [
  z.object({
    id: safeId, type: z.literal("fill"), outputId: safeId,
    inMin: z.number(), inMax: z.number(), color: hexColor, box: boxSchema,
  }).strict(),
  z.object({
    id: safeId, type: z.literal("swap"), outputId: safeId, box: boxSchema,
    bands: z.array(z.object({ upTo: z.number(), assetId: z.string().min(1).max(64) }).strict()).min(1).max(12),
  }).strict(),
  z.object({
    id: safeId, type: z.literal("transform"), outputId: safeId, box: boxSchema,
    assetId: z.string().min(1).max(64),
    property: z.enum(["translateY", "translateX", "rotate", "scale", "opacity"]),
    inMin: z.number(), inMax: z.number(), outMin: z.number(), outMax: z.number(),
  }).strict(),
]);

const visualSchema = z.object({
  backgroundAssetId: z.string().min(1).max(64).optional(),
  overlays: z.array(overlaySchema).max(12).default([]),
}).strict();

const challengeSchema = z.object({
  id: safeId,
  prompt: plain(300),
  outputId: safeId,
  comparator: z.enum(["gte", "lte", "between"]),
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).strict();

export const sandboxConfigSchema = z.object({
  title: plain(200),
  intro: rich(5000).optional(),
  inputs: z.array(inputSchema).min(1).max(20),
  outputs: z.array(outputSchema).min(1).max(20),
  charts: z.array(chartSchema).max(6).default([]),
  visual: visualSchema.optional(),
  challenges: z.array(challengeSchema).max(12).default([]),
}).strict();

export type SandboxConfig = z.infer<typeof sandboxConfigSchema>;

export type ValidationResult =
  | { ok: true; config: SandboxConfig }
  | { ok: false; errors: string[] };

export function validateSandboxConfig(raw: unknown): ValidationResult {
  const parsed = sandboxConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const config = parsed.data;
  const errors: string[] = [];

  const inputIds = config.inputs.map((i) => i.id);
  const outputIds = config.outputs.map((o) => o.id);
  const dupes = [...inputIds, ...outputIds].filter((id, i, all) => all.indexOf(id) !== i);
  if (dupes.length) errors.push(`duplicate ids: ${[...new Set(dupes)].join(", ")}`);

  // Formulas: must parse; may reference inputs and earlier outputs only.
  const known = new Set(inputIds);
  for (const out of config.outputs) {
    const r = parseFormula(out.formula);
    if (!r.ok) { errors.push(`output "${out.id}" formula: ${r.error}`); continue; }
    for (const ref of collectIdentifiers(r.ast)) {
      if (!known.has(ref)) errors.push(`output "${out.id}" formula references unknown id "${ref}"`);
    }
    known.add(out.id);
  }

  const outputIdSet = new Set(outputIds);
  const inputIdSet = new Set(inputIds);
  for (const c of config.charts) {
    if (!inputIdSet.has(c.xInputId)) errors.push(`chart "${c.id}": unknown xInputId "${c.xInputId}"`);
    if (!outputIdSet.has(c.yOutputId)) errors.push(`chart "${c.id}": unknown yOutputId "${c.yOutputId}"`);
  }
  for (const ov of config.visual?.overlays ?? []) {
    if (!outputIdSet.has(ov.outputId)) errors.push(`overlay "${ov.id}": unknown outputId "${ov.outputId}"`);
  }
  for (const ch of config.challenges) {
    if (!outputIdSet.has(ch.outputId)) errors.push(`challenge "${ch.id}": unknown outputId "${ch.outputId}"`);
    if (ch.comparator === "between" && (ch.min === undefined || ch.max === undefined))
      errors.push(`challenge "${ch.id}": "between" requires min and max`);
    if ((ch.comparator === "gte" || ch.comparator === "lte") && ch.value === undefined)
      errors.push(`challenge "${ch.id}": "${ch.comparator}" requires value`);
  }
  for (const inp of config.inputs) {
    if ((inp.type === "slider" || inp.type === "number") && (inp.min === undefined || inp.max === undefined))
      errors.push(`input "${inp.id}": ${inp.type} requires min and max`);
    if (inp.type === "select" && !(inp.options && inp.options.length))
      errors.push(`input "${inp.id}": select requires options`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}

/** Runtime config: assetIds resolved to URLs. Shape consumed by the engine runtime. */
export type RuntimeSandboxConfig = Omit<SandboxConfig, "visual"> & {
  visual?: {
    backgroundUrl?: string;
    overlays: Array<
      | { id: string; type: "fill"; outputId: string; inMin: number; inMax: number; color: string; box: { x: number; y: number; w: number; h: number } }
      | { id: string; type: "swap"; outputId: string; box: { x: number; y: number; w: number; h: number }; bands: Array<{ upTo: number; url: string }> }
      | { id: string; type: "transform"; outputId: string; box: { x: number; y: number; w: number; h: number }; url: string; property: "translateY" | "translateX" | "rotate" | "scale" | "opacity"; inMin: number; inMax: number; outMin: number; outMax: number }
    >;
  };
};

export function toRuntimeConfig(config: SandboxConfig, urlForAsset: (assetId: string) => string): RuntimeSandboxConfig {
  const { visual, ...rest } = config;
  if (!visual) return rest;
  return {
    ...rest,
    visual: {
      backgroundUrl: visual.backgroundAssetId ? urlForAsset(visual.backgroundAssetId) : undefined,
      overlays: visual.overlays.map((ov) => {
        if (ov.type === "fill") return ov;
        if (ov.type === "swap") {
          const { bands, ...o } = ov;
          return { ...o, bands: bands.map((b) => ({ upTo: b.upTo, url: urlForAsset(b.assetId) })) };
        }
        const { assetId, ...o } = ov;
        return { ...o, url: urlForAsset(assetId) };
      }),
    },
  };
}

/** All assetIds referenced by a config (for export bundling). */
export function collectAssetIds(config: SandboxConfig): string[] {
  const ids = new Set<string>();
  if (config.visual?.backgroundAssetId) ids.add(config.visual.backgroundAssetId);
  for (const ov of config.visual?.overlays ?? []) {
    if (ov.type === "swap") ov.bands.forEach((b) => ids.add(b.assetId));
    if (ov.type === "transform") ids.add(ov.assetId);
  }
  return [...ids];
}

export function emptySandboxConfig(title: string): SandboxConfig {
  return sandboxConfigSchema.parse({
    title,
    inputs: [{ id: "x", label: "x", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }],
    outputs: [{ id: "y", label: "y", formula: "x * 2" }],
    charts: [],
    challenges: [],
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/param-sandbox-schema.test.ts` — Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/param-sandbox-schema.test.ts src/lib/engines
git commit -m "feat: Parameter Sandbox strict Zod schema, cross-ref validation, runtime config mapping"
```

---

### Task 6: SCORM 1.2 adapter (TDD)

**Files:**
- Create: `tests/scorm-adapter.test.ts`, `src/engine-runtime/scorm-adapter.ts`

The adapter is authored as a module (testable) and also attaches itself to `window.ILBScorm` when a `window` exists (for the built bundle).

- [ ] **Step 1: Write failing tests `tests/scorm-adapter.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createScormSession } from "@/engine-runtime/scorm-adapter";

function mockApi() {
  const data: Record<string, string> = {};
  return {
    data,
    LMSInitialize: vi.fn(() => "true"),
    LMSFinish: vi.fn(() => "true"),
    LMSGetValue: vi.fn((k: string) => data[k] ?? ""),
    LMSSetValue: vi.fn((k: string, v: string) => { data[k] = v; return "true"; }),
    LMSCommit: vi.fn(() => "true"),
    LMSGetLastError: vi.fn(() => "0"),
    LMSGetErrorString: vi.fn(() => ""),
    LMSGetDiagnostic: vi.fn(() => ""),
  };
}

describe("createScormSession", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).API;
  });

  it("standalone mode when no API found", () => {
    const s = createScormSession(window);
    expect(s.mode).toBe("standalone");
    expect(() => s.setScore(50)).not.toThrow();
  });

  it("finds API on window and initializes", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    expect(s.mode).toBe("scorm");
    expect(api.LMSInitialize).toHaveBeenCalledWith("");
  });

  it("finds API on a parent window", () => {
    const api = mockApi();
    const child = { parent: { API: api } } as unknown as Window;
    // make parent chain terminate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child.parent as any).parent = child.parent;
    const s = createScormSession(child);
    expect(s.mode).toBe("scorm");
  });

  it("setScore clamps to 0-100, writes raw/min/max, commits", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    s.setScore(150);
    expect(api.data["cmi.core.score.raw"]).toBe("100");
    expect(api.data["cmi.core.score.min"]).toBe("0");
    expect(api.data["cmi.core.score.max"]).toBe("100");
    expect(api.LMSCommit).toHaveBeenCalled();
  });

  it("setCompleted sets lesson_status and commits", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    s.setCompleted();
    expect(api.data["cmi.core.lesson_status"]).toBe("completed");
  });

  it("suspend data round-trips and rejects >4096 chars", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    expect(s.saveSuspendData({ a: 1 })).toBe(true);
    expect(s.loadSuspendData()).toEqual({ a: 1 });
    expect(s.saveSuspendData({ big: "x".repeat(5000) })).toBe(false);
  });

  it("finish sets exit and calls LMSFinish once", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    s.finish();
    s.finish();
    expect(api.data["cmi.core.exit"]).toBe("");
    expect(api.LMSFinish).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/scorm-adapter.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/engine-runtime/scorm-adapter.ts`**

```ts
/** SCORM 1.2 API adapter. No DOM dependencies beyond window; bundled into packages. */

interface Scorm12Api {
  LMSInitialize(arg: string): string;
  LMSFinish(arg: string): string;
  LMSGetValue(key: string): string;
  LMSSetValue(key: string, value: string): string;
  LMSCommit(arg: string): string;
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

export interface ScormSession {
  mode: "scorm" | "standalone";
  setScore(raw: number): void;
  setCompleted(): void;
  saveSuspendData(state: unknown): boolean;
  loadSuspendData(): unknown | null;
  finish(): void;
}

const MAX_SUSPEND = 4096;

function findApi(win: Window): Scorm12Api | null {
  let w: Window | null = win;
  for (let hops = 0; w && hops < 10; hops++) {
    const api = (w as Window & { API?: Scorm12Api }).API;
    if (api) return api;
    if (w.parent === w) break;
    w = w.parent;
  }
  try {
    const opener = (win as Window & { opener?: Window }).opener;
    const api = opener && (opener as Window & { API?: Scorm12Api }).API;
    if (api) return api;
  } catch { /* cross-origin opener */ }
  return null;
}

export function createScormSession(win: Window): ScormSession {
  const api = findApi(win);
  if (!api) {
    return {
      mode: "standalone",
      setScore() {}, setCompleted() {},
      saveSuspendData() { return true; },
      loadSuspendData() { return null; },
      finish() {},
    };
  }
  api.LMSInitialize("");
  let finished = false;
  const set = (k: string, v: string) => api.LMSSetValue(k, v);
  const commit = () => api.LMSCommit("");

  return {
    mode: "scorm",
    setScore(raw: number) {
      const clamped = Math.max(0, Math.min(100, Math.round(raw)));
      set("cmi.core.score.raw", String(clamped));
      set("cmi.core.score.min", "0");
      set("cmi.core.score.max", "100");
      commit();
    },
    setCompleted() {
      set("cmi.core.lesson_status", "completed");
      commit();
    },
    saveSuspendData(state: unknown): boolean {
      const json = JSON.stringify(state);
      if (json.length > MAX_SUSPEND) return false;
      set("cmi.suspend_data", json);
      commit();
      return true;
    },
    loadSuspendData(): unknown | null {
      const raw = api.LMSGetValue("cmi.suspend_data");
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    finish() {
      if (finished) return;
      finished = true;
      set("cmi.core.exit", "");
      commit();
      api.LMSFinish("");
    },
  };
}

/* Bundle entry behavior: attach to window and finish on unload. */
declare global {
  interface Window { ILBScorm?: ScormSession }
}
if (typeof window !== "undefined" && typeof document !== "undefined" && !("__vitest_worker__" in globalThis)) {
  const session = createScormSession(window);
  window.ILBScorm = session;
  window.addEventListener("beforeunload", () => session.finish());
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/scorm-adapter.test.ts` — Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/scorm-adapter.test.ts src/engine-runtime/scorm-adapter.ts
git commit -m "feat: SCORM 1.2 adapter with API discovery, score/completion, suspend data, standalone fallback"
```

---

### Task 7: Parameter Sandbox engine runtime + build script

**Files:**
- Create: `src/engine-runtime/param-sandbox/main.ts`, `src/engine-runtime/param-sandbox/engine.css`, `src/engine-runtime/param-sandbox/preview.html`, `scripts/build-engines.mjs`
- Create (build output, committed): `public/engines/param-sandbox/1.0.0/engine.js`, `.../engine.css`, `.../preview.html`, `public/engines/scorm/1.0.0/scorm-adapter.js`, `public/engines/engines.manifest.json`
- Create: `tests/engine-runtime.test.ts`

The runtime exposes `window.ILBEngine.mount(root, runtimeConfig)`. It imports the formula interpreter from `src/lib/formula` (esbuild bundles it), renders inputs/outputs/chart/visual stage/challenges, recomputes on every input event, and drives SCORM via `window.ILBScorm` if present.

- [ ] **Step 1: Write failing runtime tests `tests/engine-runtime.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { mountSandbox } from "@/engine-runtime/param-sandbox/main";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";

const config: RuntimeSandboxConfig = {
  title: "Test",
  inputs: [{ id: "mass", label: "Mass", type: "slider", min: 0, max: 10, step: 1, defaultValue: 4, units: "kg" }],
  outputs: [{ id: "double", label: "Double", formula: "mass * 2", units: "kg", decimals: 0 }],
  charts: [],
  challenges: [{ id: "c1", prompt: "Reach 12", outputId: "double", comparator: "gte", value: 12 }],
};

describe("mountSandbox", () => {
  beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; });

  it("renders inputs and computes outputs from defaults", () => {
    mountSandbox(document.getElementById("root")!, config);
    const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
    expect(out.textContent).toBe("8");
  });

  it("recomputes when an input changes", () => {
    mountSandbox(document.getElementById("root")!, config);
    const slider = document.querySelector('input[data-input="mass"]') as HTMLInputElement;
    slider.value = "6";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const out = document.querySelector('[data-output="double"] .ilb-output-value')!;
    expect(out.textContent).toBe("12");
  });

  it("marks challenges met and unmet", () => {
    mountSandbox(document.getElementById("root")!, config);
    const slider = document.querySelector('input[data-input="mass"]') as HTMLInputElement;
    expect(document.querySelector('[data-challenge="c1"]')!.classList.contains("met")).toBe(false);
    slider.value = "7";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector('[data-challenge="c1"]')!.classList.contains("met")).toBe(true);
  });

  it("renders a fill overlay whose height tracks the output", () => {
    mountSandbox(document.getElementById("root")!, {
      ...config,
      visual: {
        overlays: [{ id: "w", type: "fill", outputId: "double", inMin: 0, inMax: 20, color: "#4a90d9", box: { x: 0, y: 0, w: 100, h: 100 } }],
      },
    });
    const fill = document.querySelector('[data-overlay="w"] .ilb-fill') as HTMLElement;
    expect(fill.style.height).toBe("40%"); // 8 of 0..20
  });

  it("never renders unsanitized text as HTML in labels", () => {
    mountSandbox(document.getElementById("root")!, {
      ...config,
      outputs: [{ id: "double", label: '<img src=x onerror=alert(1)>', formula: "mass * 2" }],
    });
    expect(document.querySelector("img")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/engine-runtime.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/engine-runtime/param-sandbox/main.ts`**

```ts
import { parseFormula, AstNode } from "@/lib/formula/parser";
import { evaluateFormula } from "@/lib/formula/evaluate";
import type { RuntimeSandboxConfig } from "@/lib/engines/param-sandbox/schema";

type Overlay = NonNullable<RuntimeSandboxConfig["visual"]>["overlays"][number];

/** Mount the Parameter Sandbox. Labels/units via textContent (never innerHTML);
 *  only `intro` may contain markup and it arrives pre-sanitized from the builder. */
export function mountSandbox(root: HTMLElement, config: RuntimeSandboxConfig): void {
  root.innerHTML = "";
  root.classList.add("ilb-sandbox");

  const asts = new Map<string, AstNode>();
  for (const out of config.outputs) {
    const r = parseFormula(out.formula);
    if (r.ok) asts.set(out.id, r.ast);
  }

  const values: Record<string, number> = {};
  for (const inp of config.inputs) values[inp.id] = inp.defaultValue;

  let interacted = false;
  const scorm = typeof window !== "undefined" ? window.ILBScorm : undefined;

  // Resume: restore saved input values from SCORM suspend data (spec 6).
  const saved = scorm?.loadSuspendData() as { values?: Record<string, number> } | null;
  if (saved && saved.values) {
    for (const inp of config.inputs) {
      const v = saved.values[inp.id];
      if (typeof v === "number") values[inp.id] = v;
    }
    interacted = true;
  }

  // ---------- header ----------
  const header = el("div", "ilb-header");
  const h1 = el("h1"); h1.textContent = config.title; header.appendChild(h1);
  if (config.intro) {
    const intro = el("div", "ilb-intro");
    intro.innerHTML = config.intro; // sanitized at authoring + revalidated at export
    header.appendChild(intro);
  }
  root.appendChild(header);

  const layout = el("div", "ilb-layout");
  root.appendChild(layout);

  // ---------- inputs ----------
  const inputsPanel = el("div", "ilb-inputs");
  layout.appendChild(inputsPanel);
  for (const inp of config.inputs) {
    const row = el("label", "ilb-input-row");
    const lab = el("span", "ilb-input-label");
    lab.textContent = inp.units ? `${inp.label} (${inp.units})` : inp.label;
    row.appendChild(lab);

    let control: HTMLElement;
    if (inp.type === "select") {
      const sel = document.createElement("select");
      sel.dataset.input = inp.id;
      for (const opt of inp.options ?? []) {
        const o = document.createElement("option");
        o.value = String(opt.value); o.textContent = opt.label;
        if (opt.value === values[inp.id]) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => { values[inp.id] = Number(sel.value); onInteract(); });
      control = sel;
    } else if (inp.type === "toggle") {
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.dataset.input = inp.id; cb.checked = values[inp.id] !== 0;
      cb.addEventListener("change", () => { values[inp.id] = cb.checked ? 1 : 0; onInteract(); });
      control = cb;
    } else {
      const num = document.createElement("input");
      num.type = inp.type === "slider" ? "range" : "number";
      num.dataset.input = inp.id;
      num.min = String(inp.min ?? 0); num.max = String(inp.max ?? 100);
      num.step = String(inp.step ?? "any"); num.value = String(values[inp.id]);
      const valueBadge = el("span", "ilb-input-value");
      valueBadge.textContent = String(values[inp.id]);
      num.addEventListener("input", () => {
        values[inp.id] = Number(num.value);
        valueBadge.textContent = num.value;
        onInteract();
      });
      const wrap = el("span", "ilb-input-control");
      wrap.appendChild(num); wrap.appendChild(valueBadge);
      control = wrap;
    }
    row.appendChild(control);
    inputsPanel.appendChild(row);
  }

  // ---------- stage (visual layer) ----------
  let stage: HTMLElement | null = null;
  if (config.visual && (config.visual.backgroundUrl || config.visual.overlays.length)) {
    stage = el("div", "ilb-stage");
    if (config.visual.backgroundUrl) {
      const bg = document.createElement("img");
      bg.className = "ilb-stage-bg"; bg.alt = ""; bg.src = config.visual.backgroundUrl;
      stage.appendChild(bg);
    }
    for (const ov of config.visual.overlays) {
      const holder = el("div", "ilb-overlay");
      holder.dataset.overlay = ov.id;
      holder.style.left = `${ov.box.x}%`; holder.style.top = `${ov.box.y}%`;
      holder.style.width = `${ov.box.w}%`; holder.style.height = `${ov.box.h}%`;
      if (ov.type === "fill") {
        const fill = el("div", "ilb-fill");
        fill.style.background = ov.color;
        holder.appendChild(fill);
      } else {
        const img = document.createElement("img");
        img.className = "ilb-overlay-img"; img.alt = "";
        holder.appendChild(img);
      }
      stage.appendChild(holder);
    }
    layout.appendChild(stage);
  }

  // ---------- outputs ----------
  const outputsPanel = el("div", "ilb-outputs");
  layout.appendChild(outputsPanel);
  for (const out of config.outputs) {
    const card = el("div", "ilb-output");
    card.dataset.output = out.id;
    const lab = el("div", "ilb-output-label"); lab.textContent = out.label;
    const val = el("div", "ilb-output-value");
    const unit = el("span", "ilb-output-units"); unit.textContent = out.units ?? "";
    card.appendChild(lab); card.appendChild(val); card.appendChild(unit);
    outputsPanel.appendChild(card);
  }

  // ---------- charts ----------
  const chartCanvases = new Map<string, HTMLCanvasElement>();
  for (const chart of config.charts) {
    const wrap = el("div", "ilb-chart");
    const title = el("div", "ilb-chart-title"); title.textContent = chart.title;
    const canvas = document.createElement("canvas");
    canvas.width = 480; canvas.height = 220; canvas.dataset.chart = chart.id;
    wrap.appendChild(title); wrap.appendChild(canvas);
    outputsPanel.appendChild(wrap);
    chartCanvases.set(chart.id, canvas);
  }

  // ---------- challenges ----------
  if (config.challenges.length) {
    const panel = el("div", "ilb-challenges");
    const h = el("h2"); h.textContent = "Challenges"; panel.appendChild(h);
    for (const ch of config.challenges) {
      const row = el("div", "ilb-challenge");
      row.dataset.challenge = ch.id;
      const mark = el("span", "ilb-challenge-mark");
      const text = el("span"); text.textContent = ch.prompt;
      row.appendChild(mark); row.appendChild(text);
      panel.appendChild(row);
    }
    root.appendChild(panel);
  }

  // ---------- compute & render ----------
  function computeOutputs(vars: Record<string, number>): Record<string, number | null> {
    const scope: Record<string, number> = { ...vars };
    const results: Record<string, number | null> = {};
    for (const out of config.outputs) {
      const ast = asts.get(out.id);
      if (!ast) { results[out.id] = null; continue; }
      try {
        const v = evaluateFormula(ast, scope);
        scope[out.id] = v;
        results[out.id] = v;
      } catch { results[out.id] = null; }
    }
    return results;
  }

  function render(): void {
    const results = computeOutputs(values);
    for (const out of config.outputs) {
      const v = results[out.id];
      const elv = root.querySelector(`[data-output="${out.id}"] .ilb-output-value`)!;
      elv.textContent = v === null ? "—" : v.toFixed(out.decimals ?? 2).replace(/\.?0+$/, "") || "0";
    }
    if (stage && config.visual) {
      for (const ov of config.visual.overlays) renderOverlay(ov, results[ov.outputId]);
    }
    let met = 0;
    for (const ch of config.challenges) {
      const v = results[ch.outputId];
      const ok = v !== null && (
        (ch.comparator === "gte" && v >= (ch.value ?? 0)) ||
        (ch.comparator === "lte" && v <= (ch.value ?? 0)) ||
        (ch.comparator === "between" && v >= (ch.min ?? 0) && v <= (ch.max ?? 0)));
      if (ok) met++;
      root.querySelector(`[data-challenge="${ch.id}"]`)?.classList.toggle("met", ok);
    }
    for (const chart of config.charts) drawChart(chart, chartCanvases.get(chart.id)!);
    reportScorm(met);
  }

  function renderOverlay(ov: Overlay, value: number | null): void {
    const holder = root.querySelector(`[data-overlay="${ov.id}"]`) as HTMLElement | null;
    if (!holder || value === null) return;
    if (ov.type === "fill") {
      const t = clamp01((value - ov.inMin) / (ov.inMax - ov.inMin));
      (holder.querySelector(".ilb-fill") as HTMLElement).style.height = `${Math.round(t * 100)}%`;
    } else if (ov.type === "swap") {
      const band = ov.bands.find((b) => value <= b.upTo) ?? ov.bands[ov.bands.length - 1];
      const img = holder.querySelector("img") as HTMLImageElement;
      if (img.getAttribute("src") !== band.url) img.src = band.url;
    } else {
      const t = clamp01((value - ov.inMin) / (ov.inMax - ov.inMin));
      const out = ov.outMin + t * (ov.outMax - ov.outMin);
      const img = holder.querySelector("img") as HTMLImageElement;
      if (!img.getAttribute("src")) img.src = ov.url;
      if (ov.property === "opacity") img.style.opacity = String(out);
      else if (ov.property === "rotate") img.style.transform = `rotate(${out}deg)`;
      else if (ov.property === "scale") img.style.transform = `scale(${out})`;
      else if (ov.property === "translateX") img.style.transform = `translateX(${out}%)`;
      else img.style.transform = `translateY(${out}%)`;
    }
  }

  function drawChart(chart: RuntimeSandboxConfig["charts"][number], canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const inp = config.inputs.find((i) => i.id === chart.xInputId);
    if (!inp || inp.min === undefined || inp.max === undefined) return;
    const pts: Array<[number, number]> = [];
    for (let s = 0; s < chart.samples; s++) {
      const x = inp.min + (s / (chart.samples - 1)) * (inp.max - inp.min);
      const r = computeOutputs({ ...values, [chart.xInputId]: x });
      const y = r[chart.yOutputId];
      if (y !== null) pts.push([x, y]);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts.length < 2) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
    const pad = 28;
    const px = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * (canvas.width - 2 * pad);
    const py = (y: number) => canvas.height - pad - ((y - yMin) / (yMax - yMin || 1)) * (canvas.height - 2 * pad);
    ctx.strokeStyle = "#9aa0a6"; ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, canvas.width - 2 * pad, canvas.height - 2 * pad);
    ctx.strokeStyle = "#8C1D40"; ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.stroke();
    // current-position marker
    const cur = computeOutputs(values)[chart.yOutputId];
    const curX = values[chart.xInputId];
    if (cur !== null && curX >= xMin && curX <= xMax) {
      ctx.fillStyle = "#B8860B";
      ctx.beginPath(); ctx.arc(px(curX), py(cur), 4, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.fillStyle = "#5f6368"; ctx.font = "11px sans-serif";
    ctx.fillText(String(round2(xMin)), pad, canvas.height - 8);
    ctx.fillText(String(round2(xMax)), canvas.width - pad - 24, canvas.height - 8);
    ctx.fillText(String(round2(yMax)), 2, pad + 8);
    ctx.fillText(String(round2(yMin)), 2, canvas.height - pad);
  }

  function reportScorm(challengesMet: number): void {
    if (!scorm || scorm.mode !== "scorm") return;
    if (!interacted) return;
    if (config.challenges.length === 0) {
      scorm.setScore(100);
      scorm.setCompleted();
    } else {
      scorm.setScore((challengesMet / config.challenges.length) * 100);
      if (challengesMet === config.challenges.length) scorm.setCompleted();
    }
  }

  function onInteract(): void {
    interacted = true;
    render();
    scorm?.saveSuspendData({ values });
  }

  render();
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const round2 = (n: number) => Math.round(n * 100) / 100;

/* Bundle entry: expose mount API. */
declare global {
  interface Window { ILBEngine?: { mount: typeof mountSandbox } }
}
if (typeof window !== "undefined") {
  window.ILBEngine = { mount: mountSandbox };
}
```

- [ ] **Step 4: Run runtime tests**

Run: `npm test -- tests/engine-runtime.test.ts` — Expected: PASS (5 tests). The `never renders unsanitized text` test passes because labels use `textContent`.

- [ ] **Step 5: Create `src/engine-runtime/param-sandbox/engine.css`**

```css
.ilb-sandbox { font-family: Georgia, "Times New Roman", serif; color: #1b1b1b; max-width: 960px; margin: 0 auto; padding: 16px; }
.ilb-sandbox h1 { color: #8C1D40; font-size: 1.6rem; margin: 0 0 8px; }
.ilb-sandbox h2 { color: #8C1D40; font-size: 1.1rem; margin: 16px 0 8px; }
.ilb-intro { background: #fff8e1; border-left: 4px solid #B8860B; padding: 8px 12px; margin-bottom: 12px; }
.ilb-layout { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 760px) { .ilb-layout { grid-template-columns: 260px 1fr; } .ilb-layout:has(.ilb-stage) { grid-template-columns: 260px 1fr 1fr; } }
.ilb-inputs, .ilb-outputs, .ilb-challenges { background: #fff; border: 1px solid #D6D2CC; border-radius: 8px; padding: 12px; }
.ilb-input-row { display: block; margin-bottom: 14px; }
.ilb-input-label { display: block; font-weight: bold; font-size: 0.9rem; margin-bottom: 4px; }
.ilb-input-control { display: flex; align-items: center; gap: 8px; }
.ilb-input-control input[type="range"] { flex: 1; accent-color: #8C1D40; }
.ilb-input-value { min-width: 3ch; font-variant-numeric: tabular-nums; }
.ilb-stage { position: relative; border: 1px solid #D6D2CC; border-radius: 8px; overflow: hidden; min-height: 240px; background: #f7f5f2; }
.ilb-stage-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.ilb-overlay { position: absolute; }
.ilb-fill { position: absolute; bottom: 0; left: 0; width: 100%; height: 0%; opacity: 0.65; transition: height 120ms ease; }
.ilb-overlay-img { width: 100%; height: 100%; object-fit: contain; transition: transform 120ms ease, opacity 120ms ease; }
.ilb-output { display: flex; align-items: baseline; gap: 8px; padding: 6px 0; border-bottom: 1px solid #eee; }
.ilb-output-label { flex: 1; }
.ilb-output-value { font-size: 1.3rem; font-weight: bold; color: #8C1D40; font-variant-numeric: tabular-nums; }
.ilb-output-units { color: #5f6368; font-size: 0.85rem; }
.ilb-chart { margin-top: 12px; }
.ilb-chart canvas { width: 100%; height: auto; }
.ilb-chart-title { font-size: 0.9rem; font-weight: bold; margin-bottom: 4px; }
.ilb-challenge { display: flex; gap: 8px; align-items: center; padding: 6px 0; }
.ilb-challenge-mark::before { content: "○"; color: #9aa0a6; }
.ilb-challenge.met .ilb-challenge-mark::before { content: "●"; color: #2e7d32; }
```

- [ ] **Step 6: Create `src/engine-runtime/param-sandbox/preview.html`** (served from `public/engines/param-sandbox/1.0.0/`, receives config via postMessage from the editor)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Preview</title>
  <link rel="stylesheet" href="engine.css" />
</head>
<body>
  <div id="ilb-root"></div>
  <script src="engine.js"></script>
  <script>
    window.addEventListener("message", function (ev) {
      if (!ev.data || ev.data.type !== "ilb-config") return;
      window.ILBEngine.mount(document.getElementById("ilb-root"), ev.data.config);
    });
    window.parent.postMessage({ type: "ilb-preview-ready" }, "*");
  </script>
</body>
</html>
```

- [ ] **Step 7: Create `scripts/build-engines.mjs`**

```js
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "engines");
const ENGINE_VERSION = "1.0.0";
const SCORM_VERSION = "1.0.0";

const sandboxDir = path.join(OUT, "param-sandbox", ENGINE_VERSION);
const scormDir = path.join(OUT, "scorm", SCORM_VERSION);
mkdirSync(sandboxDir, { recursive: true });
mkdirSync(scormDir, { recursive: true });

await build({
  entryPoints: [path.join(ROOT, "src/engine-runtime/param-sandbox/main.ts")],
  bundle: true,
  minify: false, // auditable output
  format: "iife",
  target: "es2019",
  outfile: path.join(sandboxDir, "engine.js"),
  alias: { "@": path.join(ROOT, "src") },
});

await build({
  entryPoints: [path.join(ROOT, "src/engine-runtime/scorm-adapter.ts")],
  bundle: true,
  minify: false,
  format: "iife",
  target: "es2019",
  outfile: path.join(scormDir, "scorm-adapter.js"),
  alias: { "@": path.join(ROOT, "src") },
});

copyFileSync(path.join(ROOT, "src/engine-runtime/param-sandbox/engine.css"), path.join(sandboxDir, "engine.css"));
copyFileSync(path.join(ROOT, "src/engine-runtime/param-sandbox/preview.html"), path.join(sandboxDir, "preview.html"));

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const manifest = {
  generatedAt: new Date().toISOString(),
  engines: [
    {
      id: "param-sandbox",
      version: ENGINE_VERSION,
      title: "Parameter Sandbox",
      files: {
        "engine.js": sha256(path.join(sandboxDir, "engine.js")),
        "engine.css": sha256(path.join(sandboxDir, "engine.css")),
      },
    },
  ],
  scorm: {
    version: SCORM_VERSION,
    files: { "scorm-adapter.js": sha256(path.join(scormDir, "scorm-adapter.js")) },
  },
};
writeFileSync(path.join(OUT, "engines.manifest.json"), JSON.stringify(manifest, null, 2));
console.log("Engines built and manifest written.");
```

- [ ] **Step 8: Build engines and verify output**

Run: `npm run build:engines`
Expected: "Engines built and manifest written." and the five files exist under `public/engines/`. Confirm `engine.js` contains no `eval` usage: `Select-String -Path public/engines/param-sandbox/1.0.0/engine.js -Pattern "eval\("` returns nothing.

- [ ] **Step 9: Create `src/lib/engines/registry.ts`**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

export interface EngineManifest {
  generatedAt: string;
  engines: Array<{ id: string; version: string; title: string; files: Record<string, string> }>;
  scorm: { version: string; files: Record<string, string> };
}

export function loadEngineManifest(): EngineManifest {
  const p = path.join(process.cwd(), "public", "engines", "engines.manifest.json");
  return JSON.parse(readFileSync(p, "utf8")) as EngineManifest;
}

export function engineDir(id: string, version: string): string {
  return path.join(process.cwd(), "public", "engines", id, version);
}

export function scormDir(version: string): string {
  return path.join(process.cwd(), "public", "engines", "scorm", version);
}
```

- [ ] **Step 10: Run full test suite, commit (build output IS committed — audited artifacts)**

Run: `npm test` — Expected: all green.

```bash
git add -A
git commit -m "feat: Parameter Sandbox engine runtime, visual overlays, chart, SCORM reporting, esbuild pipeline + checksummed manifest"
```

---

### Task 8: AI provider seam + project/interactive CRUD + dashboard

**Files:**
- Create: `src/lib/ai/provider.ts`, `src/app/actions.ts`
- Modify: `src/app/page.tsx` (replace scaffold), `src/app/layout.tsx` (title only)
- Create: `src/app/projects/[id]/page.tsx`

- [ ] **Step 1: Create `src/lib/ai/provider.ts`** (the CreateAI seam; nothing calls it in v1)

```ts
/** Generation provider seam. v1 ships NullProvider: no key, no calls, no AI UI.
 *  The future CreateAI implementation must return schema-shaped JSON only;
 *  callers ALWAYS revalidate with validateSandboxConfig before use. */
export interface GenerationProvider {
  readonly enabled: boolean;
  draftContent(engineId: string, brief: string): Promise<unknown>;
  refineContent(engineId: string, config: unknown, instruction: string): Promise<unknown>;
}

class NullProvider implements GenerationProvider {
  readonly enabled = false;
  async draftContent(): Promise<unknown> {
    throw new Error("AI generation is not enabled in this build");
  }
  async refineContent(): Promise<unknown> {
    throw new Error("AI generation is not enabled in this build");
  }
}

export function getGenerationProvider(): GenerationProvider {
  return new NullProvider();
}
```

- [ ] **Step 2: Create `src/app/actions.ts`**

```ts
"use server";

import { prisma } from "@/lib/db";
import { emptySandboxConfig, validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createProject(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) return;
  const project = await prisma.project.create({ data: { title } });
  redirect(`/projects/${project.id}`);
}

export async function deleteProject(formData: FormData) {
  await prisma.project.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/");
}

export async function createInteractive(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const title = String(formData.get("title") ?? "").trim().slice(0, 200) || "Untitled interactive";
  const interactive = await prisma.interactive.create({
    data: {
      projectId,
      title,
      engineId: "param-sandbox",
      engineVersion: "1.0.0",
      configJson: JSON.stringify(emptySandboxConfig(title)),
    },
  });
  redirect(`/interactives/${interactive.id}`);
}

export async function deleteInteractive(formData: FormData) {
  const id = String(formData.get("id"));
  const row = await prisma.interactive.delete({ where: { id } });
  revalidatePath(`/projects/${row.projectId}`);
}

/** Saves a draft. Drafts may be invalid (per spec 9); returns validation state for the UI. */
export async function saveInteractiveConfig(id: string, rawConfig: unknown, title: string) {
  const result = validateSandboxConfig(rawConfig);
  await prisma.interactive.update({
    where: { id },
    data: {
      title: title.trim().slice(0, 200) || "Untitled interactive",
      configJson: JSON.stringify(rawConfig),
    },
  });
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
}
```

- [ ] **Step 3: Replace `src/app/page.tsx`** (dashboard)

```tsx
import { prisma } from "@/lib/db";
import { createProject, deleteProject } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { interactives: true } } },
  });
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold text-[#8C1D40]">Interactive Lesson Builder</h1>
      <p className="mt-1 text-sm text-gray-600">Build concept-experimentation interactives and export SCORM packages for Canvas.</p>

      <form action={createProject} className="mt-6 flex gap-2">
        <input name="title" placeholder="New project title" required maxLength={200}
          className="flex-1 rounded border border-gray-300 px-3 py-2" />
        <button className="rounded bg-[#8C1D40] px-4 py-2 text-white">Create project</button>
      </form>

      <ul className="mt-6 divide-y rounded border border-gray-200 bg-white">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-3">
            <Link href={`/projects/${p.id}`} className="font-medium text-[#8C1D40] hover:underline">
              {p.title}
            </Link>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{p._count.interactives} interactive{p._count.interactives === 1 ? "" : "s"}</span>
              <form action={deleteProject}>
                <input type="hidden" name="id" value={p.id} />
                <button className="text-red-700 hover:underline">Delete</button>
              </form>
            </div>
          </li>
        ))}
        {projects.length === 0 && <li className="px-4 py-6 text-gray-500">No projects yet.</li>}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Create `src/app/projects/[id]/page.tsx`**

```tsx
import { prisma } from "@/lib/db";
import { createInteractive, deleteInteractive } from "@/app/actions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetPanel } from "./asset-panel";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { interactives: { orderBy: { updatedAt: "desc" } }, assets: { orderBy: { createdAt: "desc" } } },
  });
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-gray-500 hover:underline">&larr; Projects</Link>
      <h1 className="mt-2 text-2xl font-bold text-[#8C1D40]">{project.title}</h1>

      <section className="mt-6">
        <h2 className="font-semibold">Interactives</h2>
        <form action={createInteractive} className="mt-2 flex gap-2">
          <input type="hidden" name="projectId" value={project.id} />
          <input name="title" placeholder="New Parameter Sandbox title" maxLength={200}
            className="flex-1 rounded border border-gray-300 px-3 py-2" />
          <button className="rounded bg-[#8C1D40] px-4 py-2 text-white">New Parameter Sandbox</button>
        </form>
        <ul className="mt-3 divide-y rounded border border-gray-200 bg-white">
          {project.interactives.map((it) => (
            <li key={it.id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/interactives/${it.id}`} className="font-medium text-[#8C1D40] hover:underline">{it.title}</Link>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <span>{it.engineId} v{it.engineVersion}</span>
                <form action={deleteInteractive}>
                  <input type="hidden" name="id" value={it.id} />
                  <button className="text-red-700 hover:underline">Delete</button>
                </form>
              </div>
            </li>
          ))}
          {project.interactives.length === 0 && <li className="px-4 py-6 text-gray-500">No interactives yet.</li>}
        </ul>
      </section>

      <AssetPanel projectId={project.id}
        assets={project.assets.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, byteSize: a.byteSize }))} />
    </main>
  );
}
```

(`AssetPanel` is created in Task 10; until then create a placeholder `src/app/projects/[id]/asset-panel.tsx`:)

```tsx
"use client";
export function AssetPanel(_props: { projectId: string; assets: Array<{ id: string; filename: string; mimeType: string; byteSize: number }> }) {
  return null;
}
```

- [ ] **Step 5: Update `src/app/layout.tsx` metadata**

Change the `metadata` export only:
```ts
export const metadata: Metadata = {
  title: "Interactive Lesson Builder",
  description: "Build concept-experimentation interactives and export SCORM packages for Canvas.",
};
```

- [ ] **Step 6: Manual verification**

Run `npm run dev`; visit `/`; create a project; create an interactive (redirects to `/interactives/<id>` which 404s until Task 9 — expected); delete works.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: dashboard, project page, CRUD server actions, NullProvider AI seam"
```

---

### Task 9: Editor with live preview

**Files:**
- Create: `src/app/interactives/[id]/page.tsx`, `src/app/interactives/[id]/editor.tsx`

Design: the editor holds the raw config as React state (typed as the Zod input shape). Every change debounce-saves (draft always saved, spec 9) and posts the runtime config to the preview iframe (`/engines/param-sandbox/1.0.0/preview.html`). Validation errors from save render inline at the top of the form. Asset references are chosen from the project's uploaded assets by dropdown; preview resolves asset URLs to `/api/assets/<id>`.

- [ ] **Step 1: Create `src/app/interactives/[id]/page.tsx`**

```tsx
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Editor } from "./editor";

export const dynamic = "force-dynamic";

export default async function InteractivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interactive = await prisma.interactive.findUnique({ where: { id } });
  if (!interactive) notFound();
  const assets = await prisma.asset.findMany({ where: { projectId: interactive.projectId }, orderBy: { createdAt: "desc" } });

  return (
    <main className="p-4">
      <div className="mb-3 flex items-center gap-4">
        <Link href={`/projects/${interactive.projectId}`} className="text-sm text-gray-500 hover:underline">&larr; Project</Link>
        <span className="text-sm text-gray-400">Parameter Sandbox v{interactive.engineVersion}</span>
      </div>
      <Editor
        interactiveId={interactive.id}
        initialTitle={interactive.title}
        initialConfig={JSON.parse(interactive.configJson)}
        assets={assets.map((a) => ({ id: a.id, filename: a.filename }))}
      />
    </main>
  );
}
```

- [ ] **Step 2: Create `src/app/interactives/[id]/editor.tsx`**

This is the largest UI file. Structure: `Editor` (state + save + preview messaging) renders section components in a left column and the iframe on the right. Complete file:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveInteractiveConfig } from "@/app/actions";

/* Editing shape mirrors the Zod input (pre-validation). */
type EInput = { id: string; label: string; type: "slider" | "number" | "toggle" | "select"; min?: number; max?: number; step?: number; defaultValue: number; units?: string; options?: Array<{ label: string; value: number }> };
type EOutput = { id: string; label: string; formula: string; units?: string; decimals?: number };
type EChart = { id: string; title: string; xInputId: string; yOutputId: string; samples: number };
type EOverlay =
  | { id: string; type: "fill"; outputId: string; inMin: number; inMax: number; color: string; box: Box }
  | { id: string; type: "swap"; outputId: string; box: Box; bands: Array<{ upTo: number; assetId: string }> }
  | { id: string; type: "transform"; outputId: string; box: Box; assetId: string; property: "translateY" | "translateX" | "rotate" | "scale" | "opacity"; inMin: number; inMax: number; outMin: number; outMax: number };
type Box = { x: number; y: number; w: number; h: number };
type EConfig = {
  title: string; intro?: string;
  inputs: EInput[]; outputs: EOutput[]; charts: EChart[];
  visual?: { backgroundAssetId?: string; overlays: EOverlay[] };
  challenges: Array<{ id: string; prompt: string; outputId: string; comparator: "gte" | "lte" | "between"; value?: number; min?: number; max?: number }>;
};
type AssetRef = { id: string; filename: string };

const PREVIEW_SRC = "/engines/param-sandbox/1.0.0/preview.html";

export function Editor({ interactiveId, initialTitle, initialConfig, assets }: {
  interactiveId: string; initialTitle: string; initialConfig: EConfig; assets: AssetRef[];
}) {
  const [title, setTitle] = useState(initialTitle);
  const [config, setConfig] = useState<EConfig>(initialConfig);
  const [errors, setErrors] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "idle">("idle");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewReady = useRef(false);

  const postPreview = useCallback((cfg: EConfig) => {
    const runtime = toPreviewRuntime(cfg);
    iframeRef.current?.contentWindow?.postMessage({ type: "ilb-config", config: runtime }, "*");
  }, []);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "ilb-preview-ready") { previewReady.current = true; postPreview(config); }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save + preview refresh on every config/title change.
  useEffect(() => {
    if (previewReady.current) postPreview(config);
    setSaveState("saving");
    const t = setTimeout(async () => {
      const result = await saveInteractiveConfig(interactiveId, config, title);
      setErrors(result.ok ? [] : result.errors);
      setSaveState("saved");
    }, 600);
    return () => clearTimeout(t);
  }, [config, title, interactiveId, postPreview]);

  const patch = (p: Partial<EConfig>) => setConfig((c) => ({ ...c, ...p }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="max-h-[85vh] space-y-4 overflow-y-auto pr-2">
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-semibold">Title</label>
            <span className="text-xs text-gray-400">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}</span>
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2" />
          <label className="mt-3 block text-sm font-semibold">Intro (basic formatting allowed)</label>
          <textarea value={config.intro ?? ""} onChange={(e) => patch({ intro: e.target.value })} rows={3}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm" />
        </div>

        {errors.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-semibold text-amber-900">Draft saved, but not exportable yet:</p>
            <ul className="mt-1 list-disc pl-5 text-amber-800">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        <InputsSection inputs={config.inputs} onChange={(inputs) => patch({ inputs })} />
        <OutputsSection outputs={config.outputs} onChange={(outputs) => patch({ outputs })} />
        <ChartsSection charts={config.charts} inputs={config.inputs} outputs={config.outputs} onChange={(charts) => patch({ charts })} />
        <VisualSection visual={config.visual} outputs={config.outputs} assets={assets}
          onChange={(visual) => patch({ visual })} />
        <ChallengesSection challenges={config.challenges} outputs={config.outputs} onChange={(challenges) => patch({ challenges })} />

        <ExportButton interactiveId={interactiveId} disabled={errors.length > 0} />
      </div>

      <div className="sticky top-4 h-[85vh]">
        <p className="mb-1 text-sm font-semibold text-gray-600">Live preview (actual engine runtime)</p>
        <iframe ref={iframeRef} src={PREVIEW_SRC} title="Preview"
          className="h-full w-full rounded border border-gray-300 bg-white" sandbox="allow-scripts" />
      </div>
    </div>
  );
}

/* Maps assetId fields to preview URLs; mirrors toRuntimeConfig server-side. */
function toPreviewRuntime(cfg: EConfig) {
  const url = (assetId: string) => `/api/assets/${assetId}`;
  const { visual, ...rest } = cfg;
  if (!visual) return rest;
  return {
    ...rest,
    visual: {
      backgroundUrl: visual.backgroundAssetId ? url(visual.backgroundAssetId) : undefined,
      overlays: visual.overlays.map((ov) => {
        if (ov.type === "fill") return ov;
        if (ov.type === "swap") return { ...ov, bands: ov.bands.map((b) => ({ upTo: b.upTo, url: url(b.assetId) })) };
        const { assetId, ...o } = ov;
        return { ...o, url: url(assetId) };
      }),
    },
  };
}

/* ---------- shared small components ---------- */

function Section({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {onAdd && <button onClick={onAdd} className="rounded bg-gray-100 px-2 py-1 text-sm hover:bg-gray-200">+ {addLabel}</button>}
      </div>
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="rounded border border-gray-100 bg-gray-50 p-3">
      <div className="flex justify-end"><button onClick={onRemove} className="text-xs text-red-700 hover:underline">Remove</button></div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs"><span className="font-medium text-gray-600">{label}</span>{children}</label>;
}

const inputCls = "mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm";

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}><input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function NumField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return <Field label={label}>
    <input type="number" step="any" className={inputCls} value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
  </Field>;
}
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return <Field label={label}>
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </Field>;
}

let uid = 0;
const newId = (prefix: string) => `${prefix}_${++uid}${Date.now() % 10000}`;

/* ---------- sections ---------- */

function InputsSection({ inputs, onChange }: { inputs: EInput[]; onChange: (v: EInput[]) => void }) {
  const update = (i: number, p: Partial<EInput>) => onChange(inputs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Inputs (what learners manipulate)" addLabel="input"
      onAdd={() => onChange([...inputs, { id: newId("input"), label: "New input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }])}>
      {inputs.map((inp, i) => (
        <Row key={i} onRemove={() => onChange(inputs.filter((_, j) => j !== i))}>
          <TextField label="ID (used in formulas)" value={inp.id} onChange={(id) => update(i, { id })} />
          <TextField label="Label" value={inp.label} onChange={(label) => update(i, { label })} />
          <SelectField label="Type" value={inp.type}
            options={["slider", "number", "toggle", "select"].map((t) => ({ value: t, label: t }))}
            onChange={(type) => update(i, { type: type as EInput["type"] })} />
          <TextField label="Units" value={inp.units ?? ""} onChange={(units) => update(i, { units: units || undefined })} />
          {(inp.type === "slider" || inp.type === "number") && (<>
            <NumField label="Min" value={inp.min} onChange={(min) => update(i, { min })} />
            <NumField label="Max" value={inp.max} onChange={(max) => update(i, { max })} />
            <NumField label="Step" value={inp.step} onChange={(step) => update(i, { step })} />
          </>)}
          <NumField label="Default" value={inp.defaultValue} onChange={(defaultValue) => update(i, { defaultValue: defaultValue ?? 0 })} />
          {inp.type === "select" && (
            <Field label="Options (label=value, one per line)">
              <textarea className={inputCls} rows={3}
                value={(inp.options ?? []).map((o) => `${o.label}=${o.value}`).join("\n")}
                onChange={(e) => update(i, {
                  options: e.target.value.split("\n").filter(Boolean).map((line) => {
                    const [label, value] = line.split("=");
                    return { label: label ?? "", value: Number(value ?? 0) };
                  }),
                })} />
            </Field>
          )}
        </Row>
      ))}
    </Section>
  );
}

function OutputsSection({ outputs, onChange }: { outputs: EOutput[]; onChange: (v: EOutput[]) => void }) {
  const update = (i: number, p: Partial<EOutput>) => onChange(outputs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Outputs (computed by formulas)" addLabel="output"
      onAdd={() => onChange([...outputs, { id: newId("out"), label: "New output", formula: "1" }])}>
      {outputs.map((out, i) => (
        <Row key={i} onRemove={() => onChange(outputs.filter((_, j) => j !== i))}>
          <TextField label="ID" value={out.id} onChange={(id) => update(i, { id })} />
          <TextField label="Label" value={out.label} onChange={(label) => update(i, { label })} />
          <Field label="Formula (inputs + earlier outputs; e.g. mass / density * 1000)">
            <input className={`${inputCls} font-mono`} value={out.formula} onChange={(e) => update(i, { formula: e.target.value })} />
          </Field>
          <TextField label="Units" value={out.units ?? ""} onChange={(units) => update(i, { units: units || undefined })} />
          <NumField label="Decimals" value={out.decimals} onChange={(decimals) => update(i, { decimals })} />
        </Row>
      ))}
    </Section>
  );
}

function ChartsSection({ charts, inputs, outputs, onChange }: { charts: EChart[]; inputs: EInput[]; outputs: EOutput[]; onChange: (v: EChart[]) => void }) {
  const update = (i: number, p: Partial<EChart>) => onChange(charts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Charts (pattern across an input's range)" addLabel="chart"
      onAdd={() => onChange([...charts, { id: newId("chart"), title: "New chart", xInputId: inputs[0]?.id ?? "", yOutputId: outputs[0]?.id ?? "", samples: 40 }])}>
      {charts.map((c, i) => (
        <Row key={i} onRemove={() => onChange(charts.filter((_, j) => j !== i))}>
          <TextField label="ID" value={c.id} onChange={(id) => update(i, { id })} />
          <TextField label="Title" value={c.title} onChange={(title) => update(i, { title })} />
          <SelectField label="X axis (input)" value={c.xInputId}
            options={inputs.map((x) => ({ value: x.id, label: x.label }))} onChange={(xInputId) => update(i, { xInputId })} />
          <SelectField label="Y axis (output)" value={c.yOutputId}
            options={outputs.map((o) => ({ value: o.id, label: o.label }))} onChange={(yOutputId) => update(i, { yOutputId })} />
          <NumField label="Samples" value={c.samples} onChange={(samples) => update(i, { samples: samples ?? 40 })} />
        </Row>
      ))}
    </Section>
  );
}

function VisualSection({ visual, outputs, assets, onChange }: {
  visual: EConfig["visual"]; outputs: EOutput[]; assets: AssetRef[]; onChange: (v: EConfig["visual"]) => void;
}) {
  const v = visual ?? { overlays: [] };
  const assetOptions = [{ value: "", label: "(none)" }, ...assets.map((a) => ({ value: a.id, label: a.filename }))];
  const outputOptions = outputs.map((o) => ({ value: o.id, label: o.label }));
  const updateOverlay = (i: number, p: Partial<EOverlay>) =>
    onChange({ ...v, overlays: v.overlays.map((x, j) => (j === i ? ({ ...x, ...p } as EOverlay) : x)) });
  const boxFields = (i: number, box: Box) => (
    <Field label="Box x,y,w,h (% of stage)">
      <div className="flex gap-1">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <input key={k} type="number" min={0} max={100} className={inputCls} value={box[k]}
            onChange={(e) => updateOverlay(i, { box: { ...box, [k]: Number(e.target.value) } } as Partial<EOverlay>)} />
        ))}
      </div>
    </Field>
  );
  return (
    <Section title="Visual stage (background + state overlays)" addLabel="overlay"
      onAdd={() => onChange({ ...v, overlays: [...v.overlays, { id: newId("ov"), type: "fill", outputId: outputs[0]?.id ?? "", inMin: 0, inMax: 100, color: "#4a90d9", box: { x: 10, y: 10, w: 80, h: 80 } }] })}>
      <SelectField label="Background image" value={v.backgroundAssetId ?? ""}
        options={assetOptions} onChange={(id) => onChange({ ...v, backgroundAssetId: id || undefined })} />
      {v.overlays.map((ov, i) => (
        <Row key={i} onRemove={() => onChange({ ...v, overlays: v.overlays.filter((_, j) => j !== i) })}>
          <TextField label="ID" value={ov.id} onChange={(id) => updateOverlay(i, { id })} />
          <SelectField label="Type" value={ov.type}
            options={[{ value: "fill", label: "fill (rising level)" }, { value: "swap", label: "swap (image per range)" }, { value: "transform", label: "transform (move/rotate/scale/fade)" }]}
            onChange={(type) => {
              const box = ov.box;
              if (type === "fill") updateOverlay(i, { type: "fill", outputId: ov.outputId, inMin: 0, inMax: 100, color: "#4a90d9", box } as EOverlay);
              else if (type === "swap") updateOverlay(i, { type: "swap", outputId: ov.outputId, box, bands: [] } as unknown as EOverlay);
              else updateOverlay(i, { type: "transform", outputId: ov.outputId, box, assetId: "", property: "translateY", inMin: 0, inMax: 100, outMin: 0, outMax: 100 } as EOverlay);
            }} />
          <SelectField label="Driven by output" value={ov.outputId} options={outputOptions} onChange={(outputId) => updateOverlay(i, { outputId })} />
          {boxFields(i, ov.box)}
          {ov.type === "fill" && (<>
            <NumField label="Value at empty" value={ov.inMin} onChange={(inMin) => updateOverlay(i, { inMin } as Partial<EOverlay>)} />
            <NumField label="Value at full" value={ov.inMax} onChange={(inMax) => updateOverlay(i, { inMax } as Partial<EOverlay>)} />
            <TextField label="Color (#rrggbb)" value={ov.color} onChange={(color) => updateOverlay(i, { color } as Partial<EOverlay>)} />
          </>)}
          {ov.type === "swap" && (
            <Field label="Bands (upTo=assetId, one per line; ascending)">
              <textarea className={inputCls} rows={3}
                value={ov.bands.map((b) => `${b.upTo}=${b.assetId}`).join("\n")}
                onChange={(e) => updateOverlay(i, {
                  bands: e.target.value.split("\n").filter(Boolean).map((line) => {
                    const [upTo, assetId] = line.split("=");
                    return { upTo: Number(upTo ?? 0), assetId: assetId ?? "" };
                  }),
                } as Partial<EOverlay>)} />
            </Field>
          )}
          {ov.type === "transform" && (<>
            <SelectField label="Image" value={ov.assetId} options={assetOptions} onChange={(assetId) => updateOverlay(i, { assetId } as Partial<EOverlay>)} />
            <SelectField label="Property" value={ov.property}
              options={["translateY", "translateX", "rotate", "scale", "opacity"].map((p) => ({ value: p, label: p }))}
              onChange={(property) => updateOverlay(i, { property } as Partial<EOverlay>)} />
            <NumField label="Output min" value={ov.inMin} onChange={(inMin) => updateOverlay(i, { inMin } as Partial<EOverlay>)} />
            <NumField label="Output max" value={ov.inMax} onChange={(inMax) => updateOverlay(i, { inMax } as Partial<EOverlay>)} />
            <NumField label="Effect at min" value={ov.outMin} onChange={(outMin) => updateOverlay(i, { outMin } as Partial<EOverlay>)} />
            <NumField label="Effect at max" value={ov.outMax} onChange={(outMax) => updateOverlay(i, { outMax } as Partial<EOverlay>)} />
          </>)}
        </Row>
      ))}
    </Section>
  );
}

function ChallengesSection({ challenges, outputs, onChange }: {
  challenges: EConfig["challenges"]; outputs: EOutput[]; onChange: (v: EConfig["challenges"]) => void;
}) {
  const update = (i: number, p: Partial<EConfig["challenges"][number]>) =>
    onChange(challenges.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Section title="Challenges (drive completion + score)" addLabel="challenge"
      onAdd={() => onChange([...challenges, { id: newId("ch"), prompt: "New challenge", outputId: outputs[0]?.id ?? "", comparator: "gte", value: 0 }])}>
      {challenges.map((ch, i) => (
        <Row key={i} onRemove={() => onChange(challenges.filter((_, j) => j !== i))}>
          <TextField label="ID" value={ch.id} onChange={(id) => update(i, { id })} />
          <TextField label="Prompt" value={ch.prompt} onChange={(prompt) => update(i, { prompt })} />
          <SelectField label="Output" value={ch.outputId} options={outputs.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(outputId) => update(i, { outputId })} />
          <SelectField label="Condition" value={ch.comparator}
            options={[{ value: "gte", label: "at least (≥)" }, { value: "lte", label: "at most (≤)" }, { value: "between", label: "between" }]}
            onChange={(comparator) => update(i, { comparator: comparator as "gte" | "lte" | "between" })} />
          {ch.comparator !== "between" && <NumField label="Value" value={ch.value} onChange={(value) => update(i, { value })} />}
          {ch.comparator === "between" && (<>
            <NumField label="Min" value={ch.min} onChange={(min) => update(i, { min })} />
            <NumField label="Max" value={ch.max} onChange={(max) => update(i, { max })} />
          </>)}
        </Row>
      ))}
    </Section>
  );
}

function ExportButton({ interactiveId, disabled }: { interactiveId: string; disabled: boolean }) {
  const [report, setReport] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function doExport() {
    setBusy(true); setReport(null);
    try {
      const res = await fetch(`/api/interactives/${interactiveId}/export`, { method: "POST" });
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = res.headers.get("X-Filename") ?? "package.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        const body = await res.json();
        setReport(body.violations?.map((v: { file: string; rule: string; detail: string }) => `${v.rule} in ${v.file}: ${v.detail}`) ?? [body.error ?? "Export failed"]);
      }
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <button onClick={doExport} disabled={disabled || busy}
        className="rounded bg-[#8C1D40] px-4 py-2 text-white disabled:opacity-40">
        {busy ? "Exporting…" : "Export SCORM package"}
      </button>
      {disabled && <p className="mt-1 text-xs text-gray-500">Fix validation issues above to enable export.</p>}
      {report && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Export blocked by compliance scan:</p>
          <ul className="mt-1 list-disc pl-5">{report.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

`npm run dev` → open an interactive → change the slider default/formula and watch preview update live; introduce a formula typo and see the amber "not exportable" panel; confirm draft still saves (reload keeps it).

- [ ] **Step 4: Commit**

```bash
git add src/app/interactives
git commit -m "feat: split-view editor with live engine preview, draft saves, inline validation"
```

---

### Task 10: Asset upload with validation (TDD on validators)

**Files:**
- Create: `tests/asset-validate.test.ts`, `src/lib/assets/validate.ts`, `src/lib/assets/store.ts`
- Create: `src/app/api/assets/route.ts`, `src/app/api/assets/[id]/route.ts`
- Replace: `src/app/projects/[id]/asset-panel.tsx`

- [ ] **Step 1: Write failing tests `tests/asset-validate.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { sniffImageType, validateAsset } from "@/lib/assets/validate";
import sharp from "sharp";

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: "#ff0000" } }).png().toBuffer();
}

describe("sniffImageType", () => {
  it("detects png / jpeg / webp from magic bytes", async () => {
    expect(sniffImageType(await png())).toBe("image/png");
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#00ff00" } }).jpeg().toBuffer();
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#0000ff" } }).webp().toBuffer();
    expect(sniffImageType(webp)).toBe("image/webp");
  });
  it("rejects SVG and other content regardless of claimed name", () => {
    expect(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(Buffer.from("#!/bin/sh\necho hi"))).toBeNull();
  });
});

describe("validateAsset", () => {
  const policy = { maxAssetBytes: 5 * 1024 * 1024, allowedTypes: ["image/png", "image/jpeg", "image/webp"] };
  it("accepts a valid png and re-encodes it (metadata stripped)", async () => {
    const r = await validateAsset(await png(), policy);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mimeType).toBe("image/png");
      expect(r.data.length).toBeGreaterThan(0);
      expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("rejects oversized files with a specific reason", async () => {
    const r = await validateAsset(await png(), { ...policy, maxAssetBytes: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/size/i);
  });
  it("rejects disallowed types", async () => {
    const r = await validateAsset(Buffer.from("<svg/>"), policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/type/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/asset-validate.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/assets/validate.ts`**

```ts
import sharp from "sharp";
import { createHash } from "node:crypto";

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export function sniffImageType(buf: Buffer): ImageMime | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export interface AssetPolicy { maxAssetBytes: number; allowedTypes: string[] }

export type AssetValidation =
  | { ok: true; data: Buffer; mimeType: ImageMime; contentHash: string }
  | { ok: false; reason: string };

/** Sniff type, enforce policy, re-encode via sharp (strips EXIF/metadata), hash. */
export async function validateAsset(buf: Buffer, policy: AssetPolicy): Promise<AssetValidation> {
  if (buf.length > policy.maxAssetBytes) {
    return { ok: false, reason: `file size ${buf.length} exceeds maximum ${policy.maxAssetBytes} bytes` };
  }
  const mime = sniffImageType(buf);
  if (!mime || !policy.allowedTypes.includes(mime)) {
    return { ok: false, reason: "file type not allowed (PNG, JPEG, or WebP required; type is detected from content, not filename)" };
  }
  try {
    const pipeline = sharp(buf, { limitInputPixels: 30_000_000 }).rotate();
    const data =
      mime === "image/png" ? await pipeline.png().toBuffer()
      : mime === "image/jpeg" ? await pipeline.jpeg({ quality: 90 }).toBuffer()
      : await pipeline.webp({ quality: 90 }).toBuffer();
    const contentHash = createHash("sha256").update(data).digest("hex");
    return { ok: true, data, mimeType: mime, contentHash };
  } catch {
    return { ok: false, reason: "image could not be decoded" };
  }
}

export const EXT_BY_MIME: Record<ImageMime, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
};
```

- [ ] **Step 4: Run validator tests**

Run: `npm test -- tests/asset-validate.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Implement `src/lib/assets/store.ts`**

```ts
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

export interface AssetStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** v1: local uploads/ folder. v2 swaps this for an S3-compatible store. */
export class LocalDiskAssetStore implements AssetStore {
  constructor(private baseDir = path.join(process.cwd(), "uploads")) {}
  private resolve(key: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error("invalid asset key");
    return path.join(this.baseDir, key);
  }
  async put(key: string, data: Buffer): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.resolve(key), data);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key));
  }
}

export const assetStore: AssetStore = new LocalDiskAssetStore();

export function assetKey(contentHash: string, ext: string): string {
  return `${contentHash}.${ext}`;
}
```

- [ ] **Step 6: Create `src/app/api/assets/route.ts`** (upload)

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateAsset, EXT_BY_MIME } from "@/lib/assets/validate";
import { assetStore, assetKey } from "@/lib/assets/store";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const projectId = String(form.get("projectId") ?? "");
  const file = form.get("file");
  if (!projectId || !(file instanceof File)) {
    return NextResponse.json({ error: "projectId and file are required" }, { status: 400 });
  }
  const policy = await prisma.policy.findUniqueOrThrow({ where: { id: 1 } });
  const buf = Buffer.from(await file.arrayBuffer());
  const result = await validateAsset(buf, {
    maxAssetBytes: policy.maxAssetBytes,
    allowedTypes: policy.allowedAssetTypes.split(","),
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });

  await assetStore.put(assetKey(result.contentHash, EXT_BY_MIME[result.mimeType]), result.data);
  const asset = await prisma.asset.create({
    data: {
      projectId,
      filename: file.name.replace(/[^a-zA-Z0-9._ -]/g, "").slice(0, 120) || "image",
      mimeType: result.mimeType,
      byteSize: result.data.length,
      contentHash: result.contentHash,
    },
  });
  return NextResponse.json({ id: asset.id, filename: asset.filename });
}
```

- [ ] **Step 7: Create `src/app/api/assets/[id]/route.ts`** (serve for preview)

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assetStore, assetKey } from "@/lib/assets/store";
import { EXT_BY_MIME, ImageMime } from "@/lib/assets/validate";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) return new NextResponse("Not found", { status: 404 });
  const data = await assetStore.get(assetKey(asset.contentHash, EXT_BY_MIME[asset.mimeType as ImageMime]));
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": asset.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
```

- [ ] **Step 8: Replace `src/app/projects/[id]/asset-panel.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function AssetPanel({ projectId, assets }: {
  projectId: string;
  assets: Array<{ id: string; filename: string; mimeType: string; byteSize: number }>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("file", file);
    const res = await fetch("/api/assets", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Upload failed"); return; }
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <section className="mt-8">
      <h2 className="font-semibold">Images (backgrounds and state images)</h2>
      <div className="mt-2 flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" />
        <button onClick={upload} disabled={busy} className="rounded bg-[#8C1D40] px-3 py-1.5 text-sm text-white disabled:opacity-40">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {assets.map((a) => (
          <li key={a.id} className="rounded border border-gray-200 bg-white p-2 text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/assets/${a.id}`} alt={a.filename} className="h-24 w-full rounded object-contain bg-gray-50" />
            <p className="mt-1 truncate font-medium">{a.filename}</p>
            <p className="text-gray-400">{Math.round(a.byteSize / 1024)} KB · id: <code className="select-all">{a.id}</code></p>
          </li>
        ))}
        {assets.length === 0 && <li className="col-span-full text-sm text-gray-500">No images uploaded yet.</li>}
      </ul>
    </section>
  );
}
```

- [ ] **Step 9: Manual verification + commit**

Upload a PNG on the project page (appears in grid, served at `/api/assets/<id>`); try a renamed `.txt` → specific type rejection; pick the image as a background in the editor and see it in the preview stage.

```bash
git add -A
git commit -m "feat: policy-enforced asset upload (magic-byte sniff, sharp re-encode, content hash) + serving + panel"
```

---

### Task 11: SCORM manifest + package index.html (TDD)

**Files:**
- Create: `tests/scorm-manifest.test.ts`, `src/lib/scorm/manifest.ts`, `src/lib/scorm/index-html.ts`

- [ ] **Step 1: Write failing tests `tests/scorm-manifest.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildManifestXml } from "@/lib/scorm/manifest";
import { buildIndexHtml } from "@/lib/scorm/index-html";

describe("buildManifestXml", () => {
  const xml = buildManifestXml({
    identifier: "ILB-abc123",
    title: "Archimedes <Principle> & Buoyancy",
    files: ["index.html", "engine/engine.js", "engine/engine.css", "engine/scorm-adapter.js", "assets/a1.png"],
  });
  it("declares SCORM 1.2 schema and adlcp namespace", () => {
    expect(xml).toContain('<schema>ADL SCORM</schema>');
    expect(xml).toContain("<schemaversion>1.2</schemaversion>");
    expect(xml).toContain("http://www.adlnet.org/xsd/adlcp_rootv1p2");
  });
  it("escapes XML special characters in titles", () => {
    expect(xml).toContain("Archimedes &lt;Principle&gt; &amp; Buoyancy");
    expect(xml).not.toContain("<Principle>");
  });
  it("lists every file and launches index.html", () => {
    expect(xml).toContain('href="index.html"');
    for (const f of ["engine/engine.js", "assets/a1.png"]) expect(xml).toContain(`<file href="${f}"`);
  });
  it("marks the resource as an sco", () => {
    expect(xml).toContain('adlcp:scormtype="sco"');
  });
});

describe("buildIndexHtml", () => {
  const html = buildIndexHtml({ title: "T & T", configJson: '{"a":"</script><script>alert(1)</script>"}' });
  it("inlines config JSON with </ escaped so script contexts cannot break out", () => {
    expect(html).toContain('<script id="ilb-config" type="application/json">');
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("<\\/script>");
  });
  it("references only local engine files and no external URLs", () => {
    expect(html).toMatch(/src="engine\/scorm-adapter\.js"/);
    expect(html).toMatch(/src="engine\/engine\.js"/);
    expect(html).toMatch(/href="engine\/engine\.css"/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/scorm-manifest.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/scorm/manifest.ts`**

```ts
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildManifestXml(opts: { identifier: string; title: string; files: string[] }): string {
  const title = xmlEscape(opts.title);
  const id = xmlEscape(opts.identifier);
  const fileTags = opts.files.map((f) => `        <file href="${xmlEscape(f)}" />`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>${title}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
${fileTags}
    </resource>
  </resources>
</manifest>
`;
}
```

- [ ] **Step 4: Implement `src/lib/scorm/index-html.ts`**

```ts
function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Package launcher. Config is inlined (no fetch) with </ escaped so it can
 *  never close its own script tag. scorm-adapter loads BEFORE engine so
 *  window.ILBScorm exists at mount time. */
export function buildIndexHtml(opts: { title: string; configJson: string }): string {
  const safeJson = opts.configJson.replace(/<\//g, "<\\/");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(opts.title)}</title>
  <link rel="stylesheet" href="engine/engine.css" />
</head>
<body>
  <div id="ilb-root"></div>
  <script id="ilb-config" type="application/json">${safeJson}</script>
  <script src="engine/scorm-adapter.js"></script>
  <script src="engine/engine.js"></script>
  <script>
    (function () {
      var config = JSON.parse(document.getElementById("ilb-config").textContent);
      window.ILBEngine.mount(document.getElementById("ilb-root"), config);
    })();
  </script>
</body>
</html>
`;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/scorm-manifest.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add tests/scorm-manifest.test.ts src/lib/scorm
git commit -m "feat: SCORM 1.2 manifest builder and package launcher html (inline escaped config)"
```

---

### Task 12: Compliance scanner (TDD with hostile fixtures)

**Files:**
- Create: `tests/scanner.test.ts`, `src/lib/export/scanner.ts`

The scanner receives the fully assembled package as `Map<path, Buffer>` plus policy + engine manifest, and returns `{ passed, violations }`. Rules (spec section 7): URL allowlist, forbidden JS/HTML patterns, engine checksums, file-type allowlist, config revalidation, sanitizer idempotence.

- [ ] **Step 1: Write failing tests `tests/scanner.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { scanPackage, ScanContext } from "@/lib/export/scanner";
import { createHash } from "node:crypto";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const ENGINE_JS = Buffer.from("window.ILBEngine={mount:function(){}};");
const ENGINE_CSS = Buffer.from(".ilb-sandbox{}");
const SCORM_JS = Buffer.from("window.ILBScorm={mode:'standalone'};");

const goodConfig = {
  title: "T",
  inputs: [{ id: "x", label: "x", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }],
  outputs: [{ id: "y", label: "y", formula: "x * 2" }],
  charts: [], challenges: [],
};

function ctx(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    engineChecksums: { "engine/engine.js": sha256(ENGINE_JS), "engine/engine.css": sha256(ENGINE_CSS), "engine/scorm-adapter.js": sha256(SCORM_JS) },
    urlAllowlist: [],
    authoringConfig: goodConfig,
    ...overrides,
  };
}

function goodPackage(): Map<string, Buffer> {
  return new Map<string, Buffer>([
    ["imsmanifest.xml", Buffer.from('<?xml version="1.0"?><manifest></manifest>')],
    ["index.html", Buffer.from('<!DOCTYPE html><html><head><link rel="stylesheet" href="engine/engine.css" /></head><body><script src="engine/engine.js"></script></body></html>')],
    ["engine/engine.js", ENGINE_JS],
    ["engine/engine.css", ENGINE_CSS],
    ["engine/scorm-adapter.js", SCORM_JS],
    ["content/config.json", Buffer.from(JSON.stringify({ ...goodConfig }))],
  ]);
}

describe("scanPackage", () => {
  it("passes a clean package", () => {
    const r = scanPackage(goodPackage(), ctx());
    expect(r.violations).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("blocks eval and new Function in any text file", () => {
    const p = goodPackage();
    p.set("content/config.json", Buffer.from(JSON.stringify({ ...goodConfig, title: 'x", eval(1), "' })));
    const r1 = scanPackage(p, ctx({ authoringConfig: JSON.parse(p.get("content/config.json")!.toString()) }));
    expect(r1.passed).toBe(false);
    expect(r1.violations.some((v) => v.rule === "forbidden-pattern" && /eval/.test(v.detail))).toBe(true);
  });

  it("blocks inline event handlers and javascript: urls in html", () => {
    const p = goodPackage();
    p.set("index.html", Buffer.from('<html><body onload="x()"><a href="javascript:alert(1)">x</a></body></html>'));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.filter((v) => v.rule === "forbidden-pattern").length).toBeGreaterThanOrEqual(2);
  });

  it("blocks off-allowlist URLs but allows allowlisted ones", () => {
    const p = goodPackage();
    p.set("content/config.json", Buffer.from(JSON.stringify({ ...goodConfig, intro: '<a href="https://evil.example/x">x</a>' })));
    const cfg = JSON.parse(p.get("content/config.json")!.toString());
    expect(scanPackage(p, ctx({ authoringConfig: cfg })).passed).toBe(false);
    expect(scanPackage(p, ctx({ authoringConfig: cfg, urlAllowlist: ["evil.example"] })).passed).toBe(true);
  });

  it("blocks tampered engine files (checksum mismatch)", () => {
    const p = goodPackage();
    p.set("engine/engine.js", Buffer.from("window.ILBEngine={mount:function(){}};//tampered"));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "checksum-mismatch")).toBe(true);
  });

  it("blocks unexpected file types", () => {
    const p = goodPackage();
    p.set("assets/evil.exe", Buffer.from("MZ"));
    const r = scanPackage(p, ctx());
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "file-type" && v.file === "assets/evil.exe")).toBe(true);
  });

  it("blocks iframes and external script srcs", () => {
    const p = goodPackage();
    p.set("index.html", Buffer.from('<html><body><iframe src="x.html"></iframe><script src="https://cdn.example/x.js"></script></body></html>'));
    const r = scanPackage(p, ctx());
    expect(r.violations.some((v) => /iframe/i.test(v.detail))).toBe(true);
  });

  it("blocks configs that fail schema revalidation", () => {
    const p = goodPackage();
    const bad = { ...goodConfig, outputs: [{ id: "y", label: "y", formula: "fetch(1)" }] };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad }));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "schema")).toBe(true);
  });

  it("blocks non-idempotent rich text (sanitizer disagreement)", () => {
    const p = goodPackage();
    const bad = { ...goodConfig, intro: '<p onclick="x()">hi</p>' };
    p.set("content/config.json", Buffer.from(JSON.stringify(bad)));
    const r = scanPackage(p, ctx({ authoringConfig: bad }));
    expect(r.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/scanner.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/export/scanner.ts`**

```ts
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

/** Forbidden executable/injection patterns. Applied to all text files EXCEPT
 *  audited engine files (integrity is enforced by checksum instead — the
 *  runtime legitimately contains addEventListener etc., but still must not
 *  contain eval; engine files are scanned with the JS ruleset too). */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\beval\s*\(/, label: "eval() call" },
  { re: /new\s+Function\s*\(/, label: "new Function() constructor" },
  { re: /\bon[a-z]+\s*=\s*["']/i, label: "inline event handler (on*=)" },
  { re: /javascript\s*:/i, label: "javascript: URL" },
  { re: /data:text\/html/i, label: "data:text/html URL" },
  { re: /<iframe\b/i, label: "iframe element" },
  { re: /document\.write\s*\(/, label: "document.write() call" },
  { re: /import\s*\(/, label: "dynamic import()" },
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

    // Rule 4: file-type allowlist
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      violations.push({ file: path, rule: "file-type", detail: `file extension ".${ext}" is not allowed in packages` });
      continue;
    }

    // Rule 3: engine checksums
    if (engineFiles.has(path)) {
      const actual = createHash("sha256").update(buf).digest("hex");
      if (actual !== ctx.engineChecksums[path]) {
        violations.push({ file: path, rule: "checksum-mismatch", detail: "engine file does not match the audited build" });
      }
    }

    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const text = buf.toString("utf8");

    // Rule 2: forbidden patterns
    for (const { re, label } of FORBIDDEN_PATTERNS) {
      if (re.test(text)) violations.push({ file: path, rule: "forbidden-pattern", detail: label });
    }

    // external <script src>
    const scriptSrcs = [...text.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const src of scriptSrcs) {
      if (/^[a-z]+:|^\/\//i.test(src)) violations.push({ file: path, rule: "external-script", detail: `script src "${src}" is not package-relative` });
    }

    // Rule 1: URL allowlist
    for (const m of text.matchAll(URL_RE)) {
      const host = m[1].toLowerCase();
      const allowed = ctx.urlAllowlist.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
      if (!allowed) violations.push({ file: path, rule: "url-allowlist", detail: `URL host "${host}" is not on the approved allowlist` });
    }
  }

  // Rule 5: config revalidation + sanitizer idempotence
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
```

Implementation note: the "blocks eval in config title" test works because the exported `content/config.json` text contains `eval(` and rule 2 applies to all text files. The sanitizer-idempotence test also trips schema revalidation (the Zod transform sanitizes, so a config whose stored `intro` still contains `onclick` differs after transform); either violation failing the scan satisfies fail-closed — assert on `passed`, as the test does.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/scanner.test.ts` — Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/scanner.test.ts src/lib/export/scanner.ts
git commit -m "feat: fail-closed compliance scanner (patterns, URL allowlist, checksums, file types, revalidation)"
```

---

### Task 13: Export pipeline + route

**Files:**
- Create: `src/lib/export/package.ts`, `src/app/api/interactives/[id]/export/route.ts`
- Create: `tests/export-package.test.ts`

- [ ] **Step 1: Write failing test `tests/export-package.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { assemblePackage } from "@/lib/export/package";
import { emptySandboxConfig } from "@/lib/engines/param-sandbox/schema";

describe("assemblePackage", () => {
  it("assembles a complete package for a minimal valid config", async () => {
    const { files } = await assemblePackage({
      identifier: "ILB-test1",
      title: "Test",
      config: emptySandboxConfig("Test"),
      resolveAsset: async () => { throw new Error("no assets in this config"); },
    });
    const paths = [...files.keys()].sort();
    expect(paths).toEqual([
      "content/config.json",
      "engine/engine.css",
      "engine/engine.js",
      "engine/scorm-adapter.js",
      "imsmanifest.xml",
      "index.html",
    ]);
    const manifest = files.get("imsmanifest.xml")!.toString();
    for (const p of paths.filter((p) => p !== "imsmanifest.xml")) expect(manifest).toContain(p);
    // index.html inlines the RUNTIME config; config.json carries the authoring config
    expect(files.get("index.html")!.toString()).toContain('"inputs"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/export-package.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/export/package.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { buildManifestXml } from "@/lib/scorm/manifest";
import { buildIndexHtml } from "@/lib/scorm/index-html";
import { loadEngineManifest, engineDir, scormDir } from "@/lib/engines/registry";
import { SandboxConfig, toRuntimeConfig, collectAssetIds } from "@/lib/engines/param-sandbox/schema";

export interface ResolvedAsset { data: Buffer; ext: string }

export interface AssembleOptions {
  identifier: string;
  title: string;
  config: SandboxConfig;
  /** returns binary + extension for an assetId; throws if unknown */
  resolveAsset: (assetId: string) => Promise<ResolvedAsset>;
}

export interface AssembledPackage {
  files: Map<string, Buffer>;
  engineChecksums: Record<string, string>;
}

export async function assemblePackage(opts: AssembleOptions): Promise<AssembledPackage> {
  const manifest = loadEngineManifest();
  const engine = manifest.engines.find((e) => e.id === "param-sandbox");
  if (!engine) throw new Error("param-sandbox engine not found in engines.manifest.json — run npm run build:engines");

  const files = new Map<string, Buffer>();
  const engineChecksums: Record<string, string> = {};

  // Engine runtime files
  const eDir = engineDir(engine.id, engine.version);
  for (const [name, hash] of Object.entries(engine.files)) {
    files.set(`engine/${name}`, await readFile(path.join(eDir, name)));
    engineChecksums[`engine/${name}`] = hash;
  }
  const sDir = scormDir(manifest.scorm.version);
  for (const [name, hash] of Object.entries(manifest.scorm.files)) {
    files.set(`engine/${name}`, await readFile(path.join(sDir, name)));
    engineChecksums[`engine/${name}`] = hash;
  }

  // Assets: bundled under assets/, referenced by hashed filename
  const assetIds = collectAssetIds(opts.config);
  const assetPathById = new Map<string, string>();
  for (const id of assetIds) {
    const { data, ext } = await opts.resolveAsset(id);
    const p = `assets/${id}.${ext}`;
    files.set(p, data);
    assetPathById.set(id, p);
  }

  // Configs: runtime (inlined) + authoring (audit copy)
  const runtimeConfig = toRuntimeConfig(opts.config, (id) => {
    const p = assetPathById.get(id);
    if (!p) throw new Error(`config references unknown asset "${id}"`);
    return p;
  });
  files.set("content/config.json", Buffer.from(JSON.stringify(opts.config, null, 2)));
  files.set("index.html", Buffer.from(buildIndexHtml({ title: opts.config.title, configJson: JSON.stringify(runtimeConfig) })));
  files.set("imsmanifest.xml", Buffer.from(buildManifestXml({
    identifier: opts.identifier,
    title: opts.config.title,
    files: [...files.keys()].filter((f) => f !== "imsmanifest.xml").sort(),
  })));

  return { files, engineChecksums };
}

export async function zipPackage(files: Map<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [p, data] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    zip.file(p, data, { date: new Date(2000, 0, 1) }); // fixed date -> byte-stable zips
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
```

- [ ] **Step 4: Run test**

Run: `npm test -- tests/export-package.test.ts` — Expected: PASS. (It reads real files from `public/engines/`, so Task 7's build must exist.)

- [ ] **Step 5: Create `src/app/api/interactives/[id]/export/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { assemblePackage, zipPackage } from "@/lib/export/package";
import { scanPackage } from "@/lib/export/scanner";
import { assetStore, assetKey } from "@/lib/assets/store";
import { EXT_BY_MIME, ImageMime } from "@/lib/assets/validate";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interactive = await prisma.interactive.findUnique({ where: { id } });
  if (!interactive) return NextResponse.json({ error: "not found" }, { status: 404 });

  const validation = validateSandboxConfig(JSON.parse(interactive.configJson));
  if (!validation.ok) {
    return NextResponse.json({ error: "config invalid", violations: validation.errors.map((e) => ({ file: "config", rule: "schema", detail: e })) }, { status: 422 });
  }

  const policy = await prisma.policy.findUniqueOrThrow({ where: { id: 1 } });

  let assembled;
  try {
    assembled = await assemblePackage({
      identifier: `ILB-${interactive.id}`,
      title: validation.config.title,
      config: validation.config,
      resolveAsset: async (assetId) => {
        const asset = await prisma.asset.findUnique({ where: { id: assetId } });
        if (!asset || asset.projectId !== interactive.projectId) throw new Error(`unknown asset "${assetId}"`);
        const ext = EXT_BY_MIME[asset.mimeType as ImageMime];
        return { data: await assetStore.get(assetKey(asset.contentHash, ext)), ext };
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "assembly failed" }, { status: 422 });
  }

  const report = scanPackage(assembled.files, {
    engineChecksums: assembled.engineChecksums,
    urlAllowlist: JSON.parse(policy.allowlistJson) as string[],
    authoringConfig: validation.config,
  });

  await prisma.exportRecord.create({
    data: { interactiveId: interactive.id, passed: report.passed, reportJson: JSON.stringify(report) },
  });

  if (!report.passed) {
    return NextResponse.json({ error: "compliance scan failed", violations: report.violations }, { status: 422 });
  }

  const zip = await zipPackage(assembled.files);
  const filename = `${validation.config.title.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "interactive"}-scorm12.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Filename": filename,
    },
  });
}
```

- [ ] **Step 6: Manual end-to-end verification**

Build an Archimedes-style interactive (mass/density sliders, displaced-volume output, fill overlay on an uploaded container image, one challenge). Export. Unzip and verify layout matches spec section 6. Open `index.html` via a local static server — interactive runs in standalone mode. This is also the point to hand Tamara the zip for a Canvas sandbox SCORM import test (all three import modes; uploads go through her, per the established pattern — no API upload exists for SCORM).

- [ ] **Step 7: Run full suite + commit**

Run: `npm test` — Expected: all green.

```bash
git add -A
git commit -m "feat: export route with fail-closed compliance gate, ExportRecord audit trail, stable zips"
```

---

### Task 14: Golden export test + README + wrap-up

**Files:**
- Create: `tests/golden-export.test.ts`, `tests/fixtures/golden-config.json`, `README.md`

- [ ] **Step 1: Create `tests/fixtures/golden-config.json`**

```json
{
  "title": "Golden Sandbox",
  "intro": "<p>Golden fixture. Do not change without updating the golden test.</p>",
  "inputs": [
    { "id": "mass", "label": "Mass", "type": "slider", "min": 1, "max": 20, "step": 1, "defaultValue": 10, "units": "kg" },
    { "id": "density", "label": "Density", "type": "number", "min": 100, "max": 2000, "step": 10, "defaultValue": 1000, "units": "kg/m3" }
  ],
  "outputs": [
    { "id": "volume", "label": "Displaced volume", "formula": "mass / density * 1000", "units": "L", "decimals": 2 }
  ],
  "charts": [
    { "id": "sweep", "title": "Volume vs mass", "xInputId": "mass", "yOutputId": "volume", "samples": 20 }
  ],
  "challenges": [
    { "id": "big", "prompt": "Displace at least 15 L", "outputId": "volume", "comparator": "gte", "value": 15 }
  ]
}
```

- [ ] **Step 2: Create `tests/golden-export.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { assemblePackage, zipPackage } from "@/lib/export/package";
import { scanPackage } from "@/lib/export/scanner";

describe("golden export", () => {
  it("golden config assembles, passes the scanner, and zips deterministically", async () => {
    const raw = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "golden-config.json"), "utf8"));
    const v = validateSandboxConfig(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;

    const build = () => assemblePackage({
      identifier: "ILB-golden",
      title: v.config.title,
      config: v.config,
      resolveAsset: async () => { throw new Error("golden config has no assets"); },
    });

    const a = await build();
    const report = scanPackage(a.files, { engineChecksums: a.engineChecksums, urlAllowlist: [], authoringConfig: v.config });
    expect(report.violations).toEqual([]);

    const zip1 = await zipPackage(a.files);
    const zip2 = await zipPackage((await build()).files);
    expect(zip1.equals(zip2)).toBe(true); // byte-stable
    expect(zip1.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 3: Run**

Run: `npm test -- tests/golden-export.test.ts` — Expected: PASS.

- [ ] **Step 4: Create `scripts/set-policy.ts`** (admin-only policy changes in v1, per spec section 7)

```ts
/** Usage:
 *    npx tsx scripts/set-policy.ts show
 *    npx tsx scripts/set-policy.ts allowlist add youtube.com
 *    npx tsx scripts/set-policy.ts allowlist remove youtube.com
 *    npx tsx scripts/set-policy.ts max-bytes 10485760
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [cmd, arg1, arg2] = process.argv.slice(2);
  const policy = await prisma.policy.findUniqueOrThrow({ where: { id: 1 } });
  const allowlist: string[] = JSON.parse(policy.allowlistJson);

  if (cmd === "show" || !cmd) {
    console.log(JSON.stringify({ ...policy, allowlist }, null, 2));
    return;
  }
  if (cmd === "allowlist" && arg1 === "add" && arg2) {
    const host = arg2.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (!allowlist.includes(host)) allowlist.push(host);
  } else if (cmd === "allowlist" && arg1 === "remove" && arg2) {
    const i = allowlist.indexOf(arg2.toLowerCase());
    if (i >= 0) allowlist.splice(i, 1);
  } else if (cmd === "max-bytes" && arg1) {
    await prisma.policy.update({ where: { id: 1 }, data: { maxAssetBytes: Number(arg1), version: { increment: 1 } } });
    console.log("updated");
    return;
  } else {
    console.error("unknown command"); process.exit(1);
  }
  await prisma.policy.update({
    where: { id: 1 },
    data: { allowlistJson: JSON.stringify(allowlist), version: { increment: 1 } },
  });
  console.log("allowlist:", allowlist);
}

main().finally(() => prisma.$disconnect());
```

Verify: `npx tsx scripts/set-policy.ts show` prints the seeded strict policy (empty allowlist).

- [ ] **Step 5: Write `README.md`**

```markdown
# Interactive Lesson Builder (ILB)

Build concept-experimentation interactives (parameter sandboxes, simulations) and export
them as SCORM 1.2 packages for the Canvas LMS SCORM tool.

Spec: `docs/superpowers/specs/2026-08-25-scorm-interactive-builder-design.md`

## Run locally

    npm install
    npx prisma migrate dev
    npm run db:seed
    npm run build:engines   # only needed after editing src/engine-runtime/**
    npm run dev             # http://localhost:3000

## Tests

    npm test

## Security model (summary)

- Only audited engine runtimes (`src/engine-runtime/**`, built to `public/engines/**`
  with SHA-256 checksums) are executable code. Designers author JSON, never code.
- Formulas run through our own interpreter (`src/lib/formula/`); there is no eval anywhere.
- Rich text passes an https-only allowlist sanitizer; uploads are magic-byte checked,
  size-capped by policy, and re-encoded to strip metadata.
- Export fails closed behind the compliance scanner (`src/lib/export/scanner.ts`):
  URL allowlist (empty by default), forbidden patterns, engine checksums, file-type
  allowlist, schema revalidation. Every export attempt is recorded in ExportRecord.
- Policy (allowlist, caps) is the admin-only `Policy` row; no designer-facing UI.

## Canvas import

Export downloads a zip. Upload it in Canvas via the SCORM LTI tool; any import mode
works (graded imports receive both completion and a 0-100 score).

## Roadmap

Branching Scenario, Case/Evidence Workspace, and Process Simulator engines; sign-in +
admin policy UI; Vercel + Railway deployment; CreateAI generation provider.
```

- [ ] **Step 6: Full suite, lint, commit**

Run: `npm test` and `npm run lint` — Expected: green/no errors (fix any lint nits).

```bash
git add -A
git commit -m "test: golden deterministic export; feat: policy maintenance script; docs: README"
```

- [ ] **Step 7: Verification-before-completion**

Re-run everything from clean: `npm test`, `npm run build:engines` (manifest unchanged → `git status` clean), `npm run build` (Next production build succeeds), and the manual end-to-end from Task 13 Step 6. Only then report the milestone complete.




