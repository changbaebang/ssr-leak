import ts from 'typescript';

export type BindingKind =
  | 'const'
  | 'let'
  | 'var'
  | 'function'
  | 'class'
  | 'import'
  | 'enum'
  | 'namespace';

export type CollectionKind = 'map' | 'set' | 'array' | 'object' | 'none';

export interface ModuleBinding {
  name: string;
  kind: BindingKind;
  /** Default import of `axios`, `require('axios')`, or a variable initialized by `<axios>.create(...)`. */
  isAxios: boolean;
  /** `create` destructured from axios: `import { create } from 'axios'` / `const { create } = require('axios')`. */
  isAxiosFactory: boolean;
  collection: CollectionKind;
}

export interface ModuleScope {
  bindings: Map<string, ModuleBinding>;
  /** Names of functions invoked (or classes instantiated) directly by a top-level statement (module init). */
  topLevelInvoked: Set<string>;
}

export interface FnScope {
  node: ts.FunctionLikeDeclaration;
  params: Set<string>;
  locals: Set<string>;
  /** Every expression assigned to a local (initializers, `=`, for-of/in sources). */
  assigned: Map<string, ts.Expression[]>;
  /**
   * Non-exported function invoked at module top level, an IIFE at module scope, or the constructor
   * of a non-exported class instantiated by a top-level statement.
   */
  isModuleInit: boolean;
  /** Callback passed to useEffect / useLayoutEffect / useInsertionEffect. */
  isEffectCallback: boolean;
  /**
   * A recognized SSR entry point whose parameters are request data: `getServerSideProps`,
   * `getStaticProps`, `getInitialProps`, exported `GET`/`POST`/… route handlers, exported
   * `middleware` / `proxy` (or the default export of `middleware.*` / `proxy.*`), exported
   * `generateMetadata` / `generateViewport`, a Remix / React Router `loader` / `action` taking
   * `{ request | params | context }`, a Server Action (`'use server'` at file level and exported,
   * or as the function's first statement), a default export in `pages/api/**`, or a default
   * export in `app/**\/(page|layout|template|default).*`.
   */
  isSsrEntry: boolean;
}

export type FunctionLike = ts.FunctionLikeDeclaration;

export function isFunctionLikeNode(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

export function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

export function collectBindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, out);
  }
}

/**
 * Collects the identifiers assigned by a destructuring assignment target
 * (`[a, , b = 1, ...rest] = …`, `({ a, b: c, ...rest } = …)`).
 */
export function collectAssignmentTargetNames(target: ts.Expression, out: string[]): void {
  const e = unwrap(target);
  if (ts.isIdentifier(e)) {
    out.push(e.text);
    return;
  }
  if (ts.isOmittedExpression(e)) return;
  if (ts.isSpreadElement(e)) {
    collectAssignmentTargetNames(e.expression, out);
    return;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    collectAssignmentTargetNames(e.left, out);
    return;
  }
  if (ts.isArrayLiteralExpression(e)) {
    for (const el of e.elements) collectAssignmentTargetNames(el, out);
    return;
  }
  if (ts.isObjectLiteralExpression(e)) {
    for (const prop of e.properties) {
      if (ts.isPropertyAssignment(prop)) collectAssignmentTargetNames(prop.initializer, out);
      else if (ts.isShorthandPropertyAssignment(prop)) out.push(prop.name.text);
      else if (ts.isSpreadAssignment(prop)) collectAssignmentTargetNames(prop.expression, out);
    }
  }
}

/** Strips parentheses, type assertions and non-null assertions. */
export function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e)
    ) {
      e = e.expression;
      continue;
    }
    return e;
  }
}

export interface ChainPart {
  /** Static property name, or `null` for a computed key. */
  name: string | null;
  /** Computed key expression (only when `name` is null). */
  expr?: ts.Expression;
}

export interface Chain {
  root: ts.Identifier;
  parts: ChainPart[];
}

