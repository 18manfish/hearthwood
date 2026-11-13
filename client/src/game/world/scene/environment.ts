// Light, sky and weather: day/night and seasons (visual), sun, moon, stars, aurora,
// rain and snow, lightning, cosy interiors; also the camera zoom and canvas size.

import * as THREE from 'three';
import { BIOMES, daylight, type EnvView, sunPosition, visualSeason } from '@hearthwood/shared';
import { net } from '../../../net.ts';
import { state } from '../../../state.ts';
import { mat } from '../../models.ts';
import { setPathSnow } from '../../paths.ts';
import { debug, WATER_Y } from '../common.ts';
import { upsertObjectMesh } from '../room/objects.ts';
import { buildTerrain, rebuildFoliage } from '../room/terrainLayer.ts';
import type { World } from '../../World.ts';

export function currentEnv(self: World): EnvView | null {
  return state.env;
}

export function currentVisual(self: World) {
  const env = currentEnv(self);
  const season = debug.season ?? env?.season ?? 'summer';
  const vs = visualSeason(season);
  const weather = debug.weather ?? env?.weather;
  const snowy = self.room?.kind !== 'interior' && ((vs === 'winter' && self.room != null && ['temperate', 'boreal'].includes(BIOMES[self.room.biome].seasonModel)) || weather === 'snow');
  return { season, vs, snowy };
}

/** Rebuild terrain + vegetation when the season (or snow cover) changes. */
export function refreshVisuals(self: World, force = false) {
  if (!self.room) return;
  const v = currentVisual(self);
  const key = `${v.season}|${v.snowy}`;
  if (!force && key === self.seasonKey) return;
  self.seasonKey = key;
  buildTerrain(self);
  for (const o of self.objects.values()) upsertObjectMesh(self, o);
  rebuildFoliage(self);
  setPathSnow(v.snowy);
}

