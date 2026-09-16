import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  buildGuardNames,
  classifyCondition,
  collectFiles,
  DEFAULT_EXCLUDED_DIRS,
  run,
  validateConfig,
} from '../src/index.js';
import { analyzeFixture, FIXTURES } from './helpers.js';

const rows = (relative: string, options = {}) =>
  analyzeFixture(relative, { all: true, ...options }).map((f) => [f.ruleId, f.line, f.confidence]);

function classify(source: string, extra?: { server?: string[]; client?: string[] }) {
  const sf = ts.createSourceFile('x.ts', `if (${source}) {}`, ts.ScriptTarget.Latest, true);
  const stmt = sf.statements[0] as ts.IfStatement;
  return classifyCondition(stmt.expression, buildGuardNames(extra));
}

describe('classifyCondition', () => {
  it('reads typeof checks on browser globals in either operand order', () => {
    expect(classify("typeof window === 'undefined'")).toBe('server');
    expect(classify("typeof window !== 'undefined'")).toBe('client');
    expect(classify("'undefined' == typeof document")).toBe('server');
    expect(classify("typeof globalThis.window !== 'undefined'")).toBe('client');
    expect(classify("typeof foo === 'undefined'")).toBeNull();
  });

  it('does not treat navigator or self as browser-only (Node 21+, Bun, Deno and edge runtimes define them)', () => {
    expect(classify("typeof navigator === 'object'")).toBeNull();
    expect(classify("typeof navigator === 'undefined'")).toBeNull();
    expect(classify("typeof self !== 'undefined'")).toBeNull();
    expect(classify("typeof globalThis.navigator === 'undefined'")).toBeNull();
  });

  it('recognizes built-in and configured guard names, including member calls', () => {
    expect(classify('isServer()')).toBe('server');
    expect(classify('isClient()')).toBe('client');
    expect(classify('runtime.isServer()')).toBe('server');
    expect(classify('canUseDOM')).toBe('client');
    expect(classify('isNodeRuntime()')).toBeNull();
    expect(classify('isNodeRuntime()', { server: ['isNodeRuntime'] })).toBe('server');
    expect(classify('inBrowser', { client: ['inBrowser'] })).toBe('client');
  });

  it('flips on ! and combines && / || conservatively', () => {
    expect(classify('!isServer()')).toBe('client');
    expect(classify('!!isServer()')).toBe('server');
    expect(classify('isClient() && flag')).toBe('client'); // false on the server
    expect(classify('flag && isServer()')).toBeNull(); // not guaranteed on the server
    expect(classify('isServer() && isServer()')).toBe('server');
    expect(classify('isServer() || flag')).toBe('server'); // true on the server regardless
    expect(classify('isClient() || flag')).toBeNull();
    expect(classify('isClient() || !isServer()')).toBe('client');
    expect(classify('flag')).toBeNull();
  });
});

