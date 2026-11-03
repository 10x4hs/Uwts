import { describe, it, expect } from 'vitest';
import { parseBugsSynced } from './bugs';
import { parseGenieMsl } from './genie';
import { mmss, plainLines } from './types';

describe('KR parsers', () => {
  it('parses Bugs synced lyrics (seconds|text＃...)', () => {
    const l = parseBugsSynced('0.9|(Ooh ah, yeah I’m blooming like a)＃8.8|(Yeah I’m blooming like a)＃10.1|기다려 왔던＃12.4|');
    expect(l).toEqual([
      { time: 0.9, text: '(Ooh ah, yeah I’m blooming like a)' },
      { time: 8.8, text: '(Yeah I’m blooming like a)' },
      { time: 10.1, text: '기다려 왔던' },
    ]);
    expect(parseBugsSynced('')).toEqual([]);
  });
  it('parses Genie JSONP keyed by ms', () => {
    const l = parseGenieMsl('null({"8800":"(Yeah)","900":"(Ooh ah)","10100":"기다려 왔던"})');
    expect(l.map((x) => x.time)).toEqual([0.9, 8.8, 10.1]);
    expect(l[2].text).toBe('기다려 왔던');
    expect(parseGenieMsl('<!DOCTYPE html><html>')).toEqual([]);
  });
  it('mmss and plain lines', () => {
    expect(mmss('03:31')).toBe(211);
    expect(mmss('3:31')).toBe(211);
    expect(mmss(undefined)).toBeUndefined();
    expect(plainLines('a<BR>b<BR><BR>c')).toEqual([{ time: -1, text: 'a' }, { time: -1, text: 'b' }, { time: -1, text: 'c' }]);
  });
});
