import { getText } from '../http';
import { plainLines, type KrLyrics, type KrSong, delayLines, SOURCE_LEAD } from './types';

/**
 * Genie (unofficial). Search: app.genie.co.kr/search/category/songs.json (JSON incl. plain lyrics and
 * duration). Synced lyrics: dn.genie.co.kr/app/purchase/get_msl.asp?path=a&songid={id} ->
 * JSONP `null({"900":"line",...})` keyed by milliseconds; non-JSONP/HTML when unavailable.
 */
interface GenieItem { song_id: string; song_name?: { original?: string }; artist_name?: { original?: string }; duration?: { time?: number }; lyrics?: string }

export async function searchGenie(q: string, size = 5): Promise<KrSong[]> {
  const p = new URLSearchParams({ query: q, pagesize: String(size) });
  const d = JSON.parse(await getText(`https://app.genie.co.kr/search/category/songs.json?${p}`, 'Genie')) as
    { searchResult?: { result?: { songs?: { items?: GenieItem[] } } } };
  return (d.searchResult?.result?.songs?.items ?? []).map((i) => ({
    source: 'genie' as const, id: String(i.song_id), title: i.song_name?.original ?? '', artist: i.artist_name?.original ?? '',
    duration: i.duration?.time || undefined, plain: i.lyrics || undefined,
  })).filter((s) => s.title);
}

export function parseGenieMsl(body: string): KrLyrics['lines'] {
  const m = body.trim().match(/^\w*\(([\s\S]*)\)\s*;?$/);
  if (!m) return [];
  let o: unknown;
  try { o = JSON.parse(m[1]); } catch { return []; }
  if (!o || typeof o !== 'object') return [];
  return Object.entries(o as Record<string, unknown>)
    .filter(([k, v]) => /^\d+$/.test(k) && typeof v === 'string' && v.trim())
    .map(([k, v]) => ({ time: +k / 1000, text: (v as string).trim() }))
    .sort((a, b) => a.time - b.time);
}

export async function genieLyrics(song: KrSong): Promise<KrLyrics | null> {
  const base = { artist: song.artist, title: song.title, duration: song.duration, source: 'genie' as const };
  const synced = parseGenieMsl(await getText(`https://dn.genie.co.kr/app/purchase/get_msl.asp?path=a&songid=${encodeURIComponent(song.id)}`, 'Genie').catch(() => ''));
  if (synced.length >= 3) return { ...base, kind: 'synced', lines: delayLines(synced, SOURCE_LEAD.genie) };
  const plain = plainLines(song.plain ?? '');
  return plain.length ? { ...base, kind: 'plain', lines: plain } : null;
}
