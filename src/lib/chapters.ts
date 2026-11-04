import type { Chapter } from '../shared/types';

const TIME = '((?:\\d{1,2}:)?\\d{1,2}:\\d{2})';
const LEAD = new RegExp(`^\\s*(?:\\d+[.)]\\s*)?\\(?${TIME}\\)?\\s*[-–—|:.]?\\s*(.+?)\\s*$`);
const TRAIL = new RegExp(`^\\s*(.+?)\\s*[-–—|:]?\\s*\\(?${TIME}\\)?\\s*$`);

function toSec(s: string): number {
  return s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
}

function cleanTitle(s: string): string {
  return s.replace(/^[\s\-–—|:.]+|[\s\-–—|:]+$/g, '').trim();
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

/** Songs are rarely under this long; chapters shorter than it are parts of one song (verses, rappers). */
const SONG_MIN_SEC = 90;
const SHORT_VIDEO_SEC = 8 * 60;

/** Chapters that split a playlist into songs, or [] when they split one song into parts. */
export function songListChapters(chapters: Chapter[], duration?: number): Chapter[] {
  if (chapters.length < 2) return chapters;
  if (duration && duration < SHORT_VIDEO_SEC) return [];
  const lens = chapters.slice(0, -1).map((c, i) => (c.end ?? chapters[i + 1].start) - c.start).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)];
  return median < SONG_MIN_SEC ? [] : chapters;
}
