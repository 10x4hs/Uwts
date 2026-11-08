import type { Chapter } from '../shared/types';

const TIME = '((?:\\d{1,2}:)?\\d{1,2}:\\d{2})';
const LEAD = new RegExp(`^\\s*(?:\\d+[.)]\\s*)?\\(?${TIME}\\)?\\s*[-–—|:.]?\\s*(.+?)\\s*$`);
const TRAIL = new RegExp(`^\\s*(.+?)\\s*[-–—|:]?\\s*\\(?${TIME}\\)?\\s*$`);

function toSec(s: string): number {
  return s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
}

/** Leading repeats of the timestamp ("03:41  Overflow Heart Mode") and separators go. */
export function cleanTitle(s: string): string {
  return s.replace(/^(?:[\s\-–—|:.]*\[?\(?(?:\d{1,2}:)?\d{1,2}:\d{2}\)?\]?)+/, '').replace(/^[\s\-–—|:.]+|[\s\-–—|:]+$/g, '').trim();
}

/** Parse "0:00 Title" / "1:02:03 Title" lines from a description. Returns [] if fewer than 2 found. */
export function parseChapters(description: string): Chapter[] {
  const out: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(LEAD);
    let time: string | undefined, title: string | undefined;
    if (m) { time = m[1]; title = m[2]; }
    else {
      const n = line.match(TRAIL);
      if (n) { time = n[2]; title = n[1].replace(/^\d+[.)]\s*/, ''); }
    }
    if (!time || title === undefined) continue;
    const t = cleanTitle(title);
    if (!t) continue;
    out.push({ start: toSec(time), title: t });
  }
  if (out.length < 2 || out[0].start !== 0) return [];
  return out;
}
/** Chapter active at time t (seconds), or null (before the first, or past a chapter's explicit end). */
export function chapterAt(chapters: Chapter[], t: number): { chapter: Chapter; index: number; end: number | null } | null {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) { if (chapters[i].start <= t) idx = i; else break; }
  if (idx < 0) return null;
  const c = chapters[idx];
  if (c.end != null && t >= c.end) return null;
  return { chapter: c, index: idx, end: c.end ?? (idx + 1 < chapters.length ? chapters[idx + 1].start : null) };
}

/** Chapters this short are parts of one song (rapper turns), not songs. Medleys such as
 *  "Killing Verse" sing one verse per song, so whole songs can be only 60-90 s here. */
const PART_MAX_SEC = 45;
const SHORT_VIDEO_SEC = 8 * 60;
const SECTION_RE = /^(?:intro|outro|verse|hook|chorus|pre-?chorus|bridge|drop|break|interlude|part\s*\d|\d+\s*절|후렴|벌스|훅|인트로|아웃트로|브릿지)\b/i;
const normTitle = (t: string) => t.toLowerCase().replace(/^[^:：]*[:：]\s*/, '').replace(/[\s()\[\]._-]+/g, '');

/** Chapters that split a playlist into songs, or [] when they split one song into parts. */
export function songListChapters(chapters: Chapter[], duration?: number): Chapter[] {
  if (chapters.length < 2) return chapters;
  if (duration && duration < SHORT_VIDEO_SEC) return [];
  // the same name coming back (rapper A, B, A, C, A) marks turns within one song
  // (unless the whole list simply plays again: A B C A B C)
  const names = chapters.map((c) => normTitle(c.title)).filter(Boolean);
  const distinct = new Set(names).size;
  if (distinct < names.length && !(distinct >= 2 && names.every((n, i) => n === names[i % distinct]))) return [];
  // mostly "Verse 1 / Hook / Bridge" style labels
  if (chapters.filter((c) => SECTION_RE.test(c.title.trim())).length * 2 > chapters.length) return [];
  const lens = chapters.slice(0, -1).map((c, i) => (c.end ?? chapters[i + 1].start) - c.start).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)];
  return median < PART_MAX_SEC ? [] : chapters;
}

/**
 * The last listed song can't run to the end of a much longer video (a 46-minute list in an 11-hour
 * loop video): end it after a typical song length so the rest counts as "no song info".
 */
export function capLastChapter(chapters: Chapter[], duration?: number): Chapter[] {
  if (chapters.length < 2 || !duration) return chapters;
  const last = chapters[chapters.length - 1];
  if (last.end != null) return chapters;
  const lens = chapters.slice(1).map((c, i) => c.start - chapters[i].start);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const end = last.start + Math.max(300, avg * 1.6);
  return end < duration ? [...chapters.slice(0, -1), { ...last, end: Math.round(end) }] : chapters;
}
