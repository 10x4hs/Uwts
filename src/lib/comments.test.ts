import { describe, it, expect } from 'vitest';
import { commentsToken, parseComments, parseTracklist, pickTracklist } from './comments';

const PINNED = [
  '*저작권 이슈로 차단된 2023.11.02 영상 재업로드 버전입니다 :)',
  '',
  '재생 시간 :: 02:52:46',
  '',
  '00:00:01 Mariah Carey - All I Want for Christmas Is You',
  '00:03:59 Wham! - Last Christmas',
  '00:08:22 Ariana Grande - Santa Tell Me',
  '02:50:15 Four Year Strong - Somewhere in My Memory',
].join('\r\n');

const entity = (id: string, content: string, isCreator = false) => ({
  payload: { commentEntityPayload: { properties: { commentId: id, content: { content } }, author: { isCreator } } },
});

describe('comment tracklists', () => {
  it('finds the comment section token', () => {
    const next = { contents: { a: [{ itemSectionRenderer: { sectionIdentifier: 'other', contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'NO' } } } }] } },
      { itemSectionRenderer: { sectionIdentifier: 'comment-item-section', contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'YES' } } } }] } }] } };
    expect(commentsToken(next)).toBe('YES');
    expect(commentsToken({})).toBeNull();
  });

  it('reads comments and marks the pinned one', () => {
    const res = {
      onResponseReceivedEndpoints: [{ x: { commentViewModel: { commentId: 'p', pinnedText: '@ch님이 고정함' } } }],
      frameworkUpdates: { entityBatchUpdate: { mutations: [entity('a', 'hi'), entity('p', PINNED, true)] } },
    };
    expect(parseComments(res)).toEqual([
      { id: 'a', text: 'hi', creator: false, pinned: false },
      { id: 'p', text: PINNED, creator: true, pinned: true },
    ]);
  });

  it('parses an hour-style tracklist and skips the total-length line', () => {
    expect(parseTracklist(PINNED, 10366)).toEqual([
      { start: 0, title: 'Mariah Carey - All I Want for Christmas Is You' },
      { start: 239, title: 'Wham! - Last Christmas' },
      { start: 502, title: 'Ariana Grande - Santa Tell Me' },
      { start: 10215, title: 'Four Year Strong - Somewhere in My Memory' },
    ]);
  });

  it('ignores chatty comments with a timestamp or two', () => {
    expect(parseTracklist('3:15 여기 미쳤다\n5:00 ㅋㅋ')).toEqual([]);
    expect(parseTracklist('12:00 a\n13:00 b\n14:00 c')).toEqual([]); // does not start near the beginning
  });

  it('prefers the pinned/creator comment over others', () => {
    const fan = '0:00 x\n1:00 y\n2:00 z\n3:00 w\n4:00 v\n5:00 u';
    const list = pickTracklist([
      { id: 'f', text: fan, creator: false, pinned: false },
      { id: 'p', text: PINNED, creator: true, pinned: true },
    ]);
    expect(list[1].title).toBe('Wham! - Last Christmas');
    expect(pickTracklist([{ id: 'f', text: fan, creator: false, pinned: false }])).toHaveLength(6);
  });
});
