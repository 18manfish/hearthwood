// Light, sky and weather: day/night and seasons (visual), sun, moon, stars, aurora,
// rain and snow, lightning, cosy interiors.

import * as THREE from 'three';
import { BIOMES, daylight, nextSeason, seasonTransition, type EnvView, sunPosition, visualSeason, type Weather } from '@hearthwood/shared';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { mat } from '../../models.ts';
import { dominantSeason, groundWeather, overallSnow, seasonSnow, stepGroundWeather, type GroundLook } from '../../groundLook.ts';
import { debug, WATER_Y } from '../common.ts';
import { upsertObjectMesh } from '../room/objects.ts';
import { buildTerrain, rebuildFoliage } from '../room/terrainLayer.ts';
import { updateSeaState } from '../../water.ts';
import { surfLight } from '../../water/surf.ts';
import { puddleUniforms } from '../../puddles.ts';
import { CLOUD_SPAN } from './sky.ts';
import type { World } from '../../World.ts';

const SURF_DAY = new THREE.Color(1, 1, 1);

// Colours of the sky and the lights, parsed once. The frame loop only copies and
// blends them into the scratch colours below: nothing is allocated per frame.
const C = (hex: string) => new THREE.Color(hex);
const SKY_DAY = C('#8fd3f4'), SKY_HEAT = C('#ffe2a8'), SKY_NIGHT = C('#0d1836'), SKY_DUSK = C('#f59e6b'), WHITE = C('#ffffff');
const SKY_GREY: Record<Weather, THREE.Color> = {
  clear: C('#aab4bd'), cloudy: C('#7e868d'), rain: C('#6f767c'), storm: C('#575d63'), snow: C('#8b9399'), fog: C('#aab4bd'), sandstorm: C('#d8b77a'), heatwave: C('#aab4bd'),
};
const OVERCAST: Record<Weather, number> = { clear: 0, cloudy: 0.86, rain: 0.9, storm: 0.95, snow: 0.86, fog: 0.5, sandstorm: 0.55, heatwave: 0 };
const SUN_DAY = C('#fff4dc'), SUN_LOW = C('#ffc58a'), HEMI_DAY = C('#d8f0ff'), HEMI_NIGHT = C('#6f84c9'), AURORA_GLOW = C('#7dffb2'), SURF_NIGHT = C('#5d6c91');
const RAIN_COL = C('#cfe8ff'), SAND_COL = C('#e8c88a'), INDOORS = C('#1e150e'), INDOOR_SUN = C('#ffe2b8'), INDOOR_HEMI = C('#ffd9a8');
const sky = new THREE.Color(), tint = new THREE.Color(), cloudCol = new THREE.Color();
/** Windows and lamps: they light up as it gets dark. */
const WINDOW_GLASS = mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 });
const LAMP_GLASS = mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.2 });

export function currentEnv(self: World): EnvView | null {
  return state.env;
}

/** Where the ground is between seasons, how much snow lies and how wet it is (see groundLook.ts). */
export function currentLook(self: World): GroundLook {
  const env = currentEnv(self);
  const season = debug.season ?? env?.season ?? 'summer';
  const biome = self.room?.biome ?? 'grassland';
  const model = BIOMES[biome].seasonModel;
  let from = season, to = season, t = 1;
  if (debug.seasonBlend != null) {
    to = nextSeason(model, season);
    t = debug.seasonBlend;
  } else if (env && !debug.season) {
    const tr = seasonTransition(net.serverNow(), model, env.geo.lat, env.geo.tz);
    if (tr.from === season || tr.to === season) ({ from, to, t } = tr);
  }
  const outside = self.room?.kind !== 'interior';
  const gw = groundWeather();
  return {
    from, to,
    t: Math.round(t * 48) / 48, // in steps of about 3 hours of a 6-day change: rebuilds stay rare
    snowFrom: outside ? seasonSnow(biome, from) : 0,
    snowTo: outside ? seasonSnow(biome, to) : 0,
    fresh: outside ? Math.round((debug.freshSnow ?? gw.fresh) * 10) / 10 : 0,
    wet: outside ? debug.wet ?? gw.wet : 0,
  };
}

export function currentVisual(self: World) {
  const look = currentLook(self);
  const season = dominantSeason(look);
  return { season, vs: visualSeason(season), snowy: overallSnow(look) > 0.5, look };
}

