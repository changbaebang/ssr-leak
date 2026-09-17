import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const PROJECT = path.join(ROOT, 'test', 'fixtures', 'cli-project');

function cli(args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: PROJECT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('cli (spawned dist/cli.js)', () => {
  it('--help exits 0 and documents options', () => {
    const r = cli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--fail-on');
    expect(r.stdout).toContain('--include-client');
    expect(r.stdout).toContain('--allow-empty');
    expect(r.stdout).toContain('storybook-static');
  });

  it('--version prints the package version', () => {
    const r = cli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--json emits a stable shape and exits 1 on high findings', () => {
    const r = cli(['--json']);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(Object.keys(report).sort()).toEqual(
      [
        'diagnostics',
        'durationMs',
        'filesScanned',
        'findings',
        'root',
        'summary',
        'version',
      ].sort(),
    );
    expect(report.filesScanned).toBe(3);
    expect(report.summary).toEqual({ total: 2, high: 2, medium: 0, low: 0 });
    expect(report.diagnostics).toEqual([]);
    const finding = report.findings[0];
    expect(Object.keys(finding).sort()).toEqual(
      [
        'column',
        'confidence',
        'endColumn',
        'endLine',
        'file',
        'fixHint',
        'line',
        'message',
        'rule',
        'ruleId',
        'snippet',
      ].sort(),
    );
    expect(
      report.findings.map((f: { ruleId: string; file: string }) => [f.file, f.ruleId]),
    ).toEqual([
      ['src/leaky.ts', 'R1'],
      ['src/leaky.ts', 'R4'],
    ]);
  });

  it('human output uses file:line:col and a summary line', () => {
    const r = cli([]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^src\/leaky\.ts:7:3 {2}R1 axios-defaults-in-function \[high\]/m);
    expect(r.stdout).toMatch(/^ {4}fix: /m);
    expect(r.stdout).toMatch(/2 findings \(2 high, 0 medium, 0 low\) — 3 files scanned in \d+ms/);
  });

  it('--all adds info-level findings (R5) that do not affect the default exit code', () => {
    const r = cli(['--json', '--all', 'src/leaky.ts']);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.findings.map((f: { ruleId: string }) => f.ruleId)).toEqual(['R1', 'R5', 'R4']);
    const clean = cli(['--json', '--all', 'src/clean.ts']);
    expect(clean.code).toBe(0);
    expect(JSON.parse(clean.stdout).summary.total).toBe(0);
  });

  it('--include-client analyzes "use client" files', () => {
    expect(JSON.parse(cli(['--json', 'src/client-only.tsx']).stdout).summary.total).toBe(0);
    const r = cli(['--json', '--include-client', 'src/client-only.tsx']);
    const findings = JSON.parse(r.stdout).findings as { ruleId: string; confidence: string }[];
    // `user` is a bare prop of a component, not a request primitive: medium, so exit 0 by default.
    expect(findings.map((f) => [f.ruleId, f.confidence])).toEqual([['R4', 'medium']]);
    expect(r.code).toBe(0);
    expect(cli(['--include-client', '--fail-on', 'medium', 'src/client-only.tsx']).code).toBe(1);
  });

  it('exit code follows --fail-on', () => {
    expect(cli(['--fail-on', 'none']).code).toBe(0);
    expect(cli(['src/clean.ts']).code).toBe(0);
    expect(cli(['--fail-on', 'medium', '--all', 'src/leaky.ts']).code).toBe(1);
  });

  it('--root works from another cwd and reports paths relative to root', () => {
    const r = spawnSync(process.execPath, [CLI, '--root', PROJECT, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).findings[0].file).toBe('src/leaky.ts');
  });

  it('exits 2 on unknown options, bad --fail-on and invalid config', () => {
    expect(cli(['--bogus']).code).toBe(2);
    expect(cli(['--fail-on', 'sometimes']).code).toBe(2);
    const bad = cli(['--config', 'bad-config.json']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('"ignore" must be string[]');
    expect(cli(['--config', 'missing.json']).code).toBe(2);
  });

  it('exits 2 with a clear message when a positional path does not exist', () => {
    const r = cli(['does-not-exist']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('error: path not found: does-not-exist');
    expect(r.stderr).toContain('error: no files to analyze');
    expect(r.stderr).not.toContain('    at ');
  });

  it('exits 2 when the input set is empty, 0 with --allow-empty', () => {
    const empty = cli(['src/*.mjs']);
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('no files to analyze');
    const allowed = cli(['src/*.mjs', '--allow-empty']);
    expect(allowed.code).toBe(0);
    expect(allowed.stderr).toContain('warning: no files to analyze');
    expect(cli(['does-not-exist', '--allow-empty']).code).toBe(0);
    expect(cli(['--root', 'does-not-exist-root']).code).toBe(2);
  });

  it('exits 2 with a one-line message for an unreadable file', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-leak-unreadable-'));
    try {
      fs.writeFileSync(path.join(dir, 'ok.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.join(dir, 'secret.ts'), 'export const b = 2;\n', { mode: 0o000 });
      const r = cli(['--root', dir, '--json']);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('error: cannot read secret.ts: EACCES');
      expect(r.stderr).not.toContain('    at ');
      const report = JSON.parse(r.stdout);
      expect(report.filesScanned).toBe(1);
      expect(report.diagnostics).toEqual([
        { kind: 'unreadable-file', path: 'secret.ts', message: 'cannot read secret.ts: EACCES' },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cli: syntax errors and --env', () => {
  const SYNTAX = path.join(ROOT, 'test', 'fixtures', 'syntax');

  it('prints a syntax error as a warning and keeps the exit code of the findings', () => {
    const r = cli(['--root', SYNTAX, '--json']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "warning: syntax error in broken.ts:5:1: '}' expected.; analyzed as far as it parsed",
    );
    expect(JSON.parse(r.stdout).diagnostics).toHaveLength(1);
    expect(cli(['--root', SYNTAX, '--fail-on', 'none']).code).toBe(0);
  });

  it('exits 2 when the only analyzed file has syntax errors, 0 with --allow-empty', () => {
    const r = cli(['--root', SYNTAX, 'broken.ts', '--fail-on', 'none']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('error: no file parsed cleanly: all 1 analyzed file(s)');
    expect(cli(['--root', SYNTAX, 'broken.ts', '--fail-on', 'none', '--allow-empty']).code).toBe(0);
  });

  it('--env prints the environment and exits 0; exits 2 on a bad config', () => {
    const r = cli(['--env']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ssr-leak: \d+\.\d+\.\d+/m);
    expect(r.stdout).toMatch(/^node: v\d+/m);
    expect(r.stdout).toMatch(/^typescript: \d+\.\d+/m);
    expect(r.stdout).toContain(`root: ${PROJECT}`);
    expect(r.stdout).toContain('config file: (none; looked for ssr-leak.config.json');
    expect(r.stdout).toContain('excluded directories: node_modules, dist');
    expect(r.stdout).toContain('server guards: isServer, isSSR, isServerSide');
    expect(r.stdout).toContain('taint identifiers: req, request, ctx');
    expect(r.stdout).toContain('  R2 axios-defaults-at-module-scope [low, --all only]');
    expect(r.stdout).toContain('  R4 module-state-write-tainted [high]');
    const bad = cli(['--env', '--config', 'bad-config.json']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('"ignore" must be string[]');
  });
});
