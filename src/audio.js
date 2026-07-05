// All SFX are synthesized with the Web Audio API — no assets, fully offline.
// The background theme is a loaded mp3 (music by ilyas-ananas on itch.io);
// Vite inlines it as a data URL so the single-file build still works offline.
import bgmUrl from '../assets/bgm.mp3';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._lastClink = 0;
    this._noiseBuf = null;
  }

  get ready() { return !!this.ctx; }

  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this._makeNoise();
    this._ambience();
    this._bgmStart();
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(m ? 0 : 1, this.ctx.currentTime + 0.06);
    }
  }

  suspend() {
    if (this.ctx) this.ctx.suspend();
    if (this._bgmEl) this._bgmEl.pause();
  }
  resume() {
    if (this.ctx && !this.muted) this.ctx.resume();
    if (this._bgmEl && !this.muted) this._bgmEl.play().catch(() => {});
  }

  _makeNoise() {
    const len = this.ctx.sampleRate;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _out(pan = 0) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(this.master);
    return p;
  }

  // Quiet room tone: filtered brown noise + a faint mains hum, the sound of an
  // empty arcade at 2am.
  _ambience() {
    const ctx = this.ctx;
    const len = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300;
    const g = ctx.createGain(); g.gain.value = 0.028;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();

    const hum = ctx.createOscillator();
    hum.type = 'sine'; hum.frequency.value = 55;
    const hg = ctx.createGain(); hg.gain.value = 0.008;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.003;
    lfo.connect(lg); lg.connect(hg.gain);
    hum.connect(hg); hg.connect(this.master);
    hum.start(); lfo.start();
  }

  // Background theme (bgm.mp3): looped through a MediaElementSource so it
  // rides the same master gain as everything else — mute silences it too.
  _bgmStart() {
    const ctx = this.ctx;
    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = 0.55;
    this.bgmGain.connect(this.master);
    const el = new Audio();
    el.src = bgmUrl;
    el.loop = true;
    el.crossOrigin = 'anonymous';
    this._bgmEl = el;
    try {
      this._bgmSrc = ctx.createMediaElementSource(el);
      this._bgmSrc.connect(this.bgmGain);
    } catch { /* Safari sometimes needs the element to have played first */ }
    // Fade in so it doesn't slam on when the player unlocks audio.
    this.bgmGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.bgmGain.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 1.6);
    el.play().catch(() => { /* the next user gesture will retry */ });
  }

  _burst(t, dur, freq, q, vol, out) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(t, dur, freq, vol, out, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Metal-on-metal impact. Intensity 0..1 scales volume; pitch is randomized so
  // a pile of coins never sounds like a sample loop.
  clink(intensity = 0.5, pan = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    if (t - this._lastClink < 0.028) return;
    this._lastClink = t;
    const out = this._out(pan);
    const f = 1600 + Math.random() * 2800;
    const dur = 0.05 + Math.random() * 0.09;
    const vol = (0.03 + 0.2 * intensity) * (0.7 + Math.random() * 0.6);
    this._tone(t, dur, f, vol, out);
    this._tone(t, dur * 0.7, f * 2.756 * (0.98 + Math.random() * 0.04), vol * 0.45, out);
    this._burst(t, 0.02, 5000 + Math.random() * 2000, 1.2, vol * 0.5, out);
  }

  insert() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(0);
    this._burst(t, 0.03, 3600, 2, 0.1, out);
    this._tone(t + 0.02, 0.05, 240, 0.08, out, 'square');
  }

  collect(pan = 0, burstIndex = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan);
    const semi = Math.min(burstIndex, 12);
    const base = 1318.5 * Math.pow(2, semi / 12);
    this._tone(t, 0.16, base, 0.1, out);
    this._tone(t + 0.05, 0.22, base * 1.5, 0.08, out);
    this.clink(0.7, pan);
  }

  special() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(0);
    [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => {
      this._tone(t + i * 0.085, 0.28, f, 0.09, out, 'triangle');
    });
  }

  jackpot() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(0);
    this._tone(t, 0.6, 65, 0.22, out);
    [523.3, 659.3, 784, 1046.5, 1318.5, 1568].forEach((f, i) => {
      this._tone(t + i * 0.09, 0.4, f, 0.1, out, 'triangle');
      this._tone(t + i * 0.09, 0.4, f * 2.01, 0.03, out);
    });
    this._burst(t + 0.5, 0.9, 7000, 0.8, 0.05, out);
  }

  thread() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(0);
    [1318.5, 1661.2, 1975.5, 2637].forEach((f, i) => {
      this._tone(t + i * 0.05, 0.2, f, 0.08, out, 'triangle');
    });
    this._burst(t + 0.05, 0.35, 6800, 0.9, 0.035, out);
  }

  gilded(pan = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan);
    this._tone(t, 0.18, 1975.5, 0.1, out);
    this._tone(t + 0.06, 0.26, 2637, 0.09, out);
    this._tone(t + 0.12, 0.3, 3136, 0.07, out);
    this.clink(0.8, pan);
  }

  thunk(pan = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan);
    this._burst(t, 0.12, 190, 1.5, 0.09, out);
    this._tone(t, 0.1, 95, 0.06, out);
  }

  denied() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(0);
    this._tone(t, 0.16, 110, 0.07, out, 'sawtooth');
  }

  pour() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 10; i++) {
      const dt = i * 0.05 + Math.random() * 0.04;
      const out = this._out((Math.random() - 0.5) * 0.6);
      const f = 1800 + Math.random() * 2600;
      this._tone(t + dt, 0.07, f, 0.08, out);
      this._tone(t + dt, 0.05, f * 2.7, 0.04, out);
    }
  }

  pusherClunk() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(0);
    this._burst(t, 0.06, 320, 2, 0.022, out);
  }
}
