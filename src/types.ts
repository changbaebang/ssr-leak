export type Confidence = 'high' | 'medium' | 'low';

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';

export interface Finding {
  /** Path relative to the analysis root (posix separators). */
  file: string;
  /** 1-based line of the offending expression. */
  line: number;
  /** 1-based column of the offending expression. */
  column: number;
  endLine: number;
  endColumn: number;
  ruleId: RuleId;
  /** Human-readable rule name, e.g. `axios-defaults-in-function`. */
  rule: string;
  confidence: Confidence;
  message: string;
  fixHint: string;
  /** The trimmed source line containing the finding. */
  snippet: string;
}

export interface TaintSources {
  /** Extra function names whose call results are request-scoped (e.g. `auth`, `getToken`). */
  functions?: string[];
  /** Extra identifier names whose property reads are request-scoped (e.g. `nextReq`). */
  identifiers?: string[];
}

/** Names of runtime checks the analyzer treats as browser/server guards, merged with the built-ins. */
export interface GuardSources {
  /** Functions or identifiers that are truthy only on the server (built-in: `isServer`, `isSSR`, `isServerSide`). */
  server?: string[];
  /** Functions or identifiers that are truthy only in a browser (built-in: `isClient`, `isBrowser`, `isClientSide`, `canUseDOM`). */
  client?: string[];
}

export interface Config {
  /** Glob patterns (relative to root) of files to skip. */
  ignore?: string[];
  /**
   * Directory basenames skipped during discovery wherever they appear in the tree.
   * Replaces the built-in list (`DEFAULT_EXCLUDED_DIRS`) when given.
   */
  exclude?: string[];
  /**
   * Glob patterns (relative to root) that are analyzed even when they sit under an excluded
   * directory or look minified (`*.min.js`, or any line longer than 2000 characters).
   */
  include?: string[];
  /** Additional taint sources merged with the built-in ones. */
  taintSources?: TaintSources;
  /** Additional browser/server guard names merged with the built-in ones. */
  guards?: GuardSources;
}

export interface AnalyzeOptions {
  /** Also report low-confidence findings (R2, R5). */
  all?: boolean;
  /** Analyze files that start with a `'use client'` directive. */
  includeClient?: boolean;
  /** Extra taint sources merged with the built-in ones. */
  taintSources?: TaintSources;
  /** Extra browser/server guard names merged with the built-in ones. */
  guards?: GuardSources;
}

export interface RunOptions extends AnalyzeOptions {
  /** Directory that globs and reported paths are relative to. Defaults to `process.cwd()`. */
  root?: string;
  /** Globs, directories or files to analyze. Defaults to every supported file under root. */
  patterns?: string[];
  /**
   * Either an explicit config object, or a path to a config file (relative paths resolve
   * against `root`). When omitted, `ssr-leak.config.{json,mjs,js,cjs}` is looked up in root.
   */
  config?: Config | string;
}

export interface ReportSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
}

export type DiagnosticKind =
  /** A positional path (or the base of a glob) does not exist. */
  | 'missing-path'
  /** No file was analyzed at all. */
  | 'empty-input'
  /** A discovered file could not be read. */
  | 'unreadable-file'
  /**
   * A file has syntax errors. It is still analyzed as far as it parsed; the CLI prints a warning
   * and the exit code is unaffected unless every analyzed file had syntax errors.
   */
  | 'parse-error';

/**
 * A problem with the input set. The CLI prints these on stderr; every kind except `parse-error`
 * makes it exit 2 (`missing-path` and `empty-input` only without `--allow-empty`).
 */
export interface Diagnostic {
  kind: DiagnosticKind;
  /** Path (relative to root, or the pattern as given) the diagnostic is about, when applicable. */
  path?: string;
  message: string;
}

export interface Report {
  version: string;
  root: string;
  /** Number of files analyzed (minified files and unreadable files are not counted). */
  filesScanned: number;
  durationMs: number;
  findings: Finding[];
  summary: ReportSummary;
  diagnostics: Diagnostic[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}
