import { describe, it, expect, beforeAll } from 'vitest';
import type { ResolveContext } from '../shared/types';

const LIVE = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === '1';

interface Case { title: string; channel: string; expect: string | null; nullOk?: boolean; duration?: number }
const CASES: Case[] = [
  { title: "RESCENE (리센느) 'With' Official MV", channel: 'RESCENE', expect: 'With' },
  { title: 'GroovyRoom - FASHO (Feat. pH-1, HAON, TRADE L, Woodie Gochild, BIG Naughty, Sik-K, Jay Park) [Official Video]', channel: 'GroovyRoom', expect: 'FASHO' },
  { title: "SEUNGRI - '셋 셀테니 (1, 2, 3!)' M/V", channel: 'BIGBANG', expect: '셋 셀테니' },
  { title: "BewhY (비와이) - 악수 [POP IS CRYIN']ㅣLyrics/가사", channel: '알파', expect: '악수' },
  { title: 'C JAMM - 신기루 (illusion)ㅣ가사ㅣLyrics', channel: '김원더', expect: '신기루' },
  { title: 'C JAMM (씨잼) & BewhY (비와이) - puzzleㅣ Lyrics / 가사', channel: '', expect: 'puzzle' },
  { title: 'Tiger JK, Paloalto, 우원재, MAN1AC, Los, YDG, Bizzy - Love Peace Movement (호심술 REMIX) | [DF LIVE]', channel: 'df 디에프', expect: 'Love Peace Movement' },
  { title: "ILLIT (아일릿) '체포하겠어 (You’re Under Arrest)’ Official MV", channel: 'HYBE LABELS', expect: '체포하겠어|Under Arrest', nullOk: true },
  { title: "NewJeans (뉴진스) 'Super Shy' Official MV", channel: 'HYBE LABELS', expect: 'Super Shy' },
  { title: "IVE 아이브 'LOVE DIVE' MV", channel: 'STARSHIP', expect: 'LOVE DIVE' },
  { title: 'BLACKPINK - ‘뚜두뚜두 (DDU-DU DDU-DU)’ M/V', channel: 'BLACKPINK', expect: '뚜두뚜두' },
  { title: 'IU(아이유) _ Blueming(블루밍) MV', channel: '1theK (원더케이)', expect: 'Blueming' },
  { title: 'The Weeknd - Blinding Lights (Official Video)', channel: 'TheWeekndVEVO', expect: 'Blinding Lights' },
  { title: 'Ed Sheeran - Shape of You (Official Music Video)', channel: 'Ed Sheeran', expect: 'Shape of You' },
];

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

describe.skipIf(!LIVE)('live resolve', () => {
  beforeAll(() => {
    const mem: Record<string, unknown> = {};
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: {
        get: async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in mem).map((x) => [x, mem[x]])),
        set: async (o: Record<string, unknown>) => { Object.assign(mem, o); },
      } },
    };
  });

  it('resolves real titles', async () => {
    const { resolveCached } = await import('../background/resolve');
    const rows: string[] = [];
    const times: number[] = [];
    let hits = 0;
    const fails: string[] = [];
    for (const [i, c] of CASES.entries()) {
      const ctx: ResolveContext = { videoId: `live${i}xxxx`, videoTitle: c.title, channel: c.channel, videoDuration: c.duration };
      const t0 = performance.now();
      let r: Awaited<ReturnType<typeof resolveCached>> | null = null;
      let err = '';
      try { r = await resolveCached(ctx); } catch (e) { err = String(e); }
      const ms = Math.round(performance.now() - t0);
      times.push(ms);
      const got = r?.result;
      const ok = got ? (c.expect ?? '').split('|').some((e) => norm(got.title).includes(norm(e))) : !!c.nullOk;
      if (ok) hits++; else fails.push(c.title);
      rows.push(`${ok ? 'OK ' : 'BAD'} | ${c.title.slice(0, 48).padEnd(48)} | ${got ? `${got.artist.slice(0, 30)} | ${got.title} | ${got.kind} | ${got.score}` : `null ${err}`} | ${ms}ms`);
    }
    times.sort((a, b) => a - b);
    console.log(`\n${rows.join('\n')}\nhit rate ${hits}/${CASES.length}, median ${times[Math.floor(times.length / 2)]}ms`);
    expect(fails).toEqual([]);
  }, 200_000);
});
