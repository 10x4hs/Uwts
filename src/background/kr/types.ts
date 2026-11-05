import type { LyricsResult } from '../../shared/types';

export type KrSource = 'bugs' | 'genie' | 'melon';
/** A song hit from a Korean music service. `plain` = lyrics already known from the search payload. */
export interface KrSong { source: KrSource; id: string; title: string; artist: string; duration?: number; plain?: string }
export type KrLyrics = LyricsResult & { duration?: number; source: KrSource };

/** "03:31" / "3:31" -> 211 */
export function mmss(s: string | undefined): number | undefined {
  const m = s?.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return undefined;
  return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}

export function plainLines(text: string): LyricsResult['lines'] {
  return text.replace(/<br\s*\/?>/gi, '\n').split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((t) => ({ time: -1, text: t }));
}

/**
 * Korean services stamp a line a little before it is sung (so it shows early). Measured against
 * Apple Music word onsets and LRCLIB on K-pop tracks (2026-11): Bugs ~0.35s early, Genie ~0.15s.
 * The panel starts the karaoke fill at the line time, so shift to the sung onset.
 */
export const SOURCE_LEAD: Record<KrSource, number> = { bugs: 0.35, genie: 0.15, melon: 0 };
export function delayLines(lines: LyricsResult['lines'], sec: number): LyricsResult['lines'] {
  return sec ? lines.map((l) => (l.time >= 0 ? { ...l, time: Math.round((l.time + sec) * 100) / 100 } : l)) : lines;
}
