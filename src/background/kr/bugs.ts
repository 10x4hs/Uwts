import { getText } from '../http';
import { mmss, plainLines, delayLines, SOURCE_LEAD, type KrLyrics, type KrSong } from './types';

/**
 * Bugs (unofficial). Search: m.bugs.co.kr/api/getSearchList (JSON, no auth).
 * Lyrics: music.bugs.co.kr/player/lyrics/T/{id} -> {"lyrics":"0.9|line＃8.8|line..."} (synced, seconds),
 * /N/{id} -> plain with \n. Empty string when unavailable.
 */
interface BugsTrack { track_id: number; track_title: string; artists?: { artist_nm: string }[]; len?: string }

export async function searchBugs(q: string, size = 5): Promise<KrSong[]> {
  const p = new URLSearchParams({ query: q, type: 'track', page: '1', size: String(size) });
  const d = JSON.parse(await getText(`https://m.bugs.co.kr/api/getSearchList?${p}`, 'Bugs')) as { list?: BugsTrack[] };
  return (d.list ?? []).map((t) => ({
    source: 'bugs' as const, id: String(t.track_id), title: t.track_title,
    artist: (t.artists ?? []).map((a) => a.artist_nm).join(', '), duration: mmss(t.len),
  }));
}

export function parseBugsSynced(s: string): KrLyrics['lines'] {
  const out: KrLyrics['lines'] = [];
  for (const part of s.split(/[＃#](?=\d+(?:\.\d+)?\|)/)) {
    const m = part.match(/^(\d+(?:\.\d+)?)\|([\s\S]*)$/);
    if (m && m[2].trim()) out.push({ time: +m[1], text: m[2].trim() });
  }
  return out.sort((a, b) => a.time - b.time);
}

export async function bugsLyrics(song: KrSong): Promise<KrLyrics | null> {
  const base = { artist: song.artist, title: song.title, duration: song.duration, source: 'bugs' as const };
  const t = JSON.parse(await getText(`https://music.bugs.co.kr/player/lyrics/T/${encodeURIComponent(song.id)}`, 'Bugs')) as { lyrics?: string };
  const synced = parseBugsSynced(t.lyrics ?? '');
  if (synced.length >= 3) return { ...base, kind: 'synced', lines: delayLines(synced, SOURCE_LEAD.bugs) };
  const n = JSON.parse(await getText(`https://music.bugs.co.kr/player/lyrics/N/${encodeURIComponent(song.id)}`, 'Bugs')) as { lyrics?: string };
  const plain = plainLines(n.lyrics ?? '');
  return plain.length ? { ...base, kind: 'plain', lines: plain } : null;
}
