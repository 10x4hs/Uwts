import type { LyricsResult, Palette, SongQuery } from './types';

export type Request =
  | { type: 'lyrics:get'; query: SongQuery }
  | { type: 'lyrics:search'; q: string }
  | { type: 'palette:get'; videoId: string }
  | { type: 'video:meta'; videoId: string };

export type Response<R extends Request> =
  R extends { type: 'lyrics:get' } ? { ok: true; result: LyricsResult | null } | { ok: false; error: string } :
  R extends { type: 'lyrics:search' } ? { ok: true; results: LyricsResult[] } | { ok: false; error: string } :
  R extends { type: 'palette:get' } ? { ok: true; palette: Palette } | { ok: false; error: string } :
  R extends { type: 'video:meta' } ? { ok: true; title: string; channel: string } | { ok: false; error: string } : never;

export function send<R extends Request>(req: R): Promise<Response<R>> {
  return chrome.runtime.sendMessage(req);
}
