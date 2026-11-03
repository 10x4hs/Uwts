import { describe, it, expect } from 'vitest';
import { parseChapters, chapterAt } from './chapters';

describe('parseChapters', () => {
  it('parses variants', () => {
    const d = 'Tracklist:\n0:00 - Intro\n1. 3:15 | Song A\n1:02:03 Song B\nOutro 1:10:00\nnot a line';
    expect(parseChapters(d)).toEqual([
      { start: 0, title: 'Intro' }, { start: 195, title: 'Song A' },
      { start: 3723, title: 'Song B' }, { start: 4200, title: 'Outro' },
    ]);
  });
  it('requires >=2 and start at 0', () => {
    expect(parseChapters('0:00 A')).toEqual([]);
    expect(parseChapters('0:10 A\n1:00 B')).toEqual([]);
  });
  it('chapterAt', () => {
    const c = [{ start: 0, title: 'A' }, { start: 60, title: 'B' }];
    expect(chapterAt(c, 30)).toEqual({ chapter: c[0], index: 0, end: 60 });
    expect(chapterAt(c, 90)).toEqual({ chapter: c[1], index: 1, end: null });
    expect(chapterAt(c, -1)).toBeNull();
    expect(chapterAt([], 5)).toBeNull();
  });
});
