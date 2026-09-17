import { describe, expect, it } from 'vitest';
import { analyzeSource, shouldFail } from '../src/index.js';
import { analyzeFixture, ruleIds } from './helpers.js';

describe('R1 axios-defaults-in-function', () => {
  it('flags axios.defaults.headers.common[...] inside getServerSideProps', () => {
    const findings = analyzeFixture('r1/positive-gssp.ts');
    expect(ruleIds(findings)).toEqual(['R1']);
    expect(findings[0]).toMatchObject({ line: 6, column: 3, confidence: 'high' });
    expect(findings[0]?.message).toContain("axios.defaults.headers.common['Authorization']");
    expect(findings[0]?.fixHint).toContain('axios.create');
  });

  it('flags instance.defaults.headers.Cookie = req.headers... inside a route handler', () => {
    const findings = analyzeFixture('r1/positive-route-handler.ts');
    expect(ruleIds(findings)).toEqual(['R1']);
    expect(findings[0]?.line).toBe(6);
  });

  it('flags Object.assign(instance.defaults.headers, ...) inside an arrow function', () => {
    expect(ruleIds(analyzeFixture('r1/positive-object-assign.ts'))).toEqual(['R1']);
  });

  it('flags .defaults.headers on a client imported from another module', () => {
    expect(ruleIds(analyzeFixture('r1/positive-imported-client.ts'))).toEqual(['R1']);
  });

  it('flags CommonJS require("axios") usage in .js files', () => {
    expect(ruleIds(analyzeFixture('scope/plain.js'))).toEqual(['R1']);
  });

  it('does not flag a per-request instance created inside the function', () => {
    expect(analyzeFixture('r1/negative-per-request-instance.ts', { all: true })).toEqual([]);
  });

  it('does not flag module-scope defaults by default', () => {
    expect(analyzeFixture('r1/negative-module-scope.ts')).toEqual([]);
  });

  it('treats a non-exported function invoked at module scope as module init', () => {
    expect(analyzeFixture('r1/negative-init-function.ts')).toEqual([]);
    expect(ruleIds(analyzeFixture('r1/negative-init-function.ts', { all: true }))).toEqual(['R2']);
  });

  it('treats the constructor of a class instantiated by a top-level statement as module init', () => {
    expect(analyzeFixture('r1/negative-ctor-init.ts')).toEqual([]);
    expect(ruleIds(analyzeFixture('r1/negative-ctor-init.ts', { all: true }))).toEqual(['R2']);
  });

  it('still flags the constructor of an exported class (instantiated by callers)', () => {
    const findings = analyzeFixture('r1/positive-exported-class-ctor.ts');
    expect(ruleIds(findings)).toEqual(['R1']);
    expect(findings[0]?.line).toBe(5);
  });

  it('recognizes `create` destructured from axios (import and require) as an axios factory', () => {
    const ts = analyzeFixture('r1/positive-destructured-create.ts');
    expect(ts.map((f) => [f.ruleId, f.line, f.confidence])).toEqual([
      ['R1', 6, 'high'],
      ['R1', 10, 'high'],
    ]);
    const cjs = analyzeFixture('r1/positive-destructured-create.cjs');
    expect(cjs.map((f) => [f.ruleId, f.line])).toEqual([['R1', 6]]);
  });
});

describe('R2 axios-defaults-at-module-scope', () => {
  it('reports module-scope defaults only with --all, as low confidence', () => {
    const findings = analyzeFixture('r1/negative-module-scope.ts', { all: true });
    expect(ruleIds(findings)).toEqual(['R2', 'R2', 'R2']);
    expect(findings.every((f) => f.confidence === 'low')).toBe(true);
  });
});

describe('R3 axios-interceptor-in-request-path', () => {
  it('flags interceptors.request.use inside an exported async function', () => {
    const findings = analyzeFixture('r3/positive-exported-async.ts');
    expect(ruleIds(findings)).toEqual(['R3']);
    expect(findings[0]).toMatchObject({ line: 6, confidence: 'high' });
    expect(findings[0]?.message).toContain('request interceptor');
  });

  it('flags interceptors.response.use on the axios default import', () => {
    const findings = analyzeFixture('r3/positive-response-default-import.ts');
    expect(ruleIds(findings)).toEqual(['R3']);
    expect(findings[0]?.message).toContain('response interceptor');
  });

  it('does not flag interceptors registered at module scope', () => {
    expect(analyzeFixture('r3/negative-module-scope.ts', { all: true })).toEqual([]);
  });

  it('does not flag interceptors inside useEffect with eject', () => {
    expect(analyzeFixture('r3/negative-use-effect-eject.tsx', { all: true })).toEqual([]);
  });

  it('does not flag interceptors ejected in the same function', () => {
    expect(analyzeFixture('r3/negative-eject-same-function.ts', { all: true })).toEqual([]);
  });

  it('does not flag interceptors inside module-level init (IIFE / invoked function)', () => {
    expect(analyzeFixture('r3/negative-init-iife.ts', { all: true })).toEqual([]);
  });
});

