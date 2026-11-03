import { describe, it, expect } from 'vitest';
import { chooseBest, type LrclibTrack } from './lrclib';

const t = (o: Partial<LrclibTrack>): LrclibTrack => ({ trackName: 't', artistName: 'a', ...o });

describe('chooseBest', () => {
  it('returns null when nothing has lyrics', () => {
    expect(chooseBest([t({}), t({ plainLyrics: '' })], 200)).toBeNull();
    expect(chooseBest([], 200)).toBeNull();
  });
  it('prefers synced over plain even with worse duration', () => {
    const plain = t({ id: 1, plainLyrics: 'x', duration: 200 });
    const synced = t({ id: 2, syncedLyrics: '[00:01.00]x', duration: 260 });
    expect(chooseBest([plain, synced], 200)?.id).toBe(2);
  });
  it('picks closest duration among synced', () => {
    const c = [t({ id: 1, syncedLyrics: 's', duration: 180 }), t({ id: 2, syncedLyrics: 's', duration: 203 }), t({ id: 3, syncedLyrics: 's', duration: null })];
    expect(chooseBest(c, 200)?.id).toBe(2);
  });
  it('keeps first when no duration given', () => {
    const c = [t({ id: 1, syncedLyrics: 's', duration: 180 }), t({ id: 2, syncedLyrics: 's', duration: 200 })];
    expect(chooseBest(c)?.id).toBe(1);
  });
});
