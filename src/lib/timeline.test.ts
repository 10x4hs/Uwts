import { describe, expect, it } from 'vitest';
import { parseTimeline, songChapters, timelineParams } from './timeline';

import fixture from '../fixtures/xmas/timeline-panel.json' with { type: 'json' };

describe('timeline', () => {
  it('encodes get_panel params', () => {
    expect(timelineParams('nJ_gCRLsLJc')).toBe('qgkNCgtuSl9nQ1JMc0xKYw==');
  });

  it('parses song cards from the fixture', () => {
    const { songs } = parseTimeline(fixture);
    expect(songs.map((s) => [s.title, s.start])).toEqual([
      ["It's Beginning To Look A Lot Like Christmas", 0],
      ['Winter Wonderland', 181],
      ["I'll Be Home for Christmas", 335],
      ['Christmas Dreaming', 609],
      ['Have Yourself A Merry Little Christmas', 759],
      ['Holly Jolly Christmas', 970],
      ['The Christmas Waltz', 1126],
      ['Santa Claus Is Coming to Town', 1295],
      ['The Christmas Song', 1468],
      ['White Christmas', 1616],
    ]);
    expect(songs[9].artist).toBe('Matthew Ifield');
    expect(songs[9].album).toBe('A Christmas Album');
  });

  it('parses the transcript sorted', () => {
    const { transcript } = parseTimeline(fixture);
    expect(transcript.length).toBeGreaterThan(200);
    expect(transcript[0]).toEqual({ time: 0, text: '[Music]' });
    for (let i = 1; i < transcript.length; i++) expect(transcript[i].time).toBeGreaterThanOrEqual(transcript[i - 1].time);
  });

  it('returns empty for garbage', () => {
    for (const g of [null, {}, { error: {} }, 'x', [1, [null]]]) expect(parseTimeline(g)).toEqual({ songs: [], transcript: [] });
  });

  it('caps the last chapter', () => {
    const t = parseTimeline(fixture);
    const ch = songChapters(t);
    expect(ch).toHaveLength(10);
    expect(ch[0].end).toBe(181);
    expect(ch[9].end).toBe(1616 + 360);
    expect(songChapters(t, 1700)[9].end).toBe(1700);
    expect(songChapters(t, 1620)).toHaveLength(9); // 4 s chapter dropped
  });
});
