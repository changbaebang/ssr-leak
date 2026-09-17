import path from 'node:path';
import ts from 'typescript';
import {
  EVIDENCE_NOTES,
  type EvidenceKind,
  functionCallsMethodOn,
  precededByBrowserDeref,
} from './evidence.js';
import {
  buildGuardNames,
  classifyCondition,
  type GuardNames,
  isServerEarlyExit,
} from './guards.js';
import { type MessageVars, RULES } from './rules.js';
import {
  buildFnScope,
  type Chain,
  collectModuleScope,
  type FnScope,
  type FunctionLike,
  isFunctionLikeNode,
  type ModuleBinding,
  type ModuleScope,
  resolveChain,
  resolveName,
  unwrap,
} from './scope.js';
import { hasFileDisable, isClientFile, isSuppressed } from './suppress.js';
import {
  DEFAULT_TAINT_FUNCTIONS,
  DEFAULT_TAINT_IDENTIFIERS,
  findTaint,
  type Taint,
  type TaintContext,
} from './taint.js';
import type { AnalyzeOptions, Confidence, Finding, RuleId } from './types.js';

/** Methods that mutate a Map/Set/Array in place and may carry a value or key. */
const VALUE_MUTATORS: ReadonlySet<string> = new Set(['set', 'add', 'push', 'unshift', 'splice']);
/** Methods that mutate in place without storing a new value. */
const OTHER_MUTATORS: ReadonlySet<string> = new Set(['clear', 'delete', 'pop', 'shift']);

/**
 * Host objects reachable through `globalThis.<name>` that are browser APIs, not server state.
 * Writing `globalThis.location.href = ...` is a client-side navigation, not a cross-request leak.
 */
const BROWSER_HOST_OBJECTS: ReadonlySet<string> = new Set([
  'location',
  'document',
  'window',
  'navigator',
  'history',
  'localStorage',
  'sessionStorage',
  'screen',
  'scrollX',
  'scrollY',
  'innerWidth',
  'innerHeight',
]);

const COLLECTION_METHODS: Readonly<Record<string, ReadonlySet<string>>> = {
  map: new Set(['set', 'clear', 'delete']),
  set: new Set(['add', 'clear', 'delete']),
  array: new Set(['push', 'unshift', 'splice', 'pop', 'shift']),
};

/** Appended to a finding that sits behind a browser-only guard (reported at `low`). */
const GUARDED_NOTE =
  'Guarded by a browser-only check (typeof window / isServer), so it should not run during SSR; reported for audit only.';

