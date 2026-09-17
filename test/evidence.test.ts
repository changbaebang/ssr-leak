import { describe, expect, it } from 'vitest';
import { analyzeFixture } from './helpers.js';

const rows = (relative: string) =>
  analyzeFixture(relative, { all: true }).map((f) => [
    f.line,
    f.confidence,
    f.message.includes('reported for audit only'),
  ]);

describe('positive evidence downgrades a write to low', () => {
  it('a Set.add guarded by .has() in the same function is a dedupe set', () => {
    expect(rows('evidence/dedupe-set.ts')).toEqual([
      [6, 'low', true],
      [10, 'medium', false],
    ]);
    expect(analyzeFixture('evidence/dedupe-set.ts')[0]?.message).not.toContain('dedupe');
  });

  it('a Map.set whose value is not request data is an argument-keyed cache', () => {
    expect(rows('evidence/argument-keyed-cache.ts')).toEqual([
      [6, 'low', true],
      [11, 'medium', false],
      [15, 'high', false],
    ]);
    expect(analyzeFixture('evidence/argument-keyed-cache.ts', { all: true })[0]?.message).toContain(
      'memo cache',
    );
  });

  it('an entry deleted again in the same function does not outlive the call', () => {
    expect(rows('evidence/request-lifetime.ts')).toEqual([
      [7, 'low', false], // the .delete() itself is an untainted mutation (R5)
      [8, 'low', true],
      [14, 'medium', false],
    ]);
  });

  it('an unconditional browser-only dereference before the write proves the code cannot run on the server', () => {
    expect(rows('evidence/browser-deref.ts')).toEqual([
      [12, 'low', true],
      [16, 'medium', false],
      [24, 'medium', false],
      [29, 'medium', false],
      [34, 'medium', false],
      [41, 'medium', false],
      [46, 'low', true],
      [51, 'low', true],
    ]);
  });

  it('keeps evidence findings out of the default run', () => {
    expect(analyzeFixture('evidence/browser-deref.ts').map((f) => f.line)).toEqual([
      16, 24, 29, 34, 41,
    ]);
  });
});
