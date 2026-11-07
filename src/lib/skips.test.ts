import { describe, it, expect } from 'vitest';
import { compress, expand, parseSkips, skipAt, totalSkipped, within } from './skips';

const seg = (a: number, b: number, extra: object = {}) => ({ category: 'music_offtopic', actionType: 'skip', segment: [a, b], votes: 1, ...extra });

describe('music_offtopic skips', () => {
  it('parses, sorts and merges segments, dropping other cuts and tiny ones', () => {
    expect(parseSkips([seg(60, 70), seg(0, 4), seg(65, 80), seg(100, 100.2), seg(5, 9, { videoDuration: 300 })], 252)).toEqual([
      { start: 0, end: 4 }, { start: 60, end: 80 },
    ]);
    expect(parseSkips('Not Found')).toEqual([]);
    expect(parseSkips([seg(1, 5, { votes: -2 }), { category: 'sponsor', segment: [1, 9] }])).toEqual([]);
  });

  it('freezes song time inside a skip and maps back after it', () => {
    const s = [{ start: 0, end: 4 }, { start: 60, end: 70 }];
    expect(compress(s, 2)).toBe(0);
    expect(compress(s, 10)).toBe(6);
    expect(compress(s, 65)).toBe(56);
    expect(compress(s, 80)).toBe(66);
    expect(expand(s, 6)).toBe(10);
    expect(expand(s, 56)).toBe(70); // the line right after the skit plays when the skit ends
    expect(expand(s, 66)).toBe(80);
    for (const t of [5, 30, 59, 71, 120]) expect(expand(s, compress(s, t))).toBeCloseTo(t);
    expect(skipAt(s, 61)?.start).toBe(60);
    expect(skipAt(s, 70)).toBeNull();
    expect(totalSkipped(s)).toBe(14);
  });

  it('clips skips to a chapter and makes them chapter-relative', () => {
    expect(within([{ start: 0, end: 4 }, { start: 98, end: 110 }, { start: 300, end: 310 }], 100, 200)).toEqual([{ start: 0, end: 10 }]);
  });
});
