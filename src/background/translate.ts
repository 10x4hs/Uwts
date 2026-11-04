/** Lyric translation to Korean via Google's keyless web endpoint (the one Better Lyrics/YouLy+ use). */

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=';
const CACHE = 'tr:v2:';
const TTL_MS = 30 * 24 * 3600 * 1000;
/** Keep each request URL comfortably short. */
const CHUNK_CHARS = 1800;
const HANGUL = /[가-힣]/;
const LETTER = /\p{L}/u;

export const TRANSLATE_FLAG = 'uw:opt:translate';

export interface Translation { lang: string; lines: (string | null)[] }

/** Lines worth translating: has letters and no Hangul (Korean lines in a mixed song stay as is). */
export function needsTranslation(text: string): boolean {
  return LETTER.test(text) && !HANGUL.test(text);
}

/** Parse a gtx response: segments joined back together, then split on the newlines we sent. */
export function parseGtx(json: unknown): { lang: string; text: string } | null {
  if (!Array.isArray(json) || !Array.isArray(json[0])) return null;
  const text = (json[0] as unknown[]).map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : '')).join('');
  const lang = typeof json[2] === 'string' ? json[2] : '';
  return text ? { lang, text } : null;
}

/** A Korean song with a few English lines: leave it alone. */
export function mostlyKorean(lines: string[]): boolean {
  const words = lines.filter((l) => LETTER.test(l));
  return words.length > 0 && words.filter((l) => HANGUL.test(l)).length / words.length >= 0.5;
}

async function gtx(text: string): Promise<{ lang: string; lines: string[] }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(ENDPOINT + encodeURIComponent(text), { signal: ctl.signal });
    if (!res.ok) throw new Error(`translate ${res.status}`);
    const got = parseGtx(await res.json());
    if (!got) throw new Error('translate: bad response');
    return { lang: got.lang, lines: got.text.split('\n').map((s) => s.trim()) };
  } finally {
    clearTimeout(timer);
  }
}

/** Group line indexes into chunks of at most CHUNK_CHARS characters. */
export function chunks(texts: string[], max = CHUNK_CHARS): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let size = 0;
  texts.forEach((t, i) => {
    if (cur.length && size + t.length + 1 > max) { out.push(cur); cur = []; size = 0; }
    cur.push(i);
    size += t.length + 1;
  });
  if (cur.length) out.push(cur);
  return out;
}

async function hashKey(lines: string[]): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(lines.join('\n')));
  return CACHE + Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Korean translation per line (null where nothing to translate). Returns null when the song is
 * already Korean. Throws when Google can't be reached, so the caller can fall back.
 */
export async function translateLines(lines: string[]): Promise<Translation | null> {
  const key = await hashKey(lines);
  const hit = (await chrome.storage.local.get(key))[key] as { at: number; v: Translation | null } | undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;

  const todo = mostlyKorean(lines) ? [] : lines.map((l, i) => ({ i, text: l.trim() })).filter((x) => needsTranslation(x.text));
  let result: Translation | null = null;
  if (todo.length) {
    const out: (string | null)[] = lines.map(() => null);
    let lang = '';
    for (const group of chunks(todo.map((x) => x.text))) {
      const src = group.map((g) => todo[g]);
      const got = await gtx(src.map((x) => x.text).join('\n'));
      lang ||= got.lang;
      if (got.lines.length === src.length) {
        src.forEach((x, k) => { out[x.i] = got.lines[k] || null; });
      } else {
        // Google merged or split lines: translate this chunk line by line instead
        for (const x of src) out[x.i] = (await gtx(x.text)).lines.join(' ') || null;
      }
    }
    // same text back (names, "oh oh") is not a translation
    lines.forEach((l, i) => { if (out[i] && out[i]!.toLowerCase() === l.trim().toLowerCase()) out[i] = null; });
    result = lang === 'ko' || out.every((x) => !x) ? null : { lang, lines: out };
  }
  await chrome.storage.local.set({ [key]: { at: Date.now(), v: result } }).catch(() => {});
  return result;
}
