import { send, ContextInvalidated } from '../shared/messages';
import type { Chapter, LyricLine, LyricsResult, Palette, ResolveContext, SongQuery } from '../shared/types';
import { overrideKey } from '../lib/keys';
import { buildQueries } from '../lib/queries';
import { parseChapters, chapterAt } from '../lib/chapters';
import { lineIndexAt } from '../lib/lrc';
import { shiftHue } from '../lib/color';
import { blurLevel, staggerDelay, scrollOffset, fillTiming, isSeek, titlesMatch, shouldAutoRetry, NavToken } from './motion';
import { segments, unitsToChar, priorOffset, estimateOffset, smoothOffset, isIntro, FillTracker, formatOffset, type Segment } from './align';
import { VocalTracker } from './audio';
import { addAnchor, timedLines, parseAnchors, groupByMatch, type Anchor } from './anchors';
import { reduce, initialState, sameQuery, descriptionFromScript, burstVectors, displayTitle, displayArtist, type Action, type PanelState } from './state';

const PARTICLES = 14;
const BURST_MS = 1800;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function videoIdFromUrl(): string | null {
  return location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
}

// ---------- page metadata ----------
const COLLAPSE_KEY = 'uw:collapsed';
/** Same-origin InnerTube call from the YouTube page itself: no extension host permission needed,
 *  and it returns the full (untruncated) description and exact length for this exact videoId. */
async function metaInPage(videoId: string): Promise<{ title: string; channel: string; description: string; duration?: number } | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch('/youtubei/v1/player?prettyPrint=false', {
      method: 'POST', credentials: 'same-origin', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, context: { client: { clientName: 'WEB', clientVersion: '2.20241023.01.00', hl: 'ko' } } }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const v = ((await res.json()) as { videoDetails?: { videoId?: string; title?: string; author?: string; shortDescription?: string; lengthSeconds?: string } }).videoDetails;
    if (!v?.title || (v.videoId && v.videoId !== videoId)) return null;
    return { title: v.title, channel: v.author ?? '', description: v.shortDescription ?? '', duration: Number(v.lengthSeconds) || undefined };
  } catch {
    return null;
  }
}

const offsetKey = (id: string) => `uw:offset:${id}`;
const anchorKey = (id: string, chapter?: string) => `uw:anchors:${id}#${chapter ?? ''}`;
const LONG_PRESS_MS = 550;
const ESTIMATE_MS = 15000;
const MIN_COVERAGE = 20;
let collapsedPref = false;
const nav = new NavToken();

function readDescriptionScript(videoId: string): string {
  for (const s of Array.from(document.querySelectorAll('script'))) {
    const t = s.textContent ?? '';
    if (t.includes('ytInitialPlayerResponse')) {
      const d = descriptionFromScript(t, videoId);
      if (d) return d;
    }
  }
  return '';
}

const domTitle = () => document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() ?? '';
const domChannel = () => document.querySelector('#owner #channel-name a')?.textContent?.trim() ?? '';
type Cand = LyricsResult & { duration?: number; match?: 'exact' | 'partial' };
const SEARCH_DEBOUNCE_MS = 300;
const formatDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}
const ICON_SEARCH = 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20';
const ICON_CHEVRON = 'M6 15l6-6 6 6';

// ---------- panel ----------
class Panel {
  root = el('section', 'uw-panel');
  bg = el('div', 'uw-bg');
  thumb = el('img', 'uw-thumb');
  titleEl = el('div', 'uw-title');
  subEl = el('div', 'uw-sub');
  body = el('div', 'uw-body');
  lyricsEl = el('div', 'uw-lyrics');
  collapseBtn = el('button', 'uw-btn uw-chip uw-collapse-btn');
  lineEls: HTMLElement[] = [];
  current = -1;
  state: PanelState = initialState;
  // search overlay (kept outside lyricsEl so typing survives re-renders)
  searchEl = el('div', 'uw-searchpanel');
  searchInput = el('input', 'uw-search-input');
  searchStatus = el('p', 'uw-search-status');
  resultsEl = el('ul', 'uw-results');
  searchTimer = 0;
  searchSeq = 0;
  candidates: Cand[] = [];
  bestQuery: SongQuery | null = null;
  ctxKey = '';
  lastCtx: ResolveContext | null = null;
  durationReady = false; // <video>.duration belongs to this navigation
  autoConfident = false;

  // song context
  videoId: string;
  token: number;
  ready = false;
  channel = '';
  videoTitle = '';
  chapters: Chapter[] = [];
  chapterIndex = -1;
  chapterStart = 0;
  basePalette: Palette | null = null;
  video: HTMLVideoElement | null = null;
  raf = 0;
  reqSeq = 0;
  failures = 0;
  retryTimer = 0;
  manualOffset = 0;
  manualTimer = 0;
  disposers: (() => void)[] = [];

  // sync: lyricTime = videoTime - chapterStart - syncOffset
  syncOffset = 0;
  manualSync = false;
  tracker: VocalTracker | null = null;
  fill: FillTracker | null = null;
  fillSegs: Segment[] = [];
  fillCum: number[] = [];
  lastLyricT = NaN;
  // manual sync anchors for the current song; `timed` = lines in (chapter-relative) video time, or null if unsynced
  anchors: Anchor[] = [];
  timed: LyricLine[] | null = null;
  anchorSeq = 0;
  resetBtn = el('button', 'uw-btn uw-chip uw-sync-btn uw-reset-btn', '싱크 초기화');
  estTimer = 0;
  toastTimer = 0;
  introEl = el('div', 'uw-intro');
  introText = el('span', 'uw-intro-text', '');
  introBtn = el('button', 'uw-btn uw-chip uw-intro-btn', '지금 시작됐어요');
  toastEl = el('div', 'uw-toast');

