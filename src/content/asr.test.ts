import { describe, expect, test } from 'vitest';
import { parseLrc } from '../lib/lrc';
import type { LyricLine } from '../shared/types';
import { captionWordCount, captionLyrics, alignToTranscript, normalizeWords, type TranscriptSeg } from './asr';
import panel from '../fixtures/xmas/timeline-panel.json';
import winter from '../fixtures/xmas/winter-wonderland.lrclib.json';
import home from '../fixtures/xmas/ill-be-home.lrclib.json';
import dreaming from '../fixtures/xmas/christmas-dreaming.lrclib.json';
import xmasSong from '../fixtures/xmas/the-christmas-song.lrclib.json';

interface Lrclib { syncedLyrics: string | null; plainLyrics: string }
const LRC: Record<string, Lrclib> = {
  'winter-wonderland': winter, 'ill-be-home': home, 'christmas-dreaming': dreaming, 'the-christmas-song': xmasSong,
};

/** Local extractor for the committed timeline-panel fixture (independent of src/lib/timeline.ts). */
function loadSegs(): TranscriptSeg[] {
  const out: TranscriptSeg[] = [];
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    const m = (o as any).macroMarkersPanelItemViewModel;
    const t = m?.onTap?.innertubeCommand?.watchEndpoint?.startTimeSeconds;
    const text = m?.item?.timelineItemViewModel?.contentItems?.[0]?.transcriptSegmentViewModel?.simpleText;
    if (t != null && typeof text === 'string') { out.push({ time: Number(t), text }); return; }
    for (const v of Object.values(o)) walk(v);
  };
  walk(panel);
  return out;
}

function loadLines(name: string): LyricLine[] {
  const j = LRC[name];
  return j.syncedLyrics ? parseLrc(j.syncedLyrics)
    : j.plainLyrics.split('\n').map((text) => ({ time: -1, text }));
}

const segs = loadSegs();

/** Does some caption within ±tol s of t contain ≥ 2 consecutive words of the line? */
function captionHasLineNear(text: string, t: number, tol = 4): boolean {
  const ws = normalizeWords(text);
  const near = segs.filter((s) => s.time >= t - tol && s.time <= t + tol)
    .map((s) => normalizeWords(s.text).join(' ')).join(' ');
  for (let i = 0; i + 1 < ws.length; i++) if (` ${near} `.includes(` ${ws[i]} ${ws[i + 1]} `)) return true;
  return false;
}

function increasing(anchors: { lineIndex: number; videoTime: number }[]) {
  for (let k = 1; k < anchors.length; k++) {
    expect(anchors[k].lineIndex).toBeGreaterThan(anchors[k - 1].lineIndex);
    expect(anchors[k].videoTime).toBeGreaterThan(anchors[k - 1].videoTime);
  }
}

describe('alignToTranscript: synced fixtures', () => {
  // offset ranges verified by eye against the captions (see first matched lines)
  const cases = [
    { name: 'winter-wonderland', window: { start: 181, end: 195 }, offset: [192.5, 194.5] },
    { name: 'ill-be-home', window: { start: 335, end: 344 }, offset: [341.5, 344] },
    { name: 'christmas-dreaming', window: { start: 609, end: 619 }, offset: [607.5, 610] },
  ];
  for (const c of cases) {
    test(c.name, () => {
      expect(segs.length).toBeGreaterThan(100);
      const lines = loadLines(c.name);
      const r = alignToTranscript(lines, segs, c.window)!;
      expect(r.confident).toBe(true);
      expect(r.segmented ?? false).toBe(false); // real songs in one piece: no false split
      expect(r.offset!).toBeGreaterThanOrEqual(c.offset[0]);
      expect(r.offset!).toBeLessThanOrEqual(c.offset[1]);
      expect(r.anchors.length).toBeGreaterThanOrEqual(6);
      increasing(r.anchors);
      // first several matched lines sit on captions with the same words (captions start up to ~1.5 s
      // before the line, and a caption segment can begin a few seconds before the words it contains)
      const firstFew = r.anchors.slice(0, 5);
      const ok = firstFew.filter((a) => captionHasLineNear(lines[a.lineIndex].text, a.videoTime));
      expect(ok.length).toBeGreaterThanOrEqual(4);
    });
  }

  test('a wrong song in the window is not confident', () => {
    const r1 = alignToTranscript(loadLines('ill-be-home'), segs, { start: 181, end: 195 });
    expect(r1?.confident ?? false).toBe(false);
    const r2 = alignToTranscript(loadLines('winter-wonderland'), segs, { start: 609, end: 619 });
    expect(r2?.confident ?? false).toBe(false);
    const r3 = alignToTranscript(loadLines('christmas-dreaming'), segs, { start: 335, end: 344 });
    expect(r3?.confident ?? false).toBe(false);
  });
});

