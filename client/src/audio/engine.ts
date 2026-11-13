// The audio engine: one AudioContext (started on the first click or key press, as
// browsers require), a master bus with effects and ambience buses under it, volume
// settings remembered in this browser, and playback of the synthesized sounds.

import { EFFECTS, LOOPS, type Effect, type Loop } from './synth.ts';

export interface AudioSettings {
  master: number;
  effects: number;
  ambience: number;
  muted: boolean;
}

const KEY = 'hearthwood.audio';
const DEFAULTS: AudioSettings = { master: 0.8, effects: 0.9, ambience: 0.7, muted: false };

let settings: AudioSettings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AudioSettings>) };
} catch { /* private mode etc. */ }

let ctx: AudioContext | null = null;
let master: GainNode, fxBus: GainNode, ambBus: GainNode;
const effectBufs = new Map<Effect, AudioBuffer[]>();
const loopBufs = new Map<Loop, AudioBuffer>();

export function audioSettings(): AudioSettings {
  return { ...settings };
}

/** Change (and remember) volumes; applies immediately. */
export function setAudioSettings(s: Partial<AudioSettings>) {
  settings = { ...settings, ...s };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
  applyVolumes();
}

function applyVolumes() {
  if (!ctx) return;
  const now = ctx.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, now, 0.05);
  fxBus.gain.setTargetAtTime(settings.effects, now, 0.05);
  ambBus.gain.setTargetAtTime(settings.ambience, now, 0.05);
}

/** Start audio on the first user gesture (browsers keep it silent until then). */
export function initAudio() {
  const start = () => {
    try {
      if (!ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        // A gentle limiter so a chop over a storm over a waterfall never clips.
        const limit = ctx.createDynamicsCompressor();
        limit.threshold.value = -8;
        limit.knee.value = 6;
        limit.ratio.value = 10;
        limit.attack.value = 0.003;
        limit.release.value = 0.25;
        master.connect(limit).connect(ctx.destination);
        fxBus = ctx.createGain();
        ambBus = ctx.createGain();
        fxBus.connect(master);
        ambBus.connect(master);
        applyVolumes();
        prewarm();
      }
      if (ctx.state === 'suspended') void ctx.resume();
    } catch (e) {
      console.warn('[audio] could not start', e);
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, start, { capture: true, passive: true });
}

export function audioContext(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null;
}

export function ambienceBus(): GainNode | null {
  return ctx ? ambBus : null;
}

function toBuffer(data: Float32Array): AudioBuffer {
  const b = ctx!.createBuffer(1, data.length, ctx!.sampleRate);
  b.getChannelData(0).set(data);
  return b;
}

function effect(name: Effect): AudioBuffer[] {
  let list = effectBufs.get(name);
  if (!list) {
    const [render, n] = EFFECTS[name];
    list = [];
    for (let v = 0; v < n; v++) list.push(toBuffer(render(ctx!.sampleRate, v + 1)));
    effectBufs.set(name, list);
  }
  return list;
}

/** A seamless ambience loop (rendered on first use). */
export function loopBuffer(name: Loop): AudioBuffer | null {
  if (!ctx) return null;
  let b = loopBufs.get(name);
  if (!b) {
    b = toBuffer(LOOPS[name](ctx.sampleRate, 7));
    loopBufs.set(name, b);
  }
  return b;
}

/** Render the common effects a little at a time after start-up, so the first chop doesn't stutter. */
function prewarm() {
  const queue = Object.keys(EFFECTS) as Effect[];
  const step = () => {
    const n = queue.shift();
    if (!n || !ctx) return;
    effect(n);
    setTimeout(step, 30);
  };
  setTimeout(step, 200);
}

export interface PlayOpts {
  /** Volume (0..1+). */
  gain?: number;
  /** Random pitch spread (±, as a fraction). */
  vary?: number;
  /** Fixed pitch factor. */
  rate?: number;
  /** Stereo position -1..1. */
  pan?: number;
  /** Delay in seconds. */
  delay?: number;
  /** Low-pass (muffled, e.g. indoors), Hz. */
  lowpass?: number;
  /** Which volume it follows (default: effects). */
  bus?: 'effects' | 'ambience';
}

/** Play a one-shot effect. */
export function play(name: Effect, o: PlayOpts = {}) {
  const c = audioContext();
  if (!c || settings.muted) return;
  const list = effect(name);
  const src = c.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.vary ?? 0.05));
  let node: AudioNode = src;
  if (o.lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lowpass;
    node.connect(f);
    node = f;
  }
  const g = c.createGain();
  g.gain.value = o.gain ?? 1;
  node.connect(g);
  node = g;
  if (o.pan) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    node.connect(p);
    node = p;
  }
  node.connect(o.bus === 'ambience' ? ambBus : fxBus);
  src.start(c.currentTime + (o.delay ?? 0));
}