  constructor(videoId: string, token: number) {
    this.videoId = videoId;
    this.token = token;
    this.root.setAttribute('aria-label', '가사');
    const thumbUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    // animated blurred thumbnail mesh
    for (let i = 1; i <= 3; i++) {
      const img = el('img', `uw-mesh uw-mesh-${i}`);
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('load', () => this.bg.classList.add('uw-bg-ready'), { once: true });
      img.src = thumbUrl;
      this.bg.append(img);
    }
    this.bg.append(el('div', 'uw-bg-shade'));
    this.bg.setAttribute('aria-hidden', 'true');

    const header = el('header', 'uw-header');
    this.thumb.alt = '';
    this.thumb.src = thumbUrl;
    const meta = el('div', 'uw-meta');
    meta.append(this.titleEl, this.subEl);
    const searchBtn = el('button', 'uw-btn uw-chip uw-search-btn');
    searchBtn.type = 'button';
    searchBtn.setAttribute('aria-label', '가사 검색');
    searchBtn.append(icon(ICON_SEARCH));
    searchBtn.addEventListener('click', () => this.showSearch());
    this.collapseBtn.type = 'button';
    this.collapseBtn.append(icon(ICON_CHEVRON));
    this.collapseBtn.addEventListener('click', () => this.setCollapsed(!this.root.classList.contains('uw-collapsed'), true));
    header.append(this.thumb, meta, searchBtn, this.collapseBtn);
    const syncRow = el('div', 'uw-sync');
    // '+' moves the lyrics earlier (ahead), '−' later. syncOffset is subtracted from the video
    // time, so '+0.5s' means syncOffset − 0.5.
    for (const [label, d, aria, done] of [
      ['−0.5s', 0.5, '가사 0.5초 늦추기', '가사를 0.5초 늦췄어요'],
      ['+0.5s', -0.5, '가사 0.5초 앞당기기', '가사를 0.5초 앞당겼어요'],
    ] as const) {
      const b = el('button', 'uw-btn uw-chip uw-sync-btn', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.title = aria;
      b.addEventListener('click', () => this.setManualOffset(this.syncOffset + d, done));
      syncRow.append(b);
    }
    this.resetBtn.type = 'button';
    this.resetBtn.hidden = true;
    this.resetBtn.addEventListener('click', () => this.clearAnchors());
    syncRow.prepend(this.resetBtn);
    // The intro length is a guess (video longer than the track): never hide the lyrics behind it,
    // show when we expect the song to start and let the user correct it with one tap.
    this.introEl.setAttribute('role', 'status');
    this.introBtn.type = 'button';
    this.introBtn.setAttribute('aria-label', '노래가 지금 시작됐어요. 첫 줄을 지금 시간에 맞추기');
    this.introBtn.addEventListener('click', () => this.lineSungNow(0));
    this.introEl.append(el('span', 'uw-intro-note', '♪'), this.introText, this.introBtn);
    this.introEl.hidden = true;
    this.toastEl.setAttribute('role', 'status');
    this.buildSearch();
    this.body.append(this.searchEl, this.lyricsEl);
    const permBar = el('div', 'uw-perm');
    permBar.hidden = true;
    const permBtn = el('button', 'uw-btn uw-perm-btn', '더 많은 곡 찾기: 가사 소스 권한 허용');
    permBtn.type = 'button';
    permBtn.addEventListener('click', () => { void send({ type: 'perm:open' }).catch(() => {}); });
    permBar.append(permBtn);
    void send({ type: 'perm:status' }).then((r) => { if (r.ok && !r.granted) permBar.hidden = false; }).catch(() => {});
    // intro bar sits outside the scrolling/faded lyrics body so it stays crisp
    this.root.append(this.bg, header, permBar, syncRow, this.introEl, this.body, this.toastEl);
    // Keep typing inside the panel away from YouTube's global hotkeys (t = theater, f = fullscreen,
    // k/j/l = playback, / = search...), which otherwise fire while the user types a song name.
    for (const type of ['keydown', 'keypress', 'keyup'] as const) {
      this.root.addEventListener(type, (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, [contenteditable="true"]')) e.stopPropagation();
      });
    }
    this.setCollapsed(collapsedPref, false);
    let pressTimer = 0;
    let longPressed = false;
    this.lyricsEl.addEventListener('pointerdown', (e) => {
      const line = (e.target as HTMLElement).closest<HTMLElement>('.uw-line');
      longPressed = false;
      clearTimeout(pressTimer);
      if (!line?.dataset.index) return;
      pressTimer = window.setTimeout(() => { longPressed = true; this.lineSungNow(Number(line.dataset.index)); }, LONG_PRESS_MS);
    });
    const cancelPress = () => clearTimeout(pressTimer);
    this.lyricsEl.addEventListener('pointerup', cancelPress);
    this.lyricsEl.addEventListener('pointerleave', cancelPress);
    this.lyricsEl.addEventListener('pointercancel', cancelPress);
    this.lyricsEl.addEventListener('contextmenu', (e) => { if (longPressed) e.preventDefault(); });
    this.lyricsEl.addEventListener('click', (e) => {
      if (longPressed) { longPressed = false; return; }
      const line = (e.target as HTMLElement).closest<HTMLElement>('.uw-line');
      const t = line?.dataset.time;
      if (t != null && t !== '' && this.video && Number(t) >= 0) this.video.currentTime = Number(t) + this.chapterStart + this.syncOffset;
    });
    this.body.addEventListener('wheel', (e) => this.onUserScroll(e), { passive: false });
    const onVis = () => this.updatePaused();
    document.addEventListener('visibilitychange', onVis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVis));
  }