describe('alignToTranscript: plain fixture', () => {
  test('the-christmas-song yields increasing anchors on matching captions', () => {
    const lines = loadLines('the-christmas-song');
    const r = alignToTranscript(lines, segs, { start: 1468, end: 1474 })!;
    expect(r.offset).toBeNull();
    expect(r.confident).toBe(true);
    expect(r.anchors.length).toBeGreaterThanOrEqual(3);
    increasing(r.anchors);
    expect(r.anchors[0].lineIndex).toBe(0); // "Chestnuts roasting on an open fire"
    expect(Math.abs(r.anchors[0].videoTime - 1488)).toBeLessThanOrEqual(1.5);
    const ok = r.anchors.slice(0, 5).filter((a) => captionHasLineNear(lines[a.lineIndex].text, a.videoTime));
    expect(ok.length).toBeGreaterThanOrEqual(4);
  });

  test('wrong plain lyrics elsewhere are not confident', () => {
    const r = alignToTranscript(loadLines('the-christmas-song'), segs, { start: 181, end: 195 });
    expect(r?.confident ?? false).toBe(false);
  });
});

describe('alignToTranscript: synthetic', () => {
  test('recovers a +37.3 s offset from noisy, re-chunked captions', () => {
    const lines = loadLines('winter-wonderland');
    const OFF = 37.3;
    // re-chunk lyric words into 5-word segments at their spread times, mishear every 4th word,
    // sprinkle [Music] fillers and unrelated chatter
    const words: { w: string; t: number }[] = [];
    lines.forEach((l, i) => {
      const ws = normalizeWords(l.text);
      const next = lines[i + 1]?.time ?? l.time + 4;
      const step = Math.min(0.6, (next - l.time) / Math.max(1, ws.length));
      ws.forEach((w, k) => words.push({ w: (words.length % 4 === 3) ? 'zzz' : w, t: l.time + k * step + OFF }));
    });
    const noisy: TranscriptSeg[] = [{ time: 0, text: 'hello everyone welcome back to the channel' }, { time: 10, text: '[Music]' }];
    for (let k = 0; k < words.length; k += 5) noisy.push({ time: words[k].t, text: words.slice(k, k + 5).map((x) => x.w).join(' ') });
    noisy.push({ time: 300, text: '[Applause]' }, { time: 302, text: 'thanks for watching' });
    const r = alignToTranscript(lines, noisy, { start: 30, end: 45 })!;
    expect(r.confident).toBe(true);
    expect(Math.abs(r.offset! - OFF)).toBeLessThanOrEqual(0.5);
    increasing(r.anchors);
  });

  test('empty input → null', () => {
    expect(alignToTranscript([], segs, { start: 0, end: 10 })).toBeNull();
    expect(alignToTranscript(loadLines('winter-wonderland'), [], { start: 0, end: 10 })).toBeNull();
    expect(alignToTranscript([{ time: 0, text: 'hello world' }], [{ time: 5, text: '[Music]' }], { start: 0, end: 10 })).toBeNull();
  });

  test('normalizes Latin and Hangul alike', () => {
    expect(normalizeWords('[음악] 사랑해요, 너를! It’s FINE')).toEqual(['사랑해요', '너를', 'its', 'fine']);
  });

  test('fast: ~3000 caption words × ~400 lyric words', () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ time: i * 3, text: `word${i % 13} alpha${i % 7} beta gamma delta${i % 5} eps zeta` }));
    const big: TranscriptSeg[] = Array.from({ length: 600 }, (_, i) => ({ time: i * 2, text: `word${i % 13} alpha${i % 7} beta gamma delta${i % 5}` }));
    const t0 = performance.now();
    alignToTranscript(lines, big, { start: 0, end: 1200 });
    alignToTranscript(lines.map((l) => ({ ...l, time: -1 })), big, { start: 0, end: 1200 });
    // generous: CI runners are several times slower than a laptop; this only guards against blow-ups
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('captions as lyrics', () => {
  const segs = [
    { time: 727, text: '[music] Now I keep peace with the scar.' },
    { time: 730, text: "We don't erase the trembling. We just learn where the triggers are." },
    { time: 757, text: '[music]' },
    { time: 900, text: 'outside the window' },
  ];
  test('counts sung words only', () => {
    expect(captionWordCount(segs, { start: 700, end: 800 })).toBe(19);
  });
  test('splits segments into timed sentences relative to the song start', () => {
    expect(captionLyrics(segs, { start: 700, end: 800 }, 720)).toEqual([
      { time: 7, text: 'Now I keep peace with the scar' },
      { time: 10, text: "We don't erase the trembling" },
      { time: 15.27, text: 'We just learn where the triggers are' },
    ]);
  });
});

