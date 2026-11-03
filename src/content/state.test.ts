import { describe, it, expect } from 'vitest';
import { reduce, initialState, sameQuery, descriptionFromScript, burstVectors } from './state';
import type { LyricsResult } from '../shared/types';

const synced: LyricsResult = { kind: 'synced', artist: 'A', title: 'T', lines: [{ time: 1, text: 'x' }] };
const plain: LyricsResult = { kind: 'plain', artist: 'A', title: 'T', lines: [{ time: -1, text: 'x' }] };

describe('reduce', () => {
  it('load -> loading with query, clears result', () => {
    const s = reduce({ ...initialState, result: synced }, { type: 'load', query: { artist: 'a', title: 't' } });
    expect(s.status).toBe('loading'); expect(s.result).toBeNull(); expect(s.query?.title).toBe('t');
  });
  it('loaded maps kinds', () => {
    expect(reduce(initialState, { type: 'loaded', result: synced }).status).toBe('synced');
    expect(reduce(initialState, { type: 'loaded', result: plain }).status).toBe('plain');
    expect(reduce(initialState, { type: 'loaded', result: null }).status).toBe('notfound');
    expect(reduce(initialState, { type: 'loaded', result: { ...synced, lines: [] } }).status).toBe('notfound');
  });
  it('failed -> error', () => {
    const s = reduce(initialState, { type: 'failed', error: 'net' });
    expect(s.status).toBe('error'); expect(s.error).toBe('net');
  });
  it('search flow and choose overrides', () => {
    let s = reduce(initialState, { type: 'loaded', result: null });
    s = reduce(s, { type: 'search' }); expect(s.searching).toBe(true);
    s = reduce(s, { type: 'searchDone', results: [plain] }); expect(s.searchResults).toHaveLength(1);
    s = reduce(s, { type: 'choose', result: synced });
    expect(s.status).toBe('synced'); expect(s.overridden).toBe(true); expect(s.searchResults).toHaveLength(0);
  });
  it('searchFailed keeps status', () => {
    const s = reduce(reduce({ ...initialState, status: 'notfound' }, { type: 'search' }), { type: 'searchFailed', error: 'e' });
    expect(s.status).toBe('notfound'); expect(s.searching).toBe(false); expect(s.error).toBe('e');
  });
});

describe('helpers', () => {
  it('sameQuery is case-insensitive', () => {
    expect(sameQuery({ artist: 'IU', title: 'Love' }, { artist: 'iu', title: 'love' })).toBe(true);
    expect(sameQuery({ artist: 'IU', title: 'A' }, { artist: 'IU', title: 'B' })).toBe(false);
    expect(sameQuery(null, null)).toBe(true);
    expect(sameQuery(null, { artist: '', title: '' })).toBe(false);
  });
  it('descriptionFromScript decodes for matching video only', () => {
    const txt = 'var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc","shortDescription":"0:00 Song\\n3:10 \\"Two\\""}};';
    expect(descriptionFromScript(txt, 'abc')).toBe('0:00 Song\n3:10 "Two"');
    expect(descriptionFromScript(txt, 'zzz')).toBeNull();
  });
  it('burstVectors returns n vectors', () => {
    const v = burstVectors(14, () => 0.5);
    expect(v).toHaveLength(14);
    expect(v[0]).toEqual({ dx: 65, dy: 0 });
  });
});