describe('R4 module-state-write-tainted', () => {
  it('flags a module-level let assigned from params (medium: a weak name on a plain function)', () => {
    const findings = analyzeFixture('r4/positive-let-from-params.ts');
    expect(ruleIds(findings)).toEqual(['R4']);
    expect(findings[0]).toMatchObject({ line: 4, confidence: 'medium' });
    expect(findings[0]?.message).toContain('`params.id`');
  });

  it('flags cache.set(req.headers["x-user"], data)', () => {
    const findings = analyzeFixture('r4/positive-cache-set.ts');
    expect(ruleIds(findings)).toEqual(['R4']);
    expect(findings[0]?.message).toContain('cache.set(...)');
  });

  it('propagates taint through locals: headers() -> h.get() -> cfg.token', () => {
    const findings = analyzeFixture('r4/positive-taint-propagation.ts');
    expect(ruleIds(findings)).toEqual(['R4']);
    expect(findings[0]?.line).toBe(8);
    expect(findings[0]?.message).toContain('headers()');
  });

  it('treats parameters of any enclosing function as tainted, at medium confidence', () => {
    const findings = analyzeFixture('r4/positive-nested-function-param.ts');
    expect(ruleIds(findings)).toEqual(['R4']);
    expect(findings[0]?.confidence).toBe('medium');
    expect(findings[0]?.message).toContain('parameter `userId`');
  });

  it('flags destructuring assignments to module-level bindings', () => {
    const findings = analyzeFixture('r4/positive-destructuring-assign.ts');
    expect(findings.map((f) => [f.ruleId, f.line, f.confidence])).toEqual([
      ['R4', 5, 'high'],
      ['R4', 6, 'high'],
    ]);
    expect(findings[0]?.message).toContain('`last`');
    expect(findings[1]?.message).toContain('`other`');
  });

  it('flags array.push with a value derived from the request', () => {
    expect(ruleIds(analyzeFixture('r4/positive-array-push.ts'))).toEqual(['R4']);
  });

  it('flags Object.assign(moduleObject, tainted)', () => {
    const findings = analyzeFixture('r4/positive-object-assign.ts');
    expect(ruleIds(findings)).toEqual(['R4']);
    expect(findings[0]?.message).toContain('cookies()');
  });

  it('flags a tainted key even when the value is not tainted', () => {
    expect(ruleIds(analyzeFixture('r4/positive-tainted-key.ts'))).toEqual(['R4']);
  });

  it('does not flag module-level state assigned only at top level', () => {
    expect(analyzeFixture('r4/negative-module-let-top-only.ts', { all: true })).toEqual([]);
  });

  it('does not flag writes to locals that shadow module-level names', () => {
    expect(analyzeFixture('r4/negative-local-shadow.ts', { all: true })).toEqual([]);
  });

  it('does not flag writes to function-local objects and arrays', () => {
    expect(analyzeFixture('r4/negative-local-state.ts', { all: true })).toEqual([]);
  });

  it('does not flag .push/.set on receivers of unknown shape (router.push, client.set)', () => {
    expect(analyzeFixture('r4/negative-unknown-receiver.ts', { all: true })).toEqual([]);
  });

  it('honors extra taint sources from options', () => {
    expect(analyzeFixture('config/custom-source.ts')).toEqual([]);
    const findings = analyzeFixture('config/custom-source.ts', {
      taintSources: { functions: ['auth'] },
    });
    expect(ruleIds(findings)).toEqual(['R4']);
  });

  it('honors extra taint identifiers from options', () => {
    const code = `
      let last = '';
      export function f() { last = nextReq.headers.host; }
    `;
    expect(analyzeSource(code, 'x.ts')).toEqual([]);
    expect(
      ruleIds(analyzeSource(code, 'x.ts', { taintSources: { identifiers: ['nextReq'] } })),
    ).toEqual(['R4']);
  });
});

