// Types and constants the World and its parts share.

import * as THREE from 'three';
import { type BuildingType as BT, type Building, type HotbarTool, SEA_LEVEL, type Season, type VillagerDef, type Weather, type WorldObject } from '@hearthwood/shared';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { type Rig, setHat } from '../characters.ts';

/** Who works the counter in each kind of building. */
export function shopkeeper(role?: BT): VillagerDef {
  const base = { id: 'keeper', catchphrase: '', likes: [], loves: [], dislikes: [], birthday: '01-01', personality: 'cheerful' as const };
  switch (role) {
    case 'town_hall': return { ...base, name: 'Clerk', species: 'owl', color: '#8c6a4a', accent: '#efe0c4' };
    case 'tool_store': return { ...base, name: 'Smith', species: 'bear', color: '#8a5a3c', accent: '#d9b48f' };
    case 'furniture_store': return { ...base, name: 'Carpenter', species: 'squirrel', color: '#c46a2b', accent: '#f3d3a2' };
    case 'clothing_shop': return { ...base, name: 'Tailor', species: 'rabbit', color: '#f2efe8', accent: '#f6b6c4' };
    case 'restaurant': return { ...base, name: 'Chef', species: 'cat', color: '#e07b39', accent: '#fff1e2' };
    case 'travel_agent': return { ...base, name: 'Agent', species: 'penguin', color: '#2c3e50', accent: '#ffffff' };
    default: return { ...base, name: 'Keeper', species: 'dog', color: '#d9a35b', accent: '#fff3dc' };
  }
}

export const PLAYER_SPEED = 4.2;

export type Tool = HotbarTool;

export type Target =
  | { kind: 'object'; o: WorldObject; label: string }
  | { kind: 'villager'; id: string; label: string }
  | { kind: 'building'; b: Building; label: string }
  | { kind: 'water'; x: number; z: number; label: string; empty?: boolean }
  | { kind: 'plant'; x: number; z: number; label: string }
  | { kind: 'reel'; label: string };

export interface Mover {
  rig: Rig;
  label: CSS2DObject;
  x: number;
  z: number;
  r: number;
  tx: number;
  tz: number;
  tr: number;
  speed: number;
  swing: number;
}

export const WATER_Y = SEA_LEVEL;

/** Client-only debug switches (see the F3 debug menu). */
export const debug = {
  bend: 0.0085,
  timeOffsetH: 0, // shift the sun (visual only)
  weather: null as Weather | null, // visual override
  season: null as Season | null, // visual override
  shadows: true,
  labels: true,
  grid: false,
  fps: 0,
};

/** Vertical curtain texture: bright hem fading upwards, with fine rays. */
export function auroraTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.08, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  // Rays: vertical streaks of varying strength.
  g.globalCompositeOperation = 'destination-in';
  for (let x = 0; x < 512; x += 2) {
    const a = 0.25 + 0.75 * Math.pow(Math.abs(Math.sin(x * 0.07) * Math.sin(x * 0.013 + 1.3)), 0.6);
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.fillRect(x, 0, 2, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export { setHat };
