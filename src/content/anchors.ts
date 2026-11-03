import type { LyricLine } from '../shared/types';
import { countUnits } from './align';

/** "Line `lineIndex` is sung at `videoTime`" (seconds, chapter-relative video time). */
export interface Anchor { lineIndex: number; videoTime: number }

/**
 * Add an anchor, replacing any anchor on the same line and dropping anchors that would
 * contradict it (earlier line sung later, or later line sung earlier). Result sorted by line.
 */
export function addAnchor(list: Anchor[], a: Anchor): Anchor[] {
  const kept = list.filter((x) =>
    x.lineIndex !== a.lineIndex &&
    !(x.lineIndex < a.lineIndex && x.videoTime >= a.videoTime) &&
    !(x.lineIndex > a.lineIndex && x.videoTime <= a.videoTime));
  return [...kept, a].sort((p, q) => p.lineIndex - q.lineIndex);
}

/** Anchors that point at existing lines, sorted, strictly increasing in both index and time. */
function clean(lines: LyricLine[], anchors: Anchor[]): Anchor[] {
  const out: Anchor[] = [];
  for (const a of [...anchors].sort((p, q) => p.lineIndex - q.lineIndex)) {
    if (a.lineIndex < 0 || a.lineIndex >= lines.length || !isFinite(a.videoTime)) continue;
    const last = out[out.length - 1];
    if (last && (a.lineIndex === last.lineIndex || a.videoTime <= last.videoTime)) continue;
    out.push(a);
  }
  return out;
}

/** Piecewise-linear map through points (x→y), extrapolating with the nearest end's offset. */
function piecewise(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return x + (ys[0] - xs[0]);
  if (x >= xs[n - 1]) return x + (ys[n - 1] - xs[n - 1]);
  let k = 0;
  while (k < n - 2 && x > xs[k + 1]) k++;
  const span = xs[k + 1] - xs[k];
  return span > 0 ? ys[k] + ((x - xs[k]) / span) * (ys[k + 1] - ys[k]) : ys[k];
}

function monotonic(times: number[]): number[] {
  for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) times[i] = times[i - 1];
  return times;
}

/** Synced lyrics: 1 anchor = constant offset; ≥2 = piecewise-linear lyric→video mapping. */
export function mapSynced(lines: LyricLine[], anchors: Anchor[]): LyricLine[] {
  const as = clean(lines, anchors).filter((a) => lines[a.lineIndex].time >= 0);
  if (!as.length) return lines;
  // collapse anchors whose lyric times don't increase (duplicate timestamps)
  const xs: number[] = [], ys: number[] = [];
  for (const a of as) {
    const x = lines[a.lineIndex].time;
    if (xs.length && x <= xs[xs.length - 1]) continue;
    xs.push(x); ys.push(a.videoTime);
  }
  const times = monotonic(lines.map((l) => (l.time < 0 ? NaN : piecewise(xs, ys, l.time))));
  return lines.map((l, i) => ({ ...l, time: l.time < 0 ? l.time : Math.max(0, times[i]) }));
}

/**
 * Plain lyrics: with ≥2 anchors, time every line by sung-unit position between anchors;
 * outside the anchors, extrapolate at the average units-per-second. Null with <2 anchors.
 */
export function interpolatePlain(lines: LyricLine[], anchors: Anchor[]): LyricLine[] | null {
  const as = clean(lines, anchors);
  if (as.length < 2) return null;
  // cumulative unit position of each line's start
  const pos: number[] = [];
  let acc = 0;
  for (const l of lines) { pos.push(acc); acc += countUnits(l.text); }
  // fall back to line index if the anchored span has no units
  const usePos = pos[as[as.length - 1].lineIndex] > pos[as[0].lineIndex];
  const x = (i: number) => (usePos ? pos[i] : i);
  const xs: number[] = [], ys: number[] = [];
  for (const a of as) {
    const xi = x(a.lineIndex);
    if (xs.length && xi <= xs[xs.length - 1]) continue; // unitless lines between anchors
    xs.push(xi); ys.push(a.videoTime);
  }
  if (xs.length < 2) return null;
  const rate = (ys[ys.length - 1] - ys[0]) / (xs[xs.length - 1] - xs[0]); // sec per unit
  const at = (v: number): number => {
    if (v <= xs[0]) return ys[0] - (xs[0] - v) * rate;
    if (v >= xs[xs.length - 1]) return ys[ys.length - 1] + (v - xs[xs.length - 1]) * rate;
    return piecewise(xs, ys, v);
  };
  const times = monotonic(lines.map((_, i) => at(x(i))));
  return lines.map((l, i) => ({ ...l, time: Math.max(0, Math.round(times[i] * 1000) / 1000) }));
}

/** Lines in video time for display, or null if they can't be time-synced (plain, <2 anchors). */
export function timedLines(kind: 'synced' | 'plain', lines: LyricLine[], anchors: Anchor[]): LyricLine[] | null {
  return kind === 'synced' ? mapSynced(lines, anchors) : interpolatePlain(lines, anchors);
}

export function parseAnchors(v: unknown): Anchor[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a): a is Anchor => !!a && typeof a.lineIndex === 'number' && typeof a.videoTime === 'number');
}

/** Search results: exact first, then partial (missing match = exact). Stable within groups. */
export function groupByMatch<T extends { match?: 'exact' | 'partial' }>(list: T[]): { exact: T[]; partial: T[] } {
  return { exact: list.filter((r) => r.match !== 'partial'), partial: list.filter((r) => r.match === 'partial') };
}
