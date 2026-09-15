const MAGIC = /[*?{[]/;

export function hasMagic(segment: string): boolean {
  return MAGIC.test(segment);
}

export function normalizeGlob(glob: string): string {
  let g = glob.replace(/\\/g, '/');
  while (g.startsWith('./')) g = g.slice(2);
  while (g.length > 1 && g.endsWith('/')) g = g.slice(0, -1);
  return g;
}

function escapeChar(c: string): string {
  return /[.+^$()|\\/]/.test(c) ? `\\${c}` : c;
}

function findClosingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of s) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

export function globToRegExpSource(glob: string): string {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        let j = i + 2;
        while (glob[j] === '*') j++;
        if (glob[j] === '/') {
          out += '(?:.*/)?';
          i = j + 1;
        } else {
          out += '.*';
          i = j;
        }
        continue;
      }
      out += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i++;
      continue;
    }
    if (c === '{') {
      const end = findClosingBrace(glob, i);
      if (end !== -1) {
        const alts = splitTopLevel(glob.slice(i + 1, end)).map(globToRegExpSource);
        out += `(?:${alts.join('|')})`;
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const end = glob.indexOf(']', i);
      if (end !== -1) {
        out += glob.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    out += escapeChar(c);
    i++;
  }
  return out;
}

export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${globToRegExpSource(normalizeGlob(glob))}$`);
}

export type GlobMatcher = (relativePath: string) => boolean;

/** Matches a file path either exactly, or as a descendant when the glob names a directory. */
export function createMatcher(glob: string): GlobMatcher {
  const g = normalizeGlob(glob);
  const exact = globToRegExp(g);
  const descendant = globToRegExp(`${g}/**`);
  return (rel) => exact.test(rel) || descendant.test(rel);
}
