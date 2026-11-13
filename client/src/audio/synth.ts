// Sound synthesis: every effect and ambience loop is rendered from noise, filters and
// envelopes into a plain Float32Array (no audio files). Pure functions of the sample
// rate and a seed, so variants differ a little and everything can be tested offline.

export type Render = (sr: number, seed: number) => Float32Array;

// ── Building blocks ──────────────────────────────────────────────────────

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const buf = (sr: number, sec: number) => new Float32Array(Math.max(1, Math.round(sr * sec)));

/** RBJ biquad; set() may be called per sample block for sweeps. */
class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private sr: number) {}
  set(type: 'lp' | 'hp' | 'bp', f: number, q = 0.707) {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr;
    const cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Pink-ish noise (Paul Kellet's economy filter). */
function pinkGen(r: () => number) {
  let b0 = 0, b1 = 0, b2 = 0;
  return () => {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.2;
  };
}

/** Brown noise (leaky integrated white). */
function brownGen(r: () => number) {
  let v = 0;
  return () => {
    v = (v + (r() * 2 - 1) * 0.04) * 0.996;
    return v * 3.5;
  };
}

/** Add `src` into `dst` at `at` seconds. */
function mix(dst: Float32Array, src: Float32Array, sr: number, at = 0, g = 1) {
  const o = Math.round(at * sr);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g;
  return dst;
}

/** Scale so the loudest sample is `peak`. */
function norm(a: Float32Array, peak = 0.9) {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  return a;
}

/** Short fades at both ends (no clicks). */
function fade(a: Float32Array, sr: number, inS = 0.002, outS = 0.01) {
  const ni = Math.round(inS * sr), no = Math.round(outS * sr);
  for (let i = 0; i < ni && i < a.length; i++) a[i] *= i / ni;
  for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= i / no;
  return a;
}

/** Make a loop seamless: render `extra` seconds more and crossfade the tail into the head. */
function loopable(a: Float32Array, sr: number, extra: number) {
  const n = Math.round(extra * sr), len = a.length - n;
  const out = a.slice(0, len);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = out[i] * Math.sqrt(t) + a[len + i] * Math.sqrt(1 - t);
  }
  return out;
}

/** A sine whose frequency follows f(t), with amplitude env(t). */
function tone(sr: number, sec: number, f: (t: number) => number, env: (t: number) => number, harm = 0) {
  const a = buf(sr, sec);
  let ph = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * f(t)) / sr;
    a[i] = (Math.sin(ph) + harm * Math.sin(3 * ph)) * env(t);
  }
  return a;
}

/** Filtered noise burst. */
function burst(sr: number, sec: number, r: () => number, type: 'lp' | 'hp' | 'bp', f: number | ((t: number) => number), q: number, env: (t: number) => number) {
  const a = buf(sr, sec), bq = new Biquad(sr);
  const ff = typeof f === 'number' ? () => f : f;
  bq.set(type, ff(0), q);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    if (typeof f !== 'number' && i % 32 === 0) bq.set(type, ff(t), q);
    a[i] = bq.run(r() * 2 - 1) * env(t);
  }
  return a;
}

const dec = (k: number) => (t: number) => Math.exp(-t * k);
const att = (a: number, k: number) => (t: number) => Math.min(1, t / a) * Math.exp(-Math.max(0, t - a) * k);

/** Water drop: a quickly rising resonance (that's what makes it sound wet). */
function droplet(sr: number, f0: number, f1: number, sec: number) {
  return tone(sr, sec, (t) => f0 + (f1 - f0) * Math.min(1, t / sec), att(0.002, 6 / sec));
}

/** Damped partials (wood, metal, stone). */
function ring(sr: number, sec: number, parts: [number, number, number][]) {
  const a = buf(sr, sec);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const [f, amp, k] of parts) v += Math.sin(2 * Math.PI * f * t) * amp * Math.exp(-t * k);
    a[i] = v;
  }
  return a;
}

// ── Tool and action effects ──────────────────────────────────────────────

/** Swinging a tool or the net through the air. */
export const swish: Render = (sr, seed) => {
  const r = rng(seed), d = 0.2 + r() * 0.06, up = 1 + r() * 0.3;
  const a = burst(sr, d, r, 'bp', (t) => (600 + 2400 * Math.sin(Math.PI * Math.min(1, t / d))) * up, 1.3, (t) => Math.sin(Math.PI * Math.min(1, t / d)) ** 2);
  return fade(norm(a, 0.5), sr);
};

