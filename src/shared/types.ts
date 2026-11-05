/** One sung word: start `t` and length `d` (seconds, same timebase as the line), starting at char `c` of the line text. */
export interface LyricWord { t: number; d: number; c: number }
/** time in seconds; `words` only when the source has word-level (karaoke) timing. */
/** singer: who sings the line in a duet/feature (1 = first singer, 2 = second, 3 = together). */
export interface LyricLine { time: number; text: string; words?: LyricWord[]; singer?: 1 | 2 | 3 }
/** start/end in seconds; `end` only when known (e.g. YouTube's song cards), otherwise the next chapter's start. */
export interface Chapter { start: number; title: string; end?: number }
export interface SongQuery { artist: string; title: string; duration?: number }
export interface LyricsResult {
  kind: 'synced' | 'plain';
  artist: string; title: string;
  lines: LyricLine[]; // plain: time = -1
}
export interface Palette { from: string; to: string; glow: string } // CSS colors

/** Everything known about the playing video, for fuzzy song resolution in the background. */
export interface ResolveContext {
  videoId: string;
  videoTitle: string;      // raw YouTube title
  channel: string;         // raw channel name
  videoDuration?: number;  // seconds
  chapterTitle?: string;   // current chapter title for multi-song videos
  chapterDuration?: number;
}
