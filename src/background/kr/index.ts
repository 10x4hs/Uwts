import { bugsLyrics, searchBugs } from './bugs';
import { genieLyrics, searchGenie } from './genie';
import { melonLyrics, searchMelon } from './melon';
import type { KrLyrics, KrSong } from './types';

export type { KrLyrics, KrSong, KrSource } from './types';

import { KR_FLAG, KR_ORIGINS } from '../../shared/messages';

export async function krEnabled(): Promise<boolean> {
  try {
    if ((await chrome.storage.local.get(KR_FLAG))[KR_FLAG] !== true) return false;
    return await chrome.permissions.contains({ origins: KR_ORIGINS });
  } catch { return false; }
}

/** Search all KR services in parallel; a failing service contributes nothing (fail soft). */
export async function searchKr(q: string): Promise<KrSong[]> {
  const all = await Promise.allSettled([searchBugs(q), searchGenie(q), searchMelon(q)]);
  const out = all.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!out.length && all.every((r) => r.status === 'rejected')) throw new Error('KR sources failed');
  return out;
}

export function krLyrics(song: KrSong): Promise<KrLyrics | null> {
  return song.source === 'bugs' ? bugsLyrics(song) : song.source === 'genie' ? genieLyrics(song) : melonLyrics(song);
}