/** Axe into wood: a thump, a bite and a short woody ring. */
export const chop: Render = (sr, seed) => {
  const r = rng(seed), p = 0.92 + r() * 0.16;
  const a = tone(sr, 0.16, (t) => (70 + 90 * Math.exp(-t * 18)) * p, dec(30));
  mix(a, burst(sr, 0.05, r, 'bp', 2400 * p, 1.8, dec(110)), sr, 0, 0.8);
  mix(a, ring(sr, 0.2, [[380 * p, 0.5, 30], [590 * p, 0.35, 42], [910 * p, 0.22, 60]]), sr, 0.002, 0.9);
  return fade(norm(a, 0.85), sr, 0.001);
};

/** Shaking a tree: leaves rustling. */
export const rustle: Render = (sr, seed) => {
  const r = rng(seed), d = 0.75;
  const a = buf(sr, d);
  for (let g = 0; g < 90; g++) {
    const at = Math.pow(r(), 1.6) * (d - 0.06), len = 0.01 + r() * 0.03;
    const grain = burst(sr, len, r, 'bp', 2500 + r() * 3000, 1.2, (t) => Math.sin((Math.PI * t) / len));
    mix(a, grain, sr, at, (0.4 + r() * 0.6) * (1 - at / d));
  }
  mix(a, burst(sr, 0.5, r, 'bp', 1800, 0.6, (t) => Math.sin(Math.PI * Math.min(1, t / 0.5)) * 0.4), sr);
  return fade(norm(a, 0.6), sr);
};

/** Something dropping onto the grass (fruit, branches). */
export const thud: Render = (sr, seed) => {
  const r = rng(seed), p = 0.85 + r() * 0.3;
  const a = tone(sr, 0.18, (t) => (80 + 130 * Math.exp(-t * 25)) * p, dec(26));
  mix(a, burst(sr, 0.06, r, 'lp', 500, 0.7, dec(60)), sr, 0, 0.5);
  return fade(norm(a, 0.7), sr, 0.001);
};

/** Shovel into dirt: an impact and a crunchy scoop. */
export const dig: Render = (sr, seed) => {
  const r = rng(seed), d = 0.38;
  const a = burst(sr, d, r, 'lp', 1400, 0.8, dec(22));
  for (let g = 0; g < 28; g++) {
    const at = r() * 0.26, len = 0.004 + r() * 0.012;
    mix(a, burst(sr, len, r, 'bp', 1200 + r() * 1800, 1.5, (t) => Math.sin((Math.PI * t) / len)), sr, at, (0.3 + r() * 0.5) * (1 - at / 0.3));
  }
  mix(a, tone(sr, 0.12, (t) => 70 + 60 * Math.exp(-t * 30), dec(35)), sr, 0, 0.7);
  return fade(norm(a, 0.8), sr, 0.001);
};

/** Pick against rock: a bright metallic clink over a stony knock. */
export const clink: Render = (sr, seed) => {
  const r = rng(seed), f = 1500 + r() * 300;
  const a = ring(sr, 0.4, [[f, 0.5, 9], [f * 2.76, 0.3, 14], [f * 5.4, 0.16, 22], [f * 8.93, 0.08, 30]]);
  mix(a, burst(sr, 0.02, r, 'hp', 4000, 0.7, dec(250)), sr, 0, 0.6);
  mix(a, burst(sr, 0.1, r, 'lp', 600, 0.9, dec(45)), sr, 0, 1.2);
  return fade(norm(a, 0.7), sr, 0.001);
};

/** Picking something up. */
export const pop: Render = (sr, seed) => {
  const r = rng(seed), p = 0.95 + r() * 0.1;
  const a = tone(sr, 0.12, (t) => (420 * Math.pow(2.3, Math.min(1, t / 0.06))) * p, att(0.003, 30), 0.15);
  return fade(norm(a, 0.45), sr);
};

/** Patting soil (planting). */
export const pat: Render = (sr, seed) => {
  const r = rng(seed);
  const one = () => {
    const a = burst(sr, 0.09, r, 'lp', 650, 0.8, dec(45));
    return mix(a, tone(sr, 0.08, () => 105 + r() * 20, dec(45)), sr, 0, 0.6);
  };
  const a = buf(sr, 0.3);
  mix(a, one(), sr, 0);
  mix(a, one(), sr, 0.13 + r() * 0.03, 0.8);
  return fade(norm(a, 0.6), sr, 0.001);
};

