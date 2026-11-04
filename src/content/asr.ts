import type { LyricLine } from '../shared/types';

/** One auto-caption segment: start time in video seconds (same shape as src/lib/timeline.ts). */
export interface TranscriptSeg { time: number; text: string }

export interface AsrAlignment {
  /** Synced lyrics: video time of lyric t=0 (videoTime ≈ lyricTime + offset). null for plain lyrics. */
  offset: number | null;
  /** Strictly increasing in both lineIndex and videoTime. */
  anchors: { lineIndex: number; videoTime: number }[];
  /** Supporting word matches. */
  matches: number;
  confident: boolean;
}

/*
 * Approach (why it works on ASR captions):
 * - ASR mishears single words but usually gets most adjacent word PAIRS right, and a pair is far more
 *   specific than a single word, so we match caption bigrams against lyric bigrams.
 * - Captions segments don't line up with lyric lines, so every word gets an estimated time by spreading
 *   it linearly between its segment start and the next segment start (capped per word, since segments
 *   often end with a long instrumental gap).
 * - Synced: each bigram match votes for an offset (caption time − lyric time). The true offset collects
 *   many consistent votes (choruses vote for wrong offsets too, but those scatter); the histogram peak,
 *   refined by a median, is robust to that.
 * - Plain: no times, so we look for each line's best caption hits and keep the longest chain that is
 *   increasing in both line index and time (repeated choruses produce many hits; the chain picks a
 *   consistent subset).
 */

const WORD_CAP = 0.6;       // max seconds per word when spreading words across a segment/line
const PLAIN_WORD_SEC = 0.35; // assumed singing rate when backing a line's start out of a mid-line match
const MAX_PLACEMENTS = 6; // per plain line: a chorus line rarely recurs more than this in one song
const FILLER = /^\s*[[(（【][^\])）】]*[\])）】]\s*$/; // "[Music]", "[음악]", "(Applause)" ...

