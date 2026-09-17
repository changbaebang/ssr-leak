export {
  analyzeSource,
  analyzeSourceDetailed,
  type ParseError,
  type SourceAnalysis,
} from './analyzer.js';
export { findConfigFile, loadConfigFile, resolveConfig, validateConfig } from './config.js';
export { EVIDENCE_NOTES, type EvidenceKind } from './evidence.js';
export {
  type CollectOptions,
  type CollectResult,
  collectFiles,
  collectFilesDetailed,
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_PATTERN,
  EXCLUDED_DIRS,
  isMinifiedSource,
  MAX_LINE_LENGTH,
  SUPPORTED_EXTENSIONS,
} from './files.js';
export { formatHuman, formatJson } from './format.js';
export {
  buildGuardNames,
  classifyCondition,
  DEFAULT_CLIENT_GUARDS,
  DEFAULT_SERVER_GUARDS,
  type GuardNames,
  type RuntimeEnv,
} from './guards.js';
export { CONFIDENCE_RANK, RULE_LIST, RULES, type RuleMeta } from './rules.js';
export { analyzeFile, run, shouldFail, summarize } from './run.js';
export { isServerActionFile } from './scope.js';
export { parseIgnoreRules } from './suppress.js';
export {
  DEFAULT_TAINT_FUNCTIONS,
  DEFAULT_TAINT_IDENTIFIERS,
  REQUEST_MEMBERS,
  type Taint,
  WEAK_TAINT_IDENTIFIERS,
} from './taint.js';
export {
  type AnalyzeOptions,
  type Confidence,
  type Config,
  ConfigError,
  type Diagnostic,
  type DiagnosticKind,
  type Finding,
  type GuardSources,
  type Report,
  type ReportSummary,
  type RuleId,
  type RunOptions,
  type TaintSources,
} from './types.js';
export { VERSION } from './version.js';