/** Bobber or stone landing in water. */
export const plop: Render = (sr, seed) => {
  const r = rng(seed), p = 0.85 + r() * 0.3;
  const a = droplet(sr, 280 * p, 1100 * p, 0.06);
  mix(a, burst(sr, 0.08, r, 'bp', 1500, 0.8, dec(60)), sr, 0, 0.35);
  mix(a, droplet(sr, 700 * p, 1900 * p, 0.03), sr, 0.05 + r() * 0.03, 0.35);
  return fade(norm(a, 0.6), sr, 0.001);
};

/** A fish tugging at the bobber. */
export const bite: Render = (sr, seed) => {
  const r = rng(seed), a = buf(sr, 0.35);
  for (let k = 0; k < 2; k++) mix(a, droplet(sr, 500 + r() * 200, 1600 + r() * 600, 0.035), sr, k * 0.13, 1 - k * 0.2);
  mix(a, burst(sr, 0.12, r, 'bp', 2200, 1, dec(40)), sr, 0, 0.25);
  return fade(norm(a, 0.55), sr, 0.001);
};

/** A proper splash: a fish coming out of the water. */
export const splash: Render = (sr, seed) => {
  const r = rng(seed), a = burst(sr, 0.6, r, 'bp', (t) => 2200 - t * 1600, 0.7, att(0.006, 7));
  for (let k = 0; k < 9; k++) {
    const f0 = 600 + r() * 900;
    mix(a, droplet(sr, f0, f0 * (2 + r()), 0.02 + r() * 0.025), sr, 0.04 + r() * 0.45, 0.4 + r() * 0.4);
  }
  return fade(norm(a, 0.75), sr, 0.001);
};

/** The fishing reel's ratchet. */
export const reel: Render = (sr, seed) => {
  const r = rng(seed), a = buf(sr, 0.6);
  let t = 0;
  for (let k = 0; k < 15; k++) {
    const click = mix(burst(sr, 0.004, r, 'hp', 3000, 0.7, dec(800)), ring(sr, 0.012, [[4200 + r() * 300, 0.6, 400]]), sr);
    mix(a, click, sr, t, 0.7 + r() * 0.3);
    t += 0.05 - k * 0.0018;
  }
  return fade(norm(a, 0.45), sr, 0.001);
};

/** Little arpeggio for a catch (fish, bird). */
export const jingle: Render = (sr) => {
  const a = buf(sr, 0.75);
  [1046.5, 1318.5, 1568, 2093].forEach((f, k) => mix(a, tone(sr, 0.45, () => f, att(0.004, 9), 0.25), sr, k * 0.07, 1 - k * 0.12));
  return fade(norm(a, 0.38), sr);
};

/** Didn't work (missed, too tired, nothing there). */
export const bonk: Render = (sr, seed) => {
  const r = rng(seed);
  const a = tone(sr, 0.18, (t) => 230 - 80 * Math.min(1, t / 0.15), att(0.004, 22), 0.2);
  mix(a, burst(sr, 0.05, r, 'lp', 400, 0.7, dec(80)), sr, 0, 0.4);
  return fade(norm(a, 0.35), sr);
};

/** Laying or lifting a path: a scrape. */
export const scrape: Render = (sr, seed) => {
  const r = rng(seed), d = 0.3, a = buf(sr, d), bq = new Biquad(sr).set('bp', 1300 + r() * 400, 1.4);
  let am = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    if (i % 64 === 0) am = 0.3 + r() * 0.7;
    a[i] = bq.run(r() * 2 - 1) * am * Math.sin(Math.PI * Math.min(1, t / d));
  }
  return fade(norm(a, 0.5), sr);
};

/** Earth and stone shifting (raising / lowering cliffs, ramps). */
export const rumble: Render = (sr, seed) => {
  const r = rng(seed), d = 0.9, br = brownGen(r), lp = new Biquad(sr).set('lp', 170, 0.9);
  const a = buf(sr, d);
  for (let i = 0; i < a.length; i++) a[i] = lp.run(br()) * att(0.05, 4)(i / sr);
  for (let k = 0; k < 5; k++) {
    const f = 500 + r() * 500;
    mix(a, ring(sr, 0.08, [[f, 0.4, 60], [f * 2.3, 0.2, 90]]), sr, 0.05 + r() * 0.5, 0.25 + r() * 0.2);
  }
  return fade(norm(a, 0.8), sr);
};

