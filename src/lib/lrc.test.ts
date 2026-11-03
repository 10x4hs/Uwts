import { describe, it, expect } from 'vitest';
import { parseLrc, lineIndexAt } from './lrc';

describe('parseLrc', () => {
  it('parses formats, multi tags, metadata, empty', () => {
    const l = parseLrc('[ar:X]\n[ti:Y]\n[00:01]a\n[00:02.50]b\n[00:03.250] c\n[00:10.00][00:05.00]chorus\n[00:06.00]');
    expect(l).toEqual([
      { time: 1, text: 'a' }, { time: 2.5, text: 'b' }, { time: 3.25, text: 'c' },
      { time: 5, text: 'chorus' }, { time: 6, text: '' }, { time: 10, text: 'chorus' },
    ]);
  });
  it('lineIndexAt', () => {
    const l = parseLrc('[00:01]a\n[00:02]b\n[00:03]c');
    expect(lineIndexAt(l, 0.5)).toBe(-1);
    expect(lineIndexAt(l, 1)).toBe(0);
    expect(lineIndexAt(l, 2.9)).toBe(1);
    expect(lineIndexAt(l, 99)).toBe(2);
    expect(lineIndexAt([], 1)).toBe(-1);
  });
});
