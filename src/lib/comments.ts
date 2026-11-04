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

const LINE = /^\s*(?:\d+[.)]\s*)?\[?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\]?\s*[-–—|:.~]?\s*(.+?)\s*$/;
const toSec = (s: string) => s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);

/** "00:03:59 Wham! - Last Christmas" lines from a comment. Lines must start with the time and
 *  keep going forward; anything else ("재생 시간 :: 02:52:46", a time out of order) is skipped. */
export function parseTracklist(text: string, duration?: number): Chapter[] {
  const out: Chapter[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LINE);
    if (!m) continue;
    const start = toSec(m[1]);
    const title = m[2].replace(/^[\s\-–—|:.]+|[\s\-–—|:]+$/g, '').trim();
    if (!title || /^\d+(:\d{2})*$/.test(title)) continue;
    if (duration && start >= duration) continue;
    if (out.length && start <= out[out.length - 1].start) continue;
    out.push({ start, title });
  }
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
