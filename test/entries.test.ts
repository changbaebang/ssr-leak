import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { analyzeSource, analyzeSourceDetailed, isServerActionFile, run } from '../src/index.js';
import { analyzeFixture, FIXTURES } from './helpers.js';

const rows = (relative: string) =>
  analyzeFixture(relative).map((f) => [f.ruleId, f.line, f.confidence]);

const parse = (code: string) =>
  ts.createSourceFile('a.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

describe('Server Actions (`use server`)', () => {
  it('treats every exported function of a `use server` file as an SSR entry', () => {
    expect(rows('entries/actions/file-level.ts')).toEqual([
      ['R4', 7, 'high'],
      ['R4', 11, 'high'],
      ['R4', 16, 'medium'], // not exported: not callable from the client
    ]);
  });

  it('treats a function whose first statement is `use server` as an entry at any depth', () => {
    expect(rows('entries/actions/fn-level.tsx')).toEqual([
      ['R4', 6, 'high'],
      ['R4', 13, 'medium'], // same shape without the directive
    ]);
  });

  it('exposes the file-level directive check', () => {
    expect(isServerActionFile(parse("'use server';\nexport const a = 1;"))).toBe(true);
    expect(isServerActionFile(parse("'use strict';\n'use server';\nexport const a = 1;"))).toBe(
      true,
    );
    expect(isServerActionFile(parse("export const a = 1;\n'use server';"))).toBe(false);
  });
});

describe('middleware / proxy', () => {
  it('recognizes an exported `proxy` function (Next 16 rename of `middleware`)', () => {
    expect(rows('entries/proxy.ts')).toEqual([['R4', 7, 'high']]);
  });

  it('recognizes the default export of middleware.* / proxy.*', () => {
    expect(rows('entries/middleware.ts')).toEqual([['R4', 7, 'high']]);
  });
});

describe('Remix / React Router data functions', () => {
  it('treats exported loader/action with a destructured { request | params | context } as entries', () => {
    expect(rows('entries/remix/route.tsx')).toEqual([
      ['R4', 5, 'high'],
      ['R4', 10, 'high'],
      ['R4', 15, 'medium'], // `loaderHelper` is not a route data function
      ['R4', 18, 'medium'], // `loaderUnrelated` does not destructure a request-like name
    ]);
  });

  it('ignores an exported loader/action that does not take a request-like parameter', () => {
    const code =
      "let last = ''; export const loader = (opts: { id: string }) => { last = opts.id; };";
    expect(analyzeSource(code, 'x.ts').map((f) => f.confidence)).toEqual(['medium']);
  });
});

describe('App Router metadata and special files', () => {
  it('treats generateMetadata and the page default export as entries; generateStaticParams is build-time', () => {
    expect(rows('entries/app/items/page.tsx')).toEqual([
      ['R4', 5, 'high'],
      ['R4', 15, 'high'],
    ]);
  });

  it('treats default.tsx (parallel-route fallback) like a page and loading.tsx as a plain component', () => {
    expect(rows('entries/app/items/default.tsx')).toEqual([['R4', 5, 'high']]);
    expect(rows('entries/app/items/loading.tsx')).toEqual([['R4', 5, 'medium']]);
  });

  it('recognizes route-handler exports by name, in any file', () => {
    const code = "let last = ''; export async function GET(r: Request) { last = r.url; }";
    expect(analyzeSource(code, 'lib/not-a-route.ts').map((f) => f.confidence)).toEqual(['high']);
  });
});

describe('syntax coverage', () => {
  it('parses JSX in .js files', () => {
    const r = analyzeSourceDetailed(
      "let last = ''; export function B(req) { last = req.url; return <div>{last}</div>; }",
      'banner.js',
    );
    expect(r.parseError).toBeUndefined();
    expect(r.findings.map((f) => f.ruleId)).toEqual(['R4']);
  });

  it('reports the first syntax error and still analyzes what parsed', () => {
    const r = analyzeSourceDetailed(
      "let last = '';\nexport function f(req: { url: string }) {\n  last = req.url;\n",
      'broken.ts',
    );
    expect(r.parseError).toEqual({
      line: 4,
      column: 1,
      message: "'}' expected.",
      count: 1,
    });
    expect(r.findings.map((f) => [f.ruleId, f.line])).toEqual([['R4', 3]]);
    expect(r.skipped).toBe(false);
  });

  it('reports skipped files and never throws on garbage input', () => {
    expect(analyzeSourceDetailed("'use client';\nlet a = 1;", 'c.tsx').skipped).toBe(true);
    expect(analyzeSourceDetailed('/* ssr-leak-disable */\nlet a = 1;', 'd.ts').skipped).toBe(true);
    const garbage = analyzeSourceDetailed('  {{{ ((( ', 'g.js');
    expect(garbage.findings).toEqual([]);
    expect(garbage.parseError?.count).toBeGreaterThan(0);
  });

  it('handles decorators, enums, namespaces, `satisfies`, `using` and `export =`', () => {
    const code = `
      let last = '';
      enum E { A }
      namespace N { export const x = 1; }
      @Injectable()
      class S { @Get() handle(@Req() req: { url: string }) { last = req.url; } }
      export function f(req: { url: string }) { using r = getRes(); last = req.url satisfies string; return E.A + N.x; }
      export = f;
    `;
    const r = analyzeSourceDetailed(code, 'modern.ts');
    expect(r.parseError).toBeUndefined();
    expect(r.findings.map((f) => f.line)).toEqual([6, 7]);
  });

  it('treats `import * as axios` `.default.defaults` writes as R1', () => {
    expect(rows('syntax/namespace-axios.ts')).toEqual([['R1', 4, 'high']]);
  });
});

describe('run(): parse-error diagnostics', () => {
  it('reports a parse-error diagnostic per file with syntax errors and keeps its findings', async () => {
    const report = await run({ root: FIXTURES, patterns: ['syntax'] });
    expect(report.filesScanned).toBe(3);
    expect(report.diagnostics).toEqual([
      {
        kind: 'parse-error',
        path: 'syntax/broken.ts',
        message:
          "syntax error in syntax/broken.ts:5:1: '}' expected.; analyzed as far as it parsed",
      },
    ]);
    expect(report.findings.map((f) => [f.file, f.ruleId])).toEqual([
      ['syntax/broken.ts', 'R4'],
      ['syntax/jsx-in-js.js', 'R4'],
      ['syntax/namespace-axios.ts', 'R1'],
    ]);
  });

  it('adds an empty-input diagnostic when every analyzed file has syntax errors', async () => {
    const report = await run({ root: FIXTURES, patterns: ['syntax/broken.ts'] });
    expect(report.diagnostics.map((d) => d.kind)).toEqual(['parse-error', 'empty-input']);
    expect(report.diagnostics[1]?.message).toMatch(/^no file parsed cleanly: all 1 analyzed file/);
  });
});
