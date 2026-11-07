/**
 * Page-world helper (manifest "world": "MAIN"). The content script runs in an isolated world and
 * can't reach two things that only the page's own world has:
 * - documentPictureInPicture.requestWindow(), allowed only here and only inside the click's user
 *   activation: a capture listener catches the click on our PiP button and opens the window; the
 *   content script then finds it through documentPictureInPicture.window and moves the panel in.
 * - YouTube's player, which knows the playing video's caption tracks (asr or the uploader's own).
 */
interface DocPip { requestWindow(o: { width: number; height: number }): Promise<Window>; window: Window | null }
interface Track { languageCode?: string; kind?: string }
interface PlayerResponse {
  videoDetails?: { videoId?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
  microformat?: { playerMicroformatRenderer?: { category?: string } };
}
const w = window as unknown as { documentPictureInPicture?: DocPip; __uwPage?: boolean };

if (!w.__uwPage) {
  w.__uwPage = true;
  const dp = w.documentPictureInPicture;
  if (dp) {
    document.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('.uw-pip-btn') : null;
      if (!b) return;
      if (dp.window) { dp.window.close(); return; }
      const width = Math.max(340, Math.min(520, Number(b.dataset.w) || 400));
      dp.requestWindow({ width, height: 600 })
        .then(() => document.dispatchEvent(new CustomEvent('uw:pip-open')))
        .catch((err: unknown) => document.dispatchEvent(new CustomEvent('uw:pip-fail', { detail: String(err) })));
    }, true);
  }

  // answer with plain JSON text: only primitives cross the world boundary reliably
  document.addEventListener('uw:captions?', () => {
    let detail = '{}';
    try {
      const player = document.getElementById('movie_player') as unknown as { getPlayerResponse?: () => PlayerResponse } | null;
      const pr = player?.getPlayerResponse?.();
      const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      detail = JSON.stringify({
        videoId: pr?.videoDetails?.videoId ?? null,
        uploader: tracks.filter((t) => t.kind !== 'asr').map((t) => t.languageCode ?? ''),
        category: pr?.microformat?.playerMicroformatRenderer?.category ?? null,
      });
    } catch { /* player not ready */ }
    document.dispatchEvent(new CustomEvent('uw:captions', { detail }));
  });
}
