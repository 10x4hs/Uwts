import type { LyricsResult, SongQuery } from '../shared/types';

export type Status = 'idle' | 'loading' | 'synced' | 'plain' | 'notfound' | 'error';

export interface PanelState {
  status: Status;
  query: SongQuery | null;
  result: LyricsResult | null;
  error: string | null;
  searchResults: LyricsResult[];
  searching: boolean;
  overridden: boolean;
}

export type Action =
  | { type: 'load'; query: SongQuery }
  | { type: 'loaded'; result: LyricsResult | null }
  | { type: 'failed'; error: string }
  | { type: 'search' }
  | { type: 'searchDone'; results: LyricsResult[] }
  | { type: 'searchFailed'; error: string }
  | { type: 'choose'; result: LyricsResult }
  | { type: 'reset' };

export const initialState: PanelState = {
  status: 'idle', query: null, result: null, error: null,
  searchResults: [], searching: false, overridden: false,
};

function statusFor(result: LyricsResult | null): Status {
  if (!result || result.lines.length === 0) return 'notfound';
  return result.kind;
}

export function reduce(s: PanelState, a: Action): PanelState {
  switch (a.type) {
    case 'reset': return initialState;
    case 'load': return { ...initialState, status: 'loading', query: a.query };
    case 'loaded': return { ...s, status: statusFor(a.result), result: a.result, error: null };
    case 'failed': return { ...s, status: 'error', error: a.error };
    case 'search': return { ...s, searching: true, error: null };
    case 'searchDone': return { ...s, searching: false, searchResults: a.results };
    case 'searchFailed': return { ...s, searching: false, searchResults: [], error: a.error };
    case 'choose': return { ...s, status: statusFor(a.result), result: a.result, overridden: true, searchResults: [], error: null };
  }
}

/** Same-song check so chapter re-resolution doesn't refetch needlessly. */
export function sameQuery(a: SongQuery | null, b: SongQuery | null): boolean {
  if (!a || !b) return a === b;
  return a.artist.toLowerCase() === b.artist.toLowerCase() && a.title.toLowerCase() === b.title.toLowerCase();
}

/** Extract shortDescription for videoId from raw ytInitialPlayerResponse script text. */
export function descriptionFromScript(text: string, videoId: string): string | null {
  if (!text.includes(`"videoId":"${videoId}"`)) return null;
  const m = text.match(/"shortDescription":("(?:[^"\\]|\\.)*")/);
  if (!m) return null;
  try { return JSON.parse(m[1]) as string; } catch { return null; }
}

/** Evenly spread angles (deg) for a particle burst of n dots, with jitter in [0,1). */
export function burstVectors(n: number, rand: () => number = Math.random): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const dist = 40 + rand() * 50;
    out.push({ dx: Math.round(Math.cos(ang) * dist), dy: Math.round(Math.sin(ang) * dist * 0.6) });
  }
  return out;
}
