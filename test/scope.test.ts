import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  DEFAULT_EXCLUDED_DIRS,
  collectFiles,
  collectFilesDetailed,
  isMinifiedSource,
  run,
  validateConfig,
} from '../src/index.js';
import { FIXTURES, analyzeFixture, ruleIds } from './helpers.js';

describe('client files', () => {
  it('skips files with a "use client" directive by default', () => {
    expect(analyzeFixture('scope/use-client.tsx')).toEqual([]);
  });

  it('analyzes them with includeClient', () => {
    expect(ruleIds(analyzeFixture('scope/use-client.tsx', { includeClient: true }))).toEqual([
      'R4',
    ]);
  });
});

describe('React effect callbacks', () => {
  it('skips every rule inside useEffect/useLayoutEffect callbacks (effects never run during SSR)', () => {
    expect(analyzeFixture('scope/effect-callback.tsx', { all: true, includeClient: true })).toEqual(
      [],
    );
  });
});

describe('suppression comments', () => {
  it('honors // ssr-leak-ignore-next-line, with or without a rule list', () => {
    const findings = analyzeFixture('scope/ignore-comment.ts');
    // line 6 is fully suppressed; line 8 lists only R6, so the R4 finding stays.
    expect(findings.map((f) => [f.ruleId, f.line])).toEqual([['R4', 8]]);
  });

  it('honors /* ssr-leak-disable */ at the top of a file', () => {
    expect(analyzeFixture('scope/disabled.ts', { all: true })).toEqual([]);
  });

  it('ignores everything after " -- " in an ignore comment (a free-form reason)', () => {
    const findings = analyzeFixture('scope/ignore-reason.ts');
    // line 5: `R4 -- browser only` suppresses R4; line 7: bare `-- reason` suppresses every rule;
    // line 9: `R6 -- ...` lists the wrong rule, so the R4 finding stays.
    expect(findings.map((f) => [f.ruleId, f.line])).toEqual([['R4', 9]]);
  });
});

describe('file discovery', () => {
  it('skips test files, declaration files and node_modules', () => {
    const files = collectFiles(FIXTURES, ['scope', 'cli-project']).map((f) =>
      path.relative(FIXTURES, f),
    );
    expect(files).not.toContain(path.join('scope', 'leaky.test.ts'));
    expect(files).not.toContain(path.join('scope', 'Widget.stories.tsx'));
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files).toContain(path.join('scope', 'plain.js'));
    expect(files).toContain(path.join('cli-project', 'src', 'leaky.ts'));
  });

  it('accepts globs with wildcards in directory segments', () => {
    const files = collectFiles(FIXTURES, ['r*/positive-*.ts']).map((f) => path.basename(f));
    expect(files).toContain('positive-gssp.ts');
    expect(files).toContain('positive-globalthis.ts');
    expect(files).not.toContain('negative-module-scope.ts');
  });

  it('accepts a single file', () => {
    const files = collectFiles(FIXTURES, ['r1/positive-gssp.ts']);
    expect(files).toHaveLength(1);
  });

  it('reports a missing path instead of silently returning nothing', () => {
    const result = collectFilesDetailed(FIXTURES, ['does-not-exist/**', 'scope/plain.js']);
    expect(result.missing).toEqual(['does-not-exist/**']);
    expect(result.files).toHaveLength(1);
  });

  it('skips build outputs, static assets, caches, VCS metadata and minified files by default', () => {
    expect(DEFAULT_EXCLUDED_DIRS).toEqual(
      expect.arrayContaining([
        'node_modules',
        'dist',
        'build',
        'out',
        '.next',
        '.vercel',
        '.output',
        '.turbo',
        '.cache',
        '.git',
        'coverage',
        'storybook-static',
        'public',
      ]),
    );
    const files = collectFiles(FIXTURES, ['discovery']).map((f) =>
      path.relative(FIXTURES, f).split(path.sep).join('/'),
    );
    expect(files).toEqual(['discovery/src/long-line.js', 'discovery/src/ok.js']);
  });

  it('skips a file with a line longer than 2000 characters at analysis time', async () => {
    expect(isMinifiedSource('short\nlines\n')).toBe(false);
    expect(isMinifiedSource(`a\n${'x'.repeat(2001)}\n`)).toBe(true);
    const report = await run({ root: FIXTURES, patterns: ['discovery'] });
    expect(report.filesScanned).toBe(1);
    expect(report.findings.map((f) => f.file)).toEqual(['discovery/src/ok.js']);
  });

  it('lets config "exclude" replace the directory list and "include" re-add paths', async () => {
    const replaced = await run({
      root: FIXTURES,
      patterns: ['discovery'],
      config: { exclude: ['node_modules'] },
    });
    expect(replaced.findings.map((f) => f.file)).toEqual([
      'discovery/.cache/bundle.js',
      'discovery/.output/bundle.js',
      'discovery/.turbo/bundle.js',
      'discovery/.vercel/bundle.js',
      'discovery/build/bundle.js',
      'discovery/public/bundle.js',
      'discovery/src/ok.js',
      'discovery/storybook-static/bundle.js',
    ]);
    const included = await run({
      root: FIXTURES,
      patterns: ['discovery'],
      config: { include: ['discovery/public/**', 'discovery/src/*.min.js'] },
    });
    expect(included.findings.map((f) => f.file)).toEqual([
      'discovery/public/bundle.js',
      'discovery/src/ok.js',
      'discovery/src/vendor.min.js',
    ]);
  });

  it('explicitly named files are analyzed even when minified', async () => {
    const report = await run({ root: FIXTURES, patterns: ['discovery/src/long-line.js'] });
    expect(report.filesScanned).toBe(1);
    expect(report.findings).toHaveLength(1);
  });
});

