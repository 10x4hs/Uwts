import { getText } from '../http';
import { plainLines, type KrLyrics, type KrSong } from './types';

/**
 * Melon (unofficial, plain only). Search: www.melon.com/search/keyword/index.json (autocomplete JSON,
 * no duration). Lyrics: www.melon.com/song/lyricInfo.json?songId= -> {"lyric":"line<BR>line"}.
 */
interface MelonSong { SONGID: string; SONGNAME: string; ARTISTNAME: string }

export async function searchMelon(q: string): Promise<KrSong[]> {
  const d = JSON.parse(await getText(`https://www.melon.com/search/keyword/index.json?${new URLSearchParams({ query: q })}`, 'Melon')) as { SONGCONTENTS?: MelonSong[] };
  return (d.SONGCONTENTS ?? []).map((s) => ({ source: 'melon' as const, id: String(s.SONGID), title: s.SONGNAME, artist: s.ARTISTNAME }));
}

export async function melonLyrics(song: KrSong): Promise<KrLyrics | null> {
  const d = JSON.parse(await getText(`https://www.melon.com/song/lyricInfo.json?songId=${encodeURIComponent(song.id)}`, 'Melon')) as { lyric?: string };
  const lines = plainLines(d.lyric ?? '');
  return lines.length ? { kind: 'plain', artist: song.artist, title: song.title, lines, duration: song.duration, source: 'melon' } : null;
}
