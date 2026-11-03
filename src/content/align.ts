import type { LyricLine } from '../shared/types';

// ---------- syllable units ----------

/** A run of characters [start, end) worth `units` sung syllables. */
export interface Segment { start: number; end: number; units: number }

const HANGUL = /[가-힣]/;
const CJK = /[぀-ヿ一-鿿]/;
const LETTER = /[\p{L}\p{N}]/u;

/** Split text into sung units: Hangul/CJK char = 1, Latin word ≈ ceil(letters/3), punctuation/space = 0. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (HANGUL.test(c) || CJK.test(c)) { out.push({ start: i, end: i + 1, units: 1 }); i++; continue; }
    if (LETTER.test(c)) {
      let j = i;
      while (j < text.length && LETTER.test(text[j]) && !HANGUL.test(text[j]) && !CJK.test(text[j])) j++;
      out.push({ start: i, end: j, units: Math.max(1, Math.ceil((j - i) / 3)) });
      i = j; continue;
    }
    i++;
  }
  return out;
}

export function countUnits(text: string): number {
  return segments(text).reduce((s, g) => s + g.units, 0);
}

/** Character offset (fractional) reached after `p` units have been sung. */
export function unitsToChar(segs: Segment[], p: number): number {
  let left = p;
  for (const g of segs) {
    if (left <= 0) return g.start;
    if (left < g.units) return g.start + (g.end - g.start) * (left / g.units);
    left -= g.units;
  }
  return segs.length ? segs[segs.length - 1].end : 0;
}

// ---------- offset estimation ----------

export interface Onset { t: number; s: number } // video time (s, chapter-relative), strength

export const OFFSET_MIN = -5;
export const OFFSET_MAX = 90;
export const OFFSET_STEP = 0.1;
export const WINDOW = 0.25;
export const TAIL_SEC = 4;

/** Prior offset candidate from duration mismatch (intro before the song). */
export function priorOffset(videoDuration: number | undefined, lines: LyricLine[]): number {
  if (!videoDuration || !isFinite(videoDuration) || !lines.length) return 0;
  const trackEnd = lines[lines.length - 1].time + TAIL_SEC;
  const diff = videoDuration - trackEnd;
  return diff > 3 ? Math.min(90, Math.max(0, round1(diff))) : 0;
}

function lowerBound(a: Onset[], t: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}

/** Score of an offset: mean over observed line starts of the max onset strength within ±WINDOW. */
export function scoreOffset(sorted: Onset[], lineTimes: number[], offset: number): number {
  if (!sorted.length) return 0;
  const lo = sorted[0].t, hi = sorted[sorted.length - 1].t;
  let sum = 0, n = 0;
  for (const lt of lineTimes) {
    const c = lt + offset;
    if (c < lo - WINDOW || c > hi + WINDOW) continue;
    n++;
    let best = 0;
    for (let k = lowerBound(sorted, c - WINDOW); k < sorted.length && sorted[k].t <= c + WINDOW; k++) best = Math.max(best, sorted[k].s);
    sum += best;
  }
  return n >= 3 ? sum / Math.max(n, 8) : 0;
}

export interface Estimate { offset: number; confident: boolean; score: number; runnerUp: number }

/**
 * Grid-search the offset in [OFFSET_MIN, OFFSET_MAX]. Confident only when the best score is
 * ≥ 1.25× the best score more than 1s away; otherwise return `prior`.
 */
export function estimateOffset(onsets: Onset[], lines: LyricLine[], prior: number): Estimate {
  const sorted = [...onsets].sort((a, b) => a.t - b.t);
  const lineTimes = lines.filter((l) => l.time >= 0).map((l) => l.time);
  const scores: { o: number; s: number }[] = [];
  for (let k = 0; ; k++) {
    const o = round1(OFFSET_MIN + k * OFFSET_STEP);
    if (o > OFFSET_MAX + 1e-9) break;
    scores.push({ o, s: scoreOffset(sorted, lineTimes, o) });
  }
  let best = scores[0];
  for (const x of scores) if (x.s > best.s) best = x;
  let runnerUp = 0;
  for (const x of scores) if (Math.abs(x.o - best.o) > 1 && x.s > runnerUp) runnerUp = x.s;
  const confident = best.s > 0 && best.s >= 1.25 * runnerUp;
  return { offset: confident ? best.o : prior, confident, score: best.s, runnerUp };
}

/** Smoothly move from the current offset toward a confident estimate. */
export function smoothOffset(current: number, target: number): number {
  const d = target - current;
  if (Math.abs(d) < 0.15) return current;
  if (Math.abs(d) <= 1) return round1(current + d * 0.5);
  return target;
}

/** Before the first line (with a small lead-in) we show an intro state instead of a line. */
export function isIntro(lines: LyricLine[], lyricTime: number): boolean {
  const first = lines.find((l) => l.time >= 0);
  return !!first && lyricTime < first.time - 0.3;
}

// ---------- voice-driven fill ----------

export const VOICE_THRESHOLD = 0.25;

/** Monotonic karaoke progress (in units) for one line, driven by vocal activity. */
export class FillTracker {
  p = 0;
  constructor(public total: number, public start: number, public end: number) {}

  /**
   * Advance by dt seconds of lyric time at lyric time `now` with activity in [0,1].
   * Never goes backwards; guaranteed complete at `end`.
   */
  step(now: number, dt: number, activity: number): number {
    if (this.total <= 0) return (this.p = 0);
    const remainingTime = this.end - now;
    if (remainingTime <= 0) return (this.p = this.total);
    let next = this.p;
    if (activity > VOICE_THRESHOLD && dt > 0) {
      const factor = 0.6 + Math.min(1, Math.max(0, activity)) * 1.0; // 0.6..1.6
      next += ((this.total - this.p) / Math.max(0.05, remainingTime)) * factor * dt;
    }
    // lagging floor: the line can't fall far behind a linear wipe and must finish by `end`
    const span = Math.max(0.05, this.end - this.start);
    const lin = Math.min(1, Math.max(0, (now - this.start) / span));
    const floor = this.total * Math.max(0, (lin - 0.35) / 0.65);
    next = Math.min(this.total, Math.max(this.p, next, floor));
    return (this.p = next);
  }

  fraction(): number { return this.total > 0 ? this.p / this.total : 1; }
}

export function formatOffset(o: number): string {
  return `${o >= 0 ? '+' : '−'}${Math.abs(o).toFixed(1)}s`;
}

function round1(x: number): number { return Math.round(x * 10) / 10; }
