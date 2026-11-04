import type { ResolveContext } from '../shared/types';
import { parseVideoTitle } from './title';

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const LATIN = /[A-Za-z]/;

const squash = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s\-–—_|:,.&]+|[\s\-–—_|:,&]+$/g, '').trim();

const NOISE_WORDS = /\b(official|music\s*video|lyric\s*video|lyrics?|m\/v|mv|live|audio|video|visualizer|performance|teaser|special\s*clip|hd|4k)\b|가사|뮤직비디오|라이브|공식/gi;

/** Title-only variant: drop (feat...), (prod...), any brackets/parens, quotes, and MV/Lyrics/LIVE noise. */
export function bareTitle(s: string): string {
  let t = s.replace(/[\u3163\u1175]/g, ' ').normalize('NFKC');
  t = t.replace(/\s*[(（[【{][^)）\]】}]*[)）\]】}]/g, ' ');
  t = t.replace(/\s*\b(feat|ft|prod)\.?\s.*$/i, ' ');
  t = t.replace(/([\p{L}\p{N}])['’]([\p{L}])/gu, "$1'$2");
  t = t.replace(/(^|[^\p{L}])'|'(?![\p{L}])/gu, '$1 ').replace(/["‘’“”「」『』〈〉《》]/g, ' ');
  t = t.replace(NOISE_WORDS, ' ');
  return squash(t);
}

/** Keep only Hangul (and digits) / only Latin (and digits) words. */
export function scriptOnly(s: string, script: 'hangul' | 'latin'): string {
  const re = script === 'hangul' ? HANGUL : LATIN;
  const other = script === 'hangul' ? LATIN : HANGUL;
  return squash(s.split(/\s+/).filter((w) => re.test(w) && !other.test(w)).join(' '));
}

/** Clean a channel name into an artist guess: drop "- Topic", "Official", "VEVO", "Records", "Entertainment". */
export function cleanChannel(ch: string): string {
  return squash(ch.normalize('NFKC')
    .replace(/\s*-\s*topic\s*$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\b(official|records?|entertainment|music|labels?|channel|tv)\b/gi, ' ')
    .replace(/공식|채널/g, ' '));
}

/** Artist aliases: "RESCENE (리센느)" -> [RESCENE, 리센느]; "Seungri 승리" -> [Seungri, 승리]. */
export function artistVariants(raw: string): string[] {
  const out: string[] = [];
  const add = (s: string) => { const v = squash(s); if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v); };
  const s = raw.normalize('NFKC');
  add(s.replace(/\s*\([^)]*\)/g, ' '));
  for (const m of s.matchAll(/\(([^)]+)\)/g)) add(m[1]);
  add(scriptOnly(s.replace(/[()]/g, ' '), 'latin'));
  add(scriptOnly(s.replace(/[()]/g, ' '), 'hangul'));
  return out;
}

/** Artist segment of the raw title (before " - " or before the quoted title). */
function rawArtistPart(videoTitle: string): string {
  const t = videoTitle.normalize('NFKC');
  const dash = t.match(/^(.+?)\s+[-–—]\s+/);
  if (dash) return dash[1];
  const q = t.match(/^(.+?)\s*['‘’"“”「『]/);
  return q ? q[1] : '';
}

const firstArtist = (s: string) => squash(s.split(/\s*(?:&|,|×|\bx\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0]);

export interface QueryPlan { queries: string[]; artist: string; title: string }

/** Ordered, deduped free-text queries for LRCLIB/NetEase search. */
export function buildQueries(ctx: ResolveContext, max = 6): QueryPlan {
  const base = (ctx.chapterTitle ? ctx.chapterTitle : ctx.videoTitle).replace(/\s*[\u3163\u1175]\s*/g, ' | ');
  const parsed = parseVideoTitle(base, ctx.channel);
  const channel = cleanChannel(ctx.channel);
  const hasArtistInTitle = !!rawArtistPart(base);
  const artists: string[] = [];
  const addA = (a: string) => { const v = squash(a); if (v && !artists.some((x) => x.toLowerCase() === v.toLowerCase())) artists.push(v); };
  addA(parsed.artist);
  const rawA = rawArtistPart(base);
  if (rawA) for (const part of [rawA, firstArtist(rawA.replace(/\([^)]*\)/g, ' '))]) for (const v of artistVariants(firstArtist(part) || part)) addA(v);
  for (const v of artistVariants(parsed.artist)) addA(v);
  if (rawA) for (const part of rawA.split(/\s*(?:&|,|×|\bx\b|\bfeat\.?|\bft\.?)\s*/i).slice(1, 3)) addA(squash(part.replace(/\([^)]*\)/g, ' ')));
  if (ctx.chapterTitle && !hasArtistInTitle) addA(channel);
  if (channel) addA(channel);

  const titles: string[] = [];
  const addT = (t: string) => { const v = squash(t); if (v && !titles.includes(v)) titles.push(v); };
  const bare = bareTitle(parsed.title) || parsed.title;
  addT(bare);
  addT(scriptOnly(bare, 'hangul'));
  addT(scriptOnly(bare, 'latin'));
  // content of parentheses can be the alternate (English/Korean) title: "신기루 (illusion)"
  for (const m of parsed.title.matchAll(/\(([^)]+)\)/g)) if (!/\b(feat|ft|prod|remix|ver)\b/i.test(m[1])) addT(bareTitle(m[1]));

  const out: string[] = [];
  const add = (q: string) => {
    const v = squash(q);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  const [a0, ...aRest] = artists;
  // Multi-song videos whose chapter titles carry no artist: the only "artist" we have is the
  // uploader (a playlist channel), so search by the song title alone first; the video title
  // (e.g. "리센느 신곡 PULSE 앨범") still confirms the artist during scoring.
  const channelIsArtist = /official|\btopic\b|vevo|오피셜|공식/i.test(ctx.channel)
    || (!!channel && ctx.videoTitle.toLowerCase().includes(channel.toLowerCase()));
  if (ctx.chapterTitle && !hasArtistInTitle && !channelIsArtist) add(bare);
  add(`${a0 ?? ''} ${bare}`);
  for (const a of aRest.slice(0, 2)) add(`${a} ${bare}`);
  for (const t of titles.slice(1)) add(`${a0 ?? ''} ${t}`);
  if (ctx.chapterTitle && channel) add(`${channel} ${bareTitle(ctx.chapterTitle)}`);
  for (const a of aRest.slice(2)) add(`${a} ${bare}`);
  for (const t of titles.slice(1)) for (const a of aRest) add(`${a} ${t}`);
  add(bare);
  return { queries: out.slice(0, max), artist: parsed.artist, title: bare };
}