/** Digging water: a wet scoop and bubbles. */
export const gurgle: Render = (sr, seed) => {
  const r = rng(seed), a = mix(buf(sr, 0.6), dig(sr, seed), sr, 0, 0.6);
  for (let k = 0; k < 7; k++) {
    const f0 = 250 + r() * 300;
    mix(a, droplet(sr, f0, f0 * 2.2, 0.04 + r() * 0.03), sr, 0.12 + r() * 0.4, 0.5);
  }
  return fade(norm(a, 0.7), sr);
};

/** Wooden knock (placing furniture). */
export const knock: Render = (sr, seed) => {
  const r = rng(seed), p = 0.9 + r() * 0.2;
  const a = ring(sr, 0.18, [[650 * p, 0.5, 38], [1040 * p, 0.3, 55], [1700 * p, 0.15, 80]]);
  mix(a, burst(sr, 0.02, r, 'bp', 3000, 1.5, dec(200)), sr, 0, 0.5);
  mix(a, tone(sr, 0.1, () => 120 * p, dec(45)), sr, 0, 0.5);
  return fade(norm(a, 0.6), sr, 0.001);
};

/** Building: a few hammer knocks. */
export const hammer: Render = (sr, seed) => {
  const a = buf(sr, 0.65);
  for (let k = 0; k < 3; k++) mix(a, knock(sr, seed * 7 + k), sr, k * 0.19, k === 2 ? 1 : 0.8);
  return fade(norm(a, 0.65), sr);
};

/** A step while wading. */
export const wade: Render = (sr, seed) => {
  const r = rng(seed), a = burst(sr, 0.25, r, 'bp', 1300 + r() * 400, 0.9, att(0.004, 16));
  for (let k = 0; k < 3; k++) {
    const f0 = 700 + r() * 600;
    mix(a, droplet(sr, f0, f0 * 2, 0.025), sr, 0.03 + r() * 0.15, 0.3);
  }
  return fade(norm(a, 0.45), sr, 0.001);
};

/** Thunder: maybe a crack, then rolling rumbles. */
export const thunder: Render = (sr, seed) => {
  const r = rng(seed), d = 5.5, br = brownGen(r), lp = new Biquad(sr).set('lp', 140 + r() * 120, 0.8);
  const a = buf(sr, d);
  const swells: [number, number, number, number][] = [];
  for (let k = 0, n = 3 + Math.floor(r() * 4); k < n; k++) swells.push([r() * 2.2, 0.15 + r() * 0.35, 0.8 + r() * 1.4, 0.4 + r() * 0.6]);
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    let e = 0;
    for (const [s0, at, de, g] of swells) if (t >= s0) e += g * Math.min(1, (t - s0) / at) * Math.exp(-Math.max(0, t - s0 - at) / de);
    a[i] = lp.run(br()) * e * (1 - t / d);
  }
  if (r() < 0.55) mix(a, burst(sr, 0.35, r, 'hp', 1200, 0.6, dec(14)), sr, 0, 0.25 + r() * 0.2);
  return fade(norm(a, 0.95), sr, 0.005, 0.3);
};

// ── Ambience loops (seamless) ────────────────────────────────────────────

/** Rain: a soft hiss with countless tiny drop ticks. */
export const rainLoop: Render = (sr, seed) => {
  const r = rng(seed), d = 8, X = 0.5, pk = pinkGen(r);
  const hp = new Biquad(sr).set('hp', 500), lp = new Biquad(sr).set('lp', 6500);
  const a = buf(sr, d + X);
  for (let i = 0; i < a.length; i++) a[i] = lp.run(hp.run(pk())) * 0.6;
  for (let k = 0; k < (d + X) * 140; k++) {
    const len = 0.002 + r() * 0.004;
    mix(a, burst(sr, len, r, 'bp', 2500 + r() * 4000, 2, (t) => Math.sin((Math.PI * t) / len)), sr, r() * (d + X - len), 0.15 + r() * 0.35);
  }
  return norm(loopable(a, sr, X), 0.7);
};

