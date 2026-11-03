import { describe, it, expect } from 'vitest';
import { parseVideoTitle as p } from './title';

describe('parseVideoTitle', () => {
  it('splits and strips noise', () => {
    expect(p('Adele - Hello (Official Music Video)', 'AdeleVEVO')).toEqual({ artist: 'Adele', title: 'Hello' });
    expect(p('[MV] IU - Blueming', 'x')).toEqual({ artist: 'IU', title: 'Blueming' });
    expect(p('Dua Lipa – Levitating (Lyric Video) | Future Nostalgia', 'x')).toEqual({ artist: 'Dua Lipa', title: 'Levitating' });
    expect(p('Coldplay — Yellow (Official Audio)', 'x')).toEqual({ artist: 'Coldplay', title: 'Yellow' });
    expect(p('NewJeans - Ditto M/V', 'x')).toEqual({ artist: 'NewJeans', title: 'Ditto' });
    expect(p('Artist - Song Official Music Video', 'x')).toEqual({ artist: 'Artist', title: 'Song' });
  });
  it('keeps feat.', () => {
    expect(p('Drake - Song (feat. Rihanna) (Official Video)', 'x')).toEqual({ artist: 'Drake', title: 'Song (feat. Rihanna)' });
  });
  it('korean', () => {
    expect(p('아이유 - 좋은 날', 'x')).toEqual({ artist: '아이유', title: '좋은 날' });
    expect(p('[MV] 아이유(IU) _ 좋은 날(Good Day)', 'x')).toEqual({ artist: '아이유', title: '좋은 날(Good Day)' });
  });
  it('falls back to channel', () => {
    expect(p('Hello', 'Adele - Topic')).toEqual({ artist: 'Adele', title: 'Hello' });
    expect(p('Hello (Official Video)', 'Adele Official')).toEqual({ artist: 'Adele', title: 'Hello' });
  });
});

import { parseVideoTitle as pvt } from './title';
describe('k-pop quoted titles', () => {
  it.each([
    ["RESCENE (리센느) 'With' Official MV", 'RESCENE', 'With'],
    ["RESCENE(리센느) 'Glow Up' MV", 'RESCENE', 'Glow Up'],
    ['IVE 아이브 ‘I AM’ MV', 'IVE 아이브', 'I AM'],
    ["Jung Kook (정국) 'Seven (feat. Latto)' Official MV", 'Jung Kook', 'Seven (feat. Latto)'],
  ])('%s', (input, artist, title) => {
    expect(pvt(input, 'RESCENE')).toEqual({ artist, title });
  });
});

describe('lyrics suffixes', () => {
  it.each([
    ["BewhY (비와이) - 악수 [POP IS CRYIN']ㅣLyrics/가사", 'BewhY', '악수'],
    ['C JAMM - 신기루 (illusion) | 가사 | Lyrics', 'C JAMM', '신기루 (illusion)'],
  ])('%s', (input, artist, title) => {
    expect(pvt(input, 'x')).toEqual({ artist, title });
  });
});

describe('multi-artist dash titles', () => {
  it.each([
    ['C JAMM (씨잼) & BewhY (비와이) - puzzle |  Lyrics / 가사', 'C JAMM', 'puzzle'],
    ['Tiger JK, Paloalto, 우원재 - Love Peace Movement (호심술 REMIX) | [DF LIVE]', 'Tiger JK', 'Love Peace Movement (호심술 REMIX)'],
  ])('%s', (input, artist, title) => {
    expect(pvt(input, 'x')).toEqual({ artist, title });
  });
});

describe('apostrophes inside quoted titles', () => {
  it('keeps You’re inside the title', () => {
    expect(pvt("ILLIT (아일릿) '체포하겠어 (You’re Under Arrest)’ Official MV", 'ILLIT'))
      .toEqual({ artist: 'ILLIT', title: '체포하겠어 (You’re Under Arrest)' });
  });
});
