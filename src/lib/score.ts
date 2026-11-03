const HANGUL = /[ㄱ-ㆎ가-힣]/;

/** Lowercase, NFKC, unify quotes, punctuation -> space. */
export function normText(s: string): string {
  return s.replace(/[\u3163\u1175]/g, ' ').normalize('NFKC').toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}
export const compact = (s: string) => normText(s).replace(/ /g, '');
const stripParens = (s: string) => s.replace(/\s*[(（[【][^)）\]】]*[)）\]】]/g, ' ').replace(/\s+/g, ' ').trim();

export interface ScoreInput { artist: string; title: string; duration?: number; synced?: boolean; kind?: string }
export interface ScoreContext { videoTitle: string; channel: string; chapterTitle?: string; duration?: number }

/** Track name variants: full, parens stripped, each parenthetical alternate. */
function titleVariants(t: string): string[] {
  const out = new Set<string>();
  const bare = stripParens(t).replace(/\s*\b(feat|ft)\.?\s.*$/i, '');
  out.add(normText(bare));
  for (const m of t.matchAll(/[(（[]([^)）\]]+)[)）\]]/g)) {
    if (!/\b(feat|ft|prod|remix|ver|version|inst|mr|live)\b/i.test(m[1])) out.add(normText(m[1]));
  }
  return [...out].filter((v) => v.length > 0);
}

/** Does phrase occur in hay? Latin: on token boundaries; Hangul: spacing-insensitive substring. */
export function phraseIn(phrase: string, hay: string): boolean {
  if (!phrase) return false;
  if (HANGUL.test(phrase)) {
    const p = phrase.replace(/ /g, '');
    return p.length >= 2 && hay.replace(/ /g, '').includes(p);
  }
  if (phrase.replace(/ /g, '').length < 2) return false;
  return ` ${hay} `.includes(` ${phrase} `);
}

function tokenOverlap(cand: string, hay: string): number {
  const ct = cand.split(' ').filter(Boolean);
  if (!ct.length) return 0;
  const ht = new Set(hay.split(' '));
  const hc = hay.replace(/ /g, '');
  let hit = 0;
  for (const t of ct) if (ht.has(t) || (HANGUL.test(t) && t.length >= 2 && hc.includes(t))) hit++;
  return hit / ct.length;
}

export function splitArtists(a: string): string[] {
  const out: string[] = [];
  for (const part of a.normalize('NFKC').split(/\s*(?:,|&|、|\/|;|\bfeat\.?|\bft\.?|\bx\b|×|\band\b)\s*/i)) {
    const main = stripParens(part);
    if (main) out.push(normText(main));
    for (const m of part.matchAll(/\(([^)]+)\)/g)) out.push(normText(m[1]));
  }
  // "Seungri 승리" -> also each script separately
  for (const p of [...out]) {
    const h = p.split(' ').filter((w) => HANGUL.test(w)).join(' ');
    const l = p.split(' ').filter((w) => !HANGUL.test(w)).join(' ');
    if (h && l) out.push(h, l);
  }
  return [...new Set(out.filter((x) => x.length > 0))];
}

/** Duration score in [0,1]: MVs can run ~90s longer than the track. */
export function durationScore(cand?: number, video?: number): number {
  if (cand == null || video == null || !cand || !video) return 0.5;
  if (cand > video + 3) return Math.max(0, 1 - (cand - video - 3) / 15);
  const shorter = video - cand;
  if (shorter > 120) return Math.max(0, 1 - (shorter - 120) / 120);
  return 1;
}

export const MIN_SCORE = 0.55;
export const HIGH_SCORE = 0.85;

/** Score a candidate against the raw video info. Returns 0 for clear rejects. */
export function scoreCandidate(c: ScoreInput, ctx: ScoreContext): number {
  const titleHay = normText(`${ctx.chapterTitle ?? ''} ${ctx.chapterTitle ? '' : ctx.videoTitle}`);
  const hay = normText(`${ctx.videoTitle} ${ctx.chapterTitle ?? ''} ${ctx.channel}`);
  const tv = titleVariants(c.title);
  let title = 0;
  for (const v of tv) {
    // digits-only alternates like "(1, 2, 3!)" are weak evidence
    if (phraseIn(v, titleHay)) { title = Math.max(title, /\p{L}/u.test(v) ? 1 : 0.7); if (title === 1) break; continue; }
    title = Math.max(title, tokenOverlap(v, titleHay) * 0.8);
  }
  if (title < 0.5) return 0;
  const arts = splitArtists(c.artist);
  let artist = 0;
  for (const a of arts) {
    if (phraseIn(a, hay)) { artist = 1; break; }
    artist = Math.max(artist, tokenOverlap(a, hay) * 0.6);
  }
  const dur = durationScore(c.duration, ctx.duration);
  if (dur === 0 && artist < 1) return 0;
  // version markers on the candidate (remix, inst, sped up...) that the video doesn't mention
  const VERSION = /\b(remix|inst|instrumental|mr|sped\s*up|slowed|acoustic|live|ver|version|cover|karaoke|english|japanese|jp)\b|버전/gi;
  const videoAll = normText(`${ctx.videoTitle} ${ctx.chapterTitle ?? ''}`);
  const extra = (normText(c.title).match(VERSION) ?? []).filter((w) => !` ${videoAll} `.includes(` ${w} `)).length;
  const s = 0.5 * title - (extra ? 0.2 : 0) + 0.3 * artist + 0.15 * dur + ((c.synced ?? c.kind === 'synced') ? 0.05 : 0);
  return Math.round(s * 1000) / 1000;
}

