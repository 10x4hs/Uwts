import type { LyricLine, LyricWord } from '../shared/types';

const LINE = /^\[(\d+),(\d+)\]/;
const WORD = /\((\d+),(\d+),-?\d+\)/g;

/**
 * NetEase "yrc" word-level lyrics:
 *   [16210,3460](16210,670,0)Every(16880,410,0)body ...
 * times in ms; JSON lines ({"t":..}) are credits and skipped.
 */
export function parseYrc(text: string, skip: (line: string) => boolean = () => false): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const head = LINE.exec(raw.trim());
    if (!head) continue;
    const body = raw.trim().slice(head[0].length);
    const marks = [...body.matchAll(WORD)];
    if (!marks.length) continue;
    let s = '';
    const words: LyricWord[] = [];
    marks.forEach((m, i) => {
      let chunk = body.slice(m.index + m[0].length, marks[i + 1]?.index ?? body.length);
      if (!s) chunk = chunk.trimStart();
      if (!chunk) return;
      if (chunk.trim()) words.push({ t: Number(m[1]) / 1000, d: Number(m[2]) / 1000, c: s.length });
      s += chunk;
    });
    const t = s.trimEnd();
    if (!t || skip(t)) continue;
    out.push({ time: Number(head[1]) / 1000, text: t, words });
  }
  return out.sort((a, b) => a.time - b.time);
}
