import { describe, it, expect } from 'vitest';
import { addAnchor, mapSynced, interpolatePlain, timedLines, groupByMatch, parseAnchors } from './anchors';

const synced = [0, 10, 20, 30, 40].map((t, i) => ({ time: t, text: `l${i}` }));
const times = (ls: { time: number }[] | null) => ls!.map((l) => +l.time.toFixed(3));

describe('addAnchor', () => {
  it('replaces an anchor on the same line', () => {
    const a = addAnchor(addAnchor([], { lineIndex: 2, videoTime: 5 }), { lineIndex: 2, videoTime: 7 });
    expect(a).toEqual([{ lineIndex: 2, videoTime: 7 }]);
  });
  it('keeps sorted and drops contradicting anchors', () => {
    let a = addAnchor([], { lineIndex: 4, videoTime: 50 });
    a = addAnchor(a, { lineIndex: 1, videoTime: 10 });
    expect(a.map((x) => x.lineIndex)).toEqual([1, 4]);
    a = addAnchor(a, { lineIndex: 2, videoTime: 60 }); // later than line 4 -> line 4 dropped
    expect(a).toEqual([{ lineIndex: 1, videoTime: 10 }, { lineIndex: 2, videoTime: 60 }]);
  });
});

describe('mapSynced', () => {
  it('no anchors: unchanged', () => expect(mapSynced(synced, [])).toBe(synced));
  it('one anchor = constant offset', () => {
    expect(times(mapSynced(synced, [{ lineIndex: 1, videoTime: 13 }]))).toEqual([3, 13, 23, 33, 43]);
  });
  it('two anchors = linear stretch between, nearest offset outside', () => {
    // line1 10->15, line3 30->45: scale 1.5 between
    expect(times(mapSynced(synced, [{ lineIndex: 1, videoTime: 15 }, { lineIndex: 3, videoTime: 45 }]))).toEqual([5, 15, 30, 45, 55]);
  });
  it('multi-segment', () => {
    const r = mapSynced(synced, [{ lineIndex: 0, videoTime: 2 }, { lineIndex: 2, videoTime: 22 }, { lineIndex: 4, videoTime: 52 }]);
    expect(times(r)).toEqual([2, 12, 22, 37, 52]);
  });
  it('stays monotonic and non-negative', () => {
    const r = mapSynced(synced, [{ lineIndex: 0, videoTime: 0 }, { lineIndex: 1, videoTime: 1 }]);
    const t = times(r);
    expect(t[0]).toBe(0);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
  });
});

describe('interpolatePlain', () => {
  // units: 가나 = 2, 다라마바 = 4, 사 = 1, 아자 = 2, 차카 = 2
  const plain = ['가나', '다라마바', '사', '아자', '차카'].map((text) => ({ time: -1, text }));
  it('needs at least 2 anchors', () => {
    expect(interpolatePlain(plain, [])).toBeNull();
    expect(interpolatePlain(plain, [{ lineIndex: 1, videoTime: 10 }])).toBeNull();
    expect(timedLines('plain', plain, [{ lineIndex: 1, videoTime: 10 }])).toBeNull();
  });
  it('spreads by units between anchors and extrapolates at the average rate', () => {
    // pos: 0,2,6,7,9. anchors line1(pos2)@10s, line3(pos7)@20s -> 2 s/unit
    const r = interpolatePlain(plain, [{ lineIndex: 1, videoTime: 10 }, { lineIndex: 3, videoTime: 20 }]);
    expect(times(r)).toEqual([6, 10, 18, 20, 24]);
  });
  it('multi-segment with different tempos', () => {
    const r = interpolatePlain(plain, [{ lineIndex: 0, videoTime: 0 }, { lineIndex: 2, videoTime: 6 }, { lineIndex: 4, videoTime: 12 }]);
    // seg1: pos0->6 over 6s (1s/u): line1 at 2. seg2: pos6->9 over 6s (2s/u): line3 at 8
    expect(times(r)).toEqual([0, 2, 6, 8, 12]);
  });
  it('clamps extrapolation at 0', () => {
    const r = interpolatePlain(plain, [{ lineIndex: 2, videoTime: 3 }, { lineIndex: 4, videoTime: 9 }]);
    expect(r![0].time).toBe(0);
  });
});

describe('misc', () => {
  it('groupByMatch treats missing match as exact', () => {
    const g = groupByMatch([{ id: 1 }, { id: 2, match: 'partial' as const }, { id: 3, match: 'exact' as const }]);
    expect(g.exact.map((x) => x.id)).toEqual([1, 3]);
    expect(g.partial.map((x) => x.id)).toEqual([2]);
  });
  it('parseAnchors rejects junk', () => {
    expect(parseAnchors([{ lineIndex: 1, videoTime: 2 }, { lineIndex: 'x' }, null])).toEqual([{ lineIndex: 1, videoTime: 2 }]);
    expect(parseAnchors('nope')).toEqual([]);
  });
});
