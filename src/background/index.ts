import type { Request } from '../shared/messages';
import type { LyricsResult, Palette, SongQuery } from '../shared/types';
import { fetchLyrics, searchLyrics } from './lrclib';
import { fetchNetease, searchNetease } from './netease';
import { getJson } from './http';
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

async function videoMeta(videoId: string): Promise<{ title: string; channel: string }> {
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const r = await getJson<{ title?: string; author_name?: string }>(
    `https://www.youtube.com/oembed?${new URLSearchParams({ url: watch, format: 'json' })}`, 'oEmbed');
  if (!r.body?.title) throw new Error('oEmbed: no metadata');
  return { title: r.body.title, channel: r.body.author_name ?? '' };
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'lyrics:get': {
      const q = req.query;
      const key = `lyrics:${norm(q.artist)}|${norm(q.title)}|${q.duration ? Math.round(q.duration) : ''}`;
      return { ok: true, result: await cached(key, () => lyricsFor(q)) };
    }
    case 'lyrics:search':
      return { ok: true, results: await cached(`search:${norm(req.q)}`, async () => {
        const [a, b] = await Promise.allSettled([searchLyrics(req.q), searchNetease(req.q)]);
        if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
        return [...(a.status === 'fulfilled' ? a.value : []), ...(b.status === 'fulfilled' ? b.value : [])];
      }) };
    case 'palette:get':
      return { ok: true, palette: await cached(`palette:${req.videoId}`, () => paletteFor(req.videoId)) };
    case 'video:meta': {
      const meta = await cached(`meta:${req.videoId}`, () => videoMeta(req.videoId));
      return { ok: true, ...meta };
    }
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
