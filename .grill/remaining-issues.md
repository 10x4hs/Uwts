# Grill: Remaining issues (new songs, search noise, auto sync)
Date: 2026-11-04

## Intent
Make the lyrics panel dependable for everyday use: new K-pop songs should still show lyrics, search should surface the right song first, and karaoke highlighting must never be confidently wrong.

## Constraints
- Personal use now, possible public release later. Anything legally grey must be separable.
- A wrong highlight is worse than a few manual taps.

## Key decisions
- Decision: Default sources stay distribution-safe (LRCLIB, NetEase). Korean sites go behind an opt-in "personal sources" setting. Reason: works for new songs now, one switch to remove before publishing. Alternative considered: Korean sites always on (blocks public release).
- Decision: Source order is synced Korean sources (Bugs/Genie) → plain lyrics → auto-sync of plain lyrics. Reason: the user chose B → A → C.
- Decision: Auto-sync = smarter manual anchoring first. Long-press 2–3 lines and the rest of the timing is interpolated, then saved per video. On-device speech recognition (Whisper) comes later as an experimental feature. Reason: no API cost, no audio leaves the device, no confidently-wrong highlights. Alternatives considered: cloud speech-to-text (cost/privacy), on-device Whisper now (heavy, unproven on Korean rap).
- Decision: Search shows exact matches first and partial matches below a "비슷한 결과" divider, dimmed. Alternative considered: strict filtering (typos return nothing).

## Surfaced assumptions
- Plain lyrics plus a few manual anchors are an acceptable experience for brand-new songs.
- Unofficial Korean endpoints can break at any time, so they must fail soft.

## Out of scope
- Cloud speech recognition.
- Publishing to the Chrome Web Store (this round).
