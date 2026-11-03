import { describe, it, expect } from 'vitest';
import { artistMatches, parseNeteaseLrc, pickNetease, titleMatches, type NeteaseSong } from './netease';

const s = (id: number, name: string, artist: string, duration?: number): NeteaseSong =>
  ({ id, name, artists: [{ name: artist }], duration });

describe('netease matcher', () => {
  it('picks C Jamm - 신기루(illusion)', () => {
    const songs = [s(1, '신기루', 'Other'), s(2, '신기루(illusion)', 'C Jamm', 200000), s(3, 'Illusion', 'C Jamm')];
    expect(pickNetease(songs, { artist: 'C JAMM', title: '신기루 (illusion)' })?.id).toBe(2);
  });
  it("rejects '널사랑하겠어' for ILLIT 체포하겠어", () => {
    expect(pickNetease([s(1, '널사랑하겠어', 'ILLIT'), s(2, '널사랑하겠어', '아이릿')], { artist: 'ILLIT', title: '체포하겠어' })).toBeNull();
  });
  it('requires artist match', () => {
    expect(pickNetease([s(1, '체포하겠어', 'Someone')], { artist: 'ILLIT', title: '체포하겠어' })).toBeNull();
  });
  it('prefers closest duration', () => {
    const songs = [s(1, 'Magnetic', 'ILLIT', 250000), s(2, 'Magnetic', 'ILLIT', 161000)];
    expect(pickNetease(songs, { artist: 'ILLIT', title: 'Magnetic', duration: 160 })?.id).toBe(2);
  });
  it('fuzzy artist with alias and spaces', () => {
    expect(artistMatches('IU (아이유)', '아이유')).toBe(true);
    expect(artistMatches('cjamm', 'C Jamm')).toBe(true);
    expect(artistMatches('ILLIT', 'IU')).toBe(false);
  });
  it('title contains either way', () => {
    expect(titleMatches('Super Shy', 'Super Shy (Remix)')).toBe(true);
    expect(titleMatches('체포하겠어', '널사랑하겠어')).toBe(false);
  });
  it('drops metadata lines', () => {
    const lines = parseNeteaseLrc('[00:00.00] 作词 : A\n[00:01.00] 作曲 : B\n[00:02.00] 编曲 : C\n[00:10.00]hello');
    expect(lines.map((l) => l.text)).toEqual(['hello']);
  });
});
