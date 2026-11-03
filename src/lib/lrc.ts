import type { LyricLine } from '../shared/types';
/** Parse LRC text ("[mm:ss.xx] line"), sorted by time, multi-tag lines expanded, metadata tags dropped. */
export function parseLrc(text: string): LyricLine[] { throw new Error('TODO'); }
/** Index of the line active at t seconds (last line with time <= t), -1 if before the first. */
export function lineIndexAt(lines: LyricLine[], t: number): number { throw new Error('TODO'); }
