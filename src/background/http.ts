const BACKOFF_MS = [400, 1200];
const TIMEOUT_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (s: number) => s === 429 || s >= 500;

/** GET JSON with 8s timeout per attempt; retries 429/5xx/network errors up to 3 times. 404 -> body null. */
export async function getJson<T>(url: string, label = 'HTTP', backoff = BACKOFF_MS): Promise<{ status: number; body: T | null }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt > 0) await sleep(backoff[attempt - 1]);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.status === 404) return { status: 404, body: null };
      if (!res.ok) {
        lastErr = new Error(`${label} HTTP ${res.status}`);
        if (retryable(res.status)) continue;
        throw lastErr;
      }
      return { status: res.status, body: (await res.json()) as T };
    } catch (e) {
      if (e === lastErr) throw e; // non-retryable HTTP status
      lastErr = e instanceof Error && e.name === 'AbortError' ? new Error(`${label} timeout`) : e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** GET text once with a timeout (unofficial endpoints: fail soft, no retries). */
export async function getText(url: string, label = 'HTTP'): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    throw e instanceof Error && e.name === 'AbortError' ? new Error(`${label} timeout`) : e;
  } finally {
    clearTimeout(timer);
  }
}
