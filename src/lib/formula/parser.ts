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
      const value = Number(m[0]);
      if (!Number.isFinite(value)) throw new Error(`number literal too large at position ${i}`);
      tokens.push({ type: "num", value });
      i += m[0].length;
      continue;
    }
    // ASCII-only identifiers are deliberate: keeps formulas portable across the
    // authoring UI and the SCORM-bundled runtime without Unicode edge cases.
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

const MAX_FORMULA_LENGTH = 1000;

export function parseFormula(src: string): ParseResult {
  try {
    // Self-contained input bound: this library must be safe on its own terms
    // even if an upstream caller's own cap (e.g. a Zod schema) is bypassed or
    // absent. Also keeps pathological inputs (e.g. deeply nested parens) from
    // ever reaching the recursive-descent parser in the first place.
    if (src.length > MAX_FORMULA_LENGTH) {
      throw new Error(`formula too long (max ${MAX_FORMULA_LENGTH} characters)`);
    }
    const tokens = tokenize(src);
    if (tokens.length === 0) throw new Error("empty formula");
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (op: string) => peek()?.type === "op" && (peek() as { type: "op"; op: string }).op === op;
    const expect = (op: string) => {
      if (!isOp(op)) throw new Error(`expected "${op}"`);
      pos++;
    };

    function expr(): AstNode {
      let left = term();
      while (isOp("+") || isOp("-")) {
        const op = (tokens[pos++] as { type: "op"; op: "+" | "-" }).op;
        left = { kind: "binary", op, left, right: term() };
      }
      return left;
    }
    function term(): AstNode {
      let left = unary();
      while (isOp("*") || isOp("/")) {
        const op = (tokens[pos++] as { type: "op"; op: "*" | "/" }).op;
        left = { kind: "binary", op, left, right: unary() };
      }
      return left;
    }
    function unary(): AstNode {
      if (isOp("-")) { pos++; return { kind: "unary", op: "-", operand: unary() }; }
      return factor();
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
      throw new Error(`unexpected token "${t.type === "op" ? t.op : ""}"`);
    }

    const ast = expr();
    if (pos !== tokens.length) throw new Error(`unexpected trailing input at token ${pos}`);
    return { ok: true, ast };
  } catch (e) {
    // Catches parser errors above as well as any RangeError (e.g. "Maximum
    // call stack size exceeded") from pathological deeply-nested input —
    // parseFormula must always return a result, never throw.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
