export interface TimelineSong { title: string; artist: string; album?: string; start: number }
export interface TranscriptSeg { time: number; text: string } // video seconds
export interface Timeline { songs: TimelineSong[]; transcript: TranscriptSeg[] }

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

/** base64 protobuf {145:{1:videoId}} for get_panel. */
export function timelineParams(videoId: string): string {
  const id = Array.from(new TextEncoder().encode(videoId));
  const inner = [0x0a, id.length, ...id];
  // key for field 145, wire type 2 = varint(1162) = aa 09
  const bytes = [0xaa, 0x09, inner.length, ...inner];
  return btoa(String.fromCharCode(...bytes));
}

function parseClock(ts: unknown): number | undefined {
  if (typeof ts !== 'string' || !/^\d+(:\d{1,2}){1,2}$/.test(ts.trim())) return undefined;
  return ts.trim().split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** Depth-first search for the first array whose elements hold macroMarkersPanelItemViewModel. */
function findItems(node: unknown, depth = 0): Obj[] | undefined {
  if (!isObj(node) || depth > 40) return undefined;
  if (Array.isArray(node)) {
    if (node.some((e) => isObj(e) && 'macroMarkersPanelItemViewModel' in e)) return node;
    for (const e of node) { const r = findItems(e, depth + 1); if (r) return r; }
    return undefined;
  }
  for (const v of Object.values(node)) { const r = findItems(v, depth + 1); if (r) return r; }
  return undefined;
}

/** Parse a get_panel response. Never throws; returns empty arrays for unknown shapes. */
export function parseTimeline(json: unknown): Timeline {
  const songs: TimelineSong[] = [];
  const transcript: TranscriptSeg[] = [];
  try {
    let last: number | undefined;
    for (const el of findItems(json) ?? []) {
      const vm = el?.macroMarkersPanelItemViewModel;
      const item = vm?.item;
      if (!isObj(item)) continue;
      const tl = item.timelineItemViewModel;
      if (isObj(tl)) {
        const start = vm.onTap?.innertubeCommand?.watchEndpoint?.startTimeSeconds;
        const seg = Array.isArray(tl.contentItems) ? tl.contentItems[0]?.transcriptSegmentViewModel : undefined;
        const time = typeof start === 'number' && isFinite(start) ? start : parseClock(seg?.timestamp ?? tl.timestamp);
        if (time === undefined) continue;
        last = time;
        transcript.push({ time, text: String(seg?.simpleText ?? '').trim() });
        continue;
      }
      const va = item.videoAttributeViewModel;
      if (isObj(va)) {
        const title = typeof va.title === 'string' ? va.title.trim() : '';
        if (!title) continue;
        const sub = typeof va.subtitle === 'string' ? va.subtitle : '';
        const cut = sub.indexOf(' • ');
        const artist = (cut < 0 ? sub : sub.slice(0, cut)).trim();
        const album = cut < 0 ? undefined : sub.slice(cut + 3).trim() || undefined;
        const prev = songs[songs.length - 1];
        if (prev && prev.title === title && prev.artist === artist && prev.album === album) continue;
        songs.push({ title, artist, ...(album ? { album } : {}), start: last ?? 0 });
      }
    }
  } catch {
    return { songs: [], transcript: [] };
  }
  transcript.sort((a, b) => a.time - b.time);
  return { songs, transcript };
}

/** Songs as chapters with end times. */
export function songChapters(t: Timeline, videoDuration?: number): { start: number; end: number; title: string; artist: string }[] {
  return t.songs
    .map((s, i) => {
      const next = t.songs[i + 1];
      // YouTube often lists only the first N songs, so cap the last one.
      const end = next ? next.start : Math.min(videoDuration ?? Infinity, s.start + 360);
      return { start: s.start, end, title: s.title, artist: s.artist };
    })
    .filter((c) => c.end - c.start >= 20);
}
