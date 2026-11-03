import type { LyricsResult, Palette, ResolveContext, SongQuery } from './types';

export type Request =
  | { type: 'lyrics:get'; query: SongQuery }
  | { type: 'lyrics:search'; q: string }
  | { type: 'palette:get'; videoId: string }
  | { type: 'video:meta'; videoId: string }
  | { type: 'lyrics:resolve'; ctx: ResolveContext }
  | { type: 'perm:status' }
  | { type: 'perm:open' };

export type Response<R extends Request> =
  R extends { type: 'lyrics:get' } ? { ok: true; result: LyricsResult | null } | { ok: false; error: string } :
  R extends { type: 'lyrics:search' } ? { ok: true; results: LyricsResult[] } | { ok: false; error: string } :
  R extends { type: 'palette:get' } ? { ok: true; palette: Palette } | { ok: false; error: string } :
  R extends { type: 'perm:status' } ? { ok: true; granted: boolean } :
  R extends { type: 'perm:open' } ? { ok: true } :
  R extends { type: 'lyrics:resolve' } ? { ok: true; result: LyricsResult | null; candidates: LyricsResult[]; query: SongQuery } | { ok: false; error: string } :
  R extends { type: 'video:meta' } ? { ok: true; title: string; channel: string; description?: string; duration?: number } | { ok: false; error: string } : never;

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
