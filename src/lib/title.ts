import type { SongQuery } from '../shared/types';
/** Strip noise like [MV], (Official Video) and split "Artist - Title". Falls back to channel as artist. */
export function parseVideoTitle(videoTitle: string, channel: string): SongQuery {
  throw new Error('TODO');
}
