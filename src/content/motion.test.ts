import { describe, it, expect } from 'vitest';
import { blurLevel, staggerDelay, scrollOffset, fillTiming, fillProgress, isSeek, titlesMatch, shouldAutoRetry, NavToken } from './motion';

const lines = [{ time: 10, text: 'a' }, { time: 13, text: 'b' }, { time: 30, text: 'c' }];

describe('blurLevel', () => {
  it('is 0 for the active line and grows with distance up to 5', () => {
    expect(blurLevel(3, 3)).toBe(0);
    expect(blurLevel(4, 3)).toBe(2);
    expect(blurLevel(2, 3)).toBe(2);
    expect(blurLevel(20, 3)).toBe(5);
  });
  it('is 0 while manually scrolling', () => expect(blurLevel(10, 3, true)).toBe(0));
});

describe('staggerDelay', () => {
  it('staggers lines from the active one by 0.05s', () => {
    expect(staggerDelay(3, 3, false)).toBe(0.05);
    expect(staggerDelay(5, 3, false)).toBe(0.15);
    expect(staggerDelay(1, 3, false)).toBe(0);
    expect(staggerDelay(100, 3, false)).toBe(0.4);
  });
  it('no stagger on seek', () => expect(staggerDelay(5, 3, true)).toBe(0));
});

describe('scrollOffset', () => {
  it('anchors line top at 35% of container', () => {
    expect(scrollOffset(0, 400)).toBe(140);
    expect(scrollOffset(500, 400)).toBe(-360);
  });
});

describe('fillTiming / fillProgress', () => {
  it('duration is gap to next line, negative delay mid-line', () => {
    expect(fillTiming(lines, 0, 10)).toEqual({ duration: 3, delay: -0 });
    expect(fillTiming(lines, 0, 11.5)).toEqual({ duration: 3, delay: -1.5 });
  });
  it('caps at 6s and for last line', () => {
    expect(fillTiming(lines, 1, 13)?.duration).toBe(6);
    expect(fillTiming(lines, 2, 31)).toEqual({ duration: 6, delay: -1 });
  });
  it('scales by playbackRate', () => expect(fillTiming(lines, 0, 11, 2)).toEqual({ duration: 1.5, delay: -0.5 }));
  it('null for missing/plain line', () => {
    expect(fillTiming(lines, 5, 0)).toBeNull();
    expect(fillTiming([{ time: -1, text: 'p' }], 0, 0)).toBeNull();
  });
  it('progress clamps to [0,1]', () => {
    expect(fillProgress(lines, 0, 11.5)).toBe(0.5);
    expect(fillProgress(lines, 0, 99)).toBe(1);
  });
});

describe('misc', () => {
  it('isSeek detects non-sequential jumps', () => {
    expect(isSeek(2, 3)).toBe(false);
    expect(isSeek(2, 7)).toBe(true);
    expect(isSeek(5, 4)).toBe(true);
    expect(isSeek(-1, 0)).toBe(false);
  });
  it('titlesMatch normalizes whitespace/case', () => {
    expect(titlesMatch(' BewhY  악수 ', 'bewhy 악수')).toBe(true);
    expect(titlesMatch('Sweet Escape', 'BewhY 악수')).toBe(false);
    expect(titlesMatch('', '')).toBe(false);
  });
  it('auto-retries only after the first failure', () => {
    expect(shouldAutoRetry(1)).toBe(true);
    expect(shouldAutoRetry(2)).toBe(false);
  });
  it('NavToken drops stale tokens', () => {
    const n = new NavToken();
    const a = n.next();
    expect(n.isCurrent(a)).toBe(true);
    n.next();
    expect(n.isCurrent(a)).toBe(false);
  });
});