/** Rebuild terrain + vegetation when the season (or snow cover) changes. */
export function refreshVisuals(self: World, force = false) {
  if (!self.room) return;
  const v = currentVisual(self);
  const l = v.look;
  const key = `${l.from}|${l.to}|${l.t}|${l.snowFrom}|${l.snowTo}|${l.fresh}`;
  const objKey = `${v.season}|${v.snowy}`;
  if (!force && key === self.seasonKey) return;
  self.seasonKey = key;
  buildTerrain(self);
  rebuildFoliage(self);
  if (force || objKey !== self.objectLookKey) {
    self.objectLookKey = objKey;
    for (const o of self.objects.values()) upsertObjectMesh(self, o);
  }
}

export function updateEnvironment(self: World, dt: number, t: number) {
  const env = currentEnv(self);
  if (!env) return;
  const w: Weather = debug.weather ?? env.weather;
  const intensity = debug.weather ? 1 : env.intensity;
  lightning(self, dt, w, intensity); // indoors too: no flash in there, but you hear the thunder
  stepGroundWeather(dt, w, env.tempC); // outside keeps getting wet (or snowed on) while you're indoors
  if (self.room?.kind === 'interior') return interiorLighting(self, t);
  self.water.visible = true;
  const sp = sunPosition(net.serverNow() + debug.timeOffsetH * 3600_000, env.geo.lat, env.geo.lon);
  const d = daylight(sp.elevation);
  self.day = d;
  const el = Math.max(sp.elevation, 4) * (Math.PI / 180);
  const az = sp.azimuth * (Math.PI / 180);
  const dx = Math.sin(az) * Math.cos(el), dy = Math.sin(el), dz = -Math.cos(az) * Math.cos(el);
  const fx = self.me?.x ?? 24, fz = self.me?.z ?? 24;
  self.sun.position.set(fx + dx * 40, dy * 40, fz + dz * 40);
  self.sun.castShadow = true;
  self.stars.visible = true;
  self.moon.position.set(fx - dx * 40, Math.abs(dy) * 40 + 10, fz - dz * 40);

  updateSeaState(w, intensity, dt);
  const overcast = OVERCAST[w] * (0.4 + 0.6 * intensity);
  const twilight = Math.max(0, 1 - Math.abs(sp.elevation) / 8);

  sky.copy(SKY_NIGHT).lerp(w === 'heatwave' ? SKY_HEAT : SKY_DAY, d);
  sky.lerp(SKY_DUSK, twilight * 0.55 * (1 - overcast));
  // A clouded-over sky is grey and dull; rain and storms darkest, snow the palest of them.
  sky.lerp(tint.copy(SKY_GREY[w]).multiplyScalar(0.25 + d * 0.75), overcast);
  if (self.flash > 0) sky.lerp(WHITE, self.flash);
  (self.scene.background as THREE.Color).copy(sky);
  const fog = self.scene.fog as THREE.Fog;
  fog.color.copy(sky);
  const fogNear = w === 'fog' ? 6 : w === 'sandstorm' ? 5 : w === 'snow' || w === 'rain' || w === 'storm' ? 22 : 45;
  fog.near += (fogNear - fog.near) * dt;
  fog.far += (fogNear * 3 + 20 - fog.far) * dt;

  self.sun.intensity = d * 2.4 * (1 - overcast * 0.7) + self.flash * 3;
  self.sun.color.copy(twilight > 0.3 ? SUN_LOW : SUN_DAY);
  self.moon.intensity = (1 - d) * 0.45;
  self.hemi.intensity = 0.25 + d * 0.65;
  self.hemi.color.copy(d > 0.5 ? HEMI_DAY : HEMI_NIGHT);
  self.renderer.toneMappingExposure = 0.85 + d * 0.25;
  // Surf foam is unlit, so it takes the light of the moment from here (else it glows white at night).
  surfLight.value.copy(SURF_NIGHT).lerp(SURF_DAY, d).multiplyScalar(1 - overcast * 0.3).lerp(SURF_DAY, self.flash);
  // Puddles reflect the sky and fill/dry with the rain.
  const wet = debug.wet ?? groundWeather().wet;
  puddleUniforms.uTime.value = t;
  puddleUniforms.uWet.value = wet;
  puddleUniforms.uRain.value = w === 'rain' || w === 'storm' ? Math.max(0.4, intensity) : 0;
  puddleUniforms.uSky.value.copy(sky);
  puddleUniforms.uLight.value.copy(surfLight.value);
  if (self.puddles) self.puddles.visible = wet > 0.001;

  // Night lights.
  WINDOW_GLASS.emissiveIntensity = (1 - d) * 1.3;
  LAMP_GLASS.emissiveIntensity = 0.2 + (1 - d) * 2;

  // Stars & aurora.
  const clearNight = (1 - d) * (1 - overcast);
  (self.stars.material as THREE.PointsMaterial).opacity = clearNight;
  const auroraOn = env.aurora ? Math.max(0, clearNight - 0.15) / 0.85 : 0;
  self.aurora.visible = auroraOn > 0.01;
  for (let i = 0; i < self.aurora.children.length; i++) {
    const mesh = self.aurora.children[i] as THREE.Mesh;
    const mm = mesh.material as THREE.MeshBasicMaterial;
    // Slow pulsing brightness, drifting curtains and rippling folds.
    mm.opacity = auroraOn * (0.55 + Math.sin(t * 0.35 + i * 2.1) * 0.25 + Math.sin(t * 1.3 + i) * 0.08);
    if (mm.map) mm.map.offset.x = (t * 0.004 * (i + 1)) % 1;
    if (!self.aurora.visible) continue;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const base = mesh.userData.base as Float32Array;
    for (let v = 0; v < pos.count; v++) {
      const x = base[v * 3], y = base[v * 3 + 1];
      const top = y > 0 ? 1 : 0;
      pos.setZ(v, Math.sin(x * 0.012 + t * 0.25 + i) * 28 + Math.sin(x * 0.035 - t * 0.6 + i * 3) * 9);
      pos.setY(v, y + top * Math.sin(x * 0.02 + t * 0.4 + i) * 10);
    }
    pos.needsUpdate = true;
  }
  updateClouds(self, dt, w, intensity, d, twilight);
  // A faint green glow on the land under a strong aurora.
  if (auroraOn > 0) self.hemi.color.lerp(AURORA_GLOW, auroraOn * 0.35);

  // Precipitation.
  const kind = w === 'rain' || w === 'storm' ? 'rain' : w === 'snow' ? 'snow' : w === 'sandstorm' ? 'sand' : null;
  self.rain.visible = !!kind;
  if (kind) {
    const pm = self.rain.material as THREE.PointsMaterial;
    pm.color.copy(kind === 'rain' ? RAIN_COL : kind === 'snow' ? WHITE : SAND_COL);
    pm.size = kind === 'rain' ? 0.07 : kind === 'snow' ? 0.14 : 0.1;
    const pos = self.rain.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const fall = kind === 'rain' ? 18 : kind === 'snow' ? 1.6 : 0.4;
    const drift = kind === 'sand' ? 14 : kind === 'snow' ? 0.6 : 1;
    const n = Math.floor((arr.length / 3) * (0.35 + intensity * 0.65));
    for (let i = 0; i < arr.length / 3; i++) {
      if (i >= n) { arr[i * 3 + 1] = -50; continue; }
      const v = self.rainVel[i];
      arr[i * 3 + 1] -= fall * v * dt;
      arr[i * 3] += (kind === 'snow' ? Math.sin(t + i) * drift : drift * v) * dt;
      if (arr[i * 3 + 1] < 0 || arr[i * 3] > 20) {
        arr[i * 3 + 1] = kind === 'sand' ? Math.random() * 4 : 18 + Math.random() * 4;
        arr[i * 3] = (Math.random() - 0.5) * 40 - (kind === 'sand' ? 10 : 0);
        arr[i * 3 + 2] = (Math.random() - 0.5) * 40;
      }
    }
    pos.needsUpdate = true;
  }
  // Gentle water motion.
  const bob = Math.sin(t * 0.8) * 0.015;
  self.water.position.y = WATER_Y + bob;
  (self.waterFx?.userData.tick as ((t: number, bob: number) => void) | undefined)?.(t, bob); // flow, waterfalls, surf
}

