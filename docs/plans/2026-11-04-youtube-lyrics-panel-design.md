# YouTube Lyrics Panel — Design

Date: 2026-11-04 · Status: approved
Mockup: https://claude.ai/artifact/VArXxecADdKbckA2wRLic5 (board "미니멀 + 원자 터짐")

## Goal
Chrome (MV3) extension that shows YouTube-Music-style synced lyrics in a side panel on
youtube.com/watch, for any music video including multi-song playlist videos.

## Decisions
- Song identification: metadata only (no audio recognition).
  1. Description timestamps (`0:00 Title` lines) → pick the song for current time.
  2. Else clean the video title (`[MV]`, `(Official Video)`, `M/V`, …) → `Artist - Title`; artist falls back to channel name.
- Lyrics source: LRCLIB (`https://lrclib.net/api/search`, `/api/get`), no key. Synced → plain → "not found" + manual search.
- UI: right side panel above the related-videos column, collapsible. Minimal style
  (gradient bg, dim lines, current line bold white 26px, auto-center scroll, click line → seek).
- Effects (current line only): one-shot particle burst on line change (~14 small glowing dots), soft shimmer sweep.
- Dynamic colors: extract 2–3 dominant colors from the video thumbnail (background worker, OffscreenCanvas),
  darken for ≥4.5:1 contrast with white, ~1s transition on change. Multi-song video: hue-shift per song.
- No manual sync offset (YAGNI for now).

## Architecture
- `src/content/` — SPA navigation (`yt-navigate-finish`), panel mount, `<video>` time tracking, rendering.
- `src/background/` — LRCLIB fetch + cache (chrome.storage.session), thumbnail color extraction.
- `src/lib/` — pure logic: title cleaning, timestamp parsing, LRC parsing, current-line lookup, color math.
- Messaging: content → background via `chrome.runtime.sendMessage` typed in `src/shared/messages.ts`.

## Errors
Network failure → retry button. Wrong match → manual search overrides.

## Testing
Vitest unit tests for `src/lib/*`. Manual browser check: single MV and a playlist video.
