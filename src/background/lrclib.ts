import type { LyricsResult, SongQuery } from '../shared/types';
import { parseLrc } from '../lib/lrc';

export interface LrclibTrack {
  id?: number;
  trackName: string; artistName: string;
  duration?: number | null;
  instrumental?: boolean;
  plainLyrics?: string | null; syncedLyrics?: string | null;
}

const API = 'https://lrclib.net/api';

/** Pick best candidate: must have lyrics; prefer synced, then closest duration. */
export function chooseBest(cands: LrclibTrack[], duration?: number): LrclibTrack | null {
  const usable = cands.filter((c) => c.syncedLyrics || c.plainLyrics);
  if (!usable.length) return null;
  const durDiff = (c: LrclibTrack) =>
    duration != null && c.duration != null ? Math.abs(c.duration - duration) : Number.POSITIVE_INFINITY;
  return [...usable].sort((a, b) => {
    const sa = a.syncedLyrics ? 0 : 1, sb = b.syncedLyrics ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return durDiff(a) - durDiff(b);
  })[0];
}

export function toResult(t: LrclibTrack): LyricsResult | null {
  if (t.syncedLyrics) {
    return { kind: 'synced', artist: t.artistName, title: t.trackName, lines: parseLrc(t.syncedLyrics) };
  }
  if (t.plainLyrics) {
    return { kind: 'plain', artist: t.artistName, title: t.trackName,
      lines: t.plainLyrics.split(/\r?\n/).map((text) => ({ time: -1, text })) };
  }
  return null;
}

async function getJson<T>(url: string): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url);
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
  return { status: res.status, body: (await res.json()) as T };
}

export async function fetchLyrics(q: SongQuery): Promise<LyricsResult | null> {
  const p = new URLSearchParams({ artist_name: q.artist, track_name: q.title });
  if (q.duration) p.set('duration', String(Math.round(q.duration)));
  const got = await getJson<LrclibTrack>(`${API}/get?${p}`);
  if (got.body && (got.body.syncedLyrics || got.body.plainLyrics)) return toResult(got.body);
  const sp = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
  const found = await getJson<LrclibTrack[]>(`${API}/search?${sp}`);
  const best = chooseBest(found.body ?? [], q.duration);
  return best ? toResult(best) : null;
}

export async function searchLyrics(q: string): Promise<LyricsResult[]> {
  const found = await getJson<LrclibTrack[]>(`${API}/search?${new URLSearchParams({ q })}`);
  return (found.body ?? []).slice(0, 8).map(toResult).filter((r): r is LyricsResult => r !== null);
}
