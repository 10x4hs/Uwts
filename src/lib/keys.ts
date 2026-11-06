/** chrome.storage.local keys shared by background and content (chapter videos get one key per chapter title). */
const suffix = (chapterTitle?: string) => (chapterTitle ? `#${chapterTitle.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()}` : '');
export const resolveKey = (videoId: string, chapterTitle?: string) => `uw:resolve:v7:${videoId}${suffix(chapterTitle)}`;
export const overrideKey = (videoId: string, chapterTitle?: string) => `uw:override:${videoId}${suffix(chapterTitle)}`;
