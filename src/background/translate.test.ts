import { describe, it, expect } from 'vitest';
import { parseGtx, chunks, needsTranslation, mostlyKorean } from './translate';

describe('translate helpers', () => {
  it('parses a gtx response', () => {
    const json = [[['안녕\n', 'Hello\n', null, null, 10], ['세상', 'World', null, null, 10]], null, 'en'];
    expect(parseGtx(json)).toEqual({ lang: 'en', text: '안녕\n세상' });
    expect(parseGtx({})).toBeNull();
  });
  it('chunks by size', () => {
    expect(chunks(['aaaa', 'bbbb', 'cc'], 10)).toEqual([[0, 1], [2]]);
    expect(chunks([], 10)).toEqual([]);
  });
  it('skips Korean and non-letter lines', () => {
    expect(needsTranslation('Call me when the lights go down')).toBe(true);
    expect(needsTranslation('불이 꺼지면 바로 갈게')).toBe(false);
    expect(needsTranslation('♪')).toBe(false);
    expect(needsTranslation('君の名前')).toBe(true);
  });
  it('leaves mostly-Korean songs alone', () => {
    expect(mostlyKorean(['말한 대로 왔고', '포기하지 말아 keep goin\'', 'yeah yeah'])).toBe(true);
    expect(mostlyKorean(['Call me', 'when the lights go down', '불이 꺼지면'])).toBe(false);
  });
});
