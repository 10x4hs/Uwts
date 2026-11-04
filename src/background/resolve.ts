import type { LyricsResult, ResolveContext, SongQuery } from '../shared/types';
import { buildQueries } from '../lib/queries';
import { rank, scoreCandidate, scriptMismatch, HIGH_SCORE, MIN_SCORE, type ScoreContext } from '../lib/score';
import { resolveKey, overrideKey } from '../lib/keys';
import { searchTracks, getTrack, toResult, type LrclibTrack } from './lrclib';
import { searchSongs, lyricFor, type NeteaseSong } from './netease';
import type { KrLyrics, KrSong, KrSource } from './kr';

/** LyricsResult plus metadata; extra fields survive runtime messaging. */
export type Candidate = LyricsResult & { duration?: number; source: 'lrclib' | 'netease' | KrSource; score?: number };
export interface Resolved { result: Candidate | null; candidates: Candidate[]; query: SongQuery; partial?: boolean }

const DAY = 24 * 3600 * 1000;
const TTL_MS = 7 * DAY;
const NULL_TTL_MS = DAY;
const PARTIAL_TTL_MS = 30 * 60 * 1000; // deadline/failed requests: retry sooner
const DEADLINE_MS = 5000;
const CONCURRENCY = 4;
const SOFT_MS = 2500;
const SOFT_SCORE = 0.75;
const NETEASE_QUERIES = 2;
const NETEASE_LYRICS = 2;
const KR_QUERIES = 2;
const KR_LYRICS = 3;

export interface ResolveDeps {
  searchTracks: (q: string) => Promise<LrclibTrack[]>;
  getTrack: (a: string, t: string, d?: number) => Promise<LrclibTrack | null>;
  searchSongs: (q: string) => Promise<NeteaseSong[]>;
  lyricFor: (s: NeteaseSong) => Promise<LyricsResult | null>;
  now: () => number;
  deadlineMs: number;
  /** Opt-in Korean personal sources; absent when disabled. */
  kr?: { search: (q: string) => Promise<KrSong[]>; lyrics: (s: KrSong) => Promise<KrLyrics | null> };
}
export const defaultDeps: ResolveDeps = { searchTracks, getTrack, searchSongs, lyricFor, now: () => performance.now(), deadlineMs: DEADLINE_MS };

export function fromLrclibTrack(t: LrclibTrack): Candidate | null {
  if (t.instrumental) return null;
  const r = toResult(t);
  return r && r.lines.length ? { ...r, duration: t.duration ?? undefined, source: 'lrclib' } : null;
}

const candKey = (c: { artist: string; title: string; kind?: string; source?: string }) =>
  `${c.source}|${c.artist.toLowerCase()}|${c.title.toLowerCase()}|${c.kind}`;

/** Rank by score, but any synced candidate above the threshold beats every plain one. */
export function rankSyncedFirst<T extends Candidate>(cands: T[], sctx: ScoreContext) {
  const words = (c: Candidate) => Number(c.kind === 'synced' && c.lines.some((l) => l.words?.length));
  return rank(cands, sctx).sort((a, b) => Number(b.item.kind === 'synced') - Number(a.item.kind === 'synced')
    // word-by-word timing wins over line timing for (nearly) the same match
    || (Math.abs(b.score - a.score) < WORDS_EDGE ? words(b.item) - words(a.item) : 0)
    || b.score - a.score);
}
const WORDS_EDGE = 0.1;
/** After a confident line-timed hit, wait this long for a word-timed version of the same song. */
const WORDS_GRACE_MS = 600;

/** Simple concurrency limiter. */
function limiter(n: number) {
  let active = 0;
  const q: (() => void)[] = [];
  return <T>(fn: () => Promise<T>): Promise<T> => new Promise<T>((res, rej) => {
    const run = () => { active++; fn().then(res, rej).finally(() => { active--; q.shift()?.(); }); };
    if (active < n) run(); else q.push(run);
  });
}

