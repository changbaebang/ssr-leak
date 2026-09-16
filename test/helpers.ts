import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AnalyzeOptions, analyzeFile, type Finding } from '../src/index.js';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function analyzeFixture(relative: string, options: AnalyzeOptions = {}): Finding[] {
  return analyzeFile(relative, { root: FIXTURES, ...options });
}

export function ruleIds(findings: Finding[]): string[] {
  return findings.map((f) => f.ruleId);
}
