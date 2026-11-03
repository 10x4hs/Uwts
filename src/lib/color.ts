import type { Palette } from '../shared/types';

type RGB = [number, number, number];
type HSL = [number, number, number]; // h 0-360, s 0-1, l 0-1

const FALLBACK: Palette = { from: '#1e2a4a', to: '#3a1e4a', glow: '#8fb4ff' };

export function rgbToHsl([r, g, b]: RGB): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: HSL): RGB {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255)) as RGB;
}

export function toHex(c: RGB): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: RGB): number {
  const ch = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastWithWhite(c: RGB): number {
  return 1.05 / (luminance(c) + 0.05);
}

function darkenForWhite(c: RGB): RGB {
  const [h, s] = rgbToHsl(c);
  let l = rgbToHsl(c)[2];
  let out = c;
  while (contrastWithWhite(out) < 4.5 && l > 0) {
    l = Math.max(0, l - 0.02);
    out = hslToRgb([h, s, l]);
  }
  return out;
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function distinct(a: RGB, b: RGB): boolean {
  const [ha, sa, la] = rgbToHsl(a), [hb, sb, lb] = rgbToHsl(b);
  const rgbDist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (sa > 0.15 && sb > 0.15 && hueDist(ha, hb) >= 25) return true;
  return rgbDist > 60 || Math.abs(sa - sb) > 0.3 || Math.abs(la - lb) > 0.2;
}

/** Build a palette from RGBA pixel data: dominant colors, darkened so white text has >= 4.5:1 contrast. */
export function paletteFromPixels(data: Uint8ClampedArray): Palette {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 125) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 25 || min > 230) continue; // near-black / near-white
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const sorted = [...buckets.values()]
    .sort((x, y) => y.n - x.n)
    .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round) as RGB);
  if (sorted.length === 0) return { ...FALLBACK };
  const first = sorted[0];
  let second = sorted.find((c) => distinct(c, first));
  if (!second) {
    const [h, s, l] = rgbToHsl(first);
    second = hslToRgb([h + 30, s, l]);
  }
  // glow: most saturated among top colors, pushed saturated + bright
  const top = sorted.slice(0, 12);
  const sat = top.reduce((best, c) => (rgbToHsl(c)[1] > rgbToHsl(best)[1] ? c : best), top[0]);
  const [gh, gs] = rgbToHsl(sat);
  const glow = hslToRgb([gh, Math.max(gs, 0.75), 0.68]);
  return { from: toHex(darkenForWhite(first)), to: toHex(darkenForWhite(second)), glow: toHex(glow) };
}

/** Rotate hue of a palette by deg (used per song in multi-song videos). */
export function shiftHue(p: Palette, deg: number): Palette {
  const rot = (hex: string) => {
    const [h, s, l] = rgbToHsl(fromHex(hex));
    return toHex(hslToRgb([h + deg, s, l]));
  };
  return { from: rot(p.from), to: rot(p.to), glow: rot(p.glow) };
}
