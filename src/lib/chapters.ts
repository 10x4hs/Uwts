import type { Chapter } from '../shared/types';
/** Parse "0:00 Title" / "1:02:03 Title" lines from a description. Returns [] if fewer than 2 found. */
export function parseChapters(description: string): Chapter[] { throw new Error('TODO'); }
/** Chapter active at time t (seconds), or null. */
export function chapterAt(chapters: Chapter[], t: number): { chapter: Chapter; index: number; end: number | null } | null { throw new Error('TODO'); }
