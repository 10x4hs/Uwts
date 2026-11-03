import { send } from '../shared/messages';
import type { Chapter, LyricsResult, Palette, SongQuery } from '../shared/types';
import { parseChapters, chapterAt } from '../lib/chapters';
import { parseVideoTitle } from '../lib/title';
import { lineIndexAt } from '../lib/lrc';
import { shiftHue } from '../lib/color';
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
function readDescription(videoId: string): string {
  for (const s of Array.from(document.querySelectorAll('script'))) {
    const t = s.textContent ?? '';
    if (t.includes('ytInitialPlayerResponse')) {
      const d = descriptionFromScript(t, videoId);
      if (d) return d;
    }
  }
  return document.querySelector('#description-inner')?.textContent ?? '';
}

function readMeta() {
  const title = document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() ?? '';
  const channel = document.querySelector('#owner #channel-name a')?.textContent?.trim() ?? '';
  return { title, channel };
}

// ---------- panel ----------
class Panel {
  root = el('section', 'uw-panel');
  thumb = el('img', 'uw-thumb');
  titleEl = el('div', 'uw-title');
  subEl = el('div', 'uw-sub');
  body = el('div', 'uw-body');
  lyricsEl = el('div', 'uw-lyrics');
  lineEls: HTMLElement[] = [];
  current = -1;
  state: PanelState = initialState;

  // song context
  videoId: string;
  chapters: Chapter[] = [];
  chapterIndex = -1;
  chaptersParsed = false;
  chapterStart = 0;
  basePalette: Palette | null = null;
  video: HTMLVideoElement | null = null;
  raf = 0;
  reqSeq = 0;
  disposers: (() => void)[] = [];

  constructor(videoId: string) {
    this.videoId = videoId;
    this.root.setAttribute('aria-label', '가사');
    const header = el('header', 'uw-header');
    this.thumb.alt = '';
    this.thumb.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    const meta = el('div', 'uw-meta');
    meta.append(this.titleEl, this.subEl);
    const searchBtn = el('button', 'uw-btn uw-search-btn', '⌕');
    searchBtn.type = 'button';
    searchBtn.setAttribute('aria-label', '가사 검색');
    searchBtn.addEventListener('click', () => this.showSearch());
    const collapseBtn = el('button', 'uw-btn uw-collapse-btn', '⌃');
    collapseBtn.type = 'button';
    collapseBtn.setAttribute('aria-label', '가사 패널 접기');
    collapseBtn.setAttribute('aria-expanded', 'true');
    collapseBtn.addEventListener('click', () => {
      const c = this.root.classList.toggle('uw-collapsed');
      collapseBtn.setAttribute('aria-expanded', String(!c));
      collapseBtn.setAttribute('aria-label', c ? '가사 패널 펼치기' : '가사 패널 접기');
    });
    header.append(this.thumb, meta, searchBtn, collapseBtn);
    const footer = el('footer', 'uw-footer', '가사 제공 LRCLIB · 줄을 누르면 그 시점으로 이동해요');
    this.body.append(this.lyricsEl);
    this.root.append(header, this.body, footer);
    this.lyricsEl.addEventListener('click', (e) => {
      const line = (e.target as HTMLElement).closest<HTMLElement>('.uw-line');
      const t = line?.dataset.time;
      if (t != null && this.video && Number(t) >= 0) this.video.currentTime = Number(t) + this.chapterStart;
    });
  }

