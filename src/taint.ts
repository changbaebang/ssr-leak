import ts from 'typescript';
import { type FnScope, type ModuleScope, resolveName, unwrap } from './scope.js';

export const DEFAULT_TAINT_FUNCTIONS: readonly string[] = [
  'headers',
  'cookies',
  'draftMode',
  'getServerSession',
];

export const DEFAULT_TAINT_IDENTIFIERS: readonly string[] = [
  'req',
  'request',
  'ctx',
  'context',
  'params',
  'searchParams',
  'event',
];

/**
 * Taint identifiers that are also ordinary browser-side names (`event` handlers, router `params`,
 * a `URLSearchParams`). When one of these is a *parameter of a function that is not an SSR entry
 * point*, it only counts as a request primitive if the accessed member looks like request data;
 * otherwise it is a bare-parameter (weak) source.
 */
export const WEAK_TAINT_IDENTIFIERS: ReadonlySet<string> = new Set([
  'params',
  'searchParams',
  'event',
]);

/** Members that mark a value as request data even on a weakly named parameter. */
export const REQUEST_MEMBERS: ReadonlySet<string> = new Set([
  'headers',
  'header',
  'cookies',
  'cookie',
  'authorization',
  'session',
  'user',
  'token',
  'body',
  'query',
  'url',
  'ip',
  'locale',
  'req',
  'request',
]);

export interface TaintContext {
  fnStack: FnScope[];
  moduleScope: ModuleScope;
  taintFunctions: ReadonlySet<string>;
  taintIdentifiers: ReadonlySet<string>;
}

/**
 * Where a request-scoped value comes from.
 *
 * `primitive` is true when the source is a request primitive: a taint-source call
 * (`headers()`, `cookies()`, …), a property read on a taint identifier (`req.*`, `params.*`, …),
 * a parameter *named* like one, or a parameter of a recognized SSR entry point
 * (`getServerSideProps`, route handler `GET`, `middleware`, a `pages/api` handler, an
 * `app/**\/page|layout|template` default export). It is false when the only source is a bare
 * parameter of some other function — a setter, a subscription, a memo cache keyed by its argument —
 * which may or may not run per request.
 */
export interface Taint {
  source: string;
  primitive: boolean;
}

interface TaintState {
  memo: Map<ts.Node, Taint | null>;
  inProgress: Set<string>;
}

function localKey(scope: FnScope, name: string): string {
  return `${scope.node.pos}:${name}`;
}

/**
 * Returns the request-scoped source an expression derives from, or `null` when the expression is
 * not tainted. Flow-insensitive and conservative. A primitive source wins over a bare-parameter one.
 */
export function findTaint(expr: ts.Node, ctx: TaintContext): Taint | null {
  return taintOf(expr, ctx, { memo: new Map(), inProgress: new Set() });
}

/** Scans candidates in order; returns the first primitive taint, else the first weak one. */
function scan(
  nodes: Iterable<ts.Node | undefined>,
  ctx: TaintContext,
  state: TaintState,
): Taint | null {
  let weak: Taint | null = null;
  for (const node of nodes) {
    if (!node) continue;
    const r = taintOf(node, ctx, state);
    if (r?.primitive) return r;
    weak ??= r;
  }
  return weak;
}

function taintOfIdentifier(id: ts.Identifier, ctx: TaintContext, state: TaintState): Taint | null {
  const name = id.text;
  const res = resolveName(name, ctx.fnStack, ctx.moduleScope);
  if (res.type === 'param') {
    const namedLikeRequest = ctx.taintIdentifiers.has(name) && !WEAK_TAINT_IDENTIFIERS.has(name);
    return {
      source: `parameter \`${name}\``,
      primitive: res.scope.isSsrEntry || namedLikeRequest,
    };
  }
  if (res.type === 'local') {
    const key = localKey(res.scope, name);
    if (!state.inProgress.has(key)) {
      state.inProgress.add(key);
      try {
        const r = scan(res.scope.assigned.get(name) ?? [], ctx, state);
        if (r) return r;
      } finally {
        state.inProgress.delete(key);
      }
    }
  }
  if (res.type !== 'module' && ctx.taintIdentifiers.has(name)) {
    return { source: `\`${name}\``, primitive: true };
  }
  return null;
}

