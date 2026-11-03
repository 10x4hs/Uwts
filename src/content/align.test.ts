import { describe, it, expect } from 'vitest';
import { countUnits, segments, unitsToChar, priorOffset, estimateOffset, isIntro, FillTracker, smoothOffset, formatOffset, type Onset } from './align';

describe('syllable units', () => {
  it('counts Hangul syllables as 1 each, ignores spaces/punctuation', () => {
    expect(countUnits('셋 셀테니')).toBe(4);
    expect(countUnits('(1, 2, 3!)')).toBe(3);
  });
  it('counts Latin words as ceil(letters/3)', () => {
    expect(countUnits('I love you')).toBe(1 + 2 + 1);
    expect(countUnits('everybody')).toBe(3);
  });
  it('maps units to char offsets word by word', () => {
    const segs = segments('ab 가나');
    expect(unitsToChar(segs, 0)).toBe(0);
    expect(unitsToChar(segs, 1)).toBe(3); // after "ab" → start of 가
    expect(unitsToChar(segs, 2)).toBe(4);
    expect(unitsToChar(segs, 3)).toBe(5);
  });
});

function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const lines = (() => { const r = rng(42); let t = 5; return Array.from({ length: 40 }, () => ({ time: (t += 1.8 + r() * 2.6), text: 'x' })); })();

describe('offset estimation', () => {
  it('recovers a 12.3s offset from noisy synthetic onsets', () => {
    const r = rng(7);
    const onsets: Onset[] = [];
    for (const l of lines) onsets.push({ t: l.time + 12.3 + (r() - 0.5) * 0.15, s: 0.8 + r() * 0.2 });
    for (let t = 0; t < 150; t += 0.4 + r() * 0.6) onsets.push({ t, s: r() * 0.4 }); // background beats
    const e = estimateOffset(onsets, lines, 0);
    expect(e.confident).toBe(true);
    expect(Math.abs(e.offset - 12.3)).toBeLessThanOrEqual(0.2);
  });
  it('keeps the prior when onsets are uniform (ambiguous)', () => {
    const onsets: Onset[] = [];
    for (let t = 0; t < 150; t += 0.25) onsets.push({ t, s: 0.5 });
    const e = estimateOffset(onsets, lines, 7);
    expect(e.confident).toBe(false);
    expect(e.offset).toBe(7);
  });
  it('prior from duration mismatch', () => {
    const ls = [{ time: 10, text: 'a' }, { time: 180, text: 'b' }];
    expect(priorOffset(230, ls)).toBe(46);
    expect(priorOffset(185, ls)).toBe(0);
    expect(priorOffset(500, ls)).toBe(90);
    expect(priorOffset(undefined, ls)).toBe(0);
  });
  it('smooths small changes and jumps on large ones', () => {
    expect(smoothOffset(10, 10.1)).toBe(10);
    expect(smoothOffset(10, 11)).toBe(10.5);
    expect(smoothOffset(0, 12.3)).toBe(12.3);
    expect(formatOffset(12.3)).toBe('+12.3s');
  });
});

describe('intro state', () => {
  const ls = [{ time: 20, text: 'a' }, { time: 25, text: 'b' }];
  it('is intro well before the first line only', () => {
    expect(isIntro(ls, 0)).toBe(true);
    expect(isIntro(ls, 19.6)).toBe(true);
    expect(isIntro(ls, 19.8)).toBe(false);
    expect(isIntro(ls, 30)).toBe(false);
    expect(isIntro([], 0)).toBe(false);
  });
});

describe('FillTracker', () => {
  it('is monotonic and complete by the next line under any activity', () => {
    const r = rng(3);
    const f = new FillTracker(12, 10, 14);
    let prev = 0;
    for (let t = 10; t <= 14.0001; t += 0.02) {
      const p = f.step(t, 0.02, r());
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(12);
      prev = p;
    }
    expect(f.step(14, 0.02, 0)).toBe(12);
  });
  it('does not advance early while silent', () => {
    const f = new FillTracker(10, 0, 4);
    for (let t = 0; t < 1; t += 0.02) f.step(t, 0.02, 0);
    expect(f.p).toBe(0);
  });
  it('advances faster with stronger voice', () => {
    const a = new FillTracker(10, 0, 4), b = new FillTracker(10, 0, 4);
    for (let t = 0; t < 1; t += 0.02) { a.step(t, 0.02, 0.3); b.step(t, 0.02, 1); }
    expect(b.p).toBeGreaterThan(a.p);
  });
});
