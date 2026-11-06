import { describe, it, expect } from 'vitest';
import { filesChanged, isNewer, tagFromUrl } from './update';

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

describe('filesChanged', () => {
  it('follows the build id when both sides have one', () => {
    expect(filesChanged('b2', '0.1.9', 'b1', '0.1.9')).toBe(true);
    expect(filesChanged('b1', '0.1.9', 'b1', '0.1.9')).toBe(false);
  });
  it('falls back to the manifest version for older zips', () => {
    expect(filesChanged(null, '0.1.11', 'b1', '0.1.10')).toBe(true);
    expect(filesChanged(null, '0.1.10', 'b1', '0.1.10')).toBe(false);
    expect(filesChanged(null, undefined, '', '0.1.10')).toBe(false);
  });
});
