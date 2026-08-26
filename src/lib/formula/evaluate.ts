import { AstNode, FORMULA_CONSTANTS } from "./parser";

export class FormulaError extends Error {}

const FUNCTION_IMPLS: Record<string, (...args: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, round: Math.round,
  floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, pow: Math.pow,
  exp: Math.exp, ln: Math.log, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
};

function hasOwn(obj: Record<string, number>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function lookupVar(name: string, vars: Record<string, number>): number {
  if (hasOwn(vars, name)) {
    const v = vars[name];
    if (typeof v === "number") return v;
    throw new FormulaError(`unknown variable "${name}"`);
  }
  if (hasOwn(FORMULA_CONSTANTS, name)) {
    const v = FORMULA_CONSTANTS[name];
    if (typeof v === "number") return v;
    throw new FormulaError(`unknown variable "${name}"`);
  }
  throw new FormulaError(`unknown variable "${name}"`);
}

export function evaluateFormula(ast: AstNode, vars: Record<string, number>): number {
  const result = evalNode(ast, vars);
  if (!Number.isFinite(result)) throw new FormulaError("result is not a finite number");
  return result;
}

function evalNode(node: AstNode, vars: Record<string, number>): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var":
      return lookupVar(node.name, vars);
    case "unary":
      return -evalNode(node.operand, vars);
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
        default:
          throw new FormulaError("unreachable binary operator");
      }
    }
    case "call": {
      const fn = FUNCTION_IMPLS[node.name];
      if (!fn) throw new FormulaError(`unknown function "${node.name}"`);
      return fn(...node.args.map((a) => evalNode(a, vars)));
    }
    default: {
      const _exhaustive: never = node;
      throw new FormulaError(`unreachable node kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Variable references only (constants and function names excluded). */
export function collectIdentifiers(ast: AstNode): string[] {
  const out = new Set<string>();
  walk(ast);
  return [...out];
  function walk(n: AstNode): void {
    if (n.kind === "var" && !hasOwn(FORMULA_CONSTANTS, n.name)) out.add(n.name);
    else if (n.kind === "unary") walk(n.operand);
    else if (n.kind === "binary") { walk(n.left); walk(n.right); }
    else if (n.kind === "call") n.args.forEach(walk);
  }
}
