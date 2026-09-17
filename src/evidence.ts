import ts from 'typescript';
import {
  type FnScope,
  isFunctionLikeNode,
  type ModuleScope,
  resolveName,
  unwrap,
} from './scope.js';

/**
 * Positive evidence that a module-state write is not a cross-request leak even though it sits in
 * the request path. Each kind maps to a note appended to the finding, which is then reported at
 * `low` (visible with `--all`).
 */
export type EvidenceKind =
  | 'dedupe-set'
  | 'argument-keyed-cache'
  | 'request-lifetime'
  | 'browser-deref';

export const EVIDENCE_NOTES: Readonly<Record<EvidenceKind, string>> = {
  'dedupe-set':
    'The same function checks `.has()` before `.add()`, so this is a dedupe set of keys rather than stored request data; reported for audit only.',
  'argument-keyed-cache':
    'The stored value does not derive from request data; only the key comes from an argument, so this looks like a memo cache keyed by its argument; reported for audit only.',
  'request-lifetime':
    'The same function deletes this entry again (`.delete()`), so it does not outlive the call that wrote it; reported for audit only.',
  'browser-deref':
    'Preceded by an unconditional browser API access (window/document/location/…) that would throw during SSR, so this code cannot run on the server; reported for audit only.',
};

/**
 * Globals whose property access throws a ReferenceError in every supported server runtime.
 * `navigator` and `self` are absent on purpose (Node 21+, Bun, Deno and edge runtimes define them).
 */
const BROWSER_ONLY_GLOBALS: ReadonlySet<string> = new Set([
  'window',
  'document',
  'location',
  'localStorage',
  'sessionStorage',
  'history',
  'screen',
]);

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'global', 'window']);

/**
 * `<coll>.<method>(…)` anywhere in `fn`'s own body (nested functions included, since a callback
 * defined in the same function still shares the intent).
 */
export function functionCallsMethodOn(fn: FnScope, collection: string, method: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === method &&
        ts.isIdentifier(unwrap(callee.expression)) &&
        (unwrap(callee.expression) as ts.Identifier).text === collection
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  if (fn.node.body) visit(fn.node.body);
  return found;
}

/**
 * Is `node` a property/element access whose evaluation throws on the server: `window.x`,
 * `document.body`, `location.pathname`, `globalThis.location.href`, `localStorage.getItem(…)`?
 * Shadowed names (a local `const window = …`) do not count.
 */
function isBrowserDeref(node: ts.Node, fnStack: FnScope[], moduleScope: ModuleScope): boolean {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  if (node.questionDotToken) return false;
  const base = unwrap(node.expression);
  if (ts.isIdentifier(base)) {
    if (!BROWSER_ONLY_GLOBALS.has(base.text)) return false;
    return resolveName(base.text, fnStack, moduleScope).type === 'unresolved';
  }
  // globalThis.location.pathname: the inner access is `globalThis.location` (undefined on the
  // server, no throw); the outer access on it throws.
  if (ts.isPropertyAccessExpression(base)) {
    const root = unwrap(base.expression);
    return (
      ts.isIdentifier(root) &&
      GLOBAL_OBJECTS.has(root.text) &&
      BROWSER_ONLY_GLOBALS.has(base.name.text) &&
      resolveName(root.text, fnStack, moduleScope).type === 'unresolved'
    );
  }
  return false;
}

/**
 * Does evaluating `node` unconditionally dereference a browser-only global? Conditional parts are
 * skipped: nested functions, `typeof x`, the right side of `&&` / `||` / `??`, ternary branches,
 * optional chains and anything inside `try`.
 */
function containsUnconditionalBrowserDeref(
  node: ts.Node,
  fnStack: FnScope[],
  moduleScope: ModuleScope,
): boolean {
  if (isFunctionLikeNode(node) || ts.isTypeOfExpression(node) || ts.isTryStatement(node)) {
    return false;
  }
  if (isBrowserDeref(node, fnStack, moduleScope)) return true;
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return containsUnconditionalBrowserDeref(node.left, fnStack, moduleScope);
    }
  }
  if (ts.isConditionalExpression(node)) {
    return containsUnconditionalBrowserDeref(node.condition, fnStack, moduleScope);
  }
  if (ts.isIfStatement(node)) {
    return containsUnconditionalBrowserDeref(node.expression, fnStack, moduleScope);
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsUnconditionalBrowserDeref(child, fnStack, moduleScope)) found = true;
  });
  return found;
}

/**
 * Is `write` preceded, on every path through the innermost function, by a browser-only global
 * dereference? Looks at statements before the write in each enclosing block up to the function
 * body, and at the conditions of enclosing `if` statements.
 */
export function precededByBrowserDeref(
  write: ts.Node,
  fnStack: FnScope[],
  moduleScope: ModuleScope,
): boolean {
  const fn = fnStack.at(-1);
  if (!fn?.node.body) return false;
  let child: ts.Node = write;
  let parent = write.parent;
  while (parent && parent !== fn.node) {
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      for (const statement of parent.statements) {
        if (statement === child || statement.end > child.pos) break;
        if (containsUnconditionalBrowserDeref(statement, fnStack, moduleScope)) return true;
      }
    } else if (ts.isIfStatement(parent) && child !== parent.expression) {
      if (containsUnconditionalBrowserDeref(parent.expression, fnStack, moduleScope)) return true;
    } else if (isFunctionLikeNode(parent)) {
      break;
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
}
