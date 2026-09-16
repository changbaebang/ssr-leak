import fs from 'node:fs';
import path from 'node:path';
import { createMatcher, hasMagic, normalizeGlob } from './glob.js';

export const SUPPORTED_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

export const DEFAULT_PATTERN = '**/*.{ts,tsx,js,jsx,mjs,cjs}';

/**
 * Directory basenames skipped wherever they appear: package installs, build outputs, static
 * assets, caches, VCS metadata and mock handlers (MSW `mocks/`, Jest `__mocks__/`). Override with the `exclude` config key; re-include single paths
 * with `include`.
 */
export const DEFAULT_EXCLUDED_DIRS: readonly string[] = [
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
  'mocks',
  '__mocks__',
];

export const EXCLUDED_DIRS: ReadonlySet<string> = new Set(DEFAULT_EXCLUDED_DIRS);

/** A source line longer than this marks the file as minified and it is skipped. */
export const MAX_LINE_LENGTH = 2000;

const TEST_FILE = /(^|[\\/])__tests__[\\/]|\.(test|spec|stories|mock)\.[cm]?[jt]sx?$/;
const MINIFIED_NAME = /\.min\.[cm]?js$/;

export function isSupportedFile(file: string): boolean {
  if (file.endsWith('.d.ts')) return false;
  return SUPPORTED_EXTENSIONS.includes(path.extname(file));
}

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file);
}

/** `*.min.js` / `*.min.mjs` / `*.min.cjs`. */
export function isMinifiedName(file: string): boolean {
  return MINIFIED_NAME.test(file);
}

/** True when any line is longer than `MAX_LINE_LENGTH` characters. */
export function isMinifiedSource(code: string): boolean {
  let start = 0;
  for (;;) {
    const nl = code.indexOf('\n', start);
    const end = nl === -1 ? code.length : nl;
    if (end - start > MAX_LINE_LENGTH) return true;
    if (nl === -1) return false;
    start = nl + 1;
  }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export interface CollectOptions {
  /** Globs (relative to root) of files to skip. */
  ignore?: string[];
  /** Directory basenames to skip. Defaults to `DEFAULT_EXCLUDED_DIRS`. */
  exclude?: string[];
  /** Globs (relative to root) analyzed even under excluded directories, when named like a test/story/mock file, or when minified. */
  include?: string[];
}

export interface CollectResult {
  /** Sorted absolute paths. */
  files: string[];
  /**
   * Files that must be analyzed even if they look minified: explicitly named files and files
   * matching an `include` glob.
   */
  forced: Set<string>;
  /** Patterns (as given) whose base path does not exist. */
  missing: string[];
}

/** Can a file matching `glob` live under directory `dirRel` (both relative to root)? */
function globMayMatchUnder(glob: string, dirRel: string): boolean {
  const segments = glob.split('/');
  const dirSegments = dirRel.split('/');
  for (let i = 0; i < dirSegments.length; i++) {
    const s = segments[i];
    if (s === undefined) return false;
    if (hasMagic(s)) return true;
    if (s !== dirSegments[i]) return false;
  }
  return true;
}

/**
 * Resolves patterns (globs, directories or files) to absolute file paths.
 * Test files, declaration files and excluded directories are skipped during directory walks;
 * a file named explicitly is always returned (when it exists and has a supported extension).
 */
export function collectFilesDetailed(
  root: string,
  patterns: string[],
  options: CollectOptions = {},
): CollectResult {
  const ignoreMatchers = (options.ignore ?? []).map(createMatcher);
  const includeGlobs = (options.include ?? []).map(normalizeGlob);
  const includeMatchers = includeGlobs.map(createMatcher);
  const excluded = new Set(options.exclude ?? DEFAULT_EXCLUDED_DIRS);

  const relOf = (abs: string): string => toPosix(path.relative(root, abs));
  const isIgnored = (abs: string): boolean => {
    if (ignoreMatchers.length === 0) return false;
    const rel = relOf(abs);
    return ignoreMatchers.some((m) => m(rel));
  };
  const isIncluded = (abs: string): boolean => {
    if (includeMatchers.length === 0) return false;
    const rel = relOf(abs);
    return includeMatchers.some((m) => m(rel));
  };

  const files = new Set<string>();
  const forced = new Set<string>();
  const missing: string[] = [];

  const walk = (
    dir: string,
    rel: string,
    insideExcluded: boolean,
    matches: (rel: string) => boolean,
  ): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        let childExcluded = insideExcluded;
        if (excluded.has(entry.name)) {
          const dirRel = relOf(abs);
          if (!includeGlobs.some((g) => globMayMatchUnder(g, dirRel))) continue;
          childExcluded = true;
        }
        walk(abs, childRel, childExcluded, matches);
      } else if (entry.isFile()) {
        if (!isSupportedFile(abs)) continue;
        if (!matches(childRel) || isIgnored(abs)) continue;
        // `include` wins over every default skip: excluded directories, test/story/mock names, minified names.
        const included = isIncluded(abs);
        if (!included && (isTestFile(abs) || insideExcluded || isMinifiedName(abs))) continue;
        files.add(abs);
        if (included) forced.add(abs);
      }
    }
  };

  for (const pattern of patterns) {
    const norm = normalizeGlob(pattern);
    const abs = path.isAbsolute(norm) ? path.normalize(norm) : path.resolve(root, norm);
    const segments = toPosix(abs).split('/');
    let firstMagic = segments.findIndex(hasMagic);
    if (firstMagic === -1) firstMagic = segments.length;
    const base = segments.slice(0, firstMagic).join('/') || '/';
    const rest = segments.slice(firstMagic).join('/');

    let stat: fs.Stats;
    try {
      stat = fs.statSync(base);
    } catch {
      missing.push(pattern);
      continue;
    }
    if (stat.isFile()) {
      if (rest === '' && isSupportedFile(base) && !isIgnored(base)) {
        files.add(base);
        forced.add(base);
      }
      continue;
    }
    if (!stat.isDirectory()) continue;

    const matches = rest === '' ? () => true : createMatcher(rest);
    walk(base, '', false, matches);
  }

  return { files: [...files].sort(), forced, missing };
}

/**
 * Resolves patterns (globs, directories or files) to a sorted list of absolute file paths.
 * The third argument may be a list of ignore globs (legacy) or `CollectOptions`.
 */
export function collectFiles(
  root: string,
  patterns: string[],
  options: CollectOptions | string[] = {},
): string[] {
  const opts: CollectOptions = Array.isArray(options) ? { ignore: options } : options;
  return collectFilesDetailed(root, patterns, opts).files;
}
