import { describe, expect, it } from 'vitest';
import { createMatcher, globToRegExp } from '../src/glob.js';

describe('globToRegExp', () => {
  it.each([
    ['**/*.ts', 'a.ts', true],
    ['**/*.ts', 'a/b/c.ts', true],
    ['**/*.ts', 'a/b/c.tsx', false],
    ['**/*.{ts,tsx}', 'a/b/c.tsx', true],
    ['src/**/*.js', 'src/x.js', true],
    ['src/**/*.js', 'lib/x.js', false],
    ['apps/*/src', 'apps/web/src', true],
    ['apps/*/src', 'apps/web/src/x.ts', false],
    ['a?c.ts', 'abc.ts', true],
    ['a?c.ts', 'a/c.ts', false],
    ['generated/**', 'generated/deep/x.ts', true],
    ['./src/*.ts', 'src/a.ts', true],
    ['file.test.ts', 'file.test.ts', true],
    ['file.test.ts', 'fileXtestXts', false],
  ])('%s vs %s -> %s', (glob, input, expected) => {
    expect(globToRegExp(glob).test(input)).toBe(expected);
  });
});

describe('createMatcher', () => {
  it('matches a directory glob against descendants', () => {
    const m = createMatcher('apps/*/src');
    expect(m('apps/web/src/pages/index.tsx')).toBe(true);
    expect(m('apps/web/lib/x.ts')).toBe(false);
  });
});
