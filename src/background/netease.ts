import type { LyricsResult, SongQuery } from '../shared/types';
import { parseLrc } from '../lib/lrc';
import { getJson } from './http';

export interface NeteaseSong { id: number; name: string; artists: { name: string }[]; duration?: number }

const API = 'https://music.163.com/api';

const strip = (s: string) =>
  s.normalize('NFKC').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, '').replace(/[\s'"`’.,!?·\-_]/g, '');
const flat = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s()（）[\]'"`’.,!?·\-_]/g, '');

const contains = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a));

export function titleMatches(query: string, cand: string): boolean {
  const a = strip(query), b = strip(cand);
  if (contains(a, b)) return true;
  return contains(flat(query), flat(cand));
}

/** Artist fuzzy: compare stripped names and alias contents inside parentheses. */
export function artistMatches(query: string, cand: string): boolean {
  const variants = (s: string) => {
    const out = [strip(s)];
    for (const m of s.matchAll(/\(([^)]*)\)|（([^）]*)）/g)) out.push(strip(m[1] ?? m[2] ?? ''));
    return out.filter(Boolean);
  };
  const qa = variants(query), ca = variants(cand);
  return qa.some((x) => ca.some((y) => contains(x, y)));
}

/** Pick a NetEase candidate; title AND artist must match, then closest duration (seconds). */
export function pickNetease(songs: NeteaseSong[], q: SongQuery): NeteaseSong | null {
  const ok = songs.filter((s) => titleMatches(q.title, s.name) && s.artists.some((a) => artistMatches(q.artist, a.name)));
  if (!ok.length) return null;
  const diff = (s: NeteaseSong) =>
    q.duration != null && s.duration != null ? Math.abs(s.duration / 1000 - q.duration) : Number.POSITIVE_INFINITY;
  return [...ok].sort((a, b) => diff(a) - diff(b))[0];
}

const META_RE = /^\s*(作词|作曲|编曲|制作人|混音|母带|和声|吉他|贝斯|鼓|录音|监制|出品|词|曲|op|sp|lyricist|composer|arranger|producer)\s*[:：]/i;

export function parseNeteaseLrc(lrc: string): LyricsResult['lines'] {
  return parseLrc(lrc).filter((l) => !META_RE.test(l.text));
}

export async function searchSongs(s: string): Promise<NeteaseSong[]> {
  const p = new URLSearchParams({ s, type: '1', limit: '10' });
  const r = await getJson<{ result?: { songs?: NeteaseSong[] } }>(`${API}/search/get?${p}`, 'NetEase');
  return r.body?.result?.songs ?? [];
}

export async function lyricFor(song: NeteaseSong): Promise<LyricsResult | null> {
  const r = await getJson<{ lrc?: { lyric?: string } }>(`${API}/song/lyric?id=${song.id}&lv=1`, 'NetEase');
  const text = r.body?.lrc?.lyric;
  if (!text) return null;
  const artist = song.artists.map((a) => a.name).join(', ');
  const lines = parseNeteaseLrc(text);
  if (lines.length) return { kind: 'synced', artist, title: song.name, lines };
  const plain = text.split(/\r?\n/).filter((t) => t.trim() && !META_RE.test(t)).map((t) => ({ time: -1, text: t }));
  return plain.length ? { kind: 'plain', artist, title: song.name, lines: plain } : null;
}

export async function fetchNetease(q: SongQuery): Promise<LyricsResult | null> {
  const best = pickNetease(await searchSongs(`${q.artist} ${q.title}`), q);
  return best ? lyricFor(best) : null;
}

export async function searchNetease(q: string, max = 5): Promise<LyricsResult[]> {
  const songs = (await searchSongs(q)).slice(0, max);
  const res = await Promise.all(songs.map((s) => lyricFor(s).catch(() => null)));
  return res.filter((r): r is LyricsResult => r !== null);
}
