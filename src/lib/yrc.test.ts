import { describe, it, expect } from 'vitest';
import { parseYrc } from './yrc';
import { parseLrc } from './lrc';

describe('parseYrc', () => {
  it('parses word timings and skips credit JSON', () => {
    const l = parseYrc('{"t":0,"c":[{"tx":"作词: "}]}\n[22950,6150](22950,180,0)At (23130,390,0)least (23520,150,0)(that)(23670,0,0)\n[30000,1000](30000,500,0)')
    expect(l).toEqual([{ time: 22.95, text: 'At least (that)', words: [
      { t: 22.95, d: 0.18, c: 0 }, { t: 23.13, d: 0.39, c: 3 }, { t: 23.52, d: 0.15, c: 9 },
    ] }]);
  });
});

describe('parseLrc enhanced word tags', () => {
  it('reads <mm:ss.xx> word tags and the closing tag', () => {
    const l = parseLrc('[00:01.00]<00:01.00>Every<00:01.40>body <00:02.00>go<00:02.50>\n[00:05.00]next');
    expect(l[0]).toEqual({ time: 1, text: 'Everybody go', words: [
      { t: 1, d: 0.4, c: 0 }, { t: 1.4, d: 0.6, c: 5 }, { t: 2, d: 0.5, c: 10 },
    ] });
    expect(l[1]).toEqual({ time: 5, text: 'next' });
  });
  it('caps an unterminated last word', () => {
    expect(parseLrc('[00:01.00]<00:01.00>a <00:01.50>b\n[00:09.00]c')[0].words?.[1].d).toBe(1);
  });
});
