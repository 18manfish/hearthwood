// Ambience: looping layers mixed every frame from what's around the player – rain,
// wind gusts, cicadas on hot days and thunder after lightning; waves breaking on the
// shore nearby, babbling rivers and roaring waterfalls, panned towards where they
// are. Indoors the weather is muffled (rain on the roof) and the water falls silent.

import { SEA_LEVEL, Tile, type Grid, type Weather } from '@hearthwood/shared';
import type { World } from '../game/World.ts';
import { debug } from '../game/world/common.ts';
import { findWaterfalls, type Waterfall } from '../game/water.ts';
import { state } from '../state.ts';
import { ambienceBus, audioContext, loopBuffer, play } from './engine.ts';
import type { Loop } from './synth.ts';

/** One looping layer: loop → filter → level → stereo position → ambience bus. */
class Layer {
  readonly filter: BiquadFilterNode;
  readonly level: GainNode;
  readonly pan: StereoPannerNode;
  constructor(c: AudioContext, loop: Loop, type: BiquadFilterType, freq: number, q = 0.7) {
    const src = c.createBufferSource();
    src.buffer = loopBuffer(loop);
    src.loop = true;
    this.filter = c.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = freq;
    this.filter.Q.value = q;
    this.level = c.createGain();
    this.level.gain.value = 0;
    this.pan = c.createStereoPanner();
    src.connect(this.filter).connect(this.level).connect(this.pan).connect(ambienceBus()!);
    src.start(0, Math.random() * (src.buffer?.duration ?? 1));
  }
  private target = -1;
  set(v: number, tc = 0.6) {
    if (Math.abs(v - this.target) < 0.004) return;
    this.target = v;
    this.level.gain.setTargetAtTime(v, this.level.context.currentTime, tc);
  }
  freq(f: number, tc = 0.6) {
    this.filter.frequency.setTargetAtTime(f, this.filter.context.currentTime, tc);
  }
  panTo(p: number) {
    this.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, p)), this.pan.context.currentTime, 0.3);
  }
}

const layers: Partial<Record<string, Layer>> = {};
/** A layer, created the first time it needs to be heard. */
function layer(name: string, loop: Loop, type: BiquadFilterType, freq: number, q?: number): Layer | null {
  const c = audioContext();
  if (!c) return null;
  return (layers[name] ??= new Layer(c, loop, type, freq, q));
}
/** Set a layer's level (creating it only if it should be heard). */
function level(name: string, v: number, make: () => Layer | null) {
  const l = layers[name] ?? (v > 0.001 ? make() : null);
  l?.set(v);
  return l;
}

interface Source { gain: number; pan: number }
const silent: Source = { gain: 0, pan: 0 };

/** Waves, rivers and waterfalls near (px, pz): loudness 0..1 and left/right direction. */
function waterAround(g: Grid, falls: Waterfall[], px: number, pz: number) {
  const R = 12;
  const acc = { sea: [0, 0], river: [0, 0], fall: [0, 0] };
  const add = (k: keyof typeof acc, w: number, dx: number, d: number) => {
    acc[k][0] += w;
    acc[k][1] += (w * dx) / Math.max(1, d);
  };
  const cx = Math.floor(px), cz = Math.floor(pz);
  for (let z = cz - R; z <= cz + R; z++)
    for (let x = cx - R; x <= cx + R; x++) {
      const dx = x + 0.5 - px, dz = z + 0.5 - pz, d = Math.hypot(dx, dz);
      if (d > R) continue;
      const t = g.tile(x, z);
      if (t === Tile.Sea) {
        // Breakers: sea next to the beach or land.
        let shore = false;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = g.tile(x + ox, z + oz);
          if (n !== Tile.Sea && n !== Tile.Dock && n !== Tile.River) shore = true;
        }
        if (shore) add('sea', 1 / (1 + (d / 3) ** 2), dx, d);
      } else if (t === Tile.River) add('river', 1 / (1 + (d / 1.6) ** 2), dx, d);
    }
  for (const f of falls) {
    const dx = f.x + 0.5 - px, dz = f.z + 0.5 - pz, d = Math.hypot(dx, dz);
    if (d < 18) add('fall', (1 / (1 + (d / 2.5) ** 2)) * Math.min(2, 0.6 + (f.top - f.bottom)), dx, d);
  }
  const out = (k: keyof typeof acc, full: number): Source => {
    const [w, p] = acc[k];
    return w > 1e-4 ? { gain: Math.min(1, w / full), pan: p / w } : silent;
  };
  return { sea: out('sea', 5), river: out('river', 3), fall: out('fall', 1.2) };
}

const WIND: Record<Weather, number> = { clear: 0.07, cloudy: 0.15, rain: 0.22, storm: 0.75, snow: 0.3, fog: 0.08, sandstorm: 0.7, heatwave: 0.04 };