export function rank<T extends ScoreInput>(cands: T[], ctx: ScoreContext): { item: T; score: number }[] {
  return cands.map((item) => ({ item, score: scoreCandidate(item, ctx) }))
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
}

const HANGUL_ALL = /\p{Script=Hangul}/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HAN = /\p{Script=Han}/gu;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/**
 * Reject lyrics written in a different script than the video implies, e.g. the Japanese
 * version of a K-pop song ("1, 2, 3!" by V.I) for a Korean MV. Only fires when the video
 * title has Hangul and no kana, and the lyrics are dominated by kana/Han with little Hangul.
 */
export function scriptMismatch(lyricsText: string, videoText: string): boolean {
  const vHangul = count(videoText, HANGUL_ALL), vKana = count(videoText, KANA);
  if (vHangul === 0 || vKana > 0) return false;
  const h = count(lyricsText, HANGUL_ALL), k = count(lyricsText, KANA), c = count(lyricsText, HAN);
  const foreign = k + c;
  return foreign >= 20 && foreign > h * 3;
}

/**
 * Relevance of a search result to what the user typed: share of query tokens found in
 * "artist title" (either direction, so short queries like "whiplash" still match).
 * NetEase returns unrelated popular songs for unknown queries; those score 0.
 */
export function searchRelevance(query: string, artist: string, title: string): number {
  const q = normText(query), hay = normText(`${artist} ${title}`);
  if (!q || !hay) return 0;
  return Math.max(tokenOverlap(q, hay), tokenOverlap(normText(title), q));
}

/** Keep results relevant to the query, most relevant first, synced before plain on ties. */
export function rankSearch<T extends { artist: string; title: string; kind: string }>(query: string, list: T[]): T[] {
  return list
    .map((r) => ({ r, s: searchRelevance(query, r.artist, r.title) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s || Number(b.r.kind === 'synced') - Number(a.r.kind === 'synced'))
    .map((x) => x.r);
}

export type SearchMatch = 'exact' | 'partial';

/**
 * Group a search hit: 'exact' when the candidate title (or a parenthetical alternate) equals the
 * query, the query occurs in the title, the title occurs in the query with every other query token
 * found in artist+title, or simply all query tokens appear in artist+title. Otherwise 'partial' if
 * relevance >= 0.5, else null (dropped).
 */
export function searchMatch(query: string, artist: string, title: string): SearchMatch | null {
  const q = normText(query);
  if (!q) return null;
  const hay = normText(`${artist} ${title}`);
  const tn = normText(title);
  if (tokenOverlap(q, hay) === 1) return 'exact';
  if (titleVariants(title).some((v) => v === q || phraseIn(q, v)) || phraseIn(q, tn)) return 'exact';
  return searchRelevance(query, artist, title) >= 0.5 ? 'partial' : null;
}

/** Search results tagged exact|partial: exact first, then by relevance, synced before plain on ties. */
export function groupSearch<T extends { artist: string; title: string; kind: string }>(query: string, list: T[]): (T & { match: SearchMatch })[] {
  const out: { r: T & { match: SearchMatch }; s: number; t: number }[] = [];
  const q = normText(query);
  const seen = new Set<string>();
  for (const r of list) {
    // LRCLIB holds many user uploads of the same track (often with slightly different lengths):
    // keep only the first, i.e. best-sourced, per title/artist/kind
    const key = `${normText(displayTitleKey(r.title))}|${normText(r.artist)}|${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let match = searchMatch(query, r.artist, r.title);
    // covers/remixes/instrumentals only count as exact when the user asked for them
    if (match === 'exact' && isVariant(r.title) && !isVariant(query)) match = 'partial';
    // t: share of the candidate's words that the query covers (fewer extra words = closer)
    if (match) out.push({ r: { ...r, match }, s: searchRelevance(query, r.artist, r.title), t: tokenOverlap(normText(`${r.artist} ${r.title}`), q) });
  }
  return out
    .sort((a, b) => Number(b.r.match === 'exact') - Number(a.r.match === 'exact') || b.s - a.s || b.t - a.t
      || Number(b.r.kind === 'synced') - Number(a.r.kind === 'synced'))
    .map((x) => x.r);
}


const VARIANT = /\b(cover|covered|remix|inst\.?|instrumental|karaoke|mr|acoustic|live|sped ?up|slowed|nightcore|ver\.?|version)\b|커버|리믹스|반주|라이브|伴奏|翻唱|抖音|dj版/i;
/** Cover/remix/instrumental/live and similar non-original versions. */
export function isVariant(s: string): boolean {
  return VARIANT.test(s);
}

/** "LOVE ATTACK (LOVE ATTACK)" -> "LOVE ATTACK" for de-duplication. */
function displayTitleKey(t: string): string {
  const m = t.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return m && m[1] && m[1].trim().toLowerCase() === m[2].trim().toLowerCase() ? m[1] : t;
}
