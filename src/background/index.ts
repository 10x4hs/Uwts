import type { Request } from '../shared/messages';
import type { Palette } from '../shared/types';
import { fetchLyrics, searchLyrics } from './lrclib';
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

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'lyrics:get': {
      const q = req.query;
      const key = `lyrics:${norm(q.artist)}|${norm(q.title)}|${q.duration ? Math.round(q.duration) : ''}`;
      return { ok: true, result: await cached(key, () => fetchLyrics(q)) };
    }
    case 'lyrics:search':
      return { ok: true, results: await cached(`search:${norm(req.q)}`, () => searchLyrics(req.q)) };
    case 'palette:get':
      return { ok: true, palette: await cached(`palette:${req.videoId}`, () => paletteFor(req.videoId)) };
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