/**
 * Lightning during a storm: every strike hits somewhere 0.4–4 km away. Nearer strikes
 * light the sky up more; the thunder follows once the sound has travelled (see audio/ambience.ts).
 */
function lightning(self: World, dt: number, weather: string, intensity: number) {
  if (weather === 'storm' && Math.random() < dt * (0.1 + 0.08 * intensity)) {
    const km = 0.4 + Math.random() * 3.6;
    self.strike = { km };
    self.flash = Math.max(self.flash, Math.min(1, Math.max(0.35, 1.1 - km * 0.2)));
  }
  self.flash = Math.max(0, self.flash - dt * 4);
}

/** How much of the sky the clouds cover, by weather (scaled by its intensity). */
const CLOUD_COVER: Partial<Record<Weather, number>> = { cloudy: 0.72, rain: 1, storm: 1, snow: 0.9 };
/** How dark the clouds are (1 = white fluff) and how fast they drift. */
const CLOUD_SHADE: Partial<Record<Weather, number>> = { cloudy: 0.66, rain: 0.38, storm: 0.22, snow: 0.7 };
const CLOUD_WIND: Partial<Record<Weather, number>> = { cloudy: 0.8, rain: 1.6, storm: 3.4, snow: 0.9 };
const CLOUD_DAY = new THREE.Color('#f6f8fb'), CLOUD_NIGHT = new THREE.Color('#2c3447'), CLOUD_DUSK = new THREE.Color('#f2a57c');

