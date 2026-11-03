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
