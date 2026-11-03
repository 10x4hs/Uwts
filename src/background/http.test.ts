import { describe, it, expect, vi, afterEach } from 'vitest';
import { getJson } from './http';

const resp = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe('getJson', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('retries 503 then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(503)).mockRejectedValueOnce(new TypeError('net')).mockResolvedValueOnce(resp(200, { a: 1 }));
    vi.stubGlobal('fetch', f);
    expect((await getJson('u', 'X', [0, 0, 0])).body).toEqual({ a: 1 });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('gives up after 3 retries', async () => {
    const f = vi.fn().mockImplementation(async () => resp(503));
    vi.stubGlobal('fetch', f);
    await expect(getJson('u', 'X', [0, 0, 0])).rejects.toThrow('X HTTP 503');
    expect(f).toHaveBeenCalledTimes(4);
  });
  it('does not retry 400; 404 is null', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(400)).mockResolvedValueOnce(resp(404));
    vi.stubGlobal('fetch', f);
    await expect(getJson('u', 'X', [0])).rejects.toThrow('HTTP 400');
    expect((await getJson('u', 'X', [0])).body).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });
});
