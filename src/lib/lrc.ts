import type { LyricLine } from '../shared/types';

const TAG = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parse LRC text ("[mm:ss.xx] line"), sorted by time, multi-tag lines expanded, metadata tags dropped. */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const times: number[] = [];
    let rest = line;
    for (;;) {
      const m = /^\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*/.exec(rest);
      if (!m) break;
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      times.push(Number(m[1]) * 60 + Number(m[2]) + frac);
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue; // metadata ([ar:], [ti:] ...) or untagged
    const textPart = rest.replace(TAG, '').trim();
    for (const time of times) out.push({ time: Math.round(time * 1000) / 1000, text: textPart });
  }
  return out.map((l, i) => ({ l, i })).sort((a, b) => a.l.time - b.l.time || a.i - b.i).map((x) => x.l);
}
/** Index of the line active at t seconds (last line with time <= t), -1 if before the first. */
export function lineIndexAt(lines: LyricLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
