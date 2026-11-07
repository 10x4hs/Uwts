import { describe, it, expect } from 'vitest';
import { scoreCandidate, durationScore, rank, splitArtists, normText, HIGH_SCORE, MIN_SCORE } from './score';

const v = (videoTitle: string, channel = '', duration?: number) => ({ videoTitle, channel, duration });

describe('normText', () => {
  it('handles jamo separator, quotes, case', () => {
    expect(normText('puzzleㅣ Lyrics')).toBe('puzzle lyrics');
    expect(normText('You’re')).toBe('youre');
  });
});

describe('durationScore', () => {
  it('tolerates MV intros/outros', () => {
    expect(durationScore(200, 290)).toBe(1);
    expect(durationScore(200, 202)).toBe(1);
    expect(durationScore(230, 200)).toBe(0);
    expect(durationScore(100, 400)).toBeLessThan(0.5);
    expect(durationScore(undefined, 200)).toBe(0.5);
  });
});

describe('splitArtists', () => {
  it('splits feat lists and aliases', () => {
    expect(splitArtists('Seungri (승리)')).toEqual(['seungri', '승리']);
    expect(splitArtists('GroovyRoom, pH-1 feat. HAON')).toEqual(['groovyroom', 'ph 1', 'haon']);
  });
});

describe('scoreCandidate', () => {
  it('prefers the original over a Chinese DJ edit of the same song', () => {
    const ctx = { videoTitle: '[playlist] 위켄드는 전설이다 The Weeknd Playlist', channel: 'x', chapterTitle: 'The Weeknd - Starboy', duration: 230 };
    const orig = scoreCandidate({ artist: 'The Weeknd, Daft Punk', title: 'Starboy', duration: 230, synced: true }, ctx);
    const dj = scoreCandidate({ artist: 'The Weeknd, Daft Punk', title: 'Starboy (DJ小瑞、DJ小姚版)', duration: 230, synced: true }, ctx);
    expect(orig).toBeGreaterThan(dj);
  });
  const fasho = v('GroovyRoom - FASHO (Feat. pH-1, HAON) [Official Video]', 'GroovyRoom', 430);
  it('high score for title + artist + duration', () => {
    expect(scoreCandidate({ artist: 'GroovyRoom, pH-1', title: 'FASHO', duration: 424, synced: true }, fasho)).toBeGreaterThanOrEqual(HIGH_SCORE);
  });
  it('same title, wrong artist is not high-confidence', () => {
    expect(scoreCandidate({ artist: 'Someone Else', title: 'FASHO', duration: 180, synced: true }, fasho)).toBeLessThan(HIGH_SCORE);
  });
  it('rejects wrong title', () => {
    expect(scoreCandidate({ artist: 'GroovyRoom', title: 'Sunday', synced: true }, fasho)).toBe(0);
  });
  it('matches Hangul title ignoring spacing and parens', () => {
    const s = v("SEUNGRI - '셋 셀테니 (1, 2, 3!)' M/V", 'BIGBANG', 210);
    expect(scoreCandidate({ artist: 'Seungri (승리)', title: '셋셀테니(1, 2, 3!)', duration: 204, synced: true }, s)).toBeGreaterThanOrEqual(HIGH_SCORE);
  });
  it('Latin titles match on word boundaries only', () => {
    expect(scoreCandidate({ artist: 'X', title: 'On', synced: true }, v('Artist - Official Song'))).toBe(0);
  });
  it('penalizes remixes the video does not mention', () => {
    const s = v("NewJeans (뉴진스) 'Super Shy' Official MV", 'HYBE LABELS', 200);
    const orig = scoreCandidate({ artist: 'NewJeans', title: 'Super Shy', duration: 154, synced: true }, s);
    const remix = scoreCandidate({ artist: 'NewJeans', title: 'Super Shy (KyoU Remix)', duration: 154, synced: true }, s);
    expect(orig).toBeGreaterThan(remix);
  });
  it('prefers synced over plain', () => {
    const s = v("RESCENE (리센느) 'With' Official MV", 'RESCENE');
    expect(scoreCandidate({ artist: 'RESCENE', title: 'With', synced: true }, s)).toBeGreaterThan(scoreCandidate({ artist: 'RESCENE', title: 'With', synced: false }, s));
  });
  it('uses chapter title instead of video title', () => {
    const s = { videoTitle: 'IU live medley', channel: 'IU', chapterTitle: '좋은 날', duration: 230 };
    expect(scoreCandidate({ artist: 'IU', title: '좋은 날', duration: 230, synced: true }, s)).toBeGreaterThanOrEqual(HIGH_SCORE);
    expect(scoreCandidate({ artist: 'IU', title: 'medley', synced: true }, s)).toBe(0);
  });
});

