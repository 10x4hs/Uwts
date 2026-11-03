import type { Palette } from '../shared/types';
/** Build a palette from RGBA pixel data: dominant colors, darkened so white text has >= 4.5:1 contrast. */
export function paletteFromPixels(data: Uint8ClampedArray): Palette { throw new Error('TODO'); }
/** Rotate hue of a palette by deg (used per song in multi-song videos). */
export function shiftHue(p: Palette, deg: number): Palette { throw new Error('TODO'); }
