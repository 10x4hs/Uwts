import type { Onset } from './align';

/**
 * Vocal-band activity + onset tracker for the page's <video>.
 *
 * createMediaElementSource() permanently reroutes the element's audio through our graph, so:
 *  - it is only created while the AudioContext is actually running (else audio would go silent);
 *  - it is created at most once per element (YouTube reuses the <video> across SPA navigations).
 */
interface Graph { ctx: AudioContext; analyser: AnalyserNode }
const graphs = new WeakMap<HTMLMediaElement, Graph>();
let sharedCtx: AudioContext | null = null;

const SAMPLE_MS = 20; // ~50 Hz
const HIST = 500; // 10 s of samples
const REFRACTORY = 0.12;
const MAX_ONSETS = 4000;

async function graphFor(video: HTMLMediaElement): Promise<Graph | null> {
  const cached = graphs.get(video);
  if (cached) return cached;
  try {
    sharedCtx ??= new AudioContext();
    if (sharedCtx.state !== 'running') await sharedCtx.resume().catch(() => {});
    if (sharedCtx.state !== 'running') return null;
    if (graphs.has(video)) return graphs.get(video)!; // raced with another caller
    const ctx = sharedCtx;
    const source = ctx.createMediaElementSource(video);
    source.connect(ctx.destination); // playback unchanged
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 0.7;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    source.connect(filter).connect(analyser);
    const g = { ctx, analyser };
    graphs.set(video, g);
    return g;
  } catch {
    return null;
  }
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

export class VocalTracker {
  /** Smoothed vocal activity 0..1 (0 when unavailable). */
  activity = 0;
  ready = false;
  /** Onsets stamped with video.currentTime. */
  onsets: Onset[] = [];
  private g: Graph | null = null;
  private raf = 0;
  private last = 0;
  private dead = false;
  private time: Uint8Array<ArrayBuffer> | null = null;
  private freq: Float32Array<ArrayBuffer> | null = null;
  private prevMag: Float32Array | null = null;
  private rmsHist: number[] = [];
  private fluxHist: number[] = [];
  private rmsLo = 0; private rmsHi = 1e-3; private fluxNorm = 1e-6;
  private lastOnset = -Infinity;
  private prevFlux = 0;
  private sampleN = 0;
  /** Window whose frames drive sampling: the lyrics' PiP window keeps running when the tab is hidden. */
  private frameWin: Window = window;
  private loop: ((now: number) => void) | null = null;
  private gesture = () => { this.detachGesture(); void this.init(); };

  constructor(private video: HTMLVideoElement) {
    void this.init();
  }

  private detachGesture() {
    document.removeEventListener('pointerdown', this.gesture, true);
    document.removeEventListener('keydown', this.gesture, true);
  }

  private async init() {
    if (this.dead || this.ready) return;
    const g = await graphFor(this.video);
    if (this.dead) return;
    if (!g) {
      // autoplay policy: wait for the next user gesture, then retry once per gesture
      document.addEventListener('pointerdown', this.gesture, { capture: true, once: true });
      document.addEventListener('keydown', this.gesture, { capture: true, once: true });
      return;
    }
    this.g = g;
    this.time = new Uint8Array(g.analyser.fftSize);
    this.freq = new Float32Array(g.analyser.frequencyBinCount);
    this.ready = true;
    const loop = (now: number) => {
      if (this.dead) return;
      this.raf = this.frameWin.requestAnimationFrame(loop);
      if (now - this.last < SAMPLE_MS || this.video.paused) return;
      this.last = now;
      this.sample();
    };
    this.loop = loop;
    this.raf = this.frameWin.requestAnimationFrame(loop);
  }

  /** Move sampling to another window's frames (PiP opened or closed). */
  setFrameWindow(w: Window) {
    if (w === this.frameWin) return;
    try { this.frameWin.cancelAnimationFrame(this.raf); } catch { /* window gone */ }
    this.frameWin = w;
    if (this.loop && !this.dead) this.raf = w.requestAnimationFrame(this.loop);
  }

  /** Total seconds of video time covered by onset data. */
  coverage(): number {
    if (this.onsets.length < 2) return 0;
    let lo = Infinity, hi = -Infinity;
    for (const o of this.onsets) { lo = Math.min(lo, o.t); hi = Math.max(hi, o.t); }
    return hi - lo;
  }

  private sample() {
    const { g, time, freq } = this;
    if (!g || !time || !freq) return;
    const t = this.video.currentTime;
    g.analyser.getByteTimeDomainData(time);
    let sq = 0;
    for (let i = 0; i < time.length; i++) { const x = (time[i] - 128) / 128; sq += x * x; }
    const rms = Math.sqrt(sq / time.length);

    // spectral flux over the vocal band (≈300–3400 Hz)
    g.analyser.getFloatFrequencyData(freq);
    const binHz = g.ctx.sampleRate / g.analyser.fftSize;
    const b0 = Math.floor(300 / binHz), b1 = Math.min(freq.length - 1, Math.ceil(3400 / binHz));
    const prev = this.prevMag ?? new Float32Array(freq.length);
    let flux = 0;
    for (let i = b0; i <= b1; i++) {
      const m = isFinite(freq[i]) ? Math.pow(10, freq[i] / 20) : 0;
      const d = m - prev[i];
      if (d > 0) flux += d;
      prev[i] = m;
    }
    this.prevMag = prev;

    this.rmsHist.push(rms); this.fluxHist.push(flux);
    if (this.rmsHist.length > HIST) { this.rmsHist.shift(); this.fluxHist.shift(); }
    if (++this.sampleN % 25 === 1) {
      const r = [...this.rmsHist].sort((a, b) => a - b);
      this.rmsLo = percentile(r, 0.2);
      this.rmsHi = Math.max(this.rmsLo + 1e-4, percentile(r, 0.95));
      this.fluxNorm = Math.max(1e-6, percentile([...this.fluxHist].sort((a, b) => a - b), 0.95));
    }
    const a = Math.min(1, Math.max(0, (rms - this.rmsLo) / (this.rmsHi - this.rmsLo)));
    this.activity = this.activity * 0.6 + a * 0.4;

    const s = flux / this.fluxNorm;
    // onset = rising past an adaptive threshold, with refractory period
    if (s > 0.5 && s > this.prevFlux * 1.2 && t - this.lastOnset >= REFRACTORY) {
      this.onsets.push({ t, s: Math.min(1.5, s) });
      this.lastOnset = t;
      if (this.onsets.length > MAX_ONSETS) this.onsets.splice(0, this.onsets.length - MAX_ONSETS);
    }
    if (t < this.lastOnset) this.lastOnset = -Infinity; // seeked backwards
    this.prevFlux = s;
  }

  /** Stop sampling. The media-element source stays (it can't be undone) and is reused next time. */
  destroy() {
    this.dead = true;
    this.ready = false;
    try { this.frameWin.cancelAnimationFrame(this.raf); } catch { /* window gone */ }
    this.detachGesture();
  }
}
