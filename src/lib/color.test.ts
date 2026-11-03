import { describe, it, expect } from 'vitest';
import { paletteFromPixels, shiftHue, contrastWithWhite, fromHex, rgbToHsl } from './color';

function px(colors: [number, number, number, number, number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [r, g, b, a, n] of colors) for (let i = 0; i < n; i++) out.push(r, g, b, a);
  return new Uint8ClampedArray(out);
}
const hex = /^#[0-9a-f]{6}$/;

describe('paletteFromPixels', () => {
  it('picks two dominant distinct colors and ensures contrast', () => {
    const p = paletteFromPixels(px([[240, 60, 60, 255, 100], [60, 200, 240, 255, 60], [0, 0, 0, 255, 500], [255, 255, 255, 255, 500], [0, 255, 0, 0, 500]]));
    for (const c of [p.from, p.to, p.glow]) expect(c).toMatch(hex);
    expect(contrastWithWhite(fromHex(p.from))).toBeGreaterThanOrEqual(4.5);
    expect(contrastWithWhite(fromHex(p.to))).toBeGreaterThanOrEqual(4.5);
    const hf = rgbToHsl(fromHex(p.from))[0], ht = rgbToHsl(fromHex(p.to))[0];
    expect(hf < 20 || hf > 340).toBe(true); // red dominant
    expect(ht).toBeGreaterThan(170); expect(ht).toBeLessThan(210);
  });
  it('glow is bright and saturated', () => {
    const p = paletteFromPixels(px([[200, 120, 40, 255, 50]]));
    const [, s, l] = rgbToHsl(fromHex(p.glow));
    expect(s).toBeGreaterThan(0.6); expect(l).toBeGreaterThan(0.5);
  });
  it('falls back when only black/white/transparent', () => {
    const p = paletteFromPixels(px([[0, 0, 0, 255, 10], [255, 255, 255, 255, 10]]));
    expect(p.from).toMatch(hex);
    expect(contrastWithWhite(fromHex(p.from))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('shiftHue', () => {
  it('rotates all three colors', () => {
    const p = { from: '#802020', to: '#208020', glow: '#ff8080' };
    const q = shiftHue(p, 120);
    expect(Math.round(rgbToHsl(fromHex(q.from))[0])).toBe(120);
    expect(Math.round(rgbToHsl(fromHex(q.to))[0])).toBe(240);
    expect(Math.round(rgbToHsl(fromHex(q.glow))[0])).toBe(120);
    expect(shiftHue(p, 360)).toEqual(p);
  });
});