function taintOfCall(call: ts.CallExpression, ctx: TaintContext, state: TaintState): Taint | null {
  const callee = unwrap(call.expression);
  let weak: Taint | null = null;
  if (ts.isIdentifier(callee)) {
    const res = resolveName(callee.text, ctx.fnStack, ctx.moduleScope);
    if (ctx.taintFunctions.has(callee.text) && res.type !== 'local') {
      return { source: `\`${callee.text}()\``, primitive: true };
    }
    weak = taintOfIdentifier(callee, ctx, state);
  } else if (ts.isPropertyAccessExpression(callee)) {
    if (ctx.taintFunctions.has(callee.name.text)) {
      return { source: `\`${callee.name.text}()\``, primitive: true };
    }
    weak = taintOf(callee.expression, ctx, state);
  } else {
    weak = taintOf(callee, ctx, state);
  }
  if (weak?.primitive) return weak;
  return scan(call.arguments, ctx, state) ?? weak;
}

function taintOf(node: ts.Node, ctx: TaintContext, state: TaintState): Taint | null {
  const cached = state.memo.get(node);
  if (cached !== undefined) return cached;
  const result = compute(node, ctx, state);
  state.memo.set(node, result);
  return result;
}

function compute(node: ts.Node, ctx: TaintContext, state: TaintState): Taint | null {
  if (ts.isIdentifier(node)) return taintOfIdentifier(node, ctx, state);

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isSpreadElement(node) ||
    ts.isSpreadAssignment(node)
  ) {
    return taintOf(node.expression, ctx, state);
  }

  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const obj = taintOf(node.expression, ctx, state);
    if (obj?.primitive) return obj;
    const base = unwrap(node.expression);
    if (ts.isIdentifier(base) && ctx.taintIdentifiers.has(base.text)) {
      const res = resolveName(base.text, ctx.fnStack, ctx.moduleScope);
      if (res.type !== 'module') {
        const memberName = ts.isPropertyAccessExpression(node) ? node.name.text : null;
        const member = memberName ? `.${memberName}` : '[...]';
        // `searchParams.get('x')` on a plain function's parameter is not request data by itself;
        // `event.headers` / `params.cookies` still are, and so is anything on `req` / `ctx`.
        const weakParam =
          res.type === 'param' &&
          !res.scope.isSsrEntry &&
          WEAK_TAINT_IDENTIFIERS.has(base.text) &&
          !(memberName && REQUEST_MEMBERS.has(memberName));
        return { source: `\`${base.text}${member}\``, primitive: !weakParam };
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const key = taintOf(node.argumentExpression, ctx, state);
      if (key?.primitive) return key;
      return obj ?? key;
    }
    return obj;
  }

  if (ts.isCallExpression(node)) return taintOfCall(node, ctx, state);

  if (ts.isNewExpression(node)) return scan(node.arguments ?? [], ctx, state);

  if (ts.isTemplateExpression(node)) {
    return scan(
      node.templateSpans.map((s) => s.expression),
      ctx,
      state,
    );
  }

  if (ts.isTaggedTemplateExpression(node)) return taintOf(node.template, ctx, state);

  if (ts.isBinaryExpression(node)) {
    const isAssignment =
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    if (isAssignment) return taintOf(node.right, ctx, state);
    return scan([node.left, node.right], ctx, state);
  }

  if (ts.isConditionalExpression(node)) return scan([node.whenTrue, node.whenFalse], ctx, state);

  if (ts.isObjectLiteralExpression(node)) {
    const parts: ts.Node[] = [];
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        parts.push(prop.initializer);
        if (ts.isComputedPropertyName(prop.name)) parts.push(prop.name.expression);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        parts.push(prop.name);
      } else if (ts.isSpreadAssignment(prop)) {
        parts.push(prop.expression);
      }
    }
    return scan(parts, ctx, state);
  }

  if (ts.isArrayLiteralExpression(node)) return scan(node.elements, ctx, state);

  if (ts.isPrefixUnaryExpression(node)) {
    if (
      node.operator === ts.SyntaxKind.ExclamationToken ||
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      return null;
    }
    return taintOf(node.operand, ctx, state);
  }

  if (ts.isCommaListExpression(node)) {
    const last = node.elements[node.elements.length - 1];
    return last ? taintOf(last, ctx, state) : null;
  }

  // Literals, `this`, functions, classes, JSX, typeof/void, etc. are not request-scoped.
  return null;
}
