// How the ground looks right now: where it is in the change between two seasons,
// how much snow lies (from the season and from recent snowfall) and how wet it is
// from rain. Plain numbers, no three.js: the terrain, foliage, footprints and
// puddles all ask the same fields so they agree on where each patch is.
//
// The season change and the snow spread across the island in patches: each point
// switches when the progress passes its own threshold, taken from a smooth noise
// field, so the new season creeps in over days instead of flipping. Snow settles
// on high ground first and melts there last.

import { BIOMES, CLIFF, MAX_LEVEL, SEA_LEVEL, Tile, visualSeason, type BiomeId, type Grid, type Season, type Weather } from '@hearthwood/shared';

export interface GroundLook {
  from: Season;
  to: Season;
  /** Progress of the season change, 0 (all `from`) … 1 (all `to`). */
  t: number;
  /** Snow cover the two seasons bring (0 or 1). */
  snowFrom: number;
  snowTo: number;
  /** Snow from recent snowfall, 0 … 1 (how much of the island it covers). */
  fresh: number;
  /** Rain on the ground, 0 (dry) … 1 (puddles full). */
  wet: number;
}

/** Winter in a climate that has snow covers the ground. */
export function seasonSnow(biome: BiomeId, s: Season): number {
  const model = BIOMES[biome].seasonModel;
  return visualSeason(s) === 'winter' && (model === 'temperate' || model === 'boreal') ? 1 : 0;
}

// ── Noise ───────────────────────────────────────────────────────────────────
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
/** Blobs a few tiles across with ragged edges, 0 … 1. */
function field(x: number, z: number, seed: number): number {
  const n = vnoise(x * 0.11, z * 0.11, seed) * 0.6 + vnoise(x * 0.31, z * 0.31, seed + 7) * 0.28 + vnoise(x * 1.3, z * 1.3, seed + 13) * 0.12;
  return Math.min(1, Math.max(0, (n - 0.5) * 1.6 + 0.5)); // stretch: value noise bunches up around 0.5
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 1 once `progress` has passed this point's threshold `th` (0 … 1), with a soft edge. */
const reached = (progress: number, th: number) => smooth(th - 0.05, th + 0.05, progress * 1.1 - 0.05);
const heightN = (y: number) => Math.min(1, Math.max(0, y / (MAX_LEVEL * CLIFF)));

/** How far the season change has got at this point: 0 = `from`, 1 = `to`. */
export function seasonAt(look: GroundLook, x: number, z: number): number {
  if (look.from === look.to) return 1;
  return reached(look.t, field(x, z, 1));
}

/** Snow cover at this point, 0 … 1. */
export function snowAt(look: GroundLook, x: number, y: number, z: number): number {
  let s = look.snowFrom;
  if (look.snowFrom !== look.snowTo) {
    // Arriving: high ground first. Melting: low ground first.
    const h = heightN(y), n = field(x, z, 2);
    const th = 0.75 * n + 0.25 * (look.snowTo > look.snowFrom ? 1 - h : h);
    s = look.snowFrom + (look.snowTo - look.snowFrom) * reached(look.t, th);
  }
  if (look.fresh > 0) s = Math.max(s, reached(look.fresh, 0.85 * field(x, z, 3)));
  return s;
}

/** True when nothing is changing: one season, all or no snow (one plain build is enough). */
export function isUniform(look: GroundLook): boolean {
  const snowSteady = look.snowFrom === look.snowTo && (look.snowFrom === 1 || look.fresh === 0);
  return (look.from === look.to || look.t >= 1) && snowSteady;
}

/** The season most of the island shows (for trees and anything that can't be patchy). */
export function dominantSeason(look: GroundLook): Season {
  return look.t < 0.5 ? look.from : look.to;
}

/** Overall snow cover (for things that are snowy or not as a whole, like trees). */
export function overallSnow(look: GroundLook): number {
  return Math.max(look.snowFrom + (look.snowTo - look.snowFrom) * look.t, look.fresh);
}

// ── Weather on the ground (client-side memory of recent rain and snow) ─────
const FRESH_FILL_S = 15 * 60; // snowfall covers the island in about a quarter of an hour
const FRESH_MELT_S = 90 * 60; // and lies for a while once it stops
const WET_FILL_S = 4 * 60; // puddles fill in a few minutes of rain
const WET_DRY_S = 25 * 60; // and dry up over half an hour or so

let fresh = 0;
let wet = 0;
let primed = false;

/** Advance the ground's memory of the weather by `dt` seconds. */
export function stepGroundWeather(dt: number, weather: Weather, tempC: number) {
  const snowing = weather === 'snow';
  const raining = weather === 'rain' || weather === 'storm';
  if (!primed) {
    // Arriving in the middle of it: the ground is already covered / wet.
    primed = true;
    if (snowing) fresh = 1;
    if (raining) wet = 1;
  }
  fresh = snowing ? Math.min(1, fresh + dt / FRESH_FILL_S) : Math.max(0, fresh - (dt / FRESH_MELT_S) * (tempC > 0 ? 1.5 : 0.5));
  wet = raining ? Math.min(1, wet + dt / WET_FILL_S) : Math.max(0, wet - (dt / WET_DRY_S) * (weather === 'heatwave' ? 3 : 1));
  if (snowing || fresh > 0.3) wet = Math.min(wet, 1 - fresh); // puddles freeze over / vanish under snow
}

export function groundWeather() {
  return { fresh, wet };
}

/** Forget the weather memory (a new island: start from its current weather). */
export function resetGroundWeather() {
  fresh = 0;
  wet = 0;
  primed = false;
}

// ── Snow depth ──────────────────────────────────────────────────────────────
/** How deep full snow cover lies (tiles). */
export const SNOW_DEPTH = 0.09;

/** Ground that snow piles up on; it tapers off towards everything else (paths, ramps, water, docks). */
function holdsSnow(g: Grid, x: number, z: number): boolean {
  if (!g.inBounds(x, z)) return false;
  const t = g.tile(x, z);
  return (t === Tile.Ground || t === Tile.Shore) && !g.paths[z * g.size + x] && g.ramp(x, z) < 0;
}

/** 0 at the edge of ground that holds no snow, 1 from 0.6 tiles away: the snow banks up gently. */
function clearance(g: Grid, x: number, z: number): number {
  const tx = Math.floor(x), tz = Math.floor(z);
  let d = 1;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, nz = tz + dz;
      if (holdsSnow(g, nx, nz)) continue;
      const ex = Math.max(nx - x, 0, x - (nx + 1)), ez = Math.max(nz - z, 0, z - (nz + 1));
      d = Math.min(d, Math.hypot(ex, ez));
    }
  return smooth(0, 0.6, d);
}

/** How far the snow surface lies above the ground at a point (0 where there's none). */
export function snowLift(look: GroundLook, g: Grid, x: number, y: number, z: number): number {
  const s = snowAt(look, x, y, z);
  if (s <= 0) return 0;
  return SNOW_DEPTH * smooth(0.05, 0.6, s) * clearance(g, x, z) * smooth(SEA_LEVEL, SEA_LEVEL + 0.06, y);
}

/** The same at a point on the ground (footprints, drifts). */
export function snowLiftAt(look: GroundLook, g: Grid, x: number, z: number): number {
  return snowLift(look, g, x, g.surfaceY(x, z), z);
}

/** Anything in the look that could lay snow on the ground. */
export function anySnow(look: GroundLook): boolean {
  return look.snowFrom > 0 || look.snowTo > 0 || look.fresh > 0;
}
