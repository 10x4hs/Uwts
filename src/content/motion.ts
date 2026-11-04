import type { LyricLine } from '../shared/types';
import { countUnits } from './align';

/** Fraction of the container height where the active line is anchored. */
export const ANCHOR = 0.35;
export const MAX_FILL_SEC = 6;
export const STAGGER_SEC = 0.04;
export const MAX_STAGGER_STEPS = 8;

/** Blur radius (px) for a line at `index` given the active line. 0 for active or while scrolling manually. */
export function blurLevel(index: number, active: number, manual = false): number {
  if (manual || index === active) return 0;
  return Math.min(5, 1 + Math.abs(index - active));
}

/** Per-line transition delay (s): the finished line, the new active line and everything above
 *  move together (0s); lines below follow in a short wave. None on seek. */
export function staggerDelay(index: number, active: number, seek: boolean): number {
  if (seek) return 0;
  const steps = Math.min(MAX_STAGGER_STEPS, Math.max(0, index - Math.max(active, 0)));
  return Math.round(steps * STAGGER_SEC * 1000) / 1000;
}

/** translateY (px) that puts a line whose top is `lineTop` at ANCHOR of the container. */
export function scrollOffset(lineTop: number, containerHeight: number, anchor = ANCHOR): number {
  return Math.round(containerHeight * anchor - lineTop);
}

/**
 * The song's singing pace (seconds per sung unit), learned from its own line timings.
 * A line's slot (until the next line) is often much longer than the singing itself
 * (instrumental breaks, held pauses), so the low-ish percentile of slot/units is used.
 */
export function singingPace(lines: LyricLine[]): number | undefined {
  const r: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i], span = lines[i + 1].time - a.time;
    const u = countUnits(a.text);
    if (a.time < 0 || u < 3 || span <= 0.3) continue;
    r.push(span / u);
  }
  if (r.length < 4) return undefined;
  r.sort((x, y) => x - y);
  return Math.min(PACE_MAX, Math.max(PACE_MIN, r[Math.floor(PACE_Q * (r.length - 1))]));
}
export const PACE_MIN = 0.1;
export const PACE_MAX = 0.8;
const PACE_Q = 0.4;
/** Slack over the estimate: a held last note, breaths. */
const SUNG_SCALE = 1.2;
const SUNG_PAD = 0.35;
const SUNG_MIN = 0.8;

/** How long line `line` is probably sung for, given its slot `span` and the song pace. */
export function sungSeconds(line: LyricLine, span: number, pace?: number): number {
  const w = line.words;
  if (w?.length) return Math.min(span, Math.max(0, w[w.length - 1].t + w[w.length - 1].d - line.time));
  if (!pace) return span;
  return Math.min(span, Math.max(SUNG_MIN, countUnits(line.text) * pace * SUNG_SCALE + SUNG_PAD));
}

/**
 * Karaoke fill timing for line i at media time t (seconds, relative to the song start).
 * Duration = the line's sung time: next.time - line.time capped at MAX_FILL_SEC (cap used for
 * the last line), shortened to the pace estimate (or the last word's end) so a line followed by
 * a break doesn't crawl. Delay is negative when entering mid-line. Scaled to wall-clock by playbackRate.
 */
export function fillTiming(lines: LyricLine[], i: number, t: number, rate = 1, pace?: number): { duration: number; delay: number } | null {
  const line = lines[i];
  if (!line || line.time < 0) return null;
  const next = lines[i + 1];
  const slot = next ? Math.min(MAX_FILL_SEC, Math.max(0, next.time - line.time)) : MAX_FILL_SEC;
  const span = sungSeconds(line, slot, pace);
  const r = rate > 0 ? rate : 1;
  const elapsed = Math.min(span, Math.max(0, t - line.time));
  return { duration: round3(span / r), delay: -round3(elapsed / r) };
}

/** Fractional character position reached at lyric time t on a line with word timing. */
export function wordChar(line: LyricLine, t: number): number {
  const w = line.words ?? [];
  const len = line.text.length;
  for (let k = 0; k < w.length; k++) {
    const a = w[k];
    const end = w[k + 1]?.c ?? len;
    if (t < a.t) return a.c; // waiting for this word
    if (t < a.t + a.d) return a.c + (end - a.c) * ((t - a.t) / Math.max(0.01, a.d));
  }
  return len;
}

/** Fill progress in [0,1] for line i at time t (for non-animated/fallback rendering). */
export function fillProgress(lines: LyricLine[], i: number, t: number): number {
  const f = fillTiming(lines, i, t);
  if (!f) return 0;
  if (f.duration === 0) return 1;
  return Math.min(1, -f.delay / f.duration);
}

/** True when moving from `prev` to `next` line index should be treated as a seek (no stagger). */
export function isSeek(prev: number, next: number): boolean {
  return prev >= 0 && next !== prev + 1;
}

/** Normalize a title for DOM/oEmbed comparison. */
export function normTitle(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function titlesMatch(dom: string, oembed: string): boolean {
  return !!dom && !!oembed && normTitle(dom) === normTitle(oembed);
}

/** Auto-retry once after the background's own retries have failed. */
export function shouldAutoRetry(failures: number): boolean {
  return failures === 1;
}

/** Monotonic navigation token: results from an older navigation are stale. */
export class NavToken {
  private n = 0;
  next(): number { return ++this.n; }
  isCurrent(token: number): boolean { return token === this.n; }
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