/**
 * Clouds when it's overcast, raining, storming or snowing: they gather and clear
 * over a few seconds, take the light of the moment (white by day, dusky at sunset,
 * dark at night, lit up by lightning) and drift with the wind.
 */
function updateClouds(self: World, dt: number, w: Weather, intensity: number, d: number, twilight: number) {
  const g = self.clouds;
  const target = (CLOUD_COVER[w] ?? 0) * (0.75 + 0.25 * intensity);
  const cover = ((g.userData.cover as number | undefined) ?? target) + (target - ((g.userData.cover as number | undefined) ?? target)) * Math.min(1, dt * 0.35);
  g.userData.cover = cover;
  g.visible = cover > 0.01;
  if (!g.visible) return;
  if (CLOUD_SHADE[w] !== undefined) g.userData.shade = CLOUD_SHADE[w];
  if (CLOUD_WIND[w] !== undefined) g.userData.wind = CLOUD_WIND[w];
  const shade = (g.userData.shade as number | undefined) ?? 0.9;
  const wind = (g.userData.wind as number | undefined) ?? 0.8;
  const col = cloudCol.copy(CLOUD_NIGHT).lerp(CLOUD_DAY, d).multiplyScalar(0.35 + 0.65 * shade); // rain clouds: dark grey
  col.lerp(CLOUD_DUSK, twilight * 0.45 * shade);
  if (self.flash > 0) col.lerp(WHITE, Math.min(1, self.flash * 1.2));
  for (const c of g.children) {
    const m = c as THREE.Mesh;
    const mm = m.material as THREE.MeshBasicMaterial;
    if (m.userData.bank) {
      mm.opacity = Math.max(0, Math.min(0.95, (cover - 0.4) * 2));
      mm.color.copy(col).multiplyScalar(0.86);
      if (mm.map) mm.map.offset.x = (mm.map.offset.x + wind * dt * 0.0006) % 1;
      continue;
    }
    const far = m.userData.far as number;
    mm.opacity = Math.max(0, Math.min(1, (cover - (m.userData.rank as number)) * 5)) * (0.95 - far * 0.25);
    mm.color.copy(col).multiplyScalar(1 - far * 0.06);
    m.position.x += wind * (1 - far * 0.5) * dt;
    if (m.position.x > CLOUD_SPAN) m.position.x -= CLOUD_SPAN * 2;
  }
}

/** Warm, cosy, weather-free light indoors. */
export function interiorLighting(self: World, t: number) {
  const tent = self.room?.interior === 'tent';
  (self.scene.background as THREE.Color).copy(INDOORS);
  const fog = self.scene.fog as THREE.Fog;
  fog.color.copy(INDOORS);
  fog.near = 30;
  fog.far = 80;
  const fx = self.me?.x ?? 0, fz = self.me?.z ?? 0;
  self.sun.position.set(fx + 3, 14, fz + 6);
  self.sun.intensity = tent ? 0.9 : 1.3;
  self.sun.color.copy(INDOOR_SUN);
  self.sun.castShadow = true;
  self.moon.intensity = 0;
  self.hemi.intensity = tent ? 0.75 + Math.sin(t * 9) * 0.03 : 0.9;
  self.hemi.color.copy(INDOOR_HEMI);
  self.renderer.toneMappingExposure = 1;
  (self.stars.material as THREE.PointsMaterial).opacity = 0;
  for (const a of self.aurora.children) ((a as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0;
  self.rain.visible = false;
  self.clouds.visible = false;
  self.water.visible = false;
  WINDOW_GLASS.emissiveIntensity = 0.8;
}