/** Resolves `a.b['c'][d]` into a root identifier plus parts. Returns null for non-identifier roots. */
export function resolveChain(expr: ts.Expression): Chain | null {
  const parts: ChainPart[] = [];
  let e = unwrap(expr);
  for (;;) {
    if (ts.isPropertyAccessExpression(e)) {
      parts.unshift({ name: e.name.text });
      e = unwrap(e.expression);
      continue;
    }
    if (ts.isElementAccessExpression(e)) {
      const arg = unwrap(e.argumentExpression);
      if (ts.isStringLiteralLike(arg) || ts.isNumericLiteral(arg)) {
        parts.unshift({ name: arg.text });
      } else {
        parts.unshift({ name: null, expr: arg });
      }
      e = unwrap(e.expression);
      continue;
    }
    if (ts.isIdentifier(e)) return { root: e, parts };
    return null;
  }
}

function asRequireCall(expr: ts.Expression): ts.CallExpression | null {
  const e = unwrap(expr);
  if (!ts.isCallExpression(e)) return null;
  const callee = unwrap(e.expression);
  return ts.isIdentifier(callee) && callee.text === 'require' ? e : null;
}

function isRequireCall(expr: ts.Expression, moduleName: string): boolean {
  const call = asRequireCall(expr);
  if (!call) return false;
  const arg = call.arguments[0];
  return arg !== undefined && ts.isStringLiteralLike(arg) && arg.text === moduleName;
}

function collectionKindOf(init: ts.Expression | undefined): CollectionKind {
  if (!init) return 'none';
  const e = unwrap(init);
  if (ts.isObjectLiteralExpression(e)) return 'object';
  if (ts.isArrayLiteralExpression(e)) return 'array';
  if (ts.isNewExpression(e)) {
    const ctor = unwrap(e.expression);
    if (!ts.isIdentifier(ctor)) return 'none';
    switch (ctor.text) {
      case 'Map':
      case 'WeakMap':
        return 'map';
      case 'Set':
      case 'WeakSet':
        return 'set';
      case 'Array':
        return 'array';
      case 'Object':
        return 'object';
      default:
        return 'none';
    }
  }
  if (ts.isCallExpression(e)) {
    const chain = resolveChain(e.expression);
    if (chain && chain.root.text === 'Object' && chain.parts[0]?.name === 'create') return 'object';
    if (chain && chain.root.text === 'Array' && chain.parts[0]?.name === 'from') return 'array';
  }
  return 'none';
}

/** `<axios>.create(...)` or a bare `create(...)` where `create` was destructured from axios. */
function isAxiosCreate(
  init: ts.Expression | undefined,
  bindings: Map<string, ModuleBinding>,
): boolean {
  if (!init) return false;
  const e = unwrap(init);
  if (!ts.isCallExpression(e)) return false;
  const chain = resolveChain(e.expression);
  if (!chain) return false;
  const binding = bindings.get(chain.root.text);
  if (!binding) return false;
  if (chain.parts.length === 0) return binding.isAxiosFactory;
  return chain.parts.length === 1 && chain.parts[0]?.name === 'create' && binding.isAxios;
}

function declarationKind(list: ts.VariableDeclarationList): BindingKind {
  if (list.flags & ts.NodeFlags.Const) return 'const';
  if (list.flags & ts.NodeFlags.Let) return 'let';
  return 'var';
}

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);

/** Next.js data-fetching functions; request data flows in through their parameters. */
const SSR_ENTRY_NAMES = new Set(['getServerSideProps', 'getStaticProps', 'getInitialProps']);
/**
 * Entry points that only count when exported: route handlers, `middleware` / `proxy` (Next 16
 * renamed the file and function to `proxy`), and the App Router metadata functions, which run
 * per request on dynamic routes.
 */
const SSR_EXPORTED_ENTRY_NAMES = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'middleware',
  'proxy',
  'generateMetadata',
  'generateViewport',
]);
/**
 * Remix / React Router data functions: `loader({ request, params, context })` and
 * `action({ request, params, context })`. Only an exported function whose first parameter
 * destructures one of those names counts, so an unrelated `export const loader` is left alone.
 */
const ROUTE_DATA_FUNCTION_NAMES = new Set(['loader', 'action']);
const ROUTE_DATA_PARAM_NAMES = new Set(['request', 'params', 'context']);
const PAGES_API_FILE = /(^|\/)pages\/api\//;
const APP_ENTRY_FILE = /(^|\/)app\/(.*\/)?(page|layout|template|default)\.[cm]?[jt]sx?$/;
/** `middleware.ts` / `proxy.ts` at the project (or `src/`) root: the default export is the handler. */
const MIDDLEWARE_FILE = /(^|\/)(middleware|proxy)\.[cm]?[jt]s$/;

