import type { SongQuery } from '../shared/types';

const NOISE = /\b(official|music\s*video|video|audio|m\/?v|lyrics?|visualizer|performance|teaser|hd|4k|color\s*coded)\b/i;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s\-–—_|:]+|[\s\-–—_|:]+$/g, '').trim();
}

function stripQuotes(s: string): string {
  const m = s.match(/^\s*['"‘’“”「『〈《](.+?)['"‘’“”」』〉》]\s*(.*)$/);
  return m ? clean(`${m[1]} ${m[2]}`) : s;
}

/** Strip noise like [MV], (Official Video) and split "Artist - Title". Falls back to channel as artist. */
export function parseVideoTitle(videoTitle: string, channel: string): SongQuery {
  let t = videoTitle;
  t = t.replace(/\s+\|.*$/, '');
  t = t.replace(/[[【][^\]】]*[\]】]/g, (m) => (NOISE.test(m) || /^[[【]\s*[^\]】]*[\]】]$/.test(m) ? ' ' : m));
  t = t.replace(/\(([^)]*)\)/g, (m, inner: string) => (NOISE.test(inner) && !/\b(feat|ft)\.?\b/i.test(inner) ? ' ' : m));
  t = t.replace(/\bofficial\s+(music\s+)?video\b/gi, ' ').replace(/(^|\s)M\/?V(\s|$)/g, ' ');
  t = clean(t);

  const m = t.match(/^(.+?)\s+[-–—_]\s+(.+)$/);
  if (m) {
    let artist = clean(m[1]);
    if (/[가-힣]/.test(artist)) {
      const stripped = clean(artist.replace(/\s*\([^)]*\)\s*$/, ''));
      if (stripped) artist = stripped;
    }
    return { artist, title: stripQuotes(clean(m[2])) };
  }
  const artist = clean(channel.replace(/\s*-\s*Topic\s*$/i, '').replace(/\s*official\s*$/i, '').replace(/^official\s*/i, ''));
  return { artist, title: stripQuotes(t) };
}
