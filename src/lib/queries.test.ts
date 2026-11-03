import { describe, it, expect } from 'vitest';
import { buildQueries, bareTitle, artistVariants, cleanChannel, scriptOnly } from './queries';

const ctx = (videoTitle: string, channel = '', extra = {}) => ({ videoId: 'abc123xyz', videoTitle, channel, ...extra });

describe('bareTitle', () => {
  it('strips feat, parens, quotes and noise', () => {
    expect(bareTitle('FASHO (Feat. pH-1, HAON)')).toBe('FASHO');
    expect(bareTitle("'With' Official MV")).toBe('With');
    expect(bareTitle('Love Peace Movement (호심술 REMIX) [DF LIVE]')).toBe('Love Peace Movement');
    expect(bareTitle('신기루 가사 Lyrics')).toBe('신기루');
    expect(bareTitle("You’re Under Arrest")).toBe("You're Under Arrest");
  });
});

describe('aliases', () => {
  it('splits Latin/Hangul aliases', () => {
    expect(artistVariants('RESCENE (리센느)')).toEqual(['RESCENE', '리센느']);
    expect(artistVariants('Seungri 승리')).toEqual(['Seungri 승리', 'Seungri', '승리']);
  });
  it('cleans channel names', () => {
    expect(cleanChannel('SEUNGRI - Topic')).toBe('SEUNGRI');
    expect(cleanChannel('TheWeekndVEVO')).toBe('TheWeeknd');
    expect(cleanChannel('HYBE LABELS')).toBe('HYBE');
    expect(cleanChannel('BLACKPINK Official')).toBe('BLACKPINK');
  });
  it('script-only', () => {
    expect(scriptOnly('셋 셀테니 1, 2, 3!', 'hangul')).toBe('셋 셀테니');
    expect(scriptOnly('체포하겠어 Under Arrest', 'latin')).toBe('Under Arrest');
  });
});

describe('buildQueries', () => {
  it('artist + title first, with aliases', () => {
    const p = buildQueries(ctx("RESCENE (리센느) 'With' Official MV", 'RESCENE'));
    expect(p.queries[0]).toBe('RESCENE With');
    expect(p.queries).toContain('리센느 With');
  });
  it('strips feat lists', () => {
    expect(buildQueries(ctx('GroovyRoom - FASHO (Feat. pH-1, HAON) [Official Video]', 'GroovyRoom')).queries[0]).toBe('GroovyRoom FASHO');
  });
  it('hangul-only title and channel variants', () => {
    const q = buildQueries(ctx("SEUNGRI - '셋 셀테니 (1, 2, 3!)' M/V", 'BIGBANG')).queries;
    expect(q[0]).toBe('SEUNGRI 셋 셀테니');
    expect(q).toContain('BIGBANG 셋 셀테니');
  });
  it('includes co-artists', () => {
    expect(buildQueries(ctx('C JAMM (씨잼) & BewhY (비와이) - puzzleㅣ Lyrics / 가사')).queries).toContain('BewhY puzzle');
  });
  it('uses chapter title with channel', () => {
    const p = buildQueries(ctx('Live medley', 'IU Official', { chapterTitle: '좋은 날' }));
    expect(p.queries[0]).toBe('IU 좋은 날');
  });
  it('dedupes and caps', () => {
    const q = buildQueries(ctx("ILLIT (아일릿) '체포하겠어 (You’re Under Arrest)’ Official MV", 'HYBE LABELS')).queries;
    expect(q.length).toBeLessThanOrEqual(6);
    expect(new Set(q.map((x) => x.toLowerCase())).size).toBe(q.length);
  });
});
