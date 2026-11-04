# Grill: Karaoke fill that follows the singing
Date: 2026-11-04

## Intent
The fill should move with the singer, word by word, the way the best lyric apps do, not crawl linearly to the next line.

## Constraints
- Lyrics must appear fast; the word source takes 4-8s.
- A wrong highlight is worse than an approximate one.
- Friends-only distribution; third-party sources must be switchable off in one place.

## Key decisions
- Decision: Follow YouLy+/Better Lyrics: show line lyrics first, upgrade to word-timed lyrics from LyricsPlus (Apple/Musixmatch/QQ syllable timing) when it arrives. Reason: covers most K-pop (Supernova, Hype Boy, Magnetic, Dynamite, APT., Love wins all). Alternative considered: on-device Whisper alignment (heavy, weak on sung Korean), YouTube json3 word captions (needs PoToken).
- Decision: Upgrade only when the word lyrics match the shown lyrics (bigram similarity >= 0.6) and the user has not synced by hand. Reason: anchors are line indices; never swap in a different song or translation.
- Decision: Keep NetEase yrc and the pace estimate as fallbacks. Reason: songs LyricsPlus lacks (e.g. RESCENE, C JAMM).
- Decision: Default on, one flag (uw:opt:wordSync) turns it off. Reason: user wants it working for friends; separable if published.

## Open questions
- YouTube auto-caption word timings (json3 + PoToken) for songs no source has.

## Out of scope
- Running our own lyrics server; on-device speech recognition.
