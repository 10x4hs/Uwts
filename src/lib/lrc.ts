import type { LyricLine, LyricWord } from '../shared/types';

const TAG = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d+):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
/** Last word of a line with no closing tag: assume it lasts at most this long. */
const LAST_WORD_SEC = 1;

const secs = (m: string, s: string, f?: string) => Number(m) * 60 + Number(s) + (f ? Number(f) / 10 ** f.length : 0);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Enhanced LRC body ("<00:01.00>Every<00:01.40>body") -> text + word timings (d = -1 until known). */
function parseWords(body: string): { text: string; words?: LyricWord[] } {
  if (!WORD_TAG.test(body)) return { text: body.trim() };
  WORD_TAG.lastIndex = 0;
  const marks: { t: number; at: number; end: number }[] = [];
  for (const m of body.matchAll(WORD_TAG)) marks.push({ t: secs(m[1], m[2], m[3]), at: m.index, end: m.index + m[0].length });
  const lead = body.slice(0, marks[0].at).trim();
  let text = lead ? `${lead} ` : '';
  const words: LyricWord[] = [];
  marks.forEach((k, i) => {
    let chunk = body.slice(k.end, marks[i + 1]?.at ?? body.length);
    if (!text) chunk = chunk.trimStart();
    if (!chunk.trim()) return; // closing tag: ends the previous word
    const next = marks[i + 1];
    words.push({ t: r3(k.t), d: next ? r3(Math.max(0, next.t - k.t)) : -1, c: text.length });
    text += chunk;
  });
  const out = text.trimEnd();
  return words.length ? { text: out, words } : { text: out };
}

/** Parse LRC text ("[mm:ss.xx] line", optionally with enhanced "<mm:ss.xx>" word tags), sorted by time, multi-tag lines expanded, metadata tags dropped. */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const times: number[] = [];
    let rest = line;
    for (;;) {
      const m = /^\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*/.exec(rest);
      if (!m) break;
      times.push(secs(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue; // metadata ([ar:], [ti:] ...) or untagged
    const { text: textPart, words } = parseWords(rest.replace(TAG, ''));
    for (const time of times) {
      const l: LyricLine = { time: r3(time), text: textPart };
      // word tags carry absolute times: only valid for the line's own (first) timestamp
      if (words && time === times[0]) l.words = words.map((w) => ({ ...w }));
      out.push(l);
    }
  }
  const sorted = out.map((l, i) => ({ l, i })).sort((a, b) => a.l.time - b.l.time || a.i - b.i).map((x) => x.l);
  sorted.forEach((l, i) => {
    const last = l.words?.[l.words.length - 1];
    if (last && last.d < 0) last.d = r3(Math.max(0.1, Math.min(LAST_WORD_SEC, (sorted[i + 1]?.time ?? Infinity) - last.t)));
  });
  return sorted;
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
