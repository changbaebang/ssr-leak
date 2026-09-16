import ts from 'typescript';
import { unwrap } from './scope.js';

/**
 * What a condition evaluates to during SSR. `'server'`: guaranteed true on the server (e.g.
 * `typeof window === 'undefined'`, `isServer()`). `'client'`: guaranteed false on the server, i.e.
 * only ever true in a browser (`typeof window !== 'undefined'`, `isClient()`). `null`: unknown.
 */
export type RuntimeEnv = 'server' | 'client' | null;

export interface GuardNames {
  /** Functions or identifiers that are truthy only on the server (`isServer()`). */
  server: ReadonlySet<string>;
  /** Functions or identifiers that are truthy only in a browser (`isClient()`, `canUseDOM`). */
  client: ReadonlySet<string>;
}

export const DEFAULT_SERVER_GUARDS: readonly string[] = ['isServer', 'isSSR', 'isServerSide'];
export const DEFAULT_CLIENT_GUARDS: readonly string[] = [
  'isClient',
  'isBrowser',
  'isClientSide',
  'canUseDOM',
];

/**
 * Globals whose `typeof` is `'undefined'` in every supported server runtime and an object in a
 * browser. `navigator` is deliberately absent: Node 21+, Bun, Deno and the edge runtimes define it,
 * so `typeof navigator === 'object'` is true during SSR. `self` is absent for the same reason (edge
 * runtimes and Deno define it).
 */
const BROWSER_GLOBALS: ReadonlySet<string> = new Set(['window', 'document']);

export function buildGuardNames(extra?: { server?: string[]; client?: string[] }): GuardNames {
  return {
    server: new Set([...DEFAULT_SERVER_GUARDS, ...(extra?.server ?? [])]),
    client: new Set([...DEFAULT_CLIENT_GUARDS, ...(extra?.client ?? [])]),
  };
}

function flip(env: RuntimeEnv): RuntimeEnv {
  if (env === 'server') return 'client';
  if (env === 'client') return 'server';
  return null;
}

/** `window`, `globalThis.window`, `global.window`, `self.document`… → the global's name. */
function browserGlobalName(expr: ts.Expression): string | null {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return BROWSER_GLOBALS.has(e.text) ? e.text : null;
  if (ts.isPropertyAccessExpression(e)) {
    const obj = unwrap(e.expression);
    if (ts.isIdentifier(obj) && (obj.text === 'globalThis' || obj.text === 'global')) {
      return BROWSER_GLOBALS.has(e.name.text) ? e.name.text : null;
    }
  }
  return null;
}

/** The last identifier of a callee chain: `isServer` for `isServer`, `runtime.isServer()`, `env.isClient`. */
function lastName(expr: ts.Expression): string | null {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function isStringLiteral(expr: ts.Expression, text: string): boolean {
  const e = unwrap(expr);
  return ts.isStringLiteralLike(e) && e.text === text;
}

/**
 * `typeof window === 'undefined'` → server; `typeof window !== 'undefined'` → client. Handles both
 * operand orders, `==`/`!=`, and `typeof window === 'object'` (client).
 */
function classifyTypeofComparison(expr: ts.BinaryExpression): RuntimeEnv {
  const op = expr.operatorToken.kind;
  const equals =
    op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
  const notEquals =
    op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsToken;
  if (!equals && !notEquals) return null;

  const sides = [unwrap(expr.left), unwrap(expr.right)];
  for (let i = 0; i < 2; i++) {
    const typeofNode = sides[i];
    const literal = sides[1 - i];
    if (!typeofNode || !literal || !ts.isTypeOfExpression(typeofNode)) continue;
    if (!browserGlobalName(typeofNode.expression)) continue;
    if (isStringLiteral(literal, 'undefined')) return equals ? 'server' : 'client';
    if (isStringLiteral(literal, 'object')) return equals ? 'client' : 'server';
  }
  return null;
}

/**
 * Classifies a boolean expression by its value during SSR: `'server'` when it is guaranteed true
 * there, `'client'` when it is guaranteed false there (true only in a browser), `null` otherwise.
 *
 * - `typeof window === 'undefined'` → server; `!== 'undefined'` → client. Also `document` and
 *   `globalThis.window`. `navigator` / `self` are not guards: Node 21+ and edge runtimes define them.
 * - A call or identifier whose last name is in `names.server` → server, `names.client` → client.
 * - `!x` flips. Three-valued logic for `&&` / `||`: `server || x` is still server (true on the
 *   server no matter what `x` is), `client && x` is still client (false on the server), while
 *   `server && x` and `client || x` are unknown.
 */
export function classifyCondition(expr: ts.Expression, names: GuardNames): RuntimeEnv {
  const e = unwrap(expr);

  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    return flip(classifyCondition(e.operand, names));
  }

  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = classifyCondition(e.left, names);
      const r = classifyCondition(e.right, names);
      if (l === 'client' || r === 'client') return 'client';
      return l === 'server' && r === 'server' ? 'server' : null;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const l = classifyCondition(e.left, names);
      const r = classifyCondition(e.right, names);
      if (l === 'server' || r === 'server') return 'server';
      return l === 'client' && r === 'client' ? 'client' : null;
    }
    return classifyTypeofComparison(e);
  }

  const name = ts.isCallExpression(e) ? lastName(e.expression) : lastName(e);
  if (name === null) return null;
  if (names.server.has(name)) return 'server';
  if (names.client.has(name)) return 'client';
  return null;
}

/** A statement that unconditionally leaves the enclosing function: `return …;` / `throw …;`, or a block ending in one. */
function exitsFunction(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements.at(-1);
    return last !== undefined && exitsFunction(last);
  }
  return false;
}

/**
 * `if (<server-only condition>) return;` — every statement after it in the same block runs only
 * in a browser.
 */
export function isServerEarlyExit(statement: ts.Statement, names: GuardNames): boolean {
  if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
  return (
    classifyCondition(statement.expression, names) === 'server' &&
    exitsFunction(statement.thenStatement)
  );
}