export function normalizeWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[[(（【][^\])）】]*[\])）】]/g, ' ') // bracketed sound tags
    .replace(/['’`]/g, '')                       // "you're" → "youre"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

interface Word { w: string; t: number; line: number; pos: number }

/** Spread each unit's words between its time and the next unit's time (cap WORD_CAP per word). */
function spread(units: { time: number; text: string }[], line: (i: number) => number): Word[] {
  const out: Word[] = [];
  for (let i = 0; i < units.length; i++) {
    const ws = normalizeWords(units[i].text);
    if (!ws.length) continue;
    const next = i + 1 < units.length ? units[i + 1].time : Infinity;
    const step = Math.min(WORD_CAP, Math.max(0, next - units[i].time) / ws.length);
    ws.forEach((w, pos) => out.push({ w, t: units[i].time + pos * step, line: line(i), pos }));
  }
  return out;
}

function captionWords(segs: TranscriptSeg[], from: number, to: number): Word[] {
  const kept = segs
    .filter((s) => isFinite(s.time) && !FILLER.test(s.text))
    .sort((a, b) => a.time - b.time);
  return spread(kept, () => -1).filter((w) => w.t >= from && w.t <= to);
}

const key = (a: Word, b: Word) => a.w + ' ' + b.w;

export function alignToTranscript(
  lines: LyricLine[], segs: TranscriptSeg[], window: { start: number; end: number },
): AsrAlignment | null {
  if (!lines.length || !segs.length) return null;
  const synced = lines.every((l) => l.time >= 0);
  return synced ? alignSynced(lines, segs, window) : alignPlain(lines, segs, window);
}

/* ---------------- synced ---------------- */

function alignSynced(lines: LyricLine[], segs: TranscriptSeg[], win: { start: number; end: number }): AsrAlignment | null {
  const SLACK = 15;
  const lo = win.start - SLACK, hi = win.end + SLACK; // allowed offsets
  const lyr = spread(lines, (i) => i);
  if (lyr.length < 2) return null;
  const songLen = lines[lines.length - 1].time + 15;
  const cap = captionWords(segs, lo, hi + songLen);
  if (cap.length < 2) return null;

  // lyric bigram → indices of its first word
  const index = new Map<string, number[]>();
  for (let j = 0; j + 1 < lyr.length; j++) {
    if (lyr[j].line !== lyr[j + 1].line) continue; // bigrams don't cross lines
    const k = key(lyr[j], lyr[j + 1]);
    (index.get(k) ?? index.set(k, []).get(k)!).push(j);
  }

  const cands: { off: number; j: number; i: number }[] = [];
  for (let i = 0; i + 1 < cap.length; i++) {
    const js = index.get(key(cap[i], cap[i + 1]));
    if (!js) continue;
    for (const j of js) {
      const off = cap[i].t - lyr[j].t;
      if (off >= lo && off <= hi) cands.push({ off, j, i });
    }
  }
  if (!cands.length) return null;

  // 1-second histogram, peak smoothed over neighbours (a true offset can straddle a bin edge)
  const bins = new Map<number, number>();
  for (const c of cands) { const b = Math.floor(c.off); bins.set(b, (bins.get(b) ?? 0) + 1); }
  let best = 0, bestScore = -1;
  for (const b of bins.keys()) {
    const s = (bins.get(b - 1) ?? 0) + (bins.get(b) ?? 0) + (bins.get(b + 1) ?? 0);
    if (s > bestScore) { bestScore = s; best = b + 0.5; }
  }
  let support = cands.filter((c) => Math.abs(c.off - best) <= 1.5);
  const offs = support.map((c) => c.off).sort((a, b) => a - b);
  const offset = offs[offs.length >> 1];
  support = cands.filter((c) => Math.abs(c.off - offset) <= 1.5);

  const matches = support.length;
  const hit = new Set(support.map((c) => lyr[c.j].line));
  // Tuned on the xmas fixtures: a wrong song still shares a few stock phrases ("in my", "you can") and a
  // repeated hook can pile up 7 votes on ~3 lines, so also require the votes to cover ≥ 4 distinct lines.
  const confident = matches >= 6 && hit.size >= 4 && matches / cands.length >= 0.35;

  const anchors: AsrAlignment['anchors'] = [];
  for (const li of [...hit].sort((a, b) => a - b)) {
    const v = lines[li].time + offset;
    const last = anchors[anchors.length - 1];
    if (!last || v > last.videoTime) anchors.push({ lineIndex: li, videoTime: round(v) });
  }
  return { offset: round(offset), anchors, matches, confident };
}

/* ---------------- plain ---------------- */

function alignPlain(lines: LyricLine[], segs: TranscriptSeg[], win: { start: number; end: number }): AsrAlignment | null {
  const cap = captionWords(segs, win.start - 15, win.end + 420);
  if (cap.length < 2) return null;
  const capIdx = new Map<string, number[]>();
  for (let i = 0; i + 1 < cap.length; i++) {
    const k = key(cap[i], cap[i + 1]);
    (capIdx.get(k) ?? capIdx.set(k, []).get(k)!).push(i);
  }

  // Candidate placements: for each line, caption start positions (line start projected back) voted by
  // its bigrams; a placement's score = number of the line's bigrams that land on it.
  interface Cand { line: number; t: number; score: number }
  const cands: Cand[] = [];
  lines.forEach((l, li) => {
    const ws = normalizeWords(l.text);
    if (ws.length < 2) return;
    const votes = new Map<number, { score: number; t: number }>(); // caption index of line start → vote
    for (let p = 0; p + 1 < ws.length; p++) {
      for (const i of capIdx.get(ws[p] + ' ' + ws[p + 1]) ?? []) {
        const s = i - p;
        const v = votes.get(s);
        if (v) v.score++;
        else votes.set(s, { score: 1, t: cap[i].t - p * PLAIN_WORD_SEC });
      }
    }
    // merge near-identical starts (ASR may insert/drop a word)
    const sorted = [...votes.entries()].sort((a, b) => a[0] - b[0]);
    const mine: Cand[] = [];
    for (let k = 0; k < sorted.length; k++) {
      let { score, t } = sorted[k][1];
      while (k + 1 < sorted.length && sorted[k + 1][0] - sorted[k][0] <= 1) { score += sorted[++k][1].score; }
      const need = ws.length <= 3 ? 1 : 2;
      if (score >= need) mine.push({ line: li, t, score });
    }
    // keep only the best few placements per line so the O(n²) chain stays cheap on repetitive songs
    cands.push(...mine.sort((a, b) => b.score - a.score).slice(0, MAX_PLACEMENTS));
  });
  if (!cands.length) return null;

  // Heaviest chain strictly increasing in line and time (O(n²), n is small: hundreds at most).
  cands.sort((a, b) => a.line - b.line || a.t - b.t);
  const dp = cands.map((c) => c.score), prev = cands.map(() => -1);
  for (let b = 0; b < cands.length; b++)
    for (let a = 0; a < b; a++)
      if (cands[a].line < cands[b].line && cands[a].t < cands[b].t && dp[a] + cands[b].score > dp[b]) {
        dp[b] = dp[a] + cands[b].score; prev[b] = a;
      }
  let end = 0;
  for (let b = 1; b < cands.length; b++) if (dp[b] > dp[end]) end = b;
  const chain: Cand[] = [];
  for (let k = end; k >= 0; k = prev[k]) chain.unshift(cands[k]);

  const anchors = chain.map((c) => ({ lineIndex: c.line, videoTime: round(c.t) }));
  const nonEmpty = lines.filter((l) => normalizeWords(l.text).length).length || 1;
  const span = anchors.length ? anchors[anchors.length - 1].lineIndex - anchors[0].lineIndex + 1 : 0;
  const confident = anchors.length >= 3 && span >= 0.3 * nonEmpty;
  return { offset: null, anchors, matches: dp[end], confident };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
