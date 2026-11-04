import { EXTRA_ORIGINS, type Request, type SearchHit } from '../shared/messages';
import { groupSearch, rankSearch, searchRelevance } from '../lib/score';
import { krEnabled, krLyrics, searchKr } from './kr';
import type { LyricsResult, Palette, SongQuery } from '../shared/types';
import { fetchLyrics } from './lrclib';
import { fetchNetease, searchNetease } from './netease';
import { getJson } from './http';
import { defaultDeps, resolveCached } from './resolve';
import { searchTracks } from './lrclib';
import { fromLrclibTrack } from './resolve';
import { paletteFromPixels } from '../lib/color';

const NULL_TTL_MS = 10 * 60 * 1000;

interface CacheEntry<T> { value: T; at: number; isNull?: boolean }

const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = (await chrome.storage.session.get(key))[key] as CacheEntry<T> | undefined;
  if (hit && (!hit.isNull || Date.now() - hit.at < NULL_TTL_MS)) return hit.value;
  const value = await load();
  await chrome.storage.session.set({ [key]: { value, at: Date.now(), isNull: value == null } satisfies CacheEntry<T> })
    .catch(() => { /* quota: ignore */ });
  return value;
}

async function paletteFor(videoId: string): Promise<Palette> {
  if (!/^[\w-]{6,20}$/.test(videoId)) throw new Error('invalid videoId');
  const res = await fetch(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
  if (!res.ok) throw new Error(`thumbnail HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(64, 36);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bmp, 0, 0, 64, 36);
  bmp.close();
  return paletteFromPixels(ctx.getImageData(0, 0, 64, 36).data);
}

/**
 * Query LRCLIB and NetEase in parallel (LRCLIB is often 503-overloaded and slow to retry).
 * Priority: LRCLIB synced > NetEase synced > LRCLIB plain > NetEase plain.
 * Once NetEase has synced lyrics, wait at most LRCLIB_GRACE_MS more for LRCLIB.
 * Errors propagate only when both sources fail (never cached as null).
 */
const LRCLIB_GRACE_MS = 2500;
const LRCLIB_DEADLINE_MS = 9000;
type Settled = { r?: LyricsResult | null; e?: unknown };
async function lyricsFor(q: SongQuery): Promise<LyricsResult | null> {
  const lrc: Promise<Settled> = fetchLyrics(q).then((r) => ({ r }), (e: unknown) => ({ e }));
  const ne: Promise<Settled> = fetchNetease(q).then((r) => ({ r }), (e: unknown) => ({ e }));
  const n = await ne;
  let l: Settled | null;
  if (n.r?.kind === 'synced') {
    l = await Promise.race([lrc, new Promise<null>((res) => setTimeout(() => res(null), LRCLIB_GRACE_MS))]);
  } else {
    // Hard cap: an overloaded LRCLIB must not leave the panel loading forever.
    l = await Promise.race([lrc, new Promise<Settled>((res) => setTimeout(() => res({ e: new Error('LRCLIB timeout') }), LRCLIB_DEADLINE_MS))]);
  }
  const cands = [l?.r, n.r].filter((x): x is LyricsResult => !!x);
  const best = cands.find((x) => x.kind === 'synced') ?? cands[0] ?? null;
  if (best) return best;
  if (l?.e && n.e) throw l.e; // both sources failed -> error state (not cached)
  return null; // NetEase answered cleanly with nothing -> not found
}

interface VideoMeta { title: string; channel: string; description?: string; duration?: number }

/** Full metadata from the InnerTube player endpoint (works anonymously): untruncated description
 *  (chapters) and exact length. Falls back to oEmbed (title/channel only). */
async function videoMeta(videoId: string): Promise<VideoMeta> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, context: { client: { clientName: 'WEB', clientVersion: '2.20241023.01.00', hl: 'ko' } } }),
    });
    if (res.ok) {
      const d = (await res.json()) as { videoDetails?: { title?: string; author?: string; shortDescription?: string; lengthSeconds?: string } };
      const v = d.videoDetails;
      if (v?.title) {
        return { title: v.title, channel: v.author ?? '', description: v.shortDescription ?? '', duration: Number(v.lengthSeconds) || undefined };
      }
    }
  } catch { /* fall back to oEmbed */ }
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const r = await getJson<{ title?: string; author_name?: string }>(
    `https://www.youtube.com/oembed?${new URLSearchParams({ url: watch, format: 'json' })}`, 'oEmbed');
  if (!r.body?.title) throw new Error('oEmbed: no metadata');
  return { title: r.body.title, channel: r.body.author_name ?? '' };
}

const SEARCH_DEADLINE_MS = 4000;
const SEARCH_GRACE_MS = 1200;

/** Interactive search over both sources; never waits on a retrying source past SEARCH_DEADLINE_MS. */
const KR_SEARCH_LYRICS = 4;

/** KR personal sources for interactive search: relevant hits only, synced-capable services first. */
async function searchKrLyrics(q: string): Promise<LyricsResult[]> {
  const songs = (await searchKr(q))
    .map((s) => ({ s, r: searchRelevance(q, s.artist, s.title) }))
    .filter((x) => x.r >= 0.5)
    .sort((a, b) => Number(a.s.source === 'melon') - Number(b.s.source === 'melon') || b.r - a.r)
    .slice(0, KR_SEARCH_LYRICS);
  const res = await Promise.all(songs.map(({ s }) => krLyrics(s).catch(() => null)));
  return res.filter((r) => r !== null);
}

async function searchAll(q: string, kr = false): Promise<{ results: SearchHit[]; partial: boolean }> {
  const t0 = performance.now();
  const capped = <T,>(p: Promise<T>) =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('search timeout')), SEARCH_DEADLINE_MS))]);
  const lrc = capped(searchTracks(q).then((ts) => ts.map(fromLrclibTrack).filter((r) => r !== null).slice(0, 10)));
  const ne = capped(searchNetease(q, 4));
  // Once NetEase has relevant hits, give the (often 503-retrying) LRCLIB only a short grace period.
  const lrcGraced = ne.then(
    (hits) => (rankSearch(q, hits).length
      ? Promise.race([lrc, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('grace')), SEARCH_GRACE_MS))])
      : lrc),
    () => lrc,
  );
  const krP: Promise<LyricsResult[]> = kr ? capped(searchKrLyrics(q)) : Promise.resolve([]);
  const [a, b, c] = await Promise.allSettled([lrcGraced, ne, krP]);
  if (a.status === 'rejected' && b.status === 'rejected' && (!kr || c.status === 'rejected')) throw a.reason;
  const ok = (x: PromiseSettledResult<LyricsResult[]>) => (x.status === 'fulfilled' ? x.value : []);
  const results = groupSearch(q, [...ok(c), ...ok(a), ...ok(b)]);
  console.debug(`[uwts] search "${q}" in ${Math.round(performance.now() - t0)}ms (${results.length})`);
  return { results, partial: a.status === 'rejected' || b.status === 'rejected' || c.status === 'rejected' };
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'lyrics:get': {
      const q = req.query;
      const key = `lyrics:${norm(q.artist)}|${norm(q.title)}|${q.duration ? Math.round(q.duration) : ''}`;
      return { ok: true, result: await cached(key, () => lyricsFor(q)) };
    }
    case 'lyrics:resolve':
      return { ok: true, ...(await resolveCached(req.ctx, (await krEnabled()) ? { ...defaultDeps, kr: { search: searchKr, lyrics: krLyrics } } : defaultDeps, { fresh: req.fresh })) };
    case 'lyrics:search': {
      const kr = await krEnabled();
      const key = `search:v4:${kr ? 'kr:' : ''}${norm(req.q)}`;
      const hit = (await chrome.storage.session.get(key))[key] as SearchHit[] | undefined;
      if (hit) return { ok: true, results: hit };
      const { results, partial } = await searchAll(req.q, kr);
      // a source timed out (LRCLIB 503s): show what we have, but don't cache a partial answer
      if (!partial) await chrome.storage.session.set({ [key]: results }).catch(() => {});
      return { ok: true, results };
    }
    case 'palette:get':
      return { ok: true, palette: await cached(`palette:${req.videoId}`, () => paletteFor(req.videoId)) };
    case 'video:meta': {
      const meta = await cached(`meta:v2:${req.videoId}`, () => videoMeta(req.videoId));
      return { ok: true, ...meta };
    }
    case 'perm:status':
      return { ok: true, granted: await chrome.permissions.contains({ origins: EXTRA_ORIGINS }) };
    case 'perm:open':
      await chrome.tabs.create({ url: chrome.runtime.getURL('grant.html') });
      return { ok: true };
    default:
      return { ok: false, error: 'unknown request' };
  }
}

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req)
    .then(sendResponse)
    .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});