describe('R4 confidence by taint provenance', () => {
  it('downgrades a write whose only taint source is a bare parameter of a non-entry function', () => {
    const findings = analyzeFixture('r4/weak-setter-param.ts');
    expect(findings.map((f) => [f.ruleId, f.line, f.confidence])).toEqual([
      ['R4', 6, 'medium'],
      ['R4', 10, 'medium'],
      ['R4', 14, 'medium'],
    ]);
    for (const f of findings) {
      expect(f.message).toMatch(
        /^Possible per-request write \(value comes from a function argument\)/,
      );
    }
  });

  it('keeps high confidence for parameters of getServerSideProps (wrapped), GET and middleware', () => {
    const findings = analyzeFixture('r4/positive-ssr-entries.ts');
    expect(findings.map((f) => [f.line, f.confidence])).toEqual([
      [8, 'high'],
      [13, 'high'],
      [18, 'high'],
      [22, 'medium'],
    ]);
    expect(findings[0]?.message).toContain('parameter `c`');
  });

  it('keeps high confidence for a pages/api default-export handler', () => {
    const findings = analyzeFixture('r4/pages/api/handler.ts');
    expect(findings.map((f) => [f.ruleId, f.confidence])).toEqual([['R4', 'high']]);
  });

  it('keeps high confidence for an app/**/page default export receiving params', () => {
    const findings = analyzeFixture('r4/app/items/page.tsx');
    expect(findings.map((f) => [f.ruleId, f.confidence])).toEqual([['R4', 'high']]);
  });

  it('treats params/searchParams/event as weak names unless the member or the function says otherwise', () => {
    const rows = analyzeFixture('r4/positive-weak-name-boundary.ts').map((f) => [
      f.line,
      f.confidence,
    ]);
    expect(rows).toEqual([
      [9, 'high'], // req.headers.cookie
      [14, 'medium'], // params.id on a plain function
      [19, 'high'], // params.cookies
      [24, 'high'], // unresolved `params`
      [29, 'high'], // SSR entry point
    ]);
  });

  it('keeps high confidence for property reads on req/ctx and taint-source calls', () => {
    expect(analyzeFixture('r4/positive-cache-set.ts')[0]?.confidence).toBe('high');
    expect(analyzeFixture('r4/positive-taint-propagation.ts')[0]?.confidence).toBe('high');
  });

  it('prefers a primitive source over a bare parameter when both flow into the write', () => {
    const code = `
      let last = '';
      export function f(x: string, req: { id: string }) { last = x + req.id; }
    `;
    const findings = analyzeSource(code, 'x.ts');
    expect(findings.map((f) => [f.ruleId, f.confidence])).toEqual([['R4', 'high']]);
    expect(findings[0]?.message).toContain('parameter `req`');
  });

  it('fails the run at --fail-on medium but not at the default high', () => {
    const findings = analyzeFixture('r4/weak-setter-param.ts');
    expect(shouldFail(findings, 'high')).toBe(false);
    expect(shouldFail(findings, 'medium')).toBe(true);
  });
});

describe('R5 module-state-write-untainted', () => {
  it('reports an untainted cache.set only with --all, as low confidence', () => {
    expect(analyzeFixture('r4/negative-cache-untainted.ts')).toEqual([]);
    const findings = analyzeFixture('r4/negative-cache-untainted.ts', { all: true });
    expect(ruleIds(findings)).toEqual(['R5']);
    expect(findings[0]?.confidence).toBe('low');
  });

  it('reports a module-level counter increment only with --all', () => {
    const code = 'let n = 0; export function hit() { n++; return n; }';
    expect(analyzeSource(code, 'x.ts')).toEqual([]);
    expect(ruleIds(analyzeSource(code, 'x.ts', { all: true }))).toEqual(['R5']);
  });
});

describe('R6 global-object-write', () => {
  it('flags globalThis / process.env / global writes inside functions', () => {
    const findings = analyzeFixture('r6/positive-globalthis.ts');
    expect(ruleIds(findings)).toEqual(['R6', 'R6', 'R6']);
    expect(findings.every((f) => f.confidence === 'medium')).toBe(true);
    expect(findings.map((f) => f.line)).toEqual([2, 6, 7]);
  });

  it('does not flag global writes at module scope', () => {
    expect(analyzeFixture('r6/negative-module-scope.ts', { all: true })).toEqual([]);
  });

  it('does not flag a local variable named globalThis', () => {
    expect(analyzeFixture('r6/negative-local-shadow.ts', { all: true })).toEqual([]);
  });

  it('does not flag browser host objects reached through globalThis (location, document, ...)', () => {
    expect(analyzeFixture('r6/negative-browser-host.ts', { all: true })).toEqual([]);
  });
});

describe('analyzeSource edge cases', () => {
  it('handles class methods and object literal methods as function bodies', () => {
    const code = `
      let last = '';
      export class Store { save(req: { id: string }) { last = req.id; } }
      export const handlers = { onRequest(ctx: { id: string }) { last = ctx.id; } };
    `;
    expect(ruleIds(analyzeSource(code, 'x.ts'))).toEqual(['R4', 'R4']);
  });

  it('does not treat a non-axios create() result as axios (falls back to R4 taint, not R1)', () => {
    const code = `
      import { create } from 'not-axios';
      const thing = create();
      export function f(token: string) { thing.defaults.headers.common.Authorization = token; }
      export function g() { thing.defaults.headers.common.Authorization = 'static'; }
    `;
    expect(ruleIds(analyzeSource(code, 'x.ts'))).toEqual(['R4']);
  });

  it('parses TSX and JSX', () => {
    const tsx = `
      let last = '';
      export function Page({ params }: { params: { id: string } }) { last = params.id; return <div>{last}</div>; }
    `;
    expect(ruleIds(analyzeSource(tsx, 'page.tsx'))).toEqual(['R4']);
    expect(ruleIds(analyzeSource(tsx.replace(/: \{[^}]*\}[^)]*\)/, ')'), 'page.jsx'))).toEqual([
      'R4',
    ]);
  });

  it('does not crash on syntax errors and reports what it can', () => {
    expect(() => analyzeSource('export function ( { let x = ; }', 'broken.ts')).not.toThrow();
  });
});
