import pc from 'picocolors';
import type { Confidence, Report } from './types.js';

function paint(confidence: Confidence, text: string): string {
  switch (confidence) {
    case 'high':
      return pc.red(text);
    case 'medium':
      return pc.yellow(text);
    default:
      return pc.dim(text);
  }
}

export function formatHuman(report: Report): string {
  const lines: string[] = [];
  for (const f of report.findings) {
    const loc = `${f.file}:${f.line}:${f.column}`;
    const tag = paint(f.confidence, `${f.ruleId} ${f.rule} [${f.confidence}]`);
    lines.push(`${pc.bold(loc)}  ${tag}  ${f.message}`);
    lines.push(`    ${pc.dim(`fix: ${f.fixHint}`)}`);
  }
  const s = report.summary;
  const counts = `${s.total} finding${s.total === 1 ? '' : 's'} (${s.high} high, ${s.medium} medium, ${s.low} low)`;
  const summary = `${s.total === 0 ? pc.green('No leaks found.') : counts} ${pc.dim(
    `— ${report.filesScanned} file${report.filesScanned === 1 ? '' : 's'} scanned in ${report.durationMs}ms`,
  )}`;
  if (lines.length > 0) lines.push('');
  lines.push(summary);
  return lines.join('\n');
}

export function formatJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}
