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
  /** Synced: the video moves the song by different amounts in different parts (a skit or cut mid-song);
   *  `anchors` then carry each part's own offset. */
  segmented?: boolean;
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

  const split = splitRuns(lines, lyr, cands, offset);
  if (split) {
    const ok = split.matches >= 6 && split.lines >= 4 && split.matches / cands.length >= 0.35;
    return { offset: round(offset), anchors: split.anchors, matches: split.matches, confident: ok, segmented: true };
  }

  const anchors: AsrAlignment['anchors'] = [];
  for (const li of [...hit].sort((a, b) => a - b)) {
    const v = lines[li].time + offset;
    const last = anchors[anchors.length - 1];
    if (!last || v > last.videoTime) anchors.push({ lineIndex: li, videoTime: round(v) });
  }
  return { offset: round(offset), anchors, matches, confident };
}

/*
 * Per-part offsets. A music video can stretch the song: a skit or a dance break in the middle moves
 * every later line by its length, so one offset fits only one side. Votes then form several offset
 * peaks; each lyric line picks the peak its bigrams back, and the heaviest chain that keeps both line
 * order and video time (with a cost per offset change, so a repeated chorus can't flip back and forth)
 * decides where the song shifts. Parts must span ≥ RUN_LINES lines and differ by > MIN_SHIFT s,
 * otherwise it's one offset.
 */
const PEAK_VOTES = 6;
const RUN_LINES = 3;
const RUN_VOTES = 4;
const SWITCH_COST = 4;
/** Caption timing wobbles by a second or two; only bigger jumps are real cuts or skits. */
const MIN_SHIFT = 3;

function splitRuns(
  lines: LyricLine[], lyr: Word[], cands: { off: number; j: number }[], global: number,
): { anchors: AsrAlignment['anchors']; matches: number; lines: number } | null {
  const bins = new Map<number, number>();
  for (const c of cands) { const b = Math.floor(c.off); bins.set(b, (bins.get(b) ?? 0) + 1); }
  const sm = (b: number) => (bins.get(b - 1) ?? 0) + (bins.get(b) ?? 0) + (bins.get(b + 1) ?? 0);
  const raw: { off: number; s: number }[] = [];
  for (const b of bins.keys()) {
    const s = sm(b);
    if (s < PEAK_VOTES || s < sm(b - 1) || s < sm(b + 1)) continue;
    const near = cands.filter((c) => Math.abs(c.off - (b + 0.5)) <= 1.5).map((c) => c.off).sort((x, y) => x - y);
    raw.push({ off: near[near.length >> 1], s });
  }
  raw.sort((a, b) => b.s - a.s);
  const peaks: number[] = [];
  for (const p of raw) if (peaks.length < 4 && peaks.every((q) => Math.abs(q - p.off) > MIN_SHIFT)) peaks.push(p.off);
  if (peaks.length < 2) return null;
  const home = peaks.reduce((k, q, i) => (Math.abs(q - global) < Math.abs(peaks[k] - global) ? i : k), 0);

  // votes[line][peak]
  const votes = new Map<number, number[]>();
  for (const c of cands) {
    const line = lyr[c.j].line;
    peaks.forEach((q, p) => {
      if (Math.abs(c.off - q) > 1.5) return;
      const v = votes.get(line) ?? votes.set(line, peaks.map(() => 0)).get(line)!;
      v[p]++;
    });
  }
  interface Node { line: number; p: number; t: number; score: number }
  const nodes: Node[] = [];
  for (const [line, v] of votes) v.forEach((n, p) => {
    if (n > 0) nodes.push({ line, p, t: lines[line].time + peaks[p], score: n + (p === home ? 0.25 : 0) });
  });
  nodes.sort((a, b) => a.line - b.line || a.t - b.t);
  const dp = nodes.map((n) => n.score), prev = nodes.map(() => -1);
  for (let b = 0; b < nodes.length; b++)
    for (let a = 0; a < b; a++) {
      if (nodes[a].line >= nodes[b].line || nodes[a].t >= nodes[b].t) continue;
      const v = dp[a] - (nodes[a].p !== nodes[b].p ? SWITCH_COST : 0) + nodes[b].score;
      if (v > dp[b]) { dp[b] = v; prev[b] = a; }
    }
  let end = 0;
  for (let b = 1; b < nodes.length; b++) if (dp[b] > dp[end]) end = b;
  const chain: Node[] = [];
  for (let k = end; k >= 0; k = prev[k]) chain.unshift(nodes[k]);

  // runs of one offset; short runs are noise (a chorus line matching elsewhere)
  let runs: Node[][] = [];
  for (const n of chain) {
    const r = runs[runs.length - 1];
    if (r && r[0].p === n.p) r.push(n); else runs.push([n]);
  }
  runs = runs.filter((r) => r.length >= RUN_LINES && r.reduce((a, n) => a + Math.floor(n.score), 0) >= RUN_VOTES);
  const merged: Node[][] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last[0].p === r[0].p) last.push(...r); else merged.push([...r]);
  }
  if (merged.length < 2) return null;
  const kept = merged.flat();
  return {
    anchors: kept.map((n) => ({ lineIndex: n.line, videoTime: round(n.t) })),
    matches: kept.reduce((a, n) => a + Math.floor(n.score), 0),
    lines: kept.length,
  };
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

/** Non-lyric caption tags ("[music]", "[음악]", "[singing]", "♪"). */
const CAPTION_TAG = /\[[^\]]*\]|♪+/g;
const WORD = /[\p{L}\p{N}']+/gu;

/** Sung words YouTube's captions hold inside a window. */
export function captionWordCount(segs: TranscriptSeg[], window: { start: number; end: number }): number {
  let n = 0;
  for (const s of segs) if (s.time >= window.start && s.time < window.end) n += (s.text.replace(CAPTION_TAG, ' ').match(WORD) ?? []).length;
  return n;
}

/**
 * Auto-captions as lyric lines for songs no lyrics site knows: each caption segment is split into
 * sentences, timed by their share of the segment's characters, relative to `start`.
 */
export function captionLyrics(segs: TranscriptSeg[], window: { start: number; end: number }, start: number): LyricLine[] {
  const inside = segs.filter((s) => s.time >= window.start && s.time < window.end).sort((a, b) => a.time - b.time);
  const out: LyricLine[] = [];
  inside.forEach((s, k) => {
    const text = s.text.replace(CAPTION_TAG, ' ').replace(/\s+/g, ' ').trim();
    if (!(text.match(WORD) ?? []).length) return;
    const next = inside[k + 1]?.time ?? s.time + 6;
    const span = Math.max(0.5, Math.min(12, next - s.time));
    const parts = text.split(/(?<=[.!?])\s+/).filter((p) => (p.match(WORD) ?? []).length);
    const total = parts.reduce((a, p) => a + p.length, 0) || 1;
    let used = 0;
    for (const p of parts) {
      out.push({ time: Math.round((s.time - start + span * (used / total)) * 100) / 100, text: p.replace(/[.,]+$/, '') });
      used += p.length;
    }
  });
  return out;
}