describe('browser-only guards downgrade findings to low', () => {
  it('everything after `if (isServer()) return;` in the same block is browser-only', () => {
    expect(rows('guards/early-return-is-server.ts')).toEqual([
      ['R4', 7, 'low'],
      ['R4', 15, 'low'],
    ]);
    expect(analyzeFixture('guards/early-return-is-server.ts')).toEqual([]);
  });

  it('a write before the guard is still reported at its normal confidence', () => {
    expect(rows('guards/write-before-guard.ts')).toEqual([
      ['R4', 6, 'medium'],
      ['R4', 8, 'low'],
    ]);
  });

  it('the then-branch of a typeof-window check is browser-only', () => {
    expect(rows('guards/typeof-window-block.ts')).toEqual([
      ['R4', 5, 'low'],
      ['R4', 11, 'low'],
      ['R4', 16, 'low'],
    ]);
  });

  it('the else-branch of a server check is browser-only, the then-branch is not', () => {
    expect(rows('guards/else-branch.ts')).toEqual([
      ['R4', 8, 'high'],
      ['R4', 10, 'low'],
    ]);
  });

  it('handles `isClient() && write()`, `isServer() || write()` and ternaries', () => {
    expect(rows('guards/shorthand-and-ternary.ts')).toEqual([
      ['R4', 8, 'low'],
      ['R4', 9, 'low'],
      ['R4', 10, 'low'],
    ]);
  });

  it('handles negation and only trusts `||` / `&&` when the server branch is certain', () => {
    expect(rows('guards/negation-and-logic.ts')).toEqual([
      ['R4', 10, 'low'],
      ['R4', 13, 'low'],
      ['R4', 18, 'medium'],
      ['R4', 20, 'low'],
    ]);
  });

  it('an early exit only guards the rest of its own block', () => {
    expect(rows('guards/nested-block-scope.ts')).toEqual([
      ['R4', 9, 'low'],
      ['R4', 11, 'medium'],
    ]);
  });

  it('accepts extra guard names from options and matches member calls by last name', () => {
    expect(rows('guards/custom-names.ts')).toEqual([
      ['R4', 8, 'medium'],
      ['R4', 13, 'low'],
    ]);
    expect(rows('guards/custom-names.ts', { guards: { server: ['isNodeRuntime'] } })).toEqual([
      ['R4', 8, 'low'],
      ['R4', 13, 'low'],
    ]);
  });

  it('keeps a real leak behind a navigator/self check at its normal confidence', () => {
    // Node 21+ defines `navigator` (Node 20 does not), so the guarded branch really runs during SSR there.
    const major = Number(process.versions.node.split('.')[0]);
    expect(typeof navigator).toBe(major >= 21 ? 'object' : 'undefined');
    expect(rows('guards/navigator-is-not-a-guard.ts')).toEqual([
      ['R4', 8, 'high'],
      ['R4', 11, 'high'],
    ]);
    expect(analyzeFixture('guards/navigator-is-not-a-guard.ts')).toHaveLength(2);
  });

  it('applies to every rule, not only R4', () => {
    const findings = analyzeFixture('guards/axios-guarded.ts', { all: true });
    expect(findings.map((f) => [f.ruleId, f.confidence])).toEqual([['R1', 'low']]);
    expect(findings[0]?.message).toContain('Guarded by a browser-only check');
    expect(analyzeFixture('guards/axios-guarded.ts')).toEqual([]);
  });

  it('merges config "guards" with CLI options and rejects bad shapes', async () => {
    const report = await run({
      root: FIXTURES,
      patterns: ['guards/custom-names.ts'],
      config: { guards: { server: ['isNodeRuntime'] } },
    });
    expect(report.findings).toEqual([]);
    expect(validateConfig({ guards: { client: ['inBrowser'] } })).toEqual({
      guards: { client: ['inBrowser'] },
    });
    expect(() => validateConfig({ guards: 'isServer' })).toThrow('"guards" must be an object');
    expect(() => validateConfig({ guards: { server: 'isServer' } })).toThrow(
      '"guards.server" must be string[]',
    );
  });
});

describe('mock handlers are skipped by default', () => {
  it('excludes mocks/ and __mocks__/ directories and *.mock.* files', () => {
    expect(DEFAULT_EXCLUDED_DIRS).toEqual(expect.arrayContaining(['mocks', '__mocks__']));
    const files = collectFiles(FIXTURES, ['discovery']).map((f) =>
      path.relative(FIXTURES, f).split(path.sep).join('/'),
    );
    expect(files).toEqual(['discovery/src/long-line.js', 'discovery/src/ok.js']);
  });

  it('still analyzes a mock file when it is named explicitly', async () => {
    const report = await run({ root: FIXTURES, patterns: ['discovery/mocks/handler.ts'] });
    expect(report.findings.map((f) => f.ruleId)).toEqual(['R4']);
  });

  it('config "include" re-adds mock files (and test/story names) during a directory walk', async () => {
    const report = await run({
      root: FIXTURES,
      patterns: ['discovery'],
      config: { include: ['discovery/src/client.mock.ts', 'discovery/mocks/**'] },
    });
    expect(report.findings.map((f) => f.file).sort()).toEqual([
      'discovery/mocks/handler.ts',
      'discovery/src/client.mock.ts',
      'discovery/src/ok.js',
    ]);
    const stories = await run({
      root: FIXTURES,
      patterns: ['discovery'],
      config: { include: ['discovery/src/*.stories.js'] },
    });
    expect(stories.findings.map((f) => f.file)).toContain('discovery/src/story.stories.js');
  });
});
