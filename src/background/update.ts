/**
 * Updates for friends who load the extension unpacked from the private GitHub repo's Releases.
 * - checkUpdate: the latest release tag, read through the user's own github.com session
 *   (a private repo is only visible to invited collaborators who are signed in).
 * - reloadIfFilesChanged: after a friend unzips a new version over the folder, the files on disk
 *   are newer than the running code; reload so the new version runs without pressing ↻.
 */
export const REPO = '10x4hs/Uwts';
const KEY = 'uw:update';
const CHECK_MS = 6 * 3600 * 1000;
const RETRY_MS = 10 * 60 * 1000; // a failed check (offline, signed out) is retried soon, not in 6 h

export interface UpdateInfo { current: string; latest?: string; url?: string }

/** true when version a is newer than b ("0.1.10" > "0.1.9"). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** "https://github.com/o/r/releases/tag/v0.2.0" -> "0.2.0" */
export function tagFromUrl(url: string): string | null {
  return url.match(/\/releases\/tag\/v?(\d+(?:\.\d+)*)$/)?.[1] ?? null;
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const current = chrome.runtime.getManifest().version;
  const got = (await chrome.storage.local.get(KEY))[KEY] as { at: number; latest?: string } | undefined;
  let latest = got?.latest;
  if (!got || Date.now() - got.at > (got.latest ? CHECK_MS : RETRY_MS)) {
    try {
      const res = await fetch(`https://github.com/${REPO}/releases/latest`, { credentials: 'include', cache: 'no-store' });
      latest = (res.ok && tagFromUrl(res.url)) || undefined;
    } catch { latest = undefined; }
    // keep the last known version if this check failed; only the timestamp decides when to retry
    await chrome.storage.local.set({ [KEY]: { at: Date.now(), latest: latest ?? got?.latest } });
    latest = latest ?? got?.latest;
  }
  if (!latest || !isNewer(latest, current)) return { current };
  return { current, latest, url: `https://github.com/${REPO}/releases/download/v${latest}/uwts-lyrics-${latest}.zip` };
}

export async function reloadIfFilesChanged(): Promise<void> {
  try {
    const disk = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json() as { version?: string };
    if (disk.version && disk.version !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch { /* packed install or unreadable: nothing to do */ }
}
