import * as THREE from 'three';
import { CELL_H, CELL_W } from '../config';

/**
 * Sound effects, all synthesised with WebAudio (no samples): stone, wood, bells and air built
 * from oscillators and filtered noise, through a generated stone-hall reverb and a soft limiter.
 * Everything is tuned to one major pentatonic scale so overlapping chimes never clash.
 *
 * The context starts on the first user gesture (browsers require it) and sleeps while the tab is
 * hidden or the sound is off.
 */

type Bus = 'ui' | 'build' | 'gen' | 'flight';

/** major pentatonic, in semitones */
const SCALE = [0, 2, 4, 7, 9];
/** G3 */
const ROOT = 196;
const noteHz = (step: number, root = ROOT) => {
  const i = ((step % 5) + 5) % 5;
  return root * 2 ** ((SCALE[i] + 12 * Math.floor(step / 5)) / 12);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;

/** how loud each bus sits in the mix, and how much of it goes to the reverb */
const BUS_LEVEL: Record<Bus, [gain: number, send: number]> = {
  ui: [0.55, 0.08],
  build: [0.9, 0.16],
  gen: [0.75, 0.2],
  flight: [0.6, 0.18],
};
/** a cell pop grid: at most this many pops per slot, the rest feed the shimmer bed */
const GRAIN_SLOT = 0.03;
/** the cast riser's lowest band (it climbs about 3.6 octaves) */
const RISER_LOW = 180;
/** the riser always takes at least this long to climb (a fast solve still sweeps low to high) */
const RISE_MIN = 0.7;
const GRAINS_PER_SLOT = 2;
const MAX_VOICES = 64;
const STORE_KEY = 'wawa-sound';

export interface CellSound {
  x: number;
  y: number;
  z: number;
  /** module category (ground, garden, wall, tower, …) */
  cat: string;
  /** seconds from now until the piece pops in */
  delay: number;
}

export interface FlightState {
  speed: number;
  /** 0 … 1 eased boost */
  boost: number;
  /** Shift / boost button held while flying forward */
  boosting: boolean;
  /** bank angle (radians, + = left) */
  bank: number;
}

interface Layer {
  out: GainNode;
  nodes: AudioScheduledSourceNode[];
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private voices = 0;
  private camera: THREE.Camera | null = null;
  private enabledFlag = true;
  /** fired when the sound is switched on or off */
  onToggle: (on: boolean) => void = () => {};

  // rate limits
  private lastUi = 0;
  private lastHover = 0;
  private slots = new Map<number, number>();
  // generation
  /** the cast's riser: air and a sub tone sweeping low to high as the castle goes up */
  private riser: (Layer & { bp: BiquadFilterNode; sub: OscillatorNode; start: number }) | null = null;
  private wind: (Layer & {
    low: GainNode; lowF: BiquadFilterNode;
    high: GainNode; highF: BiquadFilterNode; highPan: StereoPannerNode;
    whistle: GainNode; whistleF: BiquadFilterNode;
  }) | null = null;
  private lastCellAt = 0;
  /** a cast is under way (its ending plays once, however often it's reported) */
  private spellOpen = false;
  // flight
  private wasBoosting = false;

  constructor() {
    try {
      this.enabledFlag = localStorage.getItem(STORE_KEY) !== 'off';
    } catch {
      /* private mode: default on */
    }
  }

  get enabled() {
    return this.enabledFlag;
  }

  /** Start listening for the first gesture (the context can only start then). */
  attach() {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (this.enabledFlag) this.ctx.resume();
    });
  }

  /** Cells are panned by where they sit on screen. */
  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  setEnabled(on: boolean) {
    this.enabledFlag = on;
    try {
      localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
    } catch {
      /* not persisted */
    }
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(on ? 1 : 0, t, 0.05);
      if (on) this.ctx.resume();
      else setTimeout(() => !this.enabledFlag && this.ctx?.suspend(), 250);
    }
    this.onToggle(on);
    if (on) this.unlock();
  }

  private unlock() {
    if (!this.enabledFlag) return;
    if (!this.ctx) this.build();
    if (this.ctx!.state !== 'running' && !document.hidden) this.ctx!.resume();
  }

  // --- graph ---------------------------------------------------------------------------------

  private build() {
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    // limiter-ish compressor keeps stacked chimes and wind from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    // shave the very top: synthesised noise gets fizzy
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 13000;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabledFlag ? 1 : 0;
    comp.connect(tone).connect(this.master).connect(ctx.destination);

    const mix = ctx.createGain();
    mix.gain.value = 0.8;
    mix.connect(comp);
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(1.6);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.9;
    verb.connect(verbOut).connect(comp);

    for (const bus of Object.keys(BUS_LEVEL) as Bus[]) {
      const [level, send] = BUS_LEVEL[bus];
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(mix);
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(verb);
      this.buses[bus] = g;
    }
    this.white = this.noiseBuffer(2, false);
    this.pink = this.noiseBuffer(4, true);
  }

  /** Stereo noise (white, or pink via Paul Kellet's filter). */
  private noiseBuffer(seconds: number, pink: boolean) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (!pink) {
          d[i] = w;
          continue;
        }
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  /** A stone hall: decaying stereo noise that darkens as it fades, with a few early reflections. */
  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        const k = 0.55 + 0.4 * (t / seconds); // one-pole lowpass closing over the tail
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] = lp * Math.exp(-t * 4) * 2.4;
      }
      for (const [dt, a] of [[0.011, 0.5], [0.019, 0.35], [0.031, 0.28], [0.047, 0.2]]) {
        const j = Math.floor((dt + ch * 0.003) * ctx.sampleRate);
        if (j < n) d[j] += a;
      }
    }
    return buf;
  }

  // --- voice helpers -------------------------------------------------------------------------

  private get ready() {
    return !!this.ctx && this.enabledFlag && this.ctx.state === 'running';
  }

  private now() {
    return this.ctx!.currentTime;
  }

  /** A one-shot output: gain → pan → bus, torn down when its last source ends. */
  private voice(bus: Bus, pan = 0, gain = 1) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p).connect(this.buses[bus]);
    } else g.connect(this.buses[bus]);
    this.voices++;
    let live = 0;
    const own = (src: AudioScheduledSourceNode) => {
      live++;
      src.onended = () => {
        if (--live === 0) {
          g.disconnect();
          this.voices--;
        }
      };
    };
    return { out: g, own };
  }

  /** Attack to `peak`, then an exponential fall over `decay`. */
  private env(p: AudioParam, t: number, peak: number, attack: number, decay: number) {
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(
    v: ReturnType<Sfx['voice']>,
    t: number,
    o: { type?: OscillatorType; f: number; to?: number; glide?: number; peak: number; attack?: number; decay: number; detune?: number },
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? o.decay));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    this.env(g.gain, t, o.peak, a, o.decay);
    osc.connect(g).connect(v.out);
    v.own(osc);
    osc.start(t);
    osc.stop(t + a + o.decay + 0.05);
  }

  private noise(
    v: ReturnType<Sfx['voice']>,
    t: number,
    o: { filter: BiquadFilterType; f: number; to?: number; q?: number; peak: number; attack?: number; decay: number; pink?: boolean; sweep?: number },
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = o.pink ? this.pink : this.white;
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.f, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.sweep ?? (o.attack ?? 0.003) + o.decay));
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    this.env(g.gain, t, o.peak, a, o.decay);
    src.connect(f).connect(g).connect(v.out);
    v.own(src);
    const dur = a + o.decay + 0.05;
    src.start(t, Math.max(0, Math.random() * (src.buffer!.duration - dur - 0.01)));
    src.stop(t + dur);
  }

  /** Struck bell: a few inharmonic partials, the high ones dying first, plus the strike. */
  private bell(v: ReturnType<Sfx['voice']>, t: number, f: number, peak: number, decay: number, bright = 1) {
    const parts: [number, number, number][] = [[1, 1, 1], [2.0, 0.42, 0.6], [2.76, 0.26, 0.42], [5.4, 0.1 * bright, 0.22]];
    for (const [r, a, d] of parts) if (f * r < 15000) this.tone(v, t, { f: f * r, peak: peak * a, attack: 0.002, decay: decay * d, detune: rand(-4, 4) });
    this.noise(v, t, { filter: 'bandpass', f: Math.min(f * 4, 9000), q: 2, peak: peak * 0.35, decay: 0.012 });
  }

  /** Screen pan and a distance fade for a cell. */
  private place3d(x: number, y: number, z: number) {
    if (!this.camera) return { pan: 0, gain: 1 };
    const p = new THREE.Vector3(x * CELL_W, y * CELL_H + CELL_H * 0.4, z * CELL_W);
    const dist = p.distanceTo(this.camera.position);
    p.project(this.camera);
    const off = Math.abs(p.x) > 1.15 || p.z > 1;
    return { pan: clamp(p.x, -1, 1) * 0.7, gain: clamp(45 / dist, 0.35, 1) * (off ? 0.55 : 1) };
  }

  // --- interface -----------------------------------------------------------------------------

  /** A soft wooden tick for buttons and tabs. */
  ui(kind: 'tab' | 'button' | 'toggle' = 'button') {
    if (!this.ready) return;
    const t = this.now();
    if (t - this.lastUi < 0.03) return;
    this.lastUi = t;
    const v = this.voice('ui');
    const f = kind === 'tab' ? 900 : kind === 'toggle' ? 1300 : 1100;
    this.noise(v, t, { filter: 'bandpass', f: f * 2.8, q: 2.2, peak: 0.12, decay: 0.022 });
    this.tone(v, t, { f, to: f * 0.72, peak: 0.08, decay: 0.045 });
  }

  /** Day, dusk or night: a short rising or falling phrase. */
  timeOfDay(time: 'day' | 'dusk' | 'night') {
    if (!this.ready) return;
    const t = this.now();
    const v = this.voice('ui', 0, 0.9);
    const steps = time === 'day' ? [5, 7, 9, 12] : time === 'dusk' ? [7, 6, 4, 5] : [9, 7, 4, 2];
    steps.forEach((s, i) => this.bell(v, t + i * 0.085, noteHz(s, time === 'night' ? ROOT : ROOT * 2), 0.06, time === 'night' ? 2.2 : 1.4, time === 'day' ? 1.2 : 0.6));
    this.noise(v, t, { filter: 'bandpass', f: time === 'night' ? 1800 : 600, to: time === 'night' ? 500 : 3200, q: 1, peak: 0.05, attack: 0.15, decay: 0.45, pink: true });
  }

  // --- build ---------------------------------------------------------------------------------

  /** Hover moved to another cell (very quiet; `ok` = something fits there). */
  hover(_y: number, ok: boolean) {
    if (!this.ready) return;
    const t = this.now();
    if (t - this.lastHover < 0.06) return;
    this.lastHover = t;
    // an unpitched tick (no melody while sweeping the pointer around)
    const v = this.voice('build', 0, 0.8);
    this.noise(v, t, { filter: 'bandpass', f: ok ? 3200 : 1300, q: 3, peak: ok ? 0.035 : 0.025, decay: 0.014 });
  }

  /** R: flip to the next fit. */
  cycle() {
    if (!this.ready) return;
    const t = this.now();
    const v = this.voice('build');
    this.tone(v, t, { type: 'triangle', f: 1400, peak: 0.05, decay: 0.04 });
    this.tone(v, t + 0.045, { type: 'triangle', f: 1870, peak: 0.05, decay: 0.05 });
    this.noise(v, t, { filter: 'bandpass', f: 1500, to: 4200, q: 1.2, peak: 0.045, attack: 0.03, decay: 0.12 });
  }

  /** Clicked where nothing fits: a soft, muffled bonk (no buzzer). */
  denied() {
    if (!this.ready) return;
    const t = this.now();
    const v = this.voice('build', 0, 0.6);
    this.tone(v, t, { f: 230, to: 150, peak: 0.16, decay: 0.16 });
    this.tone(v, t + 0.07, { f: 190, to: 130, peak: 0.1, decay: 0.16 });
    this.noise(v, t, { filter: 'lowpass', f: 500, peak: 0.06, decay: 0.05 });
  }

  /**
   * A piece set down: minimal on purpose (it happens constantly). A soft low wooden knock, a step
   * higher per floor, with only a hint of what it is made of.
   */
  place(cell: [number, number, number], cat: string, water = false) {
    if (!this.ready) return;
    const t = this.now();
    const { pan } = this.place3d(...cell);
    const v = this.voice('build', pan * 0.5);
    this.knock(v, t, noteHz(cell[1], ROOT / 2), 0.11);
    if (water) this.tone(v, t, { f: 320, to: 620, glide: 0.06, peak: 0.035, decay: 0.07 });
    else if (cat === 'garden' || cat === 'ground') this.noise(v, t, { filter: 'highpass', f: 3500, peak: 0.025, attack: 0.01, decay: 0.08 });
    else this.noise(v, t, { filter: 'bandpass', f: 1800, q: 1.5, peak: 0.03, decay: 0.02 });
  }

  /** A soft, low mallet on wood (marimba-like): short, round, barely a note. */
  private knock(v: ReturnType<Sfx['voice']>, t: number, f: number, peak: number) {
    this.tone(v, t, { f, peak, attack: 0.002, decay: 0.2 });
    this.tone(v, t, { f: f * 3.93, peak: peak * 0.16, attack: 0.001, decay: 0.045 });
    this.noise(v, t, { filter: 'bandpass', f: Math.min(f * 6, 3000), q: 2, peak: peak * 0.4, decay: 0.008 });
  }

  /** Pieces taken away: a short soft puff and a lower knock. */
  remove(cell: [number, number, number], count: number) {
    if (!this.ready) return;
    const t = this.now();
    const { pan } = this.place3d(...cell);
    const v = this.voice('build', pan * 0.5);
    this.noise(v, t, { filter: 'lowpass', f: 1800, to: 400, q: 0.7, peak: 0.06 + Math.min(count, 4) * 0.01, attack: 0.01, decay: 0.14 });
    this.knock(v, t + 0.015, noteHz(cell[1] - 2, ROOT / 2), 0.08);
  }

  // --- generation ----------------------------------------------------------------------------

  /** A collapse begins: a low breath in, then the riser climbs with the castle. */
  castStart() {
    this.spellOpen = true;
    if (!this.ready) return;
    const t = this.now();
    const v = this.voice('gen');
    this.noise(v, t, { filter: 'lowpass', f: 300, to: 700, q: 0.8, peak: 0.16, attack: 0.12, decay: 0.3, pink: true });
    this.tone(v, t, { f: 55, to: 70, peak: 0.18, attack: 0.08, decay: 0.35 });
    this.lastCellAt = t;
    this.startRiser();
  }

  /** Pieces popping in: soft unpitched taps, brighter on higher floors. */
  cells(list: CellSound[]) {
    if (!this.ready || !list.length) return;
    const t0 = this.now();
    for (const c of list) {
      const at = t0 + Math.max(0, c.delay) + 0.03; // the pop's ease peaks a moment after spawning
      this.lastCellAt = Math.max(this.lastCellAt, at);
      const slot = Math.round(at / GRAIN_SLOT);
      const n = this.slots.get(slot) ?? 0;
      if (n >= GRAINS_PER_SLOT || this.voices > MAX_VOICES) continue;
      this.slots.set(slot, n + 1);
      this.grain(at, c);
    }
    // forget slots in the past
    if (this.slots.size > 400) {
      const cut = Math.round(t0 / GRAIN_SLOT) - 2;
      for (const k of this.slots.keys()) if (k < cut) this.slots.delete(k);
    }
  }

  private grain(t: number, c: CellSound) {
    const { pan, gain } = this.place3d(c.x, c.y, c.z);
    const v = this.voice('gen', pan, gain);
    const low = c.cat === 'ground' || c.cat === 'garden';
    this.noise(v, t, { filter: 'bandpass', f: 700 + c.y * 450 + rand(0, 250), q: 2.2, peak: 0.07, decay: 0.025 });
    if (low) this.tone(v, t, { f: 140, to: 80, peak: 0.04, decay: 0.05 });
  }

  /** A contradiction: the spell fizzles and starts over. */
  fizzle() {
    if (!this.ready) return;
    const t = this.now();
    const v = this.voice('gen', 0, 0.8);
    this.noise(v, t, { filter: 'bandpass', f: 3200, to: 500, q: 1.4, peak: 0.13, attack: 0.01, decay: 0.42 });
    this.tone(v, t, { type: 'triangle', f: 620, to: 170, peak: 0.07, decay: 0.38, detune: 12 });
    this.tone(v, t, { type: 'triangle', f: 615, to: 160, peak: 0.05, decay: 0.38, detune: -14 });
  }

  /** The spell failed for good. */
  fail() {
    if (!this.spellOpen) return;
    this.spellOpen = false;
    if (!this.ready) return;
    this.endRiser();
    this.fizzle();
    const t = this.now() + 0.25;
    const v = this.voice('gen');
    this.knock(v, t, noteHz(2, ROOT / 2), 0.08);
    this.knock(v, t + 0.14, noteHz(0, ROOT / 2) * 0.94, 0.08);
  }

  /** The castle stands: the riser lands in a soft boom and a breath of air. */
  castDone() {
    if (!this.spellOpen) return;
    this.spellOpen = false;
    if (!this.ready) return;
    // land once the last piece is up and the riser has reached the top
    const t = Math.max(this.now(), this.lastCellAt + 0.05, (this.riser?.start ?? 0) + RISE_MIN);
    this.landRiser(t);
    const v = this.voice('gen');
    this.tone(v, t, { f: 72, to: 50, glide: 0.4, peak: 0.3, attack: 0.01, decay: 0.45 });
    this.noise(v, t, { filter: 'lowpass', f: 300, peak: 0.14, attack: 0.01, decay: 0.25, pink: true });
    this.noise(v, t, { filter: 'highpass', f: 3500, to: 7000, peak: 0.06, attack: 0.02, decay: 0.3 });
    this.bell(v, t + 0.02, 392, 0.035, 0.5, 0.5);
  }

  // --- broom ---------------------------------------------------------------------------------

  /** Take off (or land). */
  flight(on: boolean) {
    if (!this.ready) return;
    const t = this.now();
    const v = this.voice('flight');
    this.wasBoosting = false;
    if (on) {
      this.noise(v, t, { filter: 'bandpass', f: 280, to: 1900, q: 1, peak: 0.32, attack: 0.28, decay: 0.6, pink: true, sweep: 0.8 });
      this.startWind();
    } else {
      this.stopWind();
      this.noise(v, t, { filter: 'bandpass', f: 1600, to: 240, q: 1, peak: 0.26, attack: 0.08, decay: 0.6, pink: true });
      this.tone(v, t + 0.45, { f: 110, to: 52, peak: 0.22, decay: 0.25 });
      this.noise(v, t + 0.45, { filter: 'bandpass', f: 900, q: 1.3, peak: 0.08, decay: 0.06 });
    }
  }

  /** Shift pressed: a surge of air. */
  private boostOn() {
    const t = this.now();
    const v = this.voice('flight');
    this.noise(v, t, { filter: 'bandpass', f: 450, to: 3600, q: 0.9, peak: 0.6, attack: 0.03, decay: 0.45, sweep: 0.35 });
    this.noise(v, t, { filter: 'lowpass', f: 400, peak: 0.3, attack: 0.02, decay: 0.4, pink: true });
    this.tone(v, t, { f: 92, to: 46, peak: 0.3, decay: 0.35 });
  }

  private boostOff() {
    const t = this.now();
    const v = this.voice('flight');
    this.noise(v, t, { filter: 'bandpass', f: 2600, to: 600, q: 0.9, peak: 0.11, attack: 0.02, decay: 0.5 });
  }

  /** Brushed a wall (`strength` 0 … 1). */
  bump(strength: number) {
    if (!this.ready) return;
    const t = this.now();
    const s = clamp(strength, 0.15, 1);
    const v = this.voice('flight');
    this.tone(v, t, { f: 100, to: 44, peak: 0.5 * s, decay: 0.28 });
    this.noise(v, t, { filter: 'lowpass', f: 800, peak: 0.3 * s, decay: 0.12 });
    for (let i = 0; i < 3; i++) this.noise(v, t + 0.03 + Math.random() * 0.1, { filter: 'bandpass', f: rand(1800, 3800), q: 3, peak: 0.05 * s, decay: 0.02 });
  }

  /** Skimming past a tower (side −1 left, +1 right) or under an arch (0). */
  flyby(side: number, intensity: number) {
    if (!this.ready) return;
    const t = this.now();
    const k = clamp(intensity, 0.2, 1);
    const v = this.voice('flight', side * 0.85);
    const src = this.ctx!.createBufferSource();
    src.buffer = this.pink;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    // pitch rises as it nears and drops away past us (a hint of Doppler)
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2100, t + 0.16);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.6);
    const g = this.ctx!.createGain();
    this.env(g.gain, t, 0.42 * k, 0.15, 0.45);
    src.connect(f).connect(g).connect(v.out);
    v.own(src);
    src.start(t, Math.random() * 3);
    src.stop(t + 0.7);
  }

  private loop(buf: AudioBuffer) {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(this.now(), Math.random() * buf.duration);
    return src;
  }

  /** The air in flight: a low rumble, a rush that leans with the bank, a breathy whistle at speed. */
  private startWind() {
    if (this.wind) return;
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, this.now(), 0.25);
    out.connect(this.buses.flight);
    const lowSrc = this.loop(this.pink);
    const lowF = ctx.createBiquadFilter();
    lowF.type = 'lowpass';
    lowF.frequency.value = 200;
    const low = ctx.createGain();
    low.gain.value = 0;
    lowSrc.connect(lowF).connect(low).connect(out);
    const highSrc = this.loop(this.pink);
    const highF = ctx.createBiquadFilter();
    highF.type = 'bandpass';
    highF.Q.value = 1.4;
    highF.frequency.value = 900;
    const high = ctx.createGain();
    high.gain.value = 0;
    const highPan = ctx.createStereoPanner();
    highSrc.connect(highF).connect(high).connect(highPan).connect(out);
    // breathy rather than tonal (a wide band, so it never reads as a held note)
    const whSrc = this.loop(this.white);
    const whistleF = ctx.createBiquadFilter();
    whistleF.type = 'bandpass';
    whistleF.Q.value = 4;
    whistleF.frequency.value = 2400;
    const whistle = ctx.createGain();
    whistle.gain.value = 0;
    whSrc.connect(whistleF).connect(whistle).connect(out);
    this.wind = { out, nodes: [lowSrc, highSrc, whSrc], low, lowF, high, highF, highPan, whistle, whistleF };
  }

  private stopWind() {
    const w = this.wind;
    if (!w) return;
    this.wind = null;
    const t = this.now();
    w.out.gain.cancelScheduledValues(t);
    w.out.gain.setTargetAtTime(0, t, 0.2);
    for (const n of w.nodes) n.stop(t + 1.2);
    setTimeout(() => w.out.disconnect(), 1400);
  }

  private updateFlight(f: FlightState) {
    if (!this.wind) this.startWind();
    const w = this.wind!;
    const t = this.now();
    const s = clamp(Math.abs(f.speed) / 30, 0, 1.2);
    const tc = 0.12;
    w.low.gain.setTargetAtTime(0.09 + s ** 1.4 * 0.6, t, tc);
    w.lowF.frequency.setTargetAtTime(160 + s * 420 + f.boost * 300, t, tc);
    w.high.gain.setTargetAtTime(s ** 1.6 * 0.65 + f.boost * 0.6, t, tc);
    w.highF.frequency.setTargetAtTime(700 + s * 1500 + f.boost * 900, t, tc);
    w.highPan.pan.setTargetAtTime(clamp(-f.bank * 0.9, -0.8, 0.8), t, 0.2);
    w.whistle.gain.setTargetAtTime(Math.max(0, s - 0.4) * 0.12 + f.boost * 0.07, t, tc);
    w.whistleF.frequency.setTargetAtTime(2000 + s * 1600 + f.boost * 700, t, 0.3);
    if (f.boosting && !this.wasBoosting) this.boostOn();
    else if (!f.boosting && this.wasBoosting) this.boostOff();
    this.wasBoosting = f.boosting;
  }

  // --- per frame -----------------------------------------------------------------------------

  /** The cast's riser (following the collapse), and the wind in flight. */
  update(_dt: number, s: { generating: boolean; progress: number; flight: FlightState | null }) {
    if (!this.ready) return;
    this.updateRiser(s.generating, s.progress);
    if (s.flight) this.updateFlight(s.flight);
    else if (this.wind) this.stopWind();
  }

  /**
   * Air and a sub tone sweeping from low to high as the castle goes up: driven by the solver's
   * progress while it runs, then by the pop-in schedule (an instant solve still rises as the
   * pieces spring up). The landing in `castDone` cuts it.
   */
  private startRiser() {
    this.endRiser();
    const ctx = this.ctx!;
    const t = this.now();
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, t, 0.15);
    out.connect(this.buses.gen);
    const src = this.loop(this.pink);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.value = RISER_LOW;
    const air = ctx.createGain();
    air.gain.value = 0.32;
    src.connect(bp).connect(air).connect(out);
    const sub = ctx.createOscillator();
    sub.frequency.value = 55;
    const subG = ctx.createGain();
    subG.gain.value = 0.07;
    sub.connect(subG).connect(out);
    sub.start(t);
    this.riser = { out, nodes: [src, sub], bp, sub, start: t };
  }

  private updateRiser(running: boolean, progress: number) {
    const r = this.riser;
    if (!r) return;
    const t = this.now();
    const since = t - r.start;
    const paced = since / RISE_MIN;
    let k: number;
    if (running) k = Math.min(progress, paced);
    else if (t < this.lastCellAt) k = Math.min(since / Math.max(0.1, this.lastCellAt - r.start), paced);
    else if (!this.spellOpen) return this.endRiser();
    else k = paced;
    k = clamp(k, 0, 1);
    r.bp.frequency.setTargetAtTime(RISER_LOW * 2 ** (k * 3.6), t, 0.08);
    r.sub.frequency.setTargetAtTime(55 * 2 ** (k * 1.6), t, 0.08);
    r.out.gain.setTargetAtTime(0.7 + k * 0.5, t, 0.15);
  }

  /**
   * Finish the climb at `at` and cut it there, scheduled on the audio clock: the frame loop can
   * stall right after an instant solve (the castle rebuilding), and the sweep must not stall too.
   */
  private landRiser(at: number) {
    const r = this.riser;
    if (!r) return;
    this.riser = null;
    const now = this.now();
    const glide = (p: AudioParam, top: number) => {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.exponentialRampToValueAtTime(top, Math.max(at, now + 0.05));
    };
    glide(r.bp.frequency, RISER_LOW * 2 ** 3.6);
    glide(r.sub.frequency, 55 * 2 ** 1.6);
    glide(r.out.gain, 1.2);
    r.out.gain.setTargetAtTime(0, Math.max(at, now + 0.05), 0.05);
    for (const n of r.nodes) n.stop(at + 0.4);
    setTimeout(() => r.out.disconnect(), (at - now) * 1000 + 600);
  }

  private endRiser(at = this.ctx?.currentTime ?? 0) {
    const r = this.riser;
    if (!r) return;
    this.riser = null;
    r.out.gain.cancelScheduledValues(at);
    r.out.gain.setTargetAtTime(0, at, 0.05);
    for (const n of r.nodes) n.stop(at + 0.4);
    setTimeout(() => r.out.disconnect(), (at - this.now()) * 1000 + 600);
  }
}