  destroyed = false;
  // not tied to isConnected: YouTube may detach the node briefly (theater mode) and rehost() puts it back
  get alive(): boolean { return nav.isCurrent(this.token) && !this.destroyed; }

  /** YouTube re-renders #secondary (theater/fullscreen toggles, layout changes) and drops our node:
   *  put the same panel back without losing its state. */
  rehost(): boolean {
    if (this.root.isConnected) return true;
    const host = document.querySelector('#secondary-inner') ?? document.querySelector('#secondary');
    if (!host || !(host as HTMLElement).offsetParent) return false;
    host.prepend(this.root);
    return true;
  }

  mount(): boolean {
    const host = document.querySelector('#secondary-inner') ?? document.querySelector('#secondary');
    if (!host) return false;
    host.prepend(this.root);
    this.attachVideo();
    chrome.storage?.local.get(offsetKey(this.videoId)).then((r) => {
      const v = r[offsetKey(this.videoId)];
      if (!this.alive || typeof v !== 'number') return;
      this.manualSync = true;
      this.syncOffset = v;
      this.refresh();
    }).catch(() => {});
    this.estTimer = window.setInterval(() => this.autoEstimate(), ESTIMATE_MS);
    // re-read persisted collapse state (another tab may have changed it)
    chrome.storage?.local.get(COLLAPSE_KEY).then((r) => {
      if (this.alive) this.setCollapsed(Boolean(r[COLLAPSE_KEY]), false);
    }).catch(() => {});
    void this.identify();
    return true;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.retryTimer);
    clearTimeout(this.searchTimer);
    clearTimeout(this.manualTimer);
    clearTimeout(this.toastTimer);
    clearInterval(this.estTimer);
    this.tracker?.destroy();
    this.disposers.forEach((d) => d());
    this.root.remove();
  }

  setCollapsed(c: boolean, persist: boolean) {
    this.root.classList.toggle('uw-collapsed', c);
    this.collapseBtn.setAttribute('aria-expanded', String(!c));
    this.collapseBtn.setAttribute('aria-label', c ? '가사 패널 펼치기' : '가사 패널 접기');
    this.updatePaused();
    if (persist) {
      collapsedPref = c;
      chrome.storage?.local.set({ [COLLAPSE_KEY]: c }).catch(() => {});
    }
  }

  updatePaused() {
    this.root.classList.toggle('uw-idle', document.hidden || this.root.classList.contains('uw-collapsed'));
  }

  dispatch(a: Action) {
    const prev = this.state.result;
    this.state = reduce(this.state, a);
    if (this.state.result !== prev) {
      // different lyrics: anchors (line indices) no longer apply
      if (this.anchors.length) { this.anchors = []; this.manualSync = false; }
      this.anchorSeq++;
    }
    this.render();
    if (this.state.result && this.state.result !== prev) this.loadAnchors();
  }

  // ----- video tracking -----
  attachVideo() {
    const v = document.querySelector<HTMLVideoElement>('video.html5-main-video') ?? document.querySelector('video');
    if (!v) return;
    this.video = v;
    this.tracker = new VocalTracker(v);
    const loop = () => { this.tick(); this.raf = requestAnimationFrame(loop); };
    const sync = () => this.root.classList.toggle('uw-vpaused', v.paused);
    const onPlay = () => { sync(); cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(loop); };
    const onPause = () => { sync(); cancelAnimationFrame(this.raf); this.tick(); };
    const onTime = () => { if (v.paused) this.tick(); };
    const refill = () => { this.tick(); this.applyFill(true); };
    const flexy = document.querySelector('ytd-watch-flexy');
    this.durationReady = v.readyState >= 1 && flexy?.getAttribute('video-id') === this.videoId;
    const onDur = () => {
      if (!isFinite(v.duration) || v.duration <= 0) return;
      this.durationReady = true;
      this.applyPrior();
    };
    const evs: [string, () => void][] = [
      ['loadedmetadata', onDur], ['durationchange', onDur],
      ['play', onPlay], ['pause', onPause], ['ended', onPause], ['timeupdate', onTime],
      ['seeked', refill], ['ratechange', refill],
    ];
    for (const [n, f] of evs) v.addEventListener(n, f);
    this.disposers.push(() => { for (const [n, f] of evs) v.removeEventListener(n, f); });
    sync();
    if (!v.paused) onPlay();
  }

  tick() {
    const v = this.video;
    if (!v || !this.ready) return;
    const t = v.currentTime;
    if (this.chapters.length) {
      const idx = chapterAt(this.chapters, t)?.index ?? -1;
      if (idx !== this.chapterIndex) { this.resolveSong(); return; }
    }
    const lines = this.timed;
    if (!lines) return;
    const lt = this.lyricTime();
    const intro = isIntro(lines, lt);
    this.root.classList.toggle('uw-intro-on', intro);
    if (this.introEl.hidden === intro) this.introEl.hidden = !intro;
    if (intro && lines.length) {
      const left = Math.max(0, Math.round(lines[0].time - lt));
      const txt = `노래 시작 전 · 약 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 후`;
      if (this.introText.textContent !== txt) this.introText.textContent = txt;
    }
    this.setCurrent(lineIndexAt(lines, lt));
    this.stepVoiceFill(lt);
  }

  lyricTime(): number {
    return (this.video?.currentTime ?? 0) - this.chapterStart - this.syncOffset;
  }

  /** Re-evaluate the active line and restart the fill after an offset change. */
  refresh() {
    this.current = -2; // force setCurrent to re-apply
    this.tick();
    this.applyFill(true);
  }

  showToast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('uw-toast-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('uw-toast-on'), 1400);
  }

  setManualOffset(o: number, message?: string) {
    this.syncOffset = Math.round(o * 10) / 10;
    this.manualSync = true;
    chrome.storage?.local.set({ [offsetKey(this.videoId)]: this.syncOffset }).catch(() => {});
    this.showToast(message ?? formatOffset(this.syncOffset));
    this.refresh();
  }

  /** "This line is being sung now": add (or move) a sync anchor on it. */
  lineSungNow(lineIndex: number) {
    const res = this.state.result;
    if (!this.video || !res || !(lineIndex >= 0 && lineIndex < res.lines.length)) return;
    const videoTime = Math.round((this.video.currentTime - this.chapterStart) * 100) / 100;
    this.anchors = addAnchor(this.anchors, { lineIndex, videoTime });
    // anchors replace the global offset; auto-estimation must never override them
    this.syncOffset = 0;
    this.manualSync = true;
    chrome.storage?.local.remove(offsetKey(this.videoId)).catch(() => {});
    this.saveAnchors();
    const n = this.anchors.length;
    this.showToast(res.kind === 'plain' && n < 2 ? `싱크 지점 ${n}개 저장됨 · 한 곳 더 맞춰 주세요` : `싱크 지점 ${n}개 저장됨`);
    this.render();
  }

  anchorStoreKey(): string { return anchorKey(this.videoId, this.lastCtx?.chapterTitle); }

  saveAnchors() {
    const res = this.state.result;
    if (!res) return;
    const key = this.anchorStoreKey();
    if (!this.anchors.length) { chrome.storage?.local.remove(key).catch(() => {}); return; }
    chrome.storage?.local.set({ [key]: { title: res.title, artist: res.artist, anchors: this.anchors } }).catch(() => {});
  }

  /** Restore anchors saved for this video/chapter, only if they belong to the same lyrics. */
  loadAnchors() {
    const res = this.state.result;
    const seq = ++this.anchorSeq;
    const key = this.anchorStoreKey();
    if (!res) return;
    chrome.storage?.local.get(key).then((r) => {
      const v = r[key] as { title?: string; artist?: string; anchors?: unknown } | undefined;
      if (!this.alive || seq !== this.anchorSeq || this.state.result !== res || !v) return;
      if (v.title !== res.title || v.artist !== res.artist) return;
      const list = parseAnchors(v.anchors).filter((a) => a.lineIndex < res.lines.length);
      if (!list.length) return;
      this.anchors = list;
      this.syncOffset = 0;
      this.manualSync = true;
      this.render();
    }).catch(() => {});
  }

  clearAnchors() {
    this.anchors = [];
    this.saveAnchors();
    this.manualSync = false;
    this.autoConfident = false;
    this.syncOffset = 0;
    this.applyPrior();
    this.showToast('싱크를 초기화했어요');
    this.render();
  }

  autoEstimate() {
    const res = this.state.result;
    if (this.manualSync || this.anchors.length || !this.tracker?.ready || this.state.status !== 'synced' || !res) return;
    const onsets = this.tracker.onsets
      .filter((o) => o.t >= this.chapterStart)
      .map((o) => ({ t: o.t - this.chapterStart, s: o.s }));
    if (onsets.length < 2 || onsets[onsets.length - 1].t - Math.min(...onsets.map((o) => o.t)) < MIN_COVERAGE) return;
    const e = estimateOffset(onsets, res.lines, this.syncOffset);
    // Debug breadcrumbs for verification (DevTools / automation): current & candidate offsets.
    this.root.dataset.syncOffset = this.syncOffset.toFixed(1);
    this.root.dataset.syncEstimate = `${e.offset.toFixed(1)}${e.confident ? '' : '?'}`;
    this.root.dataset.syncOnsets = String(onsets.length);
    if (!e.confident) return;
    this.autoConfident = true;
    const next = smoothOffset(this.syncOffset, e.offset);
    if (next === this.syncOffset) return;
    this.syncOffset = next;
    this.refresh();
  }

  /** Voice-driven fill on the active line; falls back to the CSS linear wipe without audio. */
  stepVoiceFill(lt: number) {
    const cur = this.lineEls[this.current];
    const prevT = this.lastLyricT;
    this.lastLyricT = lt;
    if (!cur || !this.fill || reducedMotion()) return;
    const dt = Math.min(0.1, Math.max(0, lt - prevT)) || 0;
    const p = this.fill.step(lt, dt, this.tracker?.activity ?? 0);
    const total = this.fillCum[this.fillCum.length - 1] || 1;
    const c = unitsToChar(this.fillSegs, p);
    const i = Math.floor(c);
    const x = (this.fillCum[i] ?? total) + ((this.fillCum[i + 1] ?? total) - (this.fillCum[i] ?? total)) * (c - i);
    const f = this.fill.fraction() >= 1 ? 1 : Math.min(1, x / total);
    cur.style.setProperty('--uw-fill-size', `calc(${(f * 100).toFixed(2)}% + ${(f * 0.75).toFixed(3)}em)`);
  }

  /** Cumulative pixel widths of the line's text per character (for word-by-word fill). */
  measure(line: HTMLElement): number[] {
    const node = line.firstChild;
    const text = node?.textContent ?? '';
    const cum = [0];
    if (!node || node.nodeType !== Node.TEXT_NODE) return cum;
    const r = document.createRange();
    let acc = 0;
    for (let i = 0; i < text.length; i++) {
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      let w = 0;
      for (const rect of Array.from(r.getClientRects())) w += rect.width;
      acc += w;
      cum.push(acc);
    }
    return cum;
  }

  setCurrent(i: number) {
    if (i === this.current) return;
    const prevIdx = this.current;
    const prev = this.lineEls[prevIdx];
    const seek = isSeek(prevIdx, i);
    this.current = i;
    if (prev) {
      prev.classList.remove('uw-current');
      // finished line snaps to white, then fades to the past style
      if (!seek) {
        prev.classList.add('uw-done');
        setTimeout(() => prev.classList.remove('uw-done'), 250);
      }
    }
    this.lineEls.forEach((e, k) => {
      e.classList.toggle('uw-past', k < i);
      e.classList.toggle('uw-future', k > i);
      e.style.setProperty('--blur', `${blurLevel(k, i)}px`);
      e.style.setProperty('--delay', `${staggerDelay(k, i, seek)}s`);
    });
    const cur = this.lineEls[i];
    this.position(cur ?? this.lineEls[0]);
    this.fill = null;
    if (!cur) return;
    cur.classList.add('uw-current');
    this.applyFill(false);
    if (prev || i === 0) this.burst(cur);
  }

  /** Start (or restart) the karaoke fill on the active line. */
  applyFill(restart: boolean) {
    const cur = this.lineEls[this.current];
    const lines = this.timed;
    if (!cur || !lines || !this.video) return;
    const lt = this.lyricTime();
    const f = fillTiming(lines, this.current, lt, this.video.playbackRate);
    if (!f) return;
    const voice = !!this.tracker?.ready && !reducedMotion();
    cur.classList.toggle('uw-voice', voice);
    if (voice) {
      const line = lines[this.current];
      const segs = segments(line.text);
      const total = segs.reduce((a, g) => a + g.units, 0);
      const fresh = !this.fill || this.fill.start !== line.time;
      if (fresh) {
        this.fill = new FillTracker(total, line.time, line.time + f.duration * (this.video.playbackRate || 1));
        this.fillSegs = segs;
        this.fillCum = this.measure(cur);
      }
      // seek / offset change mid-line: start from the linear position (tracker never goes backwards)
      if (restart && this.fill) {
        const lin = Math.min(1, Math.max(0, (lt - this.fill.start) / Math.max(0.05, this.fill.end - this.fill.start)));
        this.fill = new FillTracker(total, this.fill.start, this.fill.end);
        this.fill.p = total * lin;
      }
      this.lastLyricT = lt;
      this.stepVoiceFill(lt);
      return;
    }
    cur.style.setProperty('--uw-dur', `${f.duration}s`);
    cur.style.setProperty('--uw-fill-delay', `${f.delay}s`);
    if (restart) {
      cur.classList.remove('uw-current');
      void cur.offsetWidth; // reflow to restart the animation
      cur.classList.add('uw-current');
    }
  }

  position(line: HTMLElement | undefined) {
    if (!line) return;
    const y = scrollOffset(line.offsetTop, this.body.clientHeight);
    this.lyricsEl.style.setProperty('--uw-y', `${y}px`);
  }

  onUserScroll(e: WheelEvent) {
    if (!this.timed) return;
    e.preventDefault();
    this.manualOffset -= e.deltaY;
    const max = this.lyricsEl.scrollHeight;
    this.manualOffset = Math.max(-max, Math.min(max, this.manualOffset));
    this.lyricsEl.style.setProperty('--uw-m', `${this.manualOffset}px`);
    this.root.classList.add('uw-manual');
    clearTimeout(this.manualTimer);
    this.manualTimer = window.setTimeout(() => {
      this.manualOffset = 0;
      this.lyricsEl.style.setProperty('--uw-m', '0px');
      this.root.classList.remove('uw-manual');
    }, 3000);
  }

  burst(line: HTMLElement) {
    if (reducedMotion()) return;
    const box = el('div', 'uw-burst');
    for (const { dx, dy } of burstVectors(PARTICLES)) {
      const p = el('span', 'uw-particle');
      p.style.setProperty('--dx', `${dx}px`);
      p.style.setProperty('--dy', `${dy}px`);
      p.style.left = `${20 + Math.random() * 60}%`;
      box.append(p);
    }
    line.append(box);
    setTimeout(() => box.remove(), BURST_MS);
  }

  metaDuration: number | undefined;

  /** Header subtitle: the resolved artist (not the uploader), plus "n / m곡" in multi-song videos. */
  subtitleFor(artist: string): string {
    const a = displayArtist(artist);
    return this.chapterIndex >= 0 ? `${a} · ${this.chapterIndex + 1} / ${this.chapters.length}곡` : a;
  }

  // ----- song identification -----
  /** Per-navigation: oEmbed title/channel by videoId, then chapters only from a DOM that matches. */
  async identify() {
    let title = '';
    let channel = '';
    let metaDescription: string | undefined;
    const local = await metaInPage(this.videoId);
    if (!this.alive) return;
    if (local) {
      ({ title, channel } = local);
      metaDescription = local.description;
      this.metaDuration = local.duration;
    } else {
      try {
        const res = await send({ type: 'video:meta', videoId: this.videoId });
        if (!this.alive) return;
        if (res.ok) { title = res.title; channel = res.channel; metaDescription = res.description; this.metaDuration = res.duration; }
      } catch { /* fall through */ }
    }
    if (!this.alive) return;

    let description = '';
    if (metaDescription !== undefined) {
      // full, untruncated description straight from YouTube for this exact videoId
      description = metaDescription;
    } else if (title) {
      // only trust the DOM once its h1 has caught up with this video
      for (let waited = 0; waited <= 5000; waited += 250) {
        if (titlesMatch(domTitle(), title)) {
          description = readDescriptionScript(this.videoId) || (document.querySelector('#description-inner')?.textContent ?? '').replace(/(\.\.\.|…)\s*(더보기|more)\s*$/i, '');
          break;
        }
        await sleep(250);
        if (!this.alive) return;
      }
    } else {
      // oEmbed failed: wait briefly for the DOM, accept it, but never trust its description
      await sleep(1500);
      if (!this.alive) return;
      title = domTitle();
      channel = domChannel();
      description = readDescriptionScript(this.videoId);
    }
    this.videoTitle = title;
    this.channel = channel;
    this.chapters = description ? parseChapters(description) : [];
    this.ready = true;
    this.resolveSong();
  }

  resolveSong(force = false) {
    if (!this.alive || !this.ready) return;
    const t = this.video?.currentTime ?? 0;
    const dur = this.currentDuration() ?? this.metaDuration;
    const ctx: ResolveContext = { videoId: this.videoId, videoTitle: this.videoTitle, channel: this.channel, videoDuration: dur ? Math.round(dur) : undefined };
    let hueIndex = 0;
    const hit = this.chapters.length ? chapterAt(this.chapters, t) : null;
    if (hit) {
      this.chapterIndex = hit.index;
      this.chapterStart = hit.chapter.start;
      hueIndex = hit.index;
      const end = hit.end ?? dur;
      ctx.chapterTitle = hit.chapter.title;
      ctx.chapterDuration = end != null ? Math.round(end - hit.chapter.start) : undefined;
    } else {
      this.chapterIndex = -1;
      this.chapterStart = 0;
    }
    // provisional header from the local parse; replaced by the resolved song
    const guess = buildQueries(ctx);
    this.titleEl.textContent = guess.title;
    this.subEl.textContent = hit ? `${guess.artist} · ${hit.index + 1} / ${this.chapters.length}곡` : guess.artist;
    void this.applyPalette(hueIndex);
    const key = `${ctx.videoId}#${ctx.chapterTitle ?? ''}`;
    if (!force && key === this.ctxKey && this.state.status !== 'error') return;
    this.ctxKey = key;
    this.failures = 0;
    void this.load(ctx, { artist: guess.artist, title: guess.title, duration: ctx.chapterDuration ?? ctx.videoDuration });
  }

  async load(ctx: ResolveContext, guess: SongQuery) {
    const seq = ++this.reqSeq;
    clearTimeout(this.retryTimer);
    this.lastCtx = ctx;
    this.candidates = [];
    this.bestQuery = guess;
    this.dispatch({ type: 'load', query: guess });
    let error: string | null = null;
    try {
      const res = await send({ type: 'lyrics:resolve', ctx });
      if (seq !== this.reqSeq || !this.alive) return;
      if (res.ok) {
        this.failures = 0;
        this.candidates = res.candidates as Cand[];
        this.bestQuery = res.query;
        this.autoConfident = false;
        this.applyPrior(res.result);
        if (res.result) {
          this.titleEl.textContent = displayTitle(res.result.title);
          this.subEl.textContent = this.subtitleFor(res.result.artist);
        }
        this.dispatch({ type: 'loaded', result: res.result });
        if (!this.searchEl.hidden) this.showCandidates();
        return;
      }
      error = res.error;
    } catch (e) {
      if (seq !== this.reqSeq || !this.alive) return;
      if (e instanceof ContextInvalidated) {
        // extension was reloaded/updated under this tab: retrying can never work
        this.dispatch({ type: 'failed', error: '확장 프로그램이 업데이트됐어요. 페이지를 새로고침해 주세요.' });
        return;
      }
      error = String(e);
    }
    this.failures++;
    if (shouldAutoRetry(this.failures)) {
      // keep the loading skeleton up; try once more quietly
      this.retryTimer = window.setTimeout(() => { if (this.alive && seq === this.reqSeq) void this.load(ctx, guess); }, 3000);
      return;
    }
    this.dispatch({ type: 'failed', error });
  }

  async applyPalette(index: number) {
    if (!this.basePalette) {
      try {
        const res = await send({ type: 'palette:get', videoId: this.videoId });
        if (!res.ok || !this.alive) return;
        this.basePalette = res.palette;
      } catch { return; }
    }
    const p = index > 0 ? shiftHue(this.basePalette, index * 25) : this.basePalette;
    const s = this.root.style;
    s.setProperty('--uw-from', p.from);
    s.setProperty('--uw-to', p.to);
    s.setProperty('--uw-glow', p.glow);
  }

  /** Video duration only once it is known to belong to this video (SPA reuses the <video>). */
  currentDuration(): number | undefined {
    const d = this.video?.duration;
    return this.durationReady && d != null && isFinite(d) && d > 0 ? d : undefined;
  }

  /** Duration-based intro offset; re-applied when the duration arrives, unless user/auto sync took over. */
  applyPrior(result: LyricsResult | null = this.state.result) {
    if (this.manualSync || this.autoConfident || this.anchors.length) return;
    const dur = this.chapters.length ? undefined : this.currentDuration();
    const next = result ? priorOffset(dur, result.lines, (result as { duration?: number }).duration, this.videoTitle) : 0;
    if (next === this.syncOffset) return;
    this.syncOffset = next;
    if (this.timed) this.refresh();
  }

  // ----- search -----
  buildSearch() {
    this.searchEl.hidden = true;
    const form = el('form', 'uw-search');
    const input = this.searchInput;
    input.type = 'search';
    input.placeholder = '가수, 노래 제목';
    input.setAttribute('aria-label', '가사 검색어');
    input.autocomplete = 'off';
    const close = el('button', 'uw-btn uw-search-go', '닫기');
    close.type = 'button';
    close.addEventListener('click', () => this.closeSearch());
    form.append(input, close);
    form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(this.searchTimer); void this.search(input.value); });
    input.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      // drop results for the previous text right away so they never look like answers to the new one
      this.searchSeq++;
      if (input.value.trim()) this.renderResults([], '검색 중…');
      this.searchTimer = window.setTimeout(() => void this.search(input.value), SEARCH_DEBOUNCE_MS);
    });
    // keep keystrokes away from YouTube shortcuts
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.closeSearch(); });
    this.searchStatus.setAttribute('role', 'status');
    this.searchEl.append(form, this.searchStatus, this.resultsEl);
  }

  openSearch(focus: boolean) {
    const q = this.bestQuery ?? this.state.query;
    const wasHidden = this.searchEl.hidden;
    this.searchEl.hidden = false;
    this.root.classList.add('uw-searching');
    if (wasHidden) {
      // In multi-song videos the "artist" guess is usually the uploader (e.g. a playlist channel),
      // so prefill only the song title there; otherwise "artist title".
      const useArtist = q && this.chapterIndex < 0 && q.artist && q.artist !== this.channel;
      this.searchInput.value = q ? (useArtist ? `${q.artist} ${q.title}` : q.title).trim() : '';
      this.showCandidates();
    }
    this.body.scrollTop = 0;
    if (focus) this.searchInput.focus({ preventScroll: true });
  }

  closeSearch() {
    clearTimeout(this.searchTimer);
    this.searchSeq++;
    this.searchEl.hidden = true;
    this.root.classList.remove('uw-searching');
    if (this.timed) this.tick();
  }

  showSearch() {
    this.setCollapsed(false, true);
    if (this.searchEl.hidden) this.openSearch(true); else this.closeSearch();
  }

  /** Background-resolved candidates (lets the user fix a wrong match without typing). */
  showCandidates() {
    this.renderResults(this.candidates, this.candidates.length ? '' : (this.state.status === 'loading' ? '찾는 중…' : ''));
  }

  async search(q: string) {
    const seq = ++this.searchSeq;
    if (!q.trim()) { this.showCandidates(); return; }
    this.searchStatus.textContent = '검색 중…';
    try {
      const res = await send({ type: 'lyrics:search', q: q.trim() });
      if (!this.alive || seq !== this.searchSeq) return;
      if (res.ok) this.renderResults(res.results as Cand[], res.results.length ? '' : '검색 결과가 없어요');
      else this.renderResults([], '검색에 실패했어요. 다시 시도해 주세요.', true);
    } catch {
      if (this.alive && seq === this.searchSeq) this.renderResults([], '검색에 실패했어요. 다시 시도해 주세요.', true);
    }
  }

  renderResults(list: Cand[], status: string, error = false) {
    this.searchStatus.textContent = status;
    this.searchStatus.classList.toggle('uw-search-error', error);
    this.resultsEl.replaceChildren();
    const cur = this.state.result;
    const { exact, partial } = groupByMatch(list);
    const items: (Cand | null)[] = partial.length ? [...exact, null, ...partial] : exact;
    for (const r of items) {
      if (!r) {
        const d = el('li', 'uw-results-divider', '비슷한 결과');
        d.setAttribute('role', 'separator');
        this.resultsEl.append(d);
        continue;
      }
      const li = el('li');
      const b = el('button', r.match === 'partial' ? 'uw-result uw-result-partial' : 'uw-result');
      b.type = 'button';
      const chosen = !!cur && cur.title === r.title && cur.artist === r.artist && cur.kind === r.kind;
      if (chosen) { b.classList.add('uw-result-current'); b.setAttribute('aria-current', 'true'); }
      const meta = el('span', 'uw-result-meta');
      meta.append(el('span', 'uw-result-artist', r.artist));
      if (r.duration) meta.append(el('span', 'uw-result-dur', formatDuration(r.duration)));
      meta.append(el('span', `uw-badge${r.kind === 'synced' ? ' uw-badge-synced' : ''}`, r.kind === 'synced' ? '싱크' : '일반'));
      b.append(el('span', 'uw-result-title', r.title), meta);
      b.addEventListener('click', () => this.choose(r));
      li.append(b);
      this.resultsEl.append(li);
    }
  }

  choose(r: Cand) {
    this.reqSeq++; // drop any in-flight resolve
    clearTimeout(this.retryTimer);
    this.closeSearch();
    this.autoConfident = false;
    this.applyPrior(r);
    this.titleEl.textContent = displayTitle(r.title);
    this.subEl.textContent = this.subtitleFor(r.artist);
    this.dispatch({ type: 'choose', result: r });
    const key = overrideKey(this.videoId, this.lastCtx?.chapterTitle);
    chrome.storage?.local.set({ [key]: r }).catch(() => { /* quota */ });
  }

  // ----- render -----
  render() {
    const s = this.state;
    this.lyricsEl.replaceChildren();
    this.lineEls = [];
    this.current = -1;
    // karaoke only when the source is synced or anchors make it synced
    this.timed = (s.status === 'synced' || s.status === 'plain') && s.result ? timedLines(s.result.kind, s.result.lines, this.anchors) : null;
    const synced = !!this.timed;
    this.root.dataset.status = synced ? 'synced' : s.status;
    this.resetBtn.hidden = !this.anchors.length;
    this.root.classList.toggle('uw-has-anchors', this.anchors.length > 0);
    this.introEl.hidden = true;
    this.root.classList.remove('uw-intro-on');
    this.lyricsEl.style.setProperty('--uw-y', '0px');
    if (s.status === 'loading' || s.status === 'idle') {
      const sk = el('div', 'uw-skeleton');
      sk.setAttribute('aria-busy', 'true');
      sk.setAttribute('aria-label', '가사 불러오는 중');
      for (let i = 0; i < 6; i++) sk.append(el('div', 'uw-skel-line'));
      this.lyricsEl.append(sk);
    } else if ((s.status === 'synced' || s.status === 'plain') && s.result) {
      if (s.overridden) this.titleEl.textContent = displayTitle(s.result.title);
      if (!synced) this.lyricsEl.append(el('p', 'uw-hint', '줄을 길게 눌러 두세 곳만 맞추면 노래방처럼 따라가요'));
      s.result.lines.forEach((line, i) => {
        const p = el('p', 'uw-line uw-future', line.text || '♪');
        p.dataset.index = String(i);
        if (this.anchors.some((a) => a.lineIndex === i)) p.classList.add('uw-anchored');
        if (synced) {
          p.dataset.time = String(this.timed![i].time);
          p.tabIndex = 0;
          p.setAttribute('role', 'button');
          p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.click(); } });
        } else {
          p.classList.replace('uw-future', 'uw-plain');
        }
        this.lineEls.push(p);
        this.lyricsEl.append(p);
      });
      if (!synced) this.body.scrollTop = 0;
      if (synced) { this.position(this.lineEls[0]); this.tick(); }
    } else if (s.status === 'notfound') {
      this.renderNotFound();
    } else if (s.status === 'error') {
      const box = el('div', 'uw-message');
      box.append(el('p', 'uw-message-text', '가사를 불러오지 못했어요'));
      const retry = el('button', 'uw-btn uw-retry', '다시 시도');
      retry.type = 'button';
      retry.addEventListener('click', () => this.resolveSong(true));
      box.append(retry);
      this.lyricsEl.append(box);
    }
  }

  renderNotFound() {
    const box = el('div', 'uw-message');
    box.append(el('p', 'uw-message-text', '가사를 찾지 못했어요'));
    if (this.searchEl.hidden) {
      const b = el('button', 'uw-btn uw-retry', '직접 검색');
      b.type = 'button';
      b.addEventListener('click', () => this.openSearch(true));
      box.append(b);
    }
    this.lyricsEl.append(box);
    this.openSearch(false);
  }
}