/** Resolve a video to lyrics without caching (pure network + scoring). */
export async function resolveFresh(ctx: ResolveContext, deps: ResolveDeps = defaultDeps): Promise<Resolved> {
  const t0 = deps.now();
  const plan = buildQueries(ctx);
  const query: SongQuery = { artist: plan.artist, title: plan.title, duration: ctx.chapterDuration ?? ctx.videoDuration };
  const sctx: ScoreContext = { videoTitle: ctx.videoTitle, channel: ctx.channel, chapterTitle: ctx.chapterTitle, duration: ctx.chapterDuration ?? ctx.videoDuration };
  const pool = new Map<string, Candidate>();
  const limit = limiter(CONCURRENCY);
  let failures = 0;
  let tasks = 0;
  let succeeded = 0;

  return new Promise<Resolved>((resolve) => {
    let done = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (why: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(soft);
      if (grace) clearTimeout(grace);
      const ranked = rankSyncedFirst([...pool.values()], sctx);
      const candidates = ranked.slice(0, 8).map(({ item, score }) => ({ ...item, score }));
      const best = candidates[0] ?? null;
      console.debug(`[uwts] resolve ${ctx.videoId} ${why} in ${Math.round(deps.now() - t0)}ms`,
        best ? `${best.artist} - ${best.title} (${best.kind}, ${best.score})` : 'null', plan.queries);
      if (!best && succeeded === 0 && (failures > 0 || why === 'deadline')) {
        // no source answered at all (offline, LRCLIB 503-overloaded and NetEase down): report an
        // error so the panel retries, instead of caching a possibly-wrong "not found"
        resolve(Promise.reject(new Error('all lyric sources failed')) as never);
        return;
      }
      // some sources answered with nothing: "not found", kept only briefly (partial) when others failed
      resolve({ result: best, candidates, query, partial: why === 'deadline' || failures > 0 });
    };
    const timer = setTimeout(() => finish('deadline'), deps.deadlineMs);
    // soft deadline: a decent synced match is good enough once slow (retrying) requests drag on
    const soft = setTimeout(() => {
      const top = rankSyncedFirst([...pool.values()], sctx)[0];
      if (top && top.item.kind === 'synced' && top.score >= SOFT_SCORE) finish('soft');
    }, SOFT_MS);
    const videoText = `${ctx.videoTitle} ${ctx.chapterTitle ?? ''}`;
    const add = (c: Candidate | null) => {
      if (!c || done) return;
      if (scriptMismatch(c.lines.map((l) => l.text).join(' '), videoText)) return; // e.g. Japanese version of a K-pop MV
      const k = candKey(c);
      if (!pool.has(k)) pool.set(k, c);
      if (c.kind === 'synced' && scoreCandidate(c, sctx) >= HIGH_SCORE) {
        if (c.lines.some((l) => l.words?.length)) finish('early');
        else grace ??= setTimeout(() => finish('early'), WORDS_GRACE_MS);
      }
    };
    const jobs: Promise<unknown>[] = [];
    const job = (fn: () => Promise<void>) => {
      tasks++;
      jobs.push(limit(async () => { if (!done) { await fn(); succeeded++; } }).catch(() => { failures++; }));
    };
    if (plan.artist && plan.title) {
      job(async () => { const t = await deps.getTrack(plan.artist, plan.title, query.duration); if (t) add(fromLrclibTrack(t)); });
    }
    plan.queries.forEach((q, i) => {
      job(async () => { for (const t of await deps.searchTracks(q)) add(fromLrclibTrack(t)); });
      if (i < NETEASE_QUERIES) {
        job(async () => {
          const songs = await deps.searchSongs(q);
          const scored = songs
            .map((s) => ({ s, score: scoreCandidate({ artist: s.artists.map((a) => a.name).join(', '), title: s.name, duration: s.duration ? s.duration / 1000 : undefined, synced: true }, sctx) }))
            .filter((x) => x.score >= MIN_SCORE)
            .sort((a, b) => b.score - a.score)
            .slice(0, NETEASE_LYRICS);
          await Promise.all(scored.map(async ({ s }) => {
            const r = await deps.lyricFor(s).catch(() => null);
            if (r) add({ ...r, duration: s.duration ? s.duration / 1000 : undefined, source: 'netease' });
          }));
        });
      }
      if (deps.kr && i < KR_QUERIES) {
        const kr = deps.kr;
        job(async () => {
          const seen = new Set<string>();
          const scored = (await kr.search(q))
            .map((s) => ({ s, score: scoreCandidate({ artist: s.artist, title: s.title, duration: s.duration, synced: s.source !== 'melon' }, sctx) }))
            .filter((x) => x.score >= MIN_SCORE && !seen.has(`${x.s.source}|${x.s.id}`) && seen.add(`${x.s.source}|${x.s.id}`))
            // synced-capable services first, then score
            .sort((a, b) => Number(a.s.source === 'melon') - Number(b.s.source === 'melon') || b.score - a.score)
            .slice(0, KR_LYRICS);
          await Promise.all(scored.map(async ({ s }) => add(await kr.lyrics(s).catch(() => null))));
        });
      }
    });
    void Promise.all(jobs).then(() => finish('complete'));
  });
}

interface Stored { v: Resolved; at: number }

/** Cached resolve: user override > storage.local (7d, null 1d) > network. `fresh` skips the cache (user pressed retry). */
export async function resolveCached(ctx: ResolveContext, deps: ResolveDeps = defaultDeps, opts: { fresh?: boolean } = {}): Promise<Resolved> {
  // toggling personal sources must not serve results cached under the other setting
  const key = resolveKey(ctx.videoId, ctx.chapterTitle) + (deps.kr ? '|kr' : '');
  const okey = overrideKey(ctx.videoId, ctx.chapterTitle);
  const got = await chrome.storage.local.get([key, okey]).catch(() => ({} as Record<string, unknown>));
  const override = got[okey] as Candidate | undefined;
  const hit = got[key] as Stored | undefined;
  const fresh = hit && Date.now() - hit.at < (hit.v.partial ? PARTIAL_TTL_MS : hit.v.result ? TTL_MS : NULL_TTL_MS);
  if (override?.lines?.length) {
    const base = fresh ? hit.v : { candidates: [], query: { artist: override.artist, title: override.title } };
    return { ...base, result: override };
  }
  if (fresh && !opts.fresh) return hit.v;
  const v = await resolveFresh(ctx, deps);
  await chrome.storage.local.set({ [key]: { v, at: Date.now() } satisfies Stored }).catch(() => { /* quota */ });
  return v;
}
