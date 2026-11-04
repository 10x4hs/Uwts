import { describe, it, expect } from 'vitest';
import { isNewer, tagFromUrl } from './update';

describe('update helpers', () => {
  it('compares versions numerically', () => {
    expect(isNewer('0.1.10', '0.1.9')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2')).toBe(false);
    expect(isNewer('1.0', '0.9.9')).toBe(true);
  });
  it('reads the tag from the latest-release redirect', () => {
    expect(tagFromUrl('https://github.com/10x4hs/Uwts/releases/tag/v0.2.0')).toBe('0.2.0');
    expect(tagFromUrl('https://github.com/10x4hs/Uwts/releases')).toBeNull();
    expect(tagFromUrl('https://github.com/login?return_to=x')).toBeNull();
  });
});
