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
  t = t.replace(/\s*[|｜ㅣ]\s*(lyrics?|가사|lyric video|eng|kor|han|rom)[^|｜]*$/i, "").replace(/\s+[|｜].*$/, "");
  t = t.replace(/[[【][^\]】]*[\]】]/g, (m) => (NOISE.test(m) || /^[[【]\s*[^\]】]*[\]】]$/.test(m) ? ' ' : m));
  t = t.replace(/\(([^)]*)\)/g, (m, inner: string) => (NOISE.test(inner) && !/\b(feat|ft)\.?\b/i.test(inner) ? ' ' : m));
  t = t.replace(/\bofficial\s+(music\s+)?video\b/gi, ' ').replace(/(^|\s)M\/?V(\s|$)/g, ' ');
  t = t.replace(/\bofficial\b/gi, ' ');
  t = clean(t);

  // K-pop style: Artist (별칭) 'Title' ...  →  artist before the quote, title inside it
  const q = t.match(/^(.+?)\s*['‘’"“”「『〈《](.+?)['‘’"“”」』〉》](?![\p{L}\p{N}])/u);
  if (q && !/\s[-–—]\s/.test(q[1])) {
    const artist = clean(q[1].replace(/\s*\([^)]*\)\s*$/, '')) || clean(q[1]);
    return { artist, title: clean(q[2]) };
  }

  const m = t.match(/^(.+?)\s+[-–—_]\s+(.+)$/);
  if (m) {
    // Drop "(씨잼)"-style aliases, then keep only the first credited artist for lookup.
    const noAlias = clean(m[1].replace(/\s*\([^)]*\)/g, ' ')) || clean(m[1]);
    const artist = clean(noAlias.split(/\s*(?:&|,|×|\bx\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0]) || noAlias;
    return { artist, title: stripQuotes(clean(m[2])) };
  }
  const artist = clean(channel.replace(/\s*-\s*Topic\s*$/i, '').replace(/\s*official\s*$/i, '').replace(/^official\s*/i, ''));
  return { artist, title: stripQuotes(t) };
}
