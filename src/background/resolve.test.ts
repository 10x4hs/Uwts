import { describe, it, expect, beforeEach } from 'vitest';
import { resolveFresh, resolveCached, type ResolveDeps } from './resolve';
import { overrideKey } from '../lib/keys';

const mem: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = { storage: { local: {
  get: async (k: string[]) => Object.fromEntries(k.filter((x) => x in mem).map((x) => [x, mem[x]])),
  set: async (o: Record<string, unknown>) => { Object.assign(mem, o); },
} } };

const ctx = { videoId: 'vid000001', videoTitle: 'GroovyRoom - FASHO (Feat. pH-1) [Official Video]', channel: 'GroovyRoom', videoDuration: 430 };
const good = { trackName: 'FASHO', artistName: 'GroovyRoom, pH-1', duration: 424, syncedLyrics: '[00:01.00]hi' };
const wrong = { trackName: 'FASHO', artistName: 'Random', duration: 150, syncedLyrics: '[00:01.00]no' };
const never = () => new Promise<never>(() => {});

function deps(over: Partial<ResolveDeps>): ResolveDeps {
  return { searchTracks: async () => [], getTrack: async () => null, searchSongs: async () => [], lyricFor: async () => null,
    now: () => Date.now(), deadlineMs: 300, ...over };
}

describe('resolveFresh', () => {
  beforeEach(() => { for (const k of Object.keys(mem)) delete mem[k]; });
  it('returns early on a high-confidence synced hit without waiting for slow requests', async () => {
    const t0 = Date.now();
    const r = await resolveFresh(ctx, deps({ deadlineMs: 5000, searchTracks: async (q) => (q === 'GroovyRoom FASHO' ? [wrong, good] : never()) }));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.result?.artist).toBe('GroovyRoom, pH-1');
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
  });
  it('returns null (not a wrong song) when nothing matches', async () => {
    const r = await resolveFresh(ctx, deps({ searchTracks: async () => [{ trackName: 'Other', artistName: 'X', syncedLyrics: '[00:01.00]a' }] }));
    expect(r.result).toBeNull();
  });
  it('respects the deadline', async () => {
    const t0 = Date.now();
    // nothing found by the deadline -> reject so the panel retries (never cache a possibly-wrong "not found")
    await expect(resolveFresh(ctx, deps({ searchTracks: never, getTrack: never, searchSongs: never }))).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(800);
  });
  it('rejects when every source fails', async () => {
    const fail = async () => { throw new Error('503'); };
    await expect(resolveFresh(ctx, deps({ searchTracks: fail, getTrack: fail, searchSongs: fail }))).rejects.toThrow();
  });
  it('uses NetEase songs with fetched lyrics', async () => {
    const r = await resolveFresh(ctx, deps({
      searchSongs: async () => [{ id: 1, name: 'FASHO', artists: [{ name: 'GroovyRoom' }], duration: 424000 }],
      lyricFor: async () => ({ kind: 'synced', artist: 'GroovyRoom', title: 'FASHO', lines: [{ time: 1, text: 'x' }] }),
    }));
    expect(r.result?.source).toBe('netease');
    expect(r.result?.duration).toBe(424);
  });
});

describe('resolveCached', () => {
  beforeEach(() => { for (const k of Object.keys(mem)) delete mem[k]; });
  it('caches by videoId and serves revisits without network', async () => {
    let calls = 0;
    const d = deps({ searchTracks: async () => { calls++; return [good]; } });
    await resolveCached(ctx, d);
    const n = calls;
    const r = await resolveCached(ctx, d);
    expect(calls).toBe(n);
    expect(r.result?.title).toBe('FASHO');
  });
  it('user override wins', async () => {
    mem[overrideKey(ctx.videoId)] = { kind: 'plain', artist: 'Me', title: 'Mine', lines: [{ time: -1, text: 'a' }], source: 'lrclib' };
    const r = await resolveCached(ctx, deps({}));
    expect(r.result?.title).toBe('Mine');
  });
});