describe('rank', () => {
  it('sorts and drops below threshold', () => {
    const s = v('Ed Sheeran - Shape of You (Official Music Video)', 'Ed Sheeran', 263);
    const r = rank([
      { artist: 'Cover Band', title: 'Shape of You', duration: 240, synced: true },
      { artist: 'Ed Sheeran', title: 'Shape of You', duration: 234, synced: true },
      { artist: 'Ed Sheeran', title: 'Perfect', duration: 263, synced: true },
    ], s);
    expect(r[0].item.artist).toBe('Ed Sheeran');
    expect(r.every((x) => x.score >= MIN_SCORE)).toBe(true);
    expect(r.find((x) => x.item.title === 'Perfect')).toBeUndefined();
  });
});

import { scriptMismatch } from './score';
describe('scriptMismatch', () => {
  const ja = '細胞が求めてるよと 言っても分かんないかな? 高嶺の花 されど挑むオレの理想は高い 今さら気づいた 結局誰もが動物って';
  it('rejects Japanese lyrics for a Korean-titled MV', () => {
    expect(scriptMismatch(ja, "SEUNGRI - '셋 셀테니 (1, 2, 3!)' M/V")).toBe(true);
  });
  it('keeps Korean lyrics with English lines', () => {
    expect(scriptMismatch('넌 말해줘도 모를 거야 One, two, three 내가 셋 셀테니', "SEUNGRI - '셋 셀테니 (1, 2, 3!)' M/V")).toBe(false);
  });
  it('does nothing for non-Hangul titles', () => {
    expect(scriptMismatch(ja, 'Ed Sheeran - Shape of You')).toBe(false);
  });
});

import { rankSearch } from './score';
describe('rankSearch', () => {
  const R = (artist: string, title: string, kind = 'synced') => ({ artist, title, kind });
  it('drops unrelated NetEase filler', () => {
    const out = rankSearch('RESCENE Love Attack', [R('华晨宇', '烟火里的尘埃'), R('RESCENE', 'LOVE ATTACK'), R('墨哥', '烟火里的尘埃(抖音完整版)')]);
    expect(out.map((x) => x.title)).toEqual(['LOVE ATTACK']);
  });
  it('keeps title-only matches for short queries', () => {
    expect(rankSearch('whiplash', [R('aespa', 'Whiplash'), R('x', 'Other')]).map((x) => x.title)).toEqual(['Whiplash']);
  });
  it('handles Hangul queries', () => {
    expect(rankSearch('비와이 찾으니', [R('BewhY', '찾으니'), R('BewhY', '가라사대')]).map((x) => x.title)).toEqual(['찾으니']);
  });
});

