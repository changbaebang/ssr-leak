import ts from 'typescript';

const DISABLE = /ssr-leak-disable\b/;
const IGNORE_NEXT_LINE = /ssr-leak-ignore-next-line\b(.*)$/m;

function directiveCount(sf: ts.SourceFile): number {
  let n = 0;
  for (const s of sf.statements) {
    if (ts.isExpressionStatement(s) && ts.isStringLiteralLike(s.expression)) n++;
    else break;
  }
  return n;
}

/** `/* ssr-leak-disable *\/` (or `//`) anywhere before the first non-directive statement. */
export function hasFileDisable(sf: ts.SourceFile): boolean {
  const first = sf.statements[directiveCount(sf)];
  const end = first ? first.getStart(sf) : sf.text.length;
  const head = sf.text.slice(0, end);
  if (!DISABLE.test(head)) return false;
  // Only honor the marker when it appears inside a comment.
  const ranges = [
    ...(ts.getLeadingCommentRanges(sf.text, 0) ?? []),
    ...(first ? (ts.getLeadingCommentRanges(sf.text, first.getFullStart()) ?? []) : []),
  ];
  const directives = sf.statements.slice(0, directiveCount(sf));
  for (const d of directives) {
    ranges.push(...(ts.getTrailingCommentRanges(sf.text, d.end) ?? []));
    ranges.push(...(ts.getLeadingCommentRanges(sf.text, d.getFullStart()) ?? []));
  }
  return ranges.some((r) => DISABLE.test(sf.text.slice(r.pos, r.end)));
}

/** First statement is a `'use client'` directive. */
export function isClientFile(sf: ts.SourceFile): boolean {
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteralLike(s.expression)) break;
    if (s.expression.text === 'use client') return true;
  }
  return false;
}

/**
 * Parses the rule list of an ignore comment. Everything after ` -- ` is a free-form reason and is
 * ignored; a trailing `*\/` is dropped. Returns an empty list for "every rule".
 */
export function parseIgnoreRules(tail: string): string[] {
  let text = tail;
  const dash = text.indexOf('--');
  if (dash !== -1) text = text.slice(0, dash);
  text = text.replace(/\*\/.*$/, '');
  return text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(s));
}

/**
 * `// ssr-leak-ignore-next-line` on the previous line suppresses every rule;
 * `// ssr-leak-ignore-next-line R1, module-state-write-tainted` suppresses only the listed ones.
 * A reason may follow ` -- ` and is ignored: `// ssr-leak-ignore-next-line R4 -- browser only`.
 */
export function isSuppressed(
  sf: ts.SourceFile,
  zeroBasedLine: number,
  ruleId: string,
  ruleName: string,
): boolean {
  if (zeroBasedLine === 0) return false;
  const starts = sf.getLineStarts();
  const from = starts[zeroBasedLine - 1];
  const to = starts[zeroBasedLine];
  if (from === undefined || to === undefined) return false;
  const prev = sf.text.slice(from, to);
  const m = IGNORE_NEXT_LINE.exec(prev);
  if (!m) return false;
  const list = parseIgnoreRules(m[1] ?? '');
  if (list.length === 0) return true;
  return list.includes(ruleId) || list.includes(ruleName);
}