describe('alignToTranscript: per-part offsets', () => {
  /** Captions singing `lines` with offset off(t) (t = lyric time), 5 words per segment, every 5th word misheard. */
  function sing(lines: LyricLine[], off: (t: number) => number): TranscriptSeg[] {
    const words: { w: string; t: number }[] = [];
    lines.forEach((l, i) => {
      const ws = normalizeWords(l.text);
      const next = lines[i + 1]?.time ?? l.time + 4;
      const step = Math.min(0.6, (next - l.time) / Math.max(1, ws.length));
      ws.forEach((w, k) => words.push({ w: words.length % 5 === 4 ? 'zzz' : w, t: l.time + k * step + off(l.time) }));
    });
    const out: TranscriptSeg[] = [];
    for (let k = 0; k < words.length; k += 5) out.push({ time: words[k].t, text: words.slice(k, k + 5).map((x) => x.w).join(' ') });
    return out;
  }

  test('a 20 s skit in the middle: lines after it get their own offset', () => {
    const lines = loadLines('winter-wonderland');
    const cut = lines[Math.floor(lines.length / 2)].time;
    const r = alignToTranscript(lines, sing(lines, (t) => (t < cut ? 8 : 28)), { start: 0, end: 40 })!;
    expect(r.confident).toBe(true);
    expect(r.segmented).toBe(true);
    increasing(r.anchors);
    for (const a of r.anchors) {
      const want = lines[a.lineIndex].time + (lines[a.lineIndex].time < cut ? 8 : 28);
      expect(Math.abs(a.videoTime - want)).toBeLessThanOrEqual(1);
    }
  });

  test('one offset with repeated choruses stays one offset', () => {
    for (const name of ['winter-wonderland', 'the-christmas-song']) {
      const lines = loadLines(name);
      if (lines[0].time < 0) continue;
      const r = alignToTranscript(lines, sing(lines, () => 12.4), { start: 0, end: 30 })!;
      expect(r.segmented ?? false).toBe(false);
      expect(Math.abs(r.offset! - 12.4)).toBeLessThanOrEqual(0.5);
    }
  });
});