import { groupSearch, searchMatch } from './score';
describe('searchMatch / groupSearch', () => {
  const R = (artist: string, title: string, kind = 'synced') => ({ artist, title, kind, lines: [] });
  it('exact when title equals or all tokens found', () => {
    expect(searchMatch('whiplash', 'aespa', 'Whiplash')).toBe('exact');
    expect(searchMatch('aespa whiplash', 'aespa', 'Whiplash')).toBe('exact');
    expect(searchMatch('백화요란', 'RESCENE (리센느)', '백화요란 (Inside Out)')).toBe('exact');
    expect(searchMatch('inside out', 'RESCENE (리센느)', '백화요란 (Inside Out)')).toBe('exact');
    expect(searchMatch('리센느 백화요란', 'RESCENE (리센느)', '백화요란 (Inside Out)')).toBe('exact');
  });
  it('partial for related, null for unrelated', () => {
    expect(searchMatch('aespa whiplash remix', 'aespa', 'Whiplash')).toBe('partial');
    expect(searchMatch('whiplash', '华晨宇', '烟火里的尘埃')).toBeNull();
  });
  it('drops Chinese covers when the original is there, demotes them otherwise', () => {
    const out = groupSearch('보름달', [R('宣美, Lena', '보름달'), R('DaHee, 梦酱', '보름달(滿月)'), R('선미 (SUNMI)', '보름달 (Full Moon)')]);
    expect(out.map((r) => r.artist)).toEqual(['선미 (SUNMI)']);
    const only = groupSearch('보름달', [R('宣美, Lena', '보름달')]);
    expect(only.map((r) => r.match)).toEqual(['partial']);
    expect(groupSearch('华晨宇 烟火里的尘埃', [R('华晨宇', '烟火里的尘埃')])[0]?.match).toBe('exact');
  });
  it('orders exact first and tags results', () => {
    const out = groupSearch('aespa whiplash', [R('aespa', 'Whiplash (Remix) extra words'), R('x', 'Other'), R('aespa', 'Whiplash')]);
    expect(out.map((x) => [x.title, x.match])).toEqual([['Whiplash', 'exact'], ['Whiplash (Remix) extra words', 'partial']]); // remixes are demoted unless asked for
    const g = groupSearch('aespa whiplash live tour', [R('aespa', 'Whiplash'), R('aespa', 'Whiplash live tour')]);
    expect(g[0]).toMatchObject({ title: 'Whiplash live tour', match: 'exact' });
    expect(g[1]).toMatchObject({ title: 'Whiplash', match: 'partial' });
  });
});

import { isVariant } from './score';
describe('groupSearch cleanup', () => {
  const R = (artist: string, title: string, kind = 'synced', duration?: number) => ({ artist, title, kind, duration });
  it('dedupes repeated uploads of the same track', () => {
    const out = groupSearch('RESCENE Love Attack', [
      R('RESCENE', 'LOVE ATTACK', 'synced', 182), R('RESCENE', 'LOVE ATTACK', 'synced', 182.4),
      R('RESCENE', 'LOVE ATTACK (LOVE ATTACK)', 'synced', 182), R('RESCENE', 'LOVE ATTACK', 'plain', 197),
    ]);
    expect(out.length).toBe(2);
  });
  it('demotes covers unless asked for', () => {
    const out = groupSearch('RESCENE Love Attack', [R('RESCENE', 'LOVE ATTACK（cover）'), R('RESCENE', 'LOVE ATTACK')]);
    expect(out.map((x) => [x.title, x.match])).toEqual([['LOVE ATTACK', 'exact'], ['LOVE ATTACK（cover）', 'partial']]);
    expect(groupSearch('Love Attack cover', [R('RESCENE', 'LOVE ATTACK (cover)')])[0].match).toBe('exact');
  });
  it('isVariant', () => {
    expect(isVariant('Pinball (Japanese Ver.)')).toBe(true);
    expect(isVariant('Super Shy')).toBe(false);
  });
});

describe('covers credited to the original artist', () => {
  it('ranks "Cover Singer, BTS" below BTS for a BTS MV and keeps it from finishing early', () => {
    const ctx = v("BTS (방탄소년단) 'FAKE LOVE' Official MV", 'HYBE LABELS', 319);
    const orig = scoreCandidate({ artist: 'BTS', title: 'FAKE LOVE', duration: 242, synced: true }, ctx);
    const cover = scoreCandidate({ artist: 'Ysabelle Cuevas, Bts', title: 'Fake Love', duration: 245, synced: true }, ctx);
    expect(orig).toBeGreaterThan(cover);
    expect(cover).toBeLessThan(HIGH_SCORE);
  });
  it('a feature led by the video artist keeps full artist credit', () => {
    const ctx = v('IU(아이유) _ eight(에잇) (Prod.&Feat. SUGA of BTS)', '1theK', 170);
    expect(scoreCandidate({ artist: 'IU, SUGA', title: 'eight', duration: 167, synced: true }, ctx)).toBeGreaterThanOrEqual(HIGH_SCORE);
  });
});