/** `'use server'` as the first statement of a body: a Server Action / Server Function. */
function startsWithUseServer(statements: readonly ts.Statement[]): boolean {
  for (const s of statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteralLike(s.expression)) return false;
    if (s.expression.text === 'use server') return true;
  }
  return false;
}

/** File-level `'use server'` directive: every exported function is a Server Function. */
export function isServerActionFile(sf: ts.SourceFile): boolean {
  return startsWithUseServer(sf.statements);
}

function isServerActionFunction(fn: FunctionLike): boolean {
  return fn.body !== undefined && ts.isBlock(fn.body) && startsWithUseServer(fn.body.statements);
}

function isRouteDataFunction(fn: FunctionLike, site: BindingSite): boolean {
  if (!site.exported || !site.name || !ROUTE_DATA_FUNCTION_NAMES.has(site.name)) return false;
  const first = fn.parameters[0];
  if (!first || !ts.isObjectBindingPattern(first.name)) return false;
  return first.name.elements.some((el) => {
    const key = el.propertyName ?? el.name;
    return ts.isIdentifier(key) && ROUTE_DATA_PARAM_NAMES.has(key.text);
  });
}

/**
 * Collects callee identifiers invoked (`f()`) or instantiated (`new C()`) by top-level statements
 * without entering function or class bodies.
 */
function collectTopLevelInvoked(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (isFunctionLikeNode(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node))
      return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee)) out.add(callee.text);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of sf.statements) visit(statement);
  return out;
}

export function collectModuleScope(sf: ts.SourceFile): ModuleScope {
  const bindings = new Map<string, ModuleBinding>();
  const add = (name: string, kind: BindingKind, extra: Partial<ModuleBinding> = {}): void => {
    bindings.set(name, {
      name,
      kind,
      isAxios: false,
      isAxiosFactory: false,
      collection: 'none',
      ...extra,
    });
  };

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const spec = statement.moduleSpecifier;
      const fromAxios = ts.isStringLiteralLike(spec) && spec.text === 'axios';
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) add(clause.name.text, 'import', { isAxios: fromAxios });
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) {
        add(named.name.text, 'import', { isAxios: fromAxios });
      } else if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          const original = (el.propertyName ?? el.name).text;
          add(el.name.text, 'import', {
            isAxios: fromAxios && original === 'default',
            isAxiosFactory: fromAxios && original === 'create',
          });
        }
      }
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      const ref = statement.moduleReference;
      const fromAxios =
        ts.isExternalModuleReference(ref) &&
        ts.isStringLiteralLike(ref.expression) &&
        ref.expression.text === 'axios';
      add(statement.name.text, 'import', { isAxios: fromAxios });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const kind = declarationKind(statement.declarationList);
      for (const decl of statement.declarationList.declarations) {
        const init = decl.initializer;
        const isRequire = init !== undefined && asRequireCall(init) !== null;
        if (ts.isIdentifier(decl.name)) {
          const isAxios =
            (init !== undefined && isRequireCall(init, 'axios')) || isAxiosCreate(init, bindings);
          add(decl.name.text, isRequire ? 'import' : kind, {
            isAxios,
            collection: collectionKindOf(init),
          });
          continue;
        }
        // `const { create } = require('axios')` marks `create` as an axios factory.
        const fromAxios = init !== undefined && isRequireCall(init, 'axios');
        if (ts.isObjectBindingPattern(decl.name)) {
          for (const el of decl.name.elements) {
            const original = el.propertyName
              ? ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : null
              : ts.isIdentifier(el.name)
                ? el.name.text
                : null;
            const names: string[] = [];
            collectBindingNames(el.name, names);
            for (const name of names) {
              add(name, isRequire ? 'import' : kind, {
                isAxiosFactory: fromAxios && original === 'create' && ts.isIdentifier(el.name),
              });
            }
          }
          continue;
        }
        const names: string[] = [];
        collectBindingNames(decl.name, names);
        for (const name of names) add(name, isRequire ? 'import' : kind);
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      add(statement.name.text, 'function');
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      add(statement.name.text, 'class');
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      add(statement.name.text, 'enum');
      continue;
    }
    if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
      add(statement.name.text, 'namespace');
    }
  }

  return { bindings, topLevelInvoked: collectTopLevelInvoked(sf) };
}