let lastScan = 0;
let water = { sea: silent, river: silent, fall: silent };
let fallsFor: unknown = null;
let falls: Waterfall[] = [];
let nextSurge = 0;
let nextGust = 0;
let gust = 1;
/** The last lightning strike we already scheduled thunder for. */
let heard: { km: number } | null = null;
let wadeDist = 0;
let lastPos: [number, number] | null = null;

/** Mix the ambience for this frame. */
export function updateAmbience(w: World, dt: number) {
  const c = audioContext();
  if (!c) return;
  const now = c.currentTime;
  const inside = w.room?.kind === 'interior';
  const env = state.env;
  const weather: Weather = debug.weather ?? env?.weather ?? 'clear';
  const intensity = debug.weather ? 1 : env?.intensity ?? 0.5;

  // ── Weather ──
  const rainV = weather === 'storm' ? 0.85 : weather === 'rain' ? 0.3 + 0.45 * intensity : 0;
  const rain = level('rain', rainV * (inside ? 0.55 : 1), () => layer('rain', 'rain', 'lowpass', 9000));
  rain?.freq(inside ? 800 : 9000, 0.2);

  const windV = WIND[weather] * (0.6 + 0.4 * intensity) * (inside ? 0.25 : 1);
  const wind = level('wind', windV * gust, () => layer('wind', 'wind', 'bandpass', 400, 0.8));
  if (wind && now >= nextGust) {
    // Gusts: wander the level and the pitch of the wind.
    gust = 0.55 + Math.random() * 0.9;
    wind.freq((inside ? 220 : 300) + Math.random() * (inside ? 150 : 700) * gust, 1.4);
    wind.panTo((Math.random() - 0.5) * 0.6);
    nextGust = now + 1.5 + Math.random() * 2.5;
  }

  const hot = weather === 'heatwave' && (env?.hour ?? 12) >= 7 && (env?.hour ?? 12) < 20;
  level('cicada', hot ? (inside ? 0.08 : 0.3) : 0, () => layer('cicada', 'cicada', 'highpass', 2500));

  // Thunder after each lightning strike. Sound travels about 343 m/s, so it arrives
  // roughly 3 s per kilometre after the flash: count the seconds to know how far it hit.
  // Close strikes crack and boom; far ones only roll, quieter and duller (and muffled indoors).
  if (w.strike && w.strike !== heard) {
    heard = w.strike;
    const km = w.strike.km;
    play(km < 1.2 ? 'thunderClose' : 'thunder', {
      delay: (km * 1000) / 343,
      gain: Math.max(0.35, 1.15 - km * 0.2) * (inside ? 0.7 : 1),
      rate: 1 - Math.min(0.12, km * 0.03),
      vary: 0.06,
      lowpass: inside ? 700 : Math.max(900, 7500 - km * 1800),
      pan: (Math.random() - 0.5) * 0.8,
      bus: 'ambience',
    });
  }

  // ── Water ──
  const g = w.grid, me = w.me;
  if (inside || !g || !me) water = { sea: silent, river: silent, fall: silent };
  else if (now - lastScan > 0.25) {
    lastScan = now;
    if (fallsFor !== w.waterFx) {
      fallsFor = w.waterFx;
      falls = findWaterfalls(g);
    }
    water = waterAround(g, falls, me.x, me.z);
  }
  // Waves come in surges: the wash swells, opens up and draws back.
  const sea = level('sea', water.sea.gain * 0.55, () => layer('sea', 'sea', 'lowpass', 500));
  if (sea) {
    sea.panTo(water.sea.pan);
    if (now >= nextSurge) {
      const s = 0.55 + Math.random() * 0.45;
      sea.filter.frequency.cancelScheduledValues(now);
      sea.filter.frequency.setTargetAtTime(700 + 1500 * s, now, 0.7);
      sea.filter.frequency.setTargetAtTime(450, now + 1.6, 1.3);
      nextSurge = now + 4.5 + Math.random() * 4;
    }
  }
  level('river', water.river.gain * 0.5, () => layer('river', 'river', 'lowpass', 6000))?.panTo(water.river.pan);
  level('fall', water.fall.gain * 0.7, () => layer('fall', 'fall', 'lowpass', 5000))?.panTo(water.fall.pan);

  // Splashy steps while wading.
  if (me && g && !inside) {
    const moved = lastPos ? Math.hypot(me.x - lastPos[0], me.z - lastPos[1]) : 0;
    lastPos = [me.x, me.z];
    const wet = g.tile(Math.floor(me.x), Math.floor(me.z)) === Tile.Sea && g.surfaceY(me.x, me.z) < SEA_LEVEL - 0.03;
    if (wet && moved > 0 && moved < 1) {
      wadeDist += moved;
      if (wadeDist > 0.62) {
        wadeDist = 0;
        play('wade', { gain: 0.55, vary: 0.12 });
      }
    } else wadeDist = 0.5;
  } else lastPos = null;
  void dt;
}