/** River: babbling – narrow resonances wandering quickly over noise. */
export const riverLoop: Render = (sr, seed) => {
  const r = rng(seed), d = 8, X = 0.5, pk = pinkGen(r);
  const bands = [[500, 1400], [1200, 2600], [2400, 4400]].map(([lo, hi]) => ({ lo, hi, f: (lo + hi) / 2, v: 0, q: new Biquad(sr) }));
  const bed = new Biquad(sr).set('lp', 1800);
  const a = buf(sr, d + X);
  for (let i = 0; i < a.length; i++) {
    const n = pk();
    if (i % 32 === 0)
      for (const b of bands) {
        b.v = b.v * 0.9 + (r() - 0.5) * 0.25;
        b.f = Math.min(b.hi, Math.max(b.lo, b.f * (1 + b.v * 0.08)));
        b.q.set('bp', b.f, 6);
      }
    let v = bed.run(n) * 0.5;
    for (const b of bands) v += b.q.run(n) * 1.6;
    a[i] = v;
  }
  return norm(loopable(a, sr, X), 0.7);
};

/** Waterfall: a steady full roar. */
export const fallLoop: Render = (sr, seed) => {
  const r = rng(seed), d = 6, X = 0.5, pk = pinkGen(r), br = brownGen(r);
  const lp = new Biquad(sr).set('lp', 3800), hp = new Biquad(sr).set('hp', 120);
  const a = buf(sr, d + X);
  for (let i = 0; i < a.length; i++) a[i] = hp.run(lp.run(pk() * 0.8 + br() * 0.25));
  return norm(loopable(a, sr, X), 0.75);
};

/** Sea: deep wash (shaped by the player into surges). */
export const seaLoop: Render = (sr, seed) => {
  const r = rng(seed), d = 8, X = 0.5, pk = pinkGen(r), br = brownGen(r);
  const lp = new Biquad(sr).set('lp', 2400);
  const a = buf(sr, d + X);
  for (let i = 0; i < a.length; i++) a[i] = lp.run(pk() * 0.7 + br() * 0.35);
  return norm(loopable(a, sr, X), 0.75);
};

/** Wind: brown-ish noise (the player sweeps a filter over it for gusts). */
export const windLoop: Render = (sr, seed) => {
  const r = rng(seed), d = 8, X = 0.5, br = brownGen(r), pk = pinkGen(r);
  const a = buf(sr, d + X);
  for (let i = 0; i < a.length; i++) a[i] = br() * 0.8 + pk() * 0.35;
  return norm(loopable(a, sr, X), 0.8);
};

/** Cicadas on a hot day: pulsing high buzz in phrases. */
export const cicadaLoop: Render = (sr, seed) => {
  const r = rng(seed), d = 8, X = 0.5, a = buf(sr, d + X);
  for (let v = 0; v < 3; v++) {
    const f = 4200 + r() * 1600, rate = 55 + r() * 30, bq = new Biquad(sr).set('bp', f, 9);
    const phrase = 2 + r() * 2, off = r() * phrase;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr, p = ((t + off) % phrase) / phrase;
      const shape = Math.sin(Math.PI * Math.min(1, p / 0.8)) ** 2 * (p < 0.8 ? 1 : 0);
      a[i] += bq.run(r() * 2 - 1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t)) ** 2 * shape * (0.6 + v * 0.2);
    }
  }
  return norm(loopable(a, sr, X), 0.5);
};

/** Every effect, with how many variants to render. */
export const EFFECTS = {
  swish: [swish, 3], chop: [chop, 3], rustle: [rustle, 2], thud: [thud, 2], dig: [dig, 3], clink: [clink, 3],
  pop: [pop, 2], pat: [pat, 2], plop: [plop, 3], bite: [bite, 2], splash: [splash, 2], reel: [reel, 1],
  jingle: [jingle, 1], bonk: [bonk, 1], scrape: [scrape, 2], rumble: [rumble, 2], gurgle: [gurgle, 2],
  knock: [knock, 3], hammer: [hammer, 2], wade: [wade, 4], thunder: [thunder, 3],
} satisfies Record<string, [Render, number]>;
export type Effect = keyof typeof EFFECTS;

export const LOOPS = { rain: rainLoop, river: riverLoop, fall: fallLoop, sea: seaLoop, wind: windLoop, cicada: cicadaLoop } satisfies Record<string, Render>;
export type Loop = keyof typeof LOOPS;