function isIife(fn: FunctionLike): boolean {
  let p: ts.Node = fn.parent;
  while (p && ts.isParenthesizedExpression(p)) p = p.parent;
  return ts.isCallExpression(p) && unwrap(p.expression) === fn;
}

/** The top-level class a constructor belongs to, when it is declared (or assigned to a const) at module scope. */
function ownerClassName(
  ctor: ts.ConstructorDeclaration,
): { name: string; exported: boolean } | null {
  const cls = ctor.parent;
  if (ts.isClassDeclaration(cls)) {
    if (!cls.name || !ts.isSourceFile(cls.parent)) return null;
    return { name: cls.name.text, exported: hasExportModifier(cls) };
  }
  if (ts.isClassExpression(cls)) {
    const decl = cls.parent;
    if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return null;
    const statement = decl.parent.parent;
    if (!ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return null;
    return { name: decl.name.text, exported: hasExportModifier(statement) };
  }
  return null;
}

function isModuleInitFunction(fn: FunctionLike, depth: number, moduleScope: ModuleScope): boolean {
  if (depth !== 0) return false;
  if (isIife(fn)) return true;
  if (ts.isFunctionDeclaration(fn)) {
    if (!fn.name || hasExportModifier(fn)) return false;
    return moduleScope.topLevelInvoked.has(fn.name.text);
  }
  if (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) {
    const parent = fn.parent;
    if (!ts.isVariableDeclaration(parent) || !ts.isIdentifier(parent.name)) return false;
    const statement = parent.parent.parent;
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) return false;
    return moduleScope.topLevelInvoked.has(parent.name.text);
  }
  if (ts.isConstructorDeclaration(fn)) {
    // `class Boot { constructor() { … } } new Boot();` — the constructor body is module init.
    const owner = ownerClassName(fn);
    if (!owner || owner.exported) return false;
    return moduleScope.topLevelInvoked.has(owner.name);
  }
  return false;
}

function isEffectCallbackFunction(fn: FunctionLike): boolean {
  const parent = fn.parent;
  if (!ts.isCallExpression(parent)) return false;
  if (!parent.arguments.some((arg) => unwrap(arg) === fn)) return false;
  const callee = unwrap(parent.expression);
  if (ts.isIdentifier(callee)) return EFFECT_HOOKS.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) return EFFECT_HOOKS.has(callee.name.text);
  return false;
}

interface BindingSite {
  /** Name the function is bound to (declaration name, variable name, or assigned property). */
  name: string | null;
  exported: boolean;
  isDefaultExport: boolean;
}

/**
 * Finds what a top-level function is bound to, looking through wrappers:
 * `export const getServerSideProps = withAuth(async (ctx) => …)` binds the arrow to
 * `getServerSideProps`; `Page.getInitialProps = async (ctx) => …` binds it to `getInitialProps`.
 */
function bindingSiteOf(fn: FunctionLike): BindingSite | null {
  if (ts.isFunctionDeclaration(fn)) {
    return {
      name: fn.name?.text ?? null,
      exported: hasExportModifier(fn),
      isDefaultExport: hasDefaultModifier(fn),
    };
  }
  let node: ts.Node = fn;
  let p: ts.Node = fn.parent;
  while (
    p &&
    (ts.isParenthesizedExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isSatisfiesExpression(p) ||
      ts.isTypeAssertionExpression(p) ||
      ts.isNonNullExpression(p) ||
      (ts.isCallExpression(p) && p.arguments.some((a) => a === node)))
  ) {
    node = p;
    p = p.parent;
  }
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
    const statement = p.parent.parent;
    return {
      name: p.name.text,
      exported: ts.isVariableStatement(statement) && hasExportModifier(statement),
      isDefaultExport: false,
    };
  }
  if (ts.isExportAssignment(p)) {
    return { name: null, exported: true, isDefaultExport: !p.isExportEquals };
  }
  if (
    ts.isBinaryExpression(p) &&
    p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    p.right === node
  ) {
    const chain = resolveChain(p.left);
    const last = chain?.parts.at(-1)?.name;
    if (chain && chain.parts.length > 0 && typeof last === 'string') {
      return { name: last, exported: true, isDefaultExport: false };
    }
  }
  return null;
}

