export interface LyricLine { time: number; text: string } // time in seconds
export interface Chapter { start: number; title: string } // start in seconds
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
