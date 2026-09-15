export { analyzeSource } from './analyzer.js';
export { findConfigFile, loadConfigFile, resolveConfig, validateConfig } from './config.js';
export {
  type CollectOptions,
  type CollectResult,
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_PATTERN,
  EXCLUDED_DIRS,
  MAX_LINE_LENGTH,
  SUPPORTED_EXTENSIONS,
  collectFiles,
  collectFilesDetailed,
  isMinifiedSource,
} from './files.js';
export { formatHuman, formatJson } from './format.js';
export { CONFIDENCE_RANK, RULES, RULE_LIST, type RuleMeta } from './rules.js';
export { analyzeFile, run, shouldFail, summarize } from './run.js';
export { parseIgnoreRules } from './suppress.js';
export { DEFAULT_TAINT_FUNCTIONS, DEFAULT_TAINT_IDENTIFIERS, type Taint } from './taint.js';
export {
  type AnalyzeOptions,
  type Config,
  ConfigError,
  type Confidence,
  type Diagnostic,
  type DiagnosticKind,
  type Finding,
  type Report,
  type ReportSummary,
  type RuleId,
  type RunOptions,
  type TaintSources,
} from './types.js';
export { VERSION } from './version.js';