// ---------- SPA lifecycle ----------
let panel: Panel | null = null;

function sync() {
  const id = videoIdFromUrl();
  if (panel && panel.videoId === id) { panel.rehost(); return; }
  // new navigation: invalidate every in-flight result and reset immediately
  const token = nav.next();
  panel?.destroy();
  panel = null;
  if (!id) return;
  const p = new Panel(id, token);
  panel = p;
  let tries = 0;
  const tryMount = () => {
    if (panel !== p || !nav.isCurrent(token)) return;
    if (!p.mount() && ++tries < 40) setTimeout(tryMount, 250);
  };
  tryMount();
}

chrome.storage?.local.get(COLLAPSE_KEY).then((r) => {
  collapsedPref = Boolean(r[COLLAPSE_KEY]);
  panel?.setCollapsed(collapsedPref, false);
}).catch(() => {});
chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === 'local' && COLLAPSE_KEY in changes) {
    collapsedPref = Boolean(changes[COLLAPSE_KEY].newValue);
    panel?.setCollapsed(collapsedPref, false);
  }
});
document.addEventListener('yt-navigate-start', () => { nav.next(); panel?.destroy(); panel = null; });
document.addEventListener('yt-navigate-finish', sync);
// re-attach after YouTube re-renders the side column (theater mode, window resizes)
setInterval(() => {
  if (panel && !panel.root.isConnected && panel.videoId === videoIdFromUrl()) panel.rehost();
}, 1000);
sync();
