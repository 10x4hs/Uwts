import type { LyricLine, LyricWord } from '../shared/types';

/**
 * Word/syllable-timed lyrics ("karaoke") from the public LyricsPlus API (the source YouLy+ uses;
 * it serves Apple Music / Musixmatch / QQ syllable timing). Slow (4-8s) and third-party, so it is
 * only an upgrade on top of lyrics we already show, and switched off with one flag.
 */
export const WORDSYNC_FLAG = 'uw:opt:wordSync'; // false = off; default on
const MIRRORS = ['https://lyricsplus.binimum.org', 'https://lyricsplus.prjktla.workers.dev'];
const TIMEOUT_MS = 15000;
const TTL_MS = 7 * 24 * 3600 * 1000;
const MISS_TTL_MS = 24 * 3600 * 1000;

interface Syl { time: number; duration: number; text: string; isBackground?: boolean }
interface LpLine { time: number; duration: number; text: string; syllabus?: Syl[]; element?: { singer?: string } }
interface Agent { type?: string }
export interface LyricsPlus { type?: string; lyrics?: LpLine[]; metadata?: { agents?: Record<string, Agent> } }

/** Apple Music agents: a "group" agent (often v1000, sometimes v3) is everyone together; of the
 *  people, the first to sing is singer 1 and anyone else singer 2. */
function singerMap(d: LyricsPlus): (singer?: string) => 1 | 2 | 3 | undefined {
  const agents = d.metadata?.agents ?? {};
  const order: string[] = [];
  for (const l of d.lyrics ?? []) {
    const s = l.element?.singer;
    if (s && !order.includes(s)) order.push(s);
  }
  const group = (s: string) => agents[s]?.type === 'group' || (!agents[s] && s === 'v1000');
  const first = order.find((s) => !group(s));
  return (s) => (!s ? undefined : group(s) ? 3 : s === first ? 1 : 2);
}

function toLine(l: LpLine, who: (singer?: string) => 1 | 2 | 3 | undefined): LyricLine | null {
  const syl = (l.syllabus ?? []).filter((s) => s.text);
  const main = syl.filter((s) => !s.isBackground);
  const bg = syl.filter((s) => s.isBackground);
  // background vocals ("(Under my control)") read after the main line, even when sung over it:
  // the fill reaches them once the main line is done
  const parts = [...main, ...bg];
  if (!parts.length) return null;
  let text = '';
  const words: LyricWord[] = [];
  for (const s of parts) {
    let chunk = s.text;
    if (!text) chunk = chunk.trimStart();
    if (s.isBackground && main.length && s === bg[0] && !text.endsWith(' ')) chunk = ` ${chunk}`;
    const lead = chunk.length - chunk.trimStart().length;
    if (chunk.trim()) words.push({ t: s.time / 1000, d: s.duration / 1000, c: text.length + lead });
    text += chunk;
  }
  text = text.trimEnd();
  const singer = who(l.element?.singer);
  return text ? { time: Math.min(l.time, parts[0].time) / 1000, text, words, ...(singer ? { singer } : {}) } : null;
}

export function parseLyricsPlus(d: LyricsPlus): LyricLine[] | null {
  if (d.type !== 'Word' || !d.lyrics?.length) return null;
  const who = singerMap(d);
  const lines = d.lyrics.map((l) => toLine(l, who)).filter((l): l is LyricLine => !!l);
  if (lines.length < 3) return null;
  // one singer throughout (solo songs, and groups: Apple tags every member as v1) = no colours
  if (new Set(lines.map((l) => l.singer ?? 1)).size < 2) for (const l of lines) delete l.singer;
  return lines.sort((a, b) => a.time - b.time);
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
/** Dice similarity of the whole lyric text: same song (and not a translation) when high. */
export function lyricSimilarity(a: LyricLine[], b: LyricLine[]): number {
  const x = bigrams(norm(a.map((l) => l.text).join(''))), y = bigrams(norm(b.map((l) => l.text).join('')));
  let both = 0, nx = 0, ny = 0;
  for (const v of x.values()) nx += v;
  for (const v of y.values()) ny += v;
  for (const [g, v] of x) both += Math.min(v, y.get(g) ?? 0);
  return nx + ny ? (2 * both) / (nx + ny) : 0;
}
export const SAME_LYRICS = 0.6;

async function getLp(base: string, q: Record<string, string>): Promise<LyricsPlus | null> {
  const r = await fetch(`${base}/v2/lyrics/get?${new URLSearchParams(q)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`LyricsPlus ${r.status}`);
  return (await r.json()) as LyricsPlus;
}

/** Word-timed lines for the song, tried with and without duration (exact length often misses). */
export async function fetchWordSync(q: { artist: string; title: string; duration?: number }): Promise<LyricLine[] | null> {
  const tries: Record<string, string>[] = [{ title: q.title, artist: q.artist }];
  if (q.duration) tries.unshift({ ...tries[0], duration: String(Math.round(q.duration)) });
  let lastErr: unknown = null;
  for (const base of MIRRORS) {
    try {
      for (const t of tries) {
        const lines = parseLyricsPlus((await getLp(base, t)) ?? {});
        if (lines) return lines;
      }
      return null; // this mirror answered: not found
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('LyricsPlus unavailable');
}

export async function wordSyncEnabled(): Promise<boolean> {
  try { return (await chrome.storage.local.get(WORDSYNC_FLAG))[WORDSYNC_FLAG] !== false; } catch { return true; }
}

/**
 * Word-timed version of `lines` (the lyrics we already show), or null when unavailable or not the
 * same lyrics. Cached per song; failures are not cached.
 */
export async function wordSyncFor(q: { artist: string; title: string; duration?: number }, lines: LyricLine[]): Promise<LyricLine[] | null> {
  if (!(await wordSyncEnabled())) return null;
  const key = `ws:v3:${norm(q.artist)}|${norm(q.title)}`;
  const got = (await chrome.storage.local.get(key).catch(() => ({})) as Record<string, { at: number; v: LyricLine[] | null }>)[key];
  let v: LyricLine[] | null;
  if (got && Date.now() - got.at < (got.v ? TTL_MS : MISS_TTL_MS)) v = got.v;
  else {
    v = await fetchWordSync(q);
    await chrome.storage.local.set({ [key]: { at: Date.now(), v } }).catch(() => {});
  }
  return v && lyricSimilarity(v, lines) >= SAME_LYRICS ? v : null;
}
