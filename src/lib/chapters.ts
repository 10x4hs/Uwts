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
/** Chapter active at time t (seconds), or null. */
export function chapterAt(chapters: Chapter[], t: number): { chapter: Chapter; index: number; end: number | null } | null {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) { if (chapters[i].start <= t) idx = i; else break; }
  if (idx < 0) return null;
  return { chapter: chapters[idx], index: idx, end: idx + 1 < chapters.length ? chapters[idx + 1].start : null };
}
