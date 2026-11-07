/**
 * Non-music parts of a music video (SponsorBlock "music_offtopic": skits, talk, a drama intro).
 * The lyrics follow the audio track, which has none of these, so song time stands still inside
 * them: songTime = videoTime − (non-music time before it).
 */
export interface Skip { start: number; end: number } // seconds

const MIN_SKIP_SEC = 0.5;

/** SponsorBlock skipSegments response → sorted, merged skips. Drops segments made for another cut of
 *  the video (their recorded duration differs from ours). Never throws. */
export function parseSkips(json: unknown, videoDuration?: number): Skip[] {
  if (!Array.isArray(json)) return [];
  const raw: Skip[] = [];
  for (const s of json) {
    if (!s || typeof s !== 'object') continue;
    const o = s as { category?: unknown; actionType?: unknown; segment?: unknown; videoDuration?: unknown; votes?: unknown };
    if (o.category !== 'music_offtopic' || (o.actionType !== undefined && o.actionType !== 'skip')) continue;
    if (typeof o.votes === 'number' && o.votes < 0) continue;
    const seg = o.segment;
    if (!Array.isArray(seg) || typeof seg[0] !== 'number' || typeof seg[1] !== 'number') continue;
    const vd = typeof o.videoDuration === 'number' ? o.videoDuration : 0;
    if (vd > 0 && videoDuration && Math.abs(vd - videoDuration) > 2) continue;
    const start = Math.max(0, seg[0]);
    const end = seg[1];
    if (!(end - start >= MIN_SKIP_SEC)) continue;
    raw.push({ start, end });
  }
  raw.sort((a, b) => a.start - b.start);
  const out: Skip[] = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Skips inside [from, to), shifted so `from` is 0 (chapter-relative). */
export function within(skips: Skip[], from: number, to = Infinity): Skip[] {
  const out: Skip[] = [];
  for (const s of skips) {
    const a = Math.max(s.start, from), b = Math.min(s.end, to);
    if (b - a >= MIN_SKIP_SEC) out.push({ start: a - from, end: b - from });
  }
  return out;
}

/** Song time at video time t: t minus the skipped time before it (frozen inside a skip). */
export function compress(skips: Skip[], t: number): number {
  let c = t;
  for (const s of skips) {
    if (t <= s.start) break;
    c -= Math.min(t, s.end) - s.start;
  }
  return c;
}

/** Video time where song time c plays (just after a skip that sits exactly at c). */
export function expand(skips: Skip[], c: number): number {
  let t = c;
  for (const s of skips) {
    if (t < s.start) break;
    t += s.end - s.start;
  }
  return t;
}

export function skipAt(skips: Skip[], t: number): Skip | null {
  return skips.find((s) => t >= s.start && t < s.end) ?? null;
}

export function totalSkipped(skips: Skip[], upTo = Infinity): number {
  return skips.reduce((a, s) => a + Math.max(0, Math.min(s.end, upTo) - s.start), 0);
}

/** Lyrics timed to the music video itself (an "MV version" as long as the video, intro included)
 *  already run on video time: removing the non-music parts again would shift them twice. */
export function timedToVideo(trackDuration: number | undefined, videoDuration: number | undefined, skipped: number): boolean {
  if (!trackDuration || !videoDuration || skipped < 1) return false;
  return Math.abs(trackDuration - videoDuration) <= 3 && Math.abs(trackDuration - (videoDuration - skipped)) > 3;
}
