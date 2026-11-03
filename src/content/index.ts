import { send } from '../shared/messages';
import type { Chapter, LyricsResult, Palette, SongQuery } from '../shared/types';
import { parseChapters, chapterAt } from '../lib/chapters';
import { parseVideoTitle } from '../lib/title';
import { lineIndexAt } from '../lib/lrc';
import { shiftHue } from '../lib/color';
import { blurLevel, staggerDelay, scrollOffset, fillTiming, isSeek, titlesMatch, shouldAutoRetry, NavToken } from './motion';
import { segments, unitsToChar, priorOffset, estimateOffset, smoothOffset, isIntro, FillTracker, formatOffset, type Segment } from './align';
import { VocalTracker } from './audio';
import { reduce, initialState, sameQuery, descriptionFromScript, burstVectors, type Action, type PanelState } from './state';

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
const offsetKey = (id: string) => `uw:offset:${id}`;
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
  estTimer = 0;
  toastTimer = 0;
  introEl = el('div', 'uw-intro', '♪');
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
    for (const [label, d, aria] of [['−0.5s', -0.5, '가사 0.5초 빠르게'], ['+0.5s', 0.5, '가사 0.5초 늦게']] as const) {
      const b = el('button', 'uw-btn uw-chip uw-sync-btn', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', () => this.setManualOffset(this.syncOffset + d));
      syncRow.append(b);
    }
    this.introEl.setAttribute('aria-hidden', 'true');
    this.toastEl.setAttribute('role', 'status');
    this.body.append(this.lyricsEl, this.introEl);
    this.root.append(this.bg, header, syncRow, this.body, this.toastEl);
    this.setCollapsed(collapsedPref, false);
    let pressTimer = 0;
    let longPressed = false;
    this.lyricsEl.addEventListener('pointerdown', (e) => {
      const line = (e.target as HTMLElement).closest<HTMLElement>('.uw-line');
      longPressed = false;
      clearTimeout(pressTimer);
      if (!line?.dataset.time) return;
      pressTimer = window.setTimeout(() => { longPressed = true; this.lineSungNow(Number(line.dataset.time)); }, LONG_PRESS_MS);
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
      if (t != null && this.video && Number(t) >= 0) this.video.currentTime = Number(t) + this.chapterStart + this.syncOffset;
    });
    this.body.addEventListener('wheel', (e) => this.onUserScroll(e), { passive: false });
    const onVis = () => this.updatePaused();
    document.addEventListener('visibilitychange', onVis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVis));
  }

  get alive(): boolean { return nav.isCurrent(this.token) && this.root.isConnected; }

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
    cancelAnimationFrame(this.raf);
    clearTimeout(this.retryTimer);
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
    this.state = reduce(this.state, a);
    this.render();
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
    const evs: [string, () => void][] = [
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
    if (this.state.status !== 'synced' || !this.state.result) return;
    const lt = this.lyricTime();
    const lines = this.state.result.lines;
    this.root.classList.toggle('uw-intro-on', isIntro(lines, lt));
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

  setManualOffset(o: number) {
    this.syncOffset = Math.round(o * 10) / 10;
    this.manualSync = true;
    chrome.storage?.local.set({ [offsetKey(this.videoId)]: this.syncOffset }).catch(() => {});
    this.showToast(formatOffset(this.syncOffset));
    this.refresh();
  }

  /** "This line is being sung now". */
  lineSungNow(lineTime: number) {
    if (!this.video || lineTime < 0) return;
    this.setManualOffset(this.video.currentTime - this.chapterStart - lineTime);
  }

  autoEstimate() {
    const res = this.state.result;
    if (this.manualSync || !this.tracker?.ready || this.state.status !== 'synced' || !res) return;
    const onsets = this.tracker.onsets
      .filter((o) => o.t >= this.chapterStart)
      .map((o) => ({ t: o.t - this.chapterStart, s: o.s }));
    if (onsets.length < 2 || onsets[onsets.length - 1].t - Math.min(...onsets.map((o) => o.t)) < MIN_COVERAGE) return;
    const e = estimateOffset(onsets, res.lines, this.syncOffset);
    if (!e.confident) return;
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
    const res = this.state.result;
    if (!cur || !res || this.state.status !== 'synced' || !this.video) return;
    const lt = this.lyricTime();
    const f = fillTiming(res.lines, this.current, lt, this.video.playbackRate);
    if (!f) return;
    const voice = !!this.tracker?.ready && !reducedMotion();
    cur.classList.toggle('uw-voice', voice);
    if (voice) {
      const line = res.lines[this.current];
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
    if (this.state.status !== 'synced') return;
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

  // ----- song identification -----
  /** Per-navigation: oEmbed title/channel by videoId, then chapters only from a DOM that matches. */
  async identify() {
    let title = '';
    let channel = '';
    try {
      const res = await send({ type: 'video:meta', videoId: this.videoId });
      if (!this.alive) return;
      if (res.ok) { title = res.title; channel = res.channel; }
    } catch { /* fall through */ }
    if (!this.alive) return;

    let description = '';
    if (title) {
      // only trust the DOM once its h1 has caught up with this video
      for (let waited = 0; waited <= 5000; waited += 250) {
        if (titlesMatch(domTitle(), title)) {
          description = readDescriptionScript(this.videoId) || (document.querySelector('#description-inner')?.textContent ?? '');
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

  resolveSong() {
    if (!this.alive || !this.ready) return;
    const t = this.video?.currentTime ?? 0;
    const dur = this.video && isFinite(this.video.duration) ? this.video.duration : undefined;
    let query: SongQuery;
    let hueIndex = 0;
    const hit = this.chapters.length ? chapterAt(this.chapters, t) : null;
    if (hit) {
      this.chapterIndex = hit.index;
      this.chapterStart = hit.chapter.start;
      hueIndex = hit.index;
      const end = hit.end ?? dur;
      query = { ...parseVideoTitle(hit.chapter.title, this.channel), duration: end != null ? Math.round(end - hit.chapter.start) : undefined };
      this.subEl.textContent = `${query.artist} · ${hit.index + 1} / ${this.chapters.length}곡`;
    } else {
      this.chapterIndex = -1;
      this.chapterStart = 0;
      query = { ...parseVideoTitle(this.videoTitle, this.channel), duration: dur ? Math.round(dur) : undefined };
      this.subEl.textContent = query.artist;
    }
    this.titleEl.textContent = query.title;
    void this.applyPalette(hueIndex);
    if (sameQuery(query, this.state.query) && this.state.status !== 'error') return;
    this.failures = 0;
    void this.load(query);
  }

  async load(query: SongQuery) {
    const seq = ++this.reqSeq;
    clearTimeout(this.retryTimer);
    this.dispatch({ type: 'load', query });
    let error: string | null = null;
    try {
      const res = await send({ type: 'lyrics:get', query });
      if (seq !== this.reqSeq || !this.alive) return;
      if (res.ok) {
        this.failures = 0;
        if (!this.manualSync) {
          const dur = this.video && isFinite(this.video.duration) && !this.chapters.length ? this.video.duration : undefined;
          this.syncOffset = res.result ? priorOffset(dur, res.result.lines) : 0;
        }
        this.dispatch({ type: 'loaded', result: res.result });
        return;
      }
      error = res.error;
    } catch (e) {
      if (seq !== this.reqSeq || !this.alive) return;
      error = String(e);
    }
    this.failures++;
    if (shouldAutoRetry(this.failures)) {
      // keep the loading skeleton up; try once more quietly
      this.retryTimer = window.setTimeout(() => { if (this.alive && seq === this.reqSeq) void this.load(query); }, 3000);
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

  async search(q: string) {
    if (!q.trim()) return;
    this.dispatch({ type: 'search' });
    try {
      const res = await send({ type: 'lyrics:search', q });
      if (!this.alive) return;
      if (res.ok) this.dispatch({ type: 'searchDone', results: res.results });
      else this.dispatch({ type: 'searchFailed', error: res.error });
    } catch (e) {
      if (this.alive) this.dispatch({ type: 'searchFailed', error: String(e) });
    }
  }

  showSearch() {
    this.setCollapsed(false, true);
    this.dispatch({ type: 'loaded', result: null });
  }

  // ----- render -----
  render() {
    const s = this.state;
    this.lyricsEl.replaceChildren();
    this.lineEls = [];
    this.current = -1;
    this.root.dataset.status = s.status;
    this.lyricsEl.style.setProperty('--uw-y', '0px');
    if (s.status === 'loading' || s.status === 'idle') {
      const sk = el('div', 'uw-skeleton');
      sk.setAttribute('aria-busy', 'true');
      sk.setAttribute('aria-label', '가사 불러오는 중');
      for (let i = 0; i < 6; i++) sk.append(el('div', 'uw-skel-line'));
      this.lyricsEl.append(sk);
    } else if ((s.status === 'synced' || s.status === 'plain') && s.result) {
      if (s.overridden) this.titleEl.textContent = s.result.title;
      for (const line of s.result.lines) {
        const p = el('p', 'uw-line uw-future', line.text || '♪');
        if (s.status === 'synced') {
          p.dataset.time = String(line.time);
          p.tabIndex = 0;
          p.setAttribute('role', 'button');
          p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.click(); } });
        } else {
          p.className = 'uw-line uw-plain';
        }
        this.lineEls.push(p);
        this.lyricsEl.append(p);
      }
      this.body.scrollTop = 0;
      if (s.status === 'synced') { this.position(this.lineEls[0]); this.tick(); }
    } else if (s.status === 'notfound') {
      this.renderNotFound(s);
    } else if (s.status === 'error') {
      const box = el('div', 'uw-message');
      box.append(el('p', 'uw-message-text', '가사를 불러오지 못했어요'));
      const retry = el('button', 'uw-btn uw-retry', '다시 시도');
      retry.type = 'button';
      retry.addEventListener('click', () => s.query && this.load(s.query));
      box.append(retry);
      this.lyricsEl.append(box);
    }
  }

  renderNotFound(s: PanelState) {
    const box = el('div', 'uw-message');
    box.append(el('p', 'uw-message-text', '가사를 찾지 못했어요'));
    const form = el('form', 'uw-search');
    const input = el('input', 'uw-search-input');
    input.type = 'search';
    input.placeholder = '가수, 노래 제목';
    input.setAttribute('aria-label', '가사 검색어');
    input.value = s.query ? `${s.query.artist} ${s.query.title}`.trim() : '';
    const go = el('button', 'uw-btn uw-search-go', s.searching ? '검색 중…' : '검색');
    go.type = 'submit';
    form.append(input, go);
    form.addEventListener('submit', (e) => { e.preventDefault(); this.search(input.value); });
    // keep keystrokes away from YouTube shortcuts
    input.addEventListener('keydown', (e) => e.stopPropagation());
    box.append(form);
    if (s.error) box.append(el('p', 'uw-search-error', '검색에 실패했어요. 다시 시도해 주세요.'));
    if (s.searchResults.length) {
      const ul = el('ul', 'uw-results');
      for (const r of s.searchResults) {
        const li = el('li');
        const b = el('button', 'uw-result');
        b.type = 'button';
        b.append(el('span', 'uw-result-title', r.title), el('span', 'uw-result-artist', `${r.artist} · ${r.kind === 'synced' ? '싱크' : '일반'}`));
        b.addEventListener('click', () => this.dispatch({ type: 'choose', result: r }));
        li.append(b);
        ul.append(li);
      }
      box.append(ul);
    }
    this.lyricsEl.append(box);
  }
}

// ---------- SPA lifecycle ----------
let panel: Panel | null = null;

function sync() {
  const id = videoIdFromUrl();
  if (panel && panel.videoId === id && panel.root.isConnected) return;
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
sync();
