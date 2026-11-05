import { describe, it, expect } from 'vitest';
import { parseLyricsPlus, lyricSimilarity, SAME_LYRICS } from './wordsync';
import fixture from '../fixtures/wordsync/supernova.json';
import { wordChar } from '../content/motion';

describe('LyricsPlus word sync', () => {
  const lines = parseLyricsPlus(fixture as never)!;
  it('parses syllable timing with char offsets that point into the text', () => {
    expect(lines.length).toBeGreaterThan(50);
    const l = lines.find((x) => x.text.startsWith('문이 열려'))!;
    expect(l.time).toBeCloseTo(15.978);
    for (const w of l.words!) expect(l.text[w.c]).not.toBe(' ');
    expect(l.text.slice(l.words![1].c, l.words![2].c)).toBe('열려 ');
    expect(wordChar(l, 16.251 + 0.644 / 2)).toBeCloseTo(l.words![1].c + 1.5, 1);
  });
  it('appends background vocals after the main line', () => {
    expect(lines.some((l) => /\(Under my/.test(l.text))).toBe(true);
  });
  it('same lyrics vs different song', () => {
    const lrc = lines.map((l) => ({ time: l.time, text: l.text }));
    expect(lyricSimilarity(lines, lrc)).toBeGreaterThan(SAME_LYRICS);
    expect(lyricSimilarity(lines, [{ time: 1, text: 'Is this the real life, is this just fantasy' }])).toBeLessThan(SAME_LYRICS);
  });
  it('rejects line-only responses', () => {
    expect(parseLyricsPlus({ type: 'Line', lyrics: [] })).toBeNull();
  });
});

describe('LyricsPlus singers', () => {
  const ln = (t: number, text: string, singer: string) => ({ time: t, duration: 1000, text, syllabus: [{ time: t, duration: 1000, text }], element: { singer } });
  it('marks duet lines by singer', () => {
    const lines = parseLyricsPlus({ type: 'Word', lyrics: [ln(0, 'a', 'v1'), ln(2000, 'b', 'v2'), ln(4000, 'c', 'v1000'), ln(6000, 'd', 'v1')] })!;
    expect(lines.map((l) => l.singer)).toEqual([1, 2, 3, 1]);
  });
  it('drops singer marks when one singer sings everything (solo songs, groups)', () => {
    expect(lines(['v1', 'v1', 'v1']).every((l) => l.singer === undefined)).toBe(true);
    function lines(s: string[]) { return parseLyricsPlus({ type: 'Word', lyrics: s.map((x, i) => ln(i * 1000, `l${i}`, x)) })!; }
  });
  it('the aespa fixture is all v1, so it has no colours', () => {
    expect(parseLyricsPlus(fixture as never)!.some((l) => l.singer)).toBe(false);
  });
  it('uses the agent type: a group agent is "together", whatever its id', () => {
    const lines = parseLyricsPlus({ type: 'Word', metadata: { agents: { v1: { type: 'person' }, v2: { type: 'person' }, v3: { type: 'group' } } },
      lyrics: [ln(0, 'a', 'v1'), ln(2000, 'b', 'v2'), ln(4000, 'c', 'v3')] })!;
    expect(lines.map((l) => l.singer)).toEqual([1, 2, 3]);
  });
});
