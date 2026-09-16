import fs from 'node:fs';
import path from 'node:path';
import { analyzeSource } from './analyzer.js';
import { resolveConfig } from './config.js';
import { collectFilesDetailed, DEFAULT_PATTERN, isMinifiedSource, toPosix } from './files.js';
import { CONFIDENCE_RANK } from './rules.js';
import type {
  AnalyzeOptions,
  Confidence,
  Diagnostic,
  Finding,
  GuardSources,
  Report,
  RunOptions,
  TaintSources,
} from './types.js';
import { VERSION } from './version.js';

function mergeSources(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a && !b) return undefined;
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

function toAnalyzeOptions(
  options: RunOptions,
  taintSources?: TaintSources,
  guards?: GuardSources,
): AnalyzeOptions {
  const out: AnalyzeOptions = {};
  if (options.all !== undefined) out.all = options.all;
  if (options.includeClient !== undefined) out.includeClient = options.includeClient;
  const sources = taintSources ?? options.taintSources;
  if (sources) out.taintSources = sources;
  const guardNames = guards ?? options.guards;
  if (guardNames) out.guards = guardNames;
  return out;
}

/**
 * Analyzes one file on disk (no minified-file skip, no config lookup).
 * Throws like `fs.readFileSync` when the file cannot be read; `run()` reports such files as
 * `unreadable-file` diagnostics instead of throwing.
 */
export function analyzeFile(file: string, options: RunOptions = {}): Finding[] {
  const root = path.resolve(options.root ?? process.cwd());
  const abs = path.resolve(root, file);
  const code = fs.readFileSync(abs, 'utf8');
  const rel = toPosix(path.relative(root, abs)) || path.basename(abs);
  return analyzeSource(code, abs, toAnalyzeOptions(options)).map((f) => ({ ...f, file: rel }));
}

/**
 * Discovers files under `root` matching `patterns`, applies config, and analyzes them all.
 * Never throws for input problems: missing paths, an empty input set and unreadable files are
 * returned in `report.diagnostics`.
 */
export async function run(options: RunOptions = {}): Promise<Report> {
  const started = performance.now();
  const root = path.resolve(options.root ?? process.cwd());
  const { config } = await resolveConfig(root, options.config);

  const functions = mergeSources(config.taintSources?.functions, options.taintSources?.functions);
  const identifiers = mergeSources(
    config.taintSources?.identifiers,
    options.taintSources?.identifiers,
  );
  const taintSources: TaintSources | undefined = functions || identifiers ? {} : undefined;
  if (taintSources && functions) taintSources.functions = functions;
  if (taintSources && identifiers) taintSources.identifiers = identifiers;
  const guardServer = mergeSources(config.guards?.server, options.guards?.server);
  const guardClient = mergeSources(config.guards?.client, options.guards?.client);
  const guards: GuardSources | undefined = guardServer || guardClient ? {} : undefined;
  if (guards && guardServer) guards.server = guardServer;
  if (guards && guardClient) guards.client = guardClient;
  const analyzeOptions = toAnalyzeOptions(options, taintSources, guards);

  const patterns =
    options.patterns && options.patterns.length > 0 ? options.patterns : [DEFAULT_PATTERN];
  const collectOptions: Parameters<typeof collectFilesDetailed>[2] = {};
  if (config.ignore) collectOptions.ignore = config.ignore;
  if (config.exclude) collectOptions.exclude = config.exclude;
  if (config.include) collectOptions.include = config.include;
  const { files, forced, missing } = collectFilesDetailed(root, patterns, collectOptions);

  const diagnostics: Diagnostic[] = missing.map((p) => ({
    kind: 'missing-path',
    path: p,
    message: `path not found: ${p} (relative to ${root})`,
  }));

  const findings: Finding[] = [];
  let filesScanned = 0;
  for (const file of files) {
    const rel = toPosix(path.relative(root, file)) || path.basename(file);
    let code: string;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      diagnostics.push({
        kind: 'unreadable-file',
        path: rel,
        message: `cannot read ${rel}: ${reason}`,
      });
      continue;
    }
    if (!forced.has(file) && isMinifiedSource(code)) continue;
    filesScanned++;
    findings.push(...analyzeSource(code, file, analyzeOptions).map((f) => ({ ...f, file: rel })));
  }
  if (filesScanned === 0) {
    diagnostics.push({
      kind: 'empty-input',
      message: `no files to analyze: ${patterns.join(', ')} matched nothing under ${root}`,
    });
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  return {
    version: VERSION,
    root,
    filesScanned,
    durationMs: Math.round(performance.now() - started),
    findings,
    summary: summarize(findings),
    diagnostics,
  };
}

export function summarize(findings: readonly Finding[]): Report['summary'] {
  const summary = { total: findings.length, high: 0, medium: 0, low: 0 };
  for (const f of findings) summary[f.confidence]++;
  return summary;
}

/** True when any finding has confidence at or above `threshold`. */
export function shouldFail(findings: readonly Finding[], threshold: Confidence | 'none'): boolean {
  if (threshold === 'none') return false;
  const min = CONFIDENCE_RANK[threshold];
  return findings.some((f) => CONFIDENCE_RANK[f.confidence] >= min);
}
