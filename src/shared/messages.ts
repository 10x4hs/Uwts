import type { Skip } from '../lib/skips';
import type { LyricLine, LyricsResult, Palette, ResolveContext, SongQuery } from './types';

export type Request =
  | { type: 'lyrics:get'; query: SongQuery }
  | { type: 'lyrics:search'; q: string }
  | { type: 'palette:get'; videoId: string }
  | { type: 'video:meta'; videoId: string }
  | { type: 'lyrics:resolve'; ctx: ResolveContext; fresh?: boolean }
  | { type: 'perm:status' }
  | { type: 'perm:open' }
  | { type: 'update:status' }
  | { type: 'skips:get'; videoId: string; duration?: number }
  | { type: 'asset:css' }
  | { type: 'lyrics:words'; artist: string; title: string; duration?: number; lines: LyricLine[] };

export type Response<R extends Request> =
  R extends { type: 'lyrics:get' } ? { ok: true; result: LyricsResult | null } | { ok: false; error: string } :
  R extends { type: 'lyrics:search' } ? { ok: true; results: SearchHit[] } | { ok: false; error: string } :
  R extends { type: 'palette:get' } ? { ok: true; palette: Palette } | { ok: false; error: string } :
  R extends { type: 'perm:status' } ? { ok: true; granted: boolean } :
  R extends { type: 'perm:open' } ? { ok: true } :
  R extends { type: 'lyrics:words' } ? { ok: true; lines: LyricLine[] | null } | { ok: false; error: string } :
  R extends { type: 'skips:get' } ? { ok: true; skips: Skip[] } | { ok: false; error: string } :
  R extends { type: 'asset:css' } ? { ok: true; css: string } | { ok: false; error: string } :
  R extends { type: 'update:status' } ? { ok: true; current: string; latest?: string; url?: string } :
  R extends { type: 'lyrics:resolve' } ? { ok: true; result: LyricsResult | null; candidates: LyricsResult[]; query: SongQuery; picked?: boolean } | { ok: false; error: string } :
  R extends { type: 'video:meta' } ? { ok: true; title: string; channel: string; description?: string; duration?: number } | { ok: false; error: string } : never;

/** A lyrics:search result; `match` groups exact hits above a "비슷한 결과" divider. */
export type SearchHit = LyricsResult & { match?: 'exact' | 'partial'; duration?: number; source?: string };

/** Opt-in personal Korean sources (Bugs/Genie/Melon): chrome.storage.local flag + optional hosts. */
export const KR_FLAG = 'uw:opt:krSources';
export const KR_ORIGINS = ['https://*.bugs.co.kr/*', 'https://*.genie.co.kr/*', 'https://*.melon.com/*'];

/** Origins the background needs beyond CORS-open LRCLIB (NetEase has no CORS headers). */
export const EXTRA_ORIGINS = ['https://music.163.com/*', 'https://www.youtube.com/*'];

/** Thrown when the extension was reloaded/updated under an already-open tab. */
export class ContextInvalidated extends Error {
  constructor() { super('context-invalidated'); }
}

export async function send<R extends Request>(req: R): Promise<Response<R>> {
  if (!chrome.runtime?.id) throw new ContextInvalidated();
  try {
    return await chrome.runtime.sendMessage(req);
  } catch (e) {
    if (e instanceof Error && /context invalidated|Receiving end does not exist/i.test(e.message) && !chrome.runtime?.id) throw new ContextInvalidated();
    throw e;
  }
}