describe('config file', () => {
  it('applies ignore globs and taintSources from ssr-leak.config.json', async () => {
    const report = await run({ root: path.join(FIXTURES, 'config') });
    const files = report.findings.map((f) => f.file).sort();
    expect(files).toEqual(['custom-source.ts', 'ignored-dir-file.ts']);
    expect(report.filesScanned).toBe(2);
  });

  it('accepts an explicit config path and object', async () => {
    const withPath = await run({
      root: path.join(FIXTURES, 'config'),
      config: 'ssr-leak.config.json',
    });
    const withObject = await run({
      root: path.join(FIXTURES, 'config'),
      config: { ignore: ['generated/**', 'custom-source.ts'] },
    });
    expect(withPath.summary.total).toBe(2);
    expect(withObject.findings.map((f) => f.file)).toEqual(['ignored-dir-file.ts']);
  });

  it('rejects invalid config shapes', () => {
    expect(() => validateConfig({ ignore: 'x' })).toThrow(ConfigError);
    expect(() => validateConfig({ exclude: [1] })).toThrow(/"exclude" must be string\[\]/);
    expect(() => validateConfig({ include: 'x' })).toThrow(/"include" must be string\[\]/);
    expect(() => validateConfig({ unknown: true })).toThrow(/unknown key/);
    expect(() => validateConfig({ taintSources: { functions: [1] } })).toThrow(ConfigError);
    expect(validateConfig({ taintSources: { identifiers: ['nextReq'] } })).toEqual({
      taintSources: { identifiers: ['nextReq'] },
    });
  });

  it('errors on a missing explicit config file', async () => {
    await expect(run({ root: FIXTURES, config: 'nope.json' })).rejects.toThrow(ConfigError);
  });
});

describe('run()', () => {
  it('produces a sorted report with a summary', async () => {
    const report = await run({ root: FIXTURES, patterns: ['r1', 'r4'], all: true });
    expect(report.filesScanned).toBeGreaterThan(5);
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.high + report.summary.medium + report.summary.low).toBe(
      report.summary.total,
    );
    for (let i = 1; i < report.findings.length; i++) {
      const a = report.findings[i - 1];
      const b = report.findings[i];
      if (!a || !b) throw new Error('unreachable');
      expect(a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column).toBeLessThan(
        1,
      );
    }
    expect(report.findings.every((f) => !path.isAbsolute(f.file))).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('returns diagnostics for a missing path and an empty input set instead of throwing', async () => {
    const missing = await run({ root: FIXTURES, patterns: ['does-not-exist'] });
    expect(missing.filesScanned).toBe(0);
    expect(missing.diagnostics.map((d) => d.kind)).toEqual(['missing-path', 'empty-input']);
    expect(missing.diagnostics[0]?.path).toBe('does-not-exist');
    const empty = await run({ root: FIXTURES, patterns: ['discovery/src/*.mjs'] });
    expect(empty.filesScanned).toBe(0);
    expect(empty.diagnostics.map((d) => d.kind)).toEqual(['empty-input']);
  });

  it('walks an excluded directory when it is named explicitly', async () => {
    const report = await run({ root: FIXTURES, patterns: ['discovery/public'] });
    expect(report.filesScanned).toBe(1);
    expect(report.diagnostics).toEqual([]);
  });
});