  mount(): boolean {
    const host = document.querySelector('#secondary-inner') ?? document.querySelector('#secondary');
    if (!host) return false;
    host.prepend(this.root);
    this.attachVideo();
    this.resolveSong();
    return true;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    this.root.remove();
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
    const loop = () => { this.tick(); this.raf = requestAnimationFrame(loop); };
    const onPlay = () => { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(loop); };
    const onPause = () => { cancelAnimationFrame(this.raf); this.tick(); };
    const onTime = () => { if (v.paused) this.tick(); };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onTime);
    this.disposers.push(() => {
      v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause); v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onTime);
    });
    if (!v.paused) onPlay();
  }

  tick() {
    const v = this.video;
    if (!v) return;
    const t = v.currentTime;
    if (this.chaptersParsed && this.chapters.length) {
      const hit = chapterAt(this.chapters, t);
      const idx = hit?.index ?? -1;
      if (idx !== this.chapterIndex) { this.resolveSong(); return; }
    }
    if (this.state.status !== 'synced' || !this.state.result) return;
    this.setCurrent(lineIndexAt(this.state.result.lines, t - this.chapterStart));
  }

  setCurrent(i: number) {
    if (i === this.current) return;
    const prev = this.lineEls[this.current];
    prev?.classList.remove('uw-current');
    this.current = i;
    this.lineEls.forEach((e, k) => {
      e.classList.toggle('uw-past', k < i);
      e.classList.toggle('uw-future', k > i);
    });
    const cur = this.lineEls[i];
    if (!cur) return;
    cur.classList.add('uw-current');
    this.scrollTo(cur);
    if (prev || i === 0) this.burst(cur);
  }

  scrollTo(line: HTMLElement) {
    const b = this.body;
    const top = line.offsetTop - b.clientHeight / 2 + line.clientHeight / 2;
    b.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  burst(line: HTMLElement) {
    if (reducedMotion()) return;
    const box = el('div', 'uw-burst');
    box.style.top = `${line.offsetTop + line.offsetHeight / 2}px`;
    for (const { dx, dy } of burstVectors(PARTICLES)) {
      const p = el('span', 'uw-particle');
      p.style.setProperty('--dx', `${dx}px`);
      p.style.setProperty('--dy', `${dy}px`);
      p.style.left = `${20 + Math.random() * 60}%`;
      box.append(p);
    }
    this.lyricsEl.append(box);
    setTimeout(() => box.remove(), BURST_MS);
  }

  // ----- song resolution -----
  resolveSong() {
    const { title, channel } = readMeta();
    if (!title) { setTimeout(() => this.root.isConnected && this.resolveSong(), 500); return; }
    if (!this.chaptersParsed) { this.chapters = parseChapters(readDescription(this.videoId)); this.chaptersParsed = true; }
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
      query = { ...parseVideoTitle(hit.chapter.title, channel), duration: end != null ? Math.round(end - hit.chapter.start) : undefined };
      this.subEl.textContent = `${query.artist} · ${hit.index + 1} / ${this.chapters.length}곡`;
    } else {
      this.chapterIndex = -1;
      this.chapterStart = 0;
      query = { ...parseVideoTitle(title, channel), duration: dur ? Math.round(dur) : undefined };
      this.subEl.textContent = `${query.artist} · 1 / 1곡`;
    }
    this.titleEl.textContent = query.title;
    this.applyPalette(hueIndex);
    if (sameQuery(query, this.state.query) && this.state.status !== 'error') return;
    this.load(query);
  }

  async load(query: SongQuery) {
    const seq = ++this.reqSeq;
    this.dispatch({ type: 'load', query });
    try {
      const res = await send({ type: 'lyrics:get', query });
      if (seq !== this.reqSeq) return;
      if (res.ok) this.dispatch({ type: 'loaded', result: res.result });
      else this.dispatch({ type: 'failed', error: res.error });
    } catch (e) {
      if (seq === this.reqSeq) this.dispatch({ type: 'failed', error: String(e) });
    }
  }

  async applyPalette(index: number) {
    if (!this.basePalette) {
      try {
        const res = await send({ type: 'palette:get', videoId: this.videoId });
        if (!res.ok) return;
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
      if (res.ok) this.dispatch({ type: 'searchDone', results: res.results });
      else this.dispatch({ type: 'searchFailed', error: res.error });
    } catch (e) {
      this.dispatch({ type: 'searchFailed', error: String(e) });
    }
  }

  showSearch() {
    this.root.classList.remove('uw-collapsed');
    this.dispatch({ type: 'loaded', result: null });
  }

  // ----- render -----
  render() {
    const s = this.state;
    this.lyricsEl.replaceChildren();
    this.lineEls = [];
    this.current = -1;
    this.root.dataset.status = s.status;
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
      this.tick();
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
  panel?.destroy();
  panel = null;
  if (!id) return;
  const p = new Panel(id);
  panel = p;
  let tries = 0;
  const tryMount = () => {
    if (panel !== p) return;
    if (!p.mount() && ++tries < 40) setTimeout(tryMount, 250);
  };
  tryMount();
}

document.addEventListener('yt-navigate-finish', sync);
sync();
