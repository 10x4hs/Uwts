import { describe, it, expect } from 'vitest';
import { parseChapters, chapterAt, songListChapters, capLastChapter } from './chapters';

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
  it('chapterAt honors explicit ends (gaps between known songs)', () => {
    const c = [{ start: 0, title: 'A', end: 50 }, { start: 60, title: 'B', end: 200 }];
    expect(chapterAt(c, 55)).toBeNull();
    expect(chapterAt(c, 100)).toEqual({ chapter: c[1], index: 1, end: 200 });
    expect(chapterAt(c, 250)).toBeNull();
  });
});

describe('songListChapters', () => {
  const parts = [{ start: 0, title: '타임라인 : NSW yoon' }, { start: 41, title: '타임라인 : BIG naughty (서동현)' }, { start: 70, title: '타임라인 : NSW yoon' }, { start: 110, title: '타임라인 : Xwally' }, { start: 150, title: '타임라인 : NSW yoon' }];
  it('drops parts of one song', () => {
    expect(songListChapters(parts, 210)).toEqual([]);
    expect(songListChapters(parts)).toEqual([]);
  });
  it('keeps a real playlist', () => {
    const songs = [{ start: 0, title: 'A - a' }, { start: 200, title: 'B - b' }, { start: 430, title: 'C - c' }];
    expect(songListChapters(songs, 3600)).toEqual(songs);
  });
  it('keeps a medley that sings one verse per song (Killing Verse)', () => {
    const kv = [[0, '맛좋은산'], [92, 'Rap Circus'], [153, 'Rap Genius'], [220, 'Do It For Fun'], [290, '아는사람 얘기'], [373, '한여름밤의 꿀'], [485, '발라드랩'], [633, '우리다시잘할수있을까']]
      .map(([start, title]) => ({ start: start as number, title: title as string }));
    expect(songListChapters(kv, 835)).toEqual(kv);
  });
  it('drops repeated names and verse/hook labels in a long video', () => {
    const turns = [{ start: 0, title: 'A' }, { start: 100, title: 'B' }, { start: 200, title: 'A' }, { start: 300, title: 'C' }];
    expect(songListChapters(turns, 900)).toEqual([]);
    const sections = [{ start: 0, title: 'Intro' }, { start: 100, title: 'Verse 1' }, { start: 200, title: 'Hook' }, { start: 300, title: 'Verse 2' }];
    expect(songListChapters(sections, 900)).toEqual([]);
  });
});

describe('loop videos', () => {
  it('drops a repeated timestamp from the title', () => {
    expect(parseChapters('00:00 00:00  Messy Heart\n03:41 03:41  Overflow Heart Mode')).toEqual([
      { start: 0, title: 'Messy Heart' }, { start: 221, title: 'Overflow Heart Mode' },
    ]);
  });
  it('ends the last song of a short list in a much longer video', () => {
    const c = [{ start: 0, title: 'a' }, { start: 200, title: 'b' }, { start: 400, title: 'c' }];
    expect(capLastChapter(c, 39447)[2]).toEqual({ start: 400, title: 'c', end: 720 });
    expect(capLastChapter(c, 600)).toBe(c);
  });
});