export function updateEnvironment(self: World, dt: number, t: number) {
  const env0 = currentEnv(self);
  if (!env0) return;
  const env = debug.weather ? { ...env0, weather: debug.weather, intensity: 1 } : env0;
  if (self.room?.kind === 'interior') return interiorLighting(self, t);
  self.water.visible = true;
  const sp = sunPosition(net.serverNow() + debug.timeOffsetH * 3600_000, env.geo.lat, env.geo.lon);
  const d = daylight(sp.elevation);
  self.day = d;
  const el = Math.max(sp.elevation, 4) * (Math.PI / 180);
  const az = sp.azimuth * (Math.PI / 180);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  const fx = self.me?.x ?? 24, fz = self.me?.z ?? 24;
  self.sun.position.set(fx + dir.x * 40, dir.y * 40, fz + dir.z * 40);
  self.sun.castShadow = true;
  self.stars.visible = true;
  self.moon.position.set(fx - dir.x * 40, Math.abs(dir.y) * 40 + 10, fz - dir.z * 40);

  const w = env.weather;
  const overcast = { clear: 0, cloudy: 0.45, rain: 0.6, storm: 0.75, snow: 0.5, fog: 0.5, sandstorm: 0.55, heatwave: 0 }[w] * env.intensity;
  const twilight = Math.max(0, 1 - Math.abs(sp.elevation) / 8);

  const dayCol = new THREE.Color(w === 'heatwave' ? '#ffe2a8' : '#8fd3f4');
  const nightCol = new THREE.Color('#0d1836');
  const duskCol = new THREE.Color('#f59e6b');
  const grey = new THREE.Color(w === 'sandstorm' ? '#d8b77a' : '#aab4bd');
  const sky = nightCol.clone().lerp(dayCol, d);
  sky.lerp(duskCol, twilight * 0.55 * (1 - overcast));
  sky.lerp(grey.clone().multiplyScalar(0.25 + d * 0.75), overcast);
  if (self.flash > 0) sky.lerp(new THREE.Color('#ffffff'), self.flash);
  (self.scene.background as THREE.Color).copy(sky);
  const fog = self.scene.fog as THREE.Fog;
  fog.color.copy(sky);
  const fogNear = w === 'fog' ? 6 : w === 'sandstorm' ? 5 : w === 'snow' || w === 'rain' || w === 'storm' ? 22 : 45;
  fog.near += (fogNear - fog.near) * dt;
  fog.far += (fogNear * 3 + 20 - fog.far) * dt;

  self.sun.intensity = d * 2.4 * (1 - overcast * 0.7) + self.flash * 3;
  self.sun.color.set(twilight > 0.3 ? '#ffc58a' : '#fff4dc');
  self.moon.intensity = (1 - d) * 0.45;
  self.hemi.intensity = 0.25 + d * 0.65;
  self.hemi.color.set(d > 0.5 ? '#d8f0ff' : '#6f84c9');
  self.renderer.toneMappingExposure = 0.85 + d * 0.25;

  // Night lights.
  mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 }).emissiveIntensity = (1 - d) * 1.3;
  mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.2 }).emissiveIntensity = 0.2 + (1 - d) * 2;

  // Stars & aurora.
  const clearNight = (1 - d) * (1 - overcast);
  (self.stars.material as THREE.PointsMaterial).opacity = clearNight;
  const auroraOn = env.aurora ? Math.max(0, clearNight - 0.15) / 0.85 : 0;
  self.aurora.visible = auroraOn > 0.01;
  for (const [i, a] of self.aurora.children.entries()) {
    const mesh = a as THREE.Mesh;
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
  // A faint green glow on the land under a strong aurora.
  if (auroraOn > 0) self.hemi.color.lerp(new THREE.Color('#7dffb2'), auroraOn * 0.35);

  // Precipitation.
  const kind = w === 'rain' || w === 'storm' ? 'rain' : w === 'snow' ? 'snow' : w === 'sandstorm' ? 'sand' : null;
  self.rain.visible = !!kind;
  if (kind) {
    const pm = self.rain.material as THREE.PointsMaterial;
    pm.color.set(kind === 'rain' ? '#cfe8ff' : kind === 'snow' ? '#ffffff' : '#e8c88a');
    pm.size = kind === 'rain' ? 0.07 : kind === 'snow' ? 0.14 : 0.1;
    const pos = self.rain.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const fall = kind === 'rain' ? 18 : kind === 'snow' ? 1.6 : 0.4;
    const drift = kind === 'sand' ? 14 : kind === 'snow' ? 0.6 : 1;
    const n = Math.floor((arr.length / 3) * (0.35 + env.intensity * 0.65));
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
  // Lightning.
  if (w === 'storm' && Math.random() < dt * 0.15) self.flash = 1;
  self.flash = Math.max(0, self.flash - dt * 4);
  // Gentle water motion.
  const bob = Math.sin(t * 0.8) * 0.015;
  self.water.position.y = WATER_Y + bob;
  (self.waterFx?.userData.tick as ((t: number, bob: number) => void) | undefined)?.(t, bob); // flow, waterfalls, surf
}

/** Warm, cosy, weather-free light indoors. */
export function interiorLighting(self: World, t: number) {
  const tent = self.room?.interior === 'tent';
  (self.scene.background as THREE.Color).set('#1e150e');
  const fog = self.scene.fog as THREE.Fog;
  fog.color.set('#1e150e');
  fog.near = 30;
  fog.far = 80;
  const fx = self.me?.x ?? 0, fz = self.me?.z ?? 0;
  self.sun.position.set(fx + 3, 14, fz + 6);
  self.sun.intensity = tent ? 0.9 : 1.3;
  self.sun.color.set('#ffe2b8');
  self.sun.castShadow = true;
  self.moon.intensity = 0;
  self.hemi.intensity = tent ? 0.75 + Math.sin(t * 9) * 0.03 : 0.9;
  self.hemi.color.set('#ffd9a8');
  self.renderer.toneMappingExposure = 1;
  (self.stars.material as THREE.PointsMaterial).opacity = 0;
  for (const a of self.aurora.children) ((a as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0;
  self.rain.visible = false;
  self.water.visible = false;
  mat('#bfe6ff', { emissive: '#ffd27a', ei: 0 }).emissiveIntensity = 0.8;
}

export function zoom(self: World, delta: number) {
  self.camDist = Math.max(8, Math.min(24, self.camDist + delta));
}

/** Size of the drawing area the renderer was last fitted to (width, height, pixel ratio). */
const fitted = new WeakMap<World, string>();

/**
 * Fit the renderer to its container. Called every frame: it only does work when
 * the size or pixel ratio changed, so it catches everything a 'resize' event can
 * miss (F11 / fullscreen, docking the window, moving to another monitor).
 */
export function resize(self: World) {
  const w = self.container.clientWidth || window.innerWidth;
  const h = self.container.clientHeight || window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${w}x${h}@${dpr}`;
  if (fitted.get(self) === key) return;
  fitted.set(self, key);
  if (self.renderer.getPixelRatio() !== dpr) self.renderer.setPixelRatio(dpr);
  self.renderer.setSize(w, h);
  self.labels.setSize(w, h);
  self.camera.aspect = w / h;
  self.camera.updateProjectionMatrix();
}