function isSsrEntryFunction(fn: FunctionLike, depth: number): boolean {
  // A function-level `'use server'` directive marks a Server Action at any nesting depth.
  if (isServerActionFunction(fn)) return true;
  if (depth !== 0) return false;
  const site = bindingSiteOf(fn);
  if (!site) return false;
  if (site.name && SSR_ENTRY_NAMES.has(site.name)) return true;
  if (site.name && site.exported && SSR_EXPORTED_ENTRY_NAMES.has(site.name)) return true;
  if (isRouteDataFunction(fn, site)) return true;
  if (site.exported && isServerActionFile(fn.getSourceFile())) return true;
  if (site.isDefaultExport && fn.parameters.length > 0) {
    const file = fn.getSourceFile().fileName.replace(/\\/g, '/');
    return PAGES_API_FILE.test(file) || APP_ENTRY_FILE.test(file) || MIDDLEWARE_FILE.test(file);
  }
  return false;
}

export function buildFnScope(fn: FunctionLike, depth: number, moduleScope: ModuleScope): FnScope {
  const params = new Set<string>();
  const locals = new Set<string>();
  const assigned = new Map<string, ts.Expression[]>();
  const record = (name: string, value: ts.Expression): void => {
    const list = assigned.get(name);
    if (list) list.push(value);
    else assigned.set(name, [value]);
  };

  for (const param of fn.parameters) {
    const names: string[] = [];
    collectBindingNames(param.name, names);
    for (const n of names) params.add(n);
  }

  const scan = (node: ts.Node, nested: boolean): void => {
    if (ts.isVariableDeclaration(node)) {
      if (!nested) {
        const names: string[] = [];
        collectBindingNames(node.name, names);
        const list = node.parent;
        const loop = ts.isVariableDeclarationList(list) ? list.parent : undefined;
        const source =
          loop && (ts.isForOfStatement(loop) || ts.isForInStatement(loop))
            ? loop.expression
            : node.initializer;
        for (const n of names) {
          locals.add(n);
          if (source) record(n, source);
        }
      }
      ts.forEachChild(node, (child) => scan(child, nested));
      return;
    }
    if (ts.isCatchClause(node)) {
      if (!nested && node.variableDeclaration) {
        const names: string[] = [];
        collectBindingNames(node.variableDeclaration.name, names);
        for (const n of names) locals.add(n);
      }
      scan(node.block, nested);
      return;
    }
    if (ts.isFunctionDeclaration(node)) {
      if (!nested && node.name) locals.add(node.name.text);
      ts.forEachChild(node, (child) => scan(child, true));
      return;
    }
    if (ts.isClassDeclaration(node)) {
      if (!nested && node.name) locals.add(node.name.text);
      ts.forEachChild(node, (child) => scan(child, true));
      return;
    }
    if (isFunctionLikeNode(node) || ts.isClassExpression(node)) {
      ts.forEachChild(node, (child) => scan(child, true));
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const left = unwrap(node.left);
      if (ts.isIdentifier(left)) {
        record(left.text, node.right);
      } else if (ts.isArrayLiteralExpression(left) || ts.isObjectLiteralExpression(left)) {
        const names: string[] = [];
        collectAssignmentTargetNames(left, names);
        for (const n of names) record(n, node.right);
      }
    }
    ts.forEachChild(node, (child) => scan(child, nested));
  };
  if (fn.body) scan(fn.body, false);

  return {
    node: fn,
    params,
    locals,
    assigned,
    isModuleInit: isModuleInitFunction(fn, depth, moduleScope),
    isEffectCallback: isEffectCallbackFunction(fn),
    isSsrEntry: isSsrEntryFunction(fn, depth),
  };
}

export type Resolution =
  | { type: 'param'; scope: FnScope }
  | { type: 'local'; scope: FnScope }
  | { type: 'module'; binding: ModuleBinding }
  | { type: 'unresolved' };

export function resolveName(
  name: string,
  fnStack: FnScope[],
  moduleScope: ModuleScope,
): Resolution {
  for (let i = fnStack.length - 1; i >= 0; i--) {
    const scope = fnStack[i] as FnScope;
    if (scope.params.has(name)) return { type: 'param', scope };
    if (scope.locals.has(name)) return { type: 'local', scope };
  }
  const binding = moduleScope.bindings.get(name);
  if (binding) return { type: 'module', binding };
  return { type: 'unresolved' };
}
