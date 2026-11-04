import type { Chapter } from '../shared/types';

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

export interface CommentText { id: string; text: string; creator: boolean; pinned: boolean }

function walk(node: unknown, visit: (o: Obj) => boolean | void, depth = 0): void {
  if (!isObj(node) || depth > 60) return;
  if (visit(node) === true) return;
  for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, visit, depth + 1);
}

/** Continuation token of the comment section in a /next (watch page) response. */
export function commentsToken(next: unknown): string | null {
  let token: string | null = null;
  walk(next, (o) => {
    if (token) return true;
    const sec = o.itemSectionRenderer;
    if (isObj(sec) && sec.sectionIdentifier === 'comment-item-section') {
      walk(sec.contents, (c) => {
        const t = c.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (typeof t === 'string' && !token) token = t;
        return !!token;
      });
      return true;
    }
  });
  return token;
}

/** Comments of a comment-continuation response (top comments, pinned first). Never throws. */
export function parseComments(json: unknown): CommentText[] {
  try {
    const pinned = new Set<string>();
    walk(json, (o) => {
      const vm = o.commentViewModel;
      if (isObj(vm) && typeof vm.commentId === 'string' && vm.pinnedText) pinned.add(vm.commentId);
    });
    const out: CommentText[] = [];
    const seen = new Set<string>();
    walk(json, (o) => {
      const c = o.commentEntityPayload;
      if (!isObj(c)) return;
      const id = c.properties?.commentId;
      const text = c.properties?.content?.content;
      if (typeof id !== 'string' || typeof text !== 'string' || seen.has(id)) return true;
      seen.add(id);
      out.push({ id, text, creator: c.author?.isCreator === true, pinned: pinned.has(id) });
      return true;
    });
    return out;
  } catch {
    return [];
  }
}

const TIME = '((?:\\d{1,2}:)?\\d{1,2}:\\d{2})';
const LEAD = new RegExp(`^\\s*(?:\\d+[.)]\\s*)?\\[?\\(?${TIME}\\)?\\]?\\s*[-–—|:.~]?\\s*(.+?)\\s*$`);
const TRAIL = new RegExp(`^\\s*(?:\\d+[.)]\\s*)?(.+?)\\s*[-–—|:~]?\\s*\\[?\\(?${TIME}\\)?\\]?\\s*$`);
const toSec = (s: string) => s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
const cleanTitle = (s: string) => s.replace(/^[\s\-–—|:.]+|[\s\-–—|:]+$/g, '').trim();
const TIME_ONLY = /\d{1,2}:\d{2}/;

/** Longest run of entries whose times keep going forward (drops "total 1:08:00"-style lines). */
function increasing(list: Chapter[]): Chapter[] {
  const len = list.map(() => 1);
  const prev = list.map(() => -1);
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < i; j++) {
      if (list[j].start < list[i].start && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    }
    if (best < 0 || len[i] > len[best]) best = i;
  }
  const out: Chapter[] = [];
  for (let k = best; k >= 0; k = prev[k]) out.unshift(list[k]);
  return out;
}

/** Tracklist lines from a comment: "00:03:59 Wham! - Last Christmas" or "Wham! - Last Christmas 3:59".
 *  Times must keep going forward; stray lines ("재생 시간 :: 02:52:46", "0:01 ——— 1:08:00") are dropped. */
export function parseTracklist(text: string, duration?: number): Chapter[] {
  const found: Chapter[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LEAD);
    const n = m ? null : line.match(TRAIL);
    const time = m ? m[1] : n?.[2];
    const raw = m ? m[2] : n?.[1];
    if (!time || raw === undefined) continue;
    const title = cleanTitle(raw);
    if (!title || TIME_ONLY.test(title) || !/\p{L}/u.test(title)) continue;
    const start = toSec(time);
    if (duration && start >= duration) continue;
    found.push({ start, title });
  }
  const out = increasing(found);
  if (out.length < 3 || out[0].start > 60) return [];
  if (out[0].start <= 15) out[0] = { ...out[0], start: 0 };
  return out;
}

/** The comment tracklist to trust: the pinned or creator's comment first, then a long one by anyone. */
export function pickTracklist(comments: CommentText[], duration?: number): Chapter[] {
  const own = comments.filter((c) => c.pinned || c.creator);
  for (const c of own) { const t = parseTracklist(c.text, duration); if (t.length) return t; }
  let best: Chapter[] = [];
  for (const c of comments) {
    if (c.pinned || c.creator) continue;
    const t = parseTracklist(c.text, duration);
    if (t.length >= 5 && t.length > best.length) best = t;
  }
  return best;
}