function scriptKindOf(fileName: string): ts.ScriptKind {
  switch (path.extname(fileName)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.ts':
      return ts.ScriptKind.TS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

function isAssignment(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

function containsInterceptorEject(fn: FunctionLike): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const chain = resolveChain(node.expression);
      if (
        chain &&
        chain.parts.at(-1)?.name === 'eject' &&
        chain.parts.some((p) => p.name === 'interceptors')
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}

function truncate(text: string, max = 100): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

class FileAnalyzer {
  private readonly findings: Finding[] = [];
  private readonly fnStack: FnScope[] = [];
  private readonly moduleScope: ModuleScope;
  private readonly taintCtx: TaintContext;
  private readonly reported = new Set<string>();
  private readonly guardNames: GuardNames;
  /**
   * Greater than zero while visiting code that only runs in a browser: the then-branch of
   * `if (typeof window !== 'undefined')`, the else-branch of `if (isServer())`, the right side of
   * `isClient() && …`, or anything after `if (isServer()) return;` in the same block.
   */
  private clientOnlyDepth = 0;

  constructor(
    private readonly sf: ts.SourceFile,
    private readonly displayName: string,
    private readonly options: AnalyzeOptions,
  ) {
    this.moduleScope = collectModuleScope(sf);
    this.guardNames = buildGuardNames(options.guards);
    this.taintCtx = {
      fnStack: this.fnStack,
      moduleScope: this.moduleScope,
      taintFunctions: new Set([
        ...DEFAULT_TAINT_FUNCTIONS,
        ...(options.taintSources?.functions ?? []),
      ]),
      taintIdentifiers: new Set([
        ...DEFAULT_TAINT_IDENTIFIERS,
        ...(options.taintSources?.identifiers ?? []),
      ]),
    };
  }

  run(): Finding[] {
    this.visit(this.sf);
    return this.findings;
  }

  /** True when the current position may execute per request (inside a function that is not module init). */
  private get inRequestPath(): boolean {
    return this.fnStack.length > 0 && !this.fnStack.some((s) => s.isModuleInit);
  }

  private visit(node: ts.Node): void {
    if (isFunctionLikeNode(node)) {
      this.fnStack.push(buildFnScope(node, this.fnStack.length, this.moduleScope));
      ts.forEachChild(node, (child) => this.visit(child));
      this.fnStack.pop();
      return;
    }
    if (ts.isBlock(node)) {
      // `if (isServer()) return;` makes the rest of this block browser-only.
      let guarded = false;
      for (const statement of node.statements) {
        this.visit(statement);
        if (!guarded && this.fnStack.length > 0 && isServerEarlyExit(statement, this.guardNames)) {
          guarded = true;
          this.clientOnlyDepth++;
        }
      }
      if (guarded) this.clientOnlyDepth--;
      return;
    }
    if (ts.isIfStatement(node)) {
      const env = classifyCondition(node.expression, this.guardNames);
      this.visit(node.expression);
      this.visitClientOnly(env === 'client', node.thenStatement);
      if (node.elseStatement) this.visitClientOnly(env === 'server', node.elseStatement);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      const env = classifyCondition(node.condition, this.guardNames);
      this.visit(node.condition);
      this.visitClientOnly(env === 'client', node.whenTrue);
      this.visitClientOnly(env === 'server', node.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      // `isClient() && write()` / `isServer() || write()`: the right side runs only in a browser.
      const env = classifyCondition(node.left, this.guardNames);
      const isAnd = node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
      this.visit(node.left);
      this.visitClientOnly(isAnd ? env === 'client' : env === 'server', node.right);
      return;
    }
    this.check(node);
    ts.forEachChild(node, (child) => this.visit(child));
  }

  private visitClientOnly(clientOnly: boolean, node: ts.Node): void {
    if (clientOnly) this.clientOnlyDepth++;
    this.visit(node);
    if (clientOnly) this.clientOnlyDepth--;
  }

  private check(node: ts.Node): void {
    // React effects never run during SSR, so nothing inside them can leak between requests.
    if (this.fnStack.some((s) => s.isEffectCallback)) return;
    if (isAssignment(node)) {
      const left = unwrap(node.left);
      if (
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (ts.isArrayLiteralExpression(left) || ts.isObjectLiteralExpression(left))
      ) {
        this.handleDestructuringWrite(left, node.right, node);
      } else {
        this.handleWrite(node.left, [node.right], node);
      }
    } else if (ts.isCallExpression(node)) {
      this.handleCall(node);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      this.handleWrite(node.operand, [], node);
    }
  }

  private resolveRoot(chain: Chain): ModuleBinding | 'global' | 'process-env' | null {
    const name = chain.root.text;
    const res = resolveName(name, this.fnStack, this.moduleScope);
    if (res.type === 'module') return res.binding;
    if (res.type !== 'unresolved') return null;
    if ((name === 'globalThis' || name === 'global') && chain.parts.length > 0) {
      const first = chain.parts[0]?.name;
      return typeof first === 'string' && BROWSER_HOST_OBJECTS.has(first) ? null : 'global';
    }
    if (name === 'process' && chain.parts[0]?.name === 'env') return 'process-env';
    return null;
  }

  private isAxiosDefaults(binding: ModuleBinding, chain: Chain): boolean {
    if (chain.parts[0]?.name !== 'defaults') return false;
    if (binding.isAxios) return true;
    // A shared client imported from another module: `.defaults.headers` is distinctive enough.
    return binding.kind === 'import' && chain.parts[1]?.name === 'headers';
  }

  /**
   * A write to `target` with `values` (RHS, or Object.assign sources). Handles R1/R2/R4/R5/R6.
   */
  private handleWrite(
    target: ts.Expression,
    values: readonly ts.Expression[],
    at: ts.Node,
    mode: 'assign' | 'mutate' = 'assign',
  ): void {
    const chain = resolveChain(target);
    if (!chain) return;
    const root = this.resolveRoot(chain);
    if (root === null) return;

    const targetText = truncate(target.getText(this.sf));

    if (root === 'global' || root === 'process-env') {
      if (this.inRequestPath) this.report('R6', at, { target: targetText });
      return;
    }

    if (this.isAxiosDefaults(root, chain)) {
      this.report(this.inRequestPath ? 'R1' : 'R2', at, { target: targetText });
      return;
    }

    if (!this.inRequestPath) return;

    if (mode === 'assign' && chain.parts.length === 0) {
      // Reassignment of the binding itself: only mutable module-level variables.
      if (root.kind !== 'let' && root.kind !== 'var') return;
    }

    this.reportStateWrite(at, targetText, this.taintOfWrite(chain, values));
  }

  /** `[last] = …` / `({ last } = …)`: every target in the pattern is written with the RHS. */
  private handleDestructuringWrite(
    pattern: ts.Expression,
    value: ts.Expression,
    at: ts.Node,
  ): void {
    const p = unwrap(pattern);
    if (ts.isArrayLiteralExpression(p)) {
      for (const el of p.elements) this.handleAssignmentTarget(el, value, at);
    } else if (ts.isObjectLiteralExpression(p)) {
      for (const prop of p.properties) {
        if (ts.isPropertyAssignment(prop)) this.handleAssignmentTarget(prop.initializer, value, at);
        else if (ts.isShorthandPropertyAssignment(prop)) this.handleWrite(prop.name, [value], at);
        else if (ts.isSpreadAssignment(prop))
          this.handleAssignmentTarget(prop.expression, value, at);
      }
    }
  }

  private handleAssignmentTarget(el: ts.Expression, value: ts.Expression, at: ts.Node): void {
    const e = unwrap(el);
    if (ts.isOmittedExpression(e)) return;
    if (ts.isSpreadElement(e)) {
      this.handleAssignmentTarget(e.expression, value, at);
    } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      this.handleAssignmentTarget(e.left, value, at);
    } else if (ts.isArrayLiteralExpression(e) || ts.isObjectLiteralExpression(e)) {
      this.handleDestructuringWrite(e, value, at);
    } else {
      this.handleWrite(e, [value], at);
    }
  }

  /**
   * R4 when the write is tainted, R5 otherwise. R4 is `high` only when the taint is a request
   * primitive; a bare parameter of a non-entry function gives `medium`.
   */
  private reportStateWrite(
    at: ts.Node,
    target: string,
    taint: Taint | null,
    evidence: EvidenceKind | null = null,
  ): void {
    // A browser-only dereference before the write is evidence for any write, not only weak ones.
    const proof =
      evidence ??
      (precededByBrowserDeref(at, this.fnStack, this.moduleScope) ? 'browser-deref' : null);
    if (!taint) {
      this.report('R5', at, { target }, undefined, proof);
      return;
    }
    if (taint.primitive) {
      this.report('R4', at, { target, source: taint.source }, undefined, proof);
      return;
    }
    this.report('R4', at, { target, source: taint.source, weak: true }, 'medium', proof);
  }

  private taintOfWrite(chain: Chain, values: readonly ts.Expression[]): Taint | null {
    let weak: Taint | null = null;
    const consider = (expr: ts.Expression): Taint | null => {
      const r = findTaint(expr, this.taintCtx);
      if (r?.primitive) return r;
      weak ??= r;
      return null;
    };
    for (const value of values) {
      const r = consider(value);
      if (r) return r;
    }
    for (const part of chain.parts) {
      if (part.expr) {
        const r = consider(part.expr);
        if (r) return r;
      }
    }
    return weak;
  }

  private handleCall(call: ts.CallExpression): void {
    const callee = unwrap(call.expression);
    const chain = resolveChain(callee);
    if (!chain) return;

    // Object.assign(target, ...sources)
    if (
      chain.root.text === 'Object' &&
      chain.parts.length === 1 &&
      chain.parts[0]?.name === 'assign'
    ) {
      const target = call.arguments[0];
      if (target && resolveName('Object', this.fnStack, this.moduleScope).type === 'unresolved') {
        this.handleWrite(target, call.arguments.slice(1), call, 'mutate');
      }
      return;
    }

    const res = resolveName(chain.root.text, this.fnStack, this.moduleScope);
    if (res.type !== 'module') return;
    const binding = res.binding;
    const method = chain.parts.at(-1)?.name;
    if (!method) return;

    // <axios>.interceptors.request|response.use(...)
    if (
      chain.parts.length === 3 &&
      chain.parts[0]?.name === 'interceptors' &&
      (chain.parts[1]?.name === 'request' || chain.parts[1]?.name === 'response') &&
      method === 'use' &&
      (binding.isAxios || binding.kind === 'import')
    ) {
      if (!this.inRequestPath) return;
      if (this.fnStack.some((s) => s.isEffectCallback)) return;
      const innermost = this.fnStack.at(-1);
      if (innermost && containsInterceptorEject(innermost.node)) return;
      this.report('R3', call, {
        target: truncate(callee.getText(this.sf)),
        kind: chain.parts[1].name ?? 'request',
      });
      return;
    }

    // Mutating calls on a module-level Map/Set/Array: cache.set(k, v), list.push(x), ...
    if (!this.inRequestPath) return;
    if (chain.parts.length !== 1) return;
    const allowed = COLLECTION_METHODS[binding.collection];
    if (!allowed?.has(method)) return;
    if (!VALUE_MUTATORS.has(method) && !OTHER_MUTATORS.has(method)) return;
    const innermostScope = this.fnStack.at(-1);
    if (!innermostScope) return;

    const targetText = `${truncate(callee.getText(this.sf))}(...)`;
    let taint: Taint | null = null;
    let evidence: EvidenceKind | null = null;
    if (VALUE_MUTATORS.has(method)) {
      const taints = call.arguments.map((arg) => findTaint(arg, this.taintCtx));
      taint = taints.find((t) => t?.primitive) ?? taints.find((t) => t) ?? null;
      const collectionName = chain.root.text;
      if (taint && !taint.primitive) {
        const [keyTaint, valueTaint] = taints;
        if (binding.collection === 'set' && method === 'add') {
          if (functionCallsMethodOn(innermostScope, collectionName, 'has')) evidence = 'dedupe-set';
        } else if (
          binding.collection === 'map' &&
          method === 'set' &&
          call.arguments.length === 2
        ) {
          if (keyTaint && !valueTaint) evidence = 'argument-keyed-cache';
        }
        if (!evidence && functionCallsMethodOn(innermostScope, collectionName, 'delete')) {
          evidence = 'request-lifetime';
        }
      }
    }
    this.reportStateWrite(call, targetText, taint, evidence);
  }

  private report(
    ruleId: RuleId,
    node: ts.Node,
    vars: MessageVars,
    confidence: Confidence = RULES[ruleId].confidence,
    evidence: EvidenceKind | null = null,
  ): void {
    const rule = RULES[ruleId];
    // Code behind a browser-only guard cannot run during SSR, and positive evidence (dedupe set,
    // argument-keyed cache, request-lifetime entry, browser dereference) means the write is not a
    // cross-request leak: keep those for audits only.
    const note =
      this.clientOnlyDepth > 0 ? GUARDED_NOTE : evidence ? EVIDENCE_NOTES[evidence] : null;
    const level: Confidence = note ? 'low' : confidence;
    // Low-confidence findings are informational: only with `all`.
    if (level === 'low' && !this.options.all) return;
    const start = node.getStart(this.sf);
    const { line, character } = this.sf.getLineAndCharacterOfPosition(start);
    if (isSuppressed(this.sf, line, rule.id, rule.name)) return;
    const key = `${ruleId}:${start}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    const end = this.sf.getLineAndCharacterOfPosition(node.getEnd());
    const starts = this.sf.getLineStarts();
    const lineText = this.sf.text.slice(starts[line] ?? 0, starts[line + 1] ?? this.sf.text.length);
    this.findings.push({
      file: this.displayName,
      line: line + 1,
      column: character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      ruleId: rule.id,
      rule: rule.name,
      confidence: level,
      message: note ? `${rule.message(vars)} ${note}` : rule.message(vars),
      fixHint: rule.fixHint,
      snippet: truncate(lineText, 160),
    });
  }
}

/**
 * Analyzes one file's source text. `fileName` selects the parser (ts/tsx/js/jsx) and is echoed
 * back in `Finding.file`. Pure: no filesystem access.
 */
export function analyzeSource(
  code: string,
  fileName: string,
  options: AnalyzeOptions = {},
): Finding[] {
  const sf = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );
  if (hasFileDisable(sf)) return [];
  if (!options.includeClient && isClientFile(sf)) return [];
  return new FileAnalyzer(sf, fileName, options).run();
}
