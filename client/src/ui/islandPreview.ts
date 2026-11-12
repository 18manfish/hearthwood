// Small 3D previews of an example island per starting location, used in the
// location picker. One WebGL context renders the static thumbnails (cached as
// images) and the slowly rotating preview of the selected biome.

import * as THREE from 'three';
import {
  BIOMES, Grid, generateIsland, hashString, visualSeason, type BiomeId, type Season,
} from '@hearthwood/shared';
import { buildDocks, buildTerrainMesh, waterColor } from '../game/terrain.ts';
import { buildingModel, objectModel } from '../game/models.ts';
import { bendStrength } from '../game/bend.ts';

const W = 240;
const H = 150;

function snowyFor(biome: BiomeId, season: Season) {
  return visualSeason(season) === 'winter' && ['temperate', 'boreal'].includes(BIOMES[biome].seasonModel);
}

/** Build a self-contained scene of an example island. */
function islandScene(biome: BiomeId, season: Season) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe8f5');
  const layout = generateIsland(hashString(`preview:${biome}`), biome, { elevation: true });
  const grid = new Grid(layout.size, layout.tiles, layout.levels, layout.ramps);
  grid.rebuild(layout.objects, layout.buildings);
  const vs = visualSeason(season);
  const snowy = snowyFor(biome, season);
  const terrain = buildTerrainMesh(grid, { biome, season, vs, snowy, pad: 3 });
  scene.add(terrain);
  scene.add(buildDocks(grid));
  const def = BIOMES[biome];
  for (const o of layout.objects) {
    const m = objectModel(o, season, vs, snowy, def.bushColor, def.bushItem);
    m.position.set(o.x + 0.5, grid.surfaceY(o.x + 0.5, o.z + 0.5), o.z + 0.5);
    scene.add(m);
  }
  for (const b of layout.buildings) {
    const m = buildingModel(b, 0);
    m.position.set(b.x + b.w / 2, 0, b.z + b.h / 2);
    scene.add(m);
  }
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: waterColor(biome), transparent: true, opacity: 0.85, roughness: 0.3 }),
  );
  water.position.set(layout.size / 2, -0.12, layout.size / 2);
  scene.add(water);
  scene.add(new THREE.HemisphereLight('#e8f6ff', '#6b8f4a', 1.1));
  const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
  sun.position.set(60, 80, 30);
  scene.add(sun);
  const dispose = () => {
    terrain.geometry.dispose();
    water.geometry.dispose();
    (water.material as THREE.Material).dispose();
  };
  return { scene, center: layout.size / 2, dispose };
}

export class IslandPreviewer {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(32, W / H, 1, 300);
  private cache = new Map<string, string>();
  private live: { scene: THREE.Scene; center: number; dispose: () => void; key: string } | null = null;
  private angle = 0.6;
  private running = false;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(W, H);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.style.cssText = 'width:100%;height:auto;border-radius:14px;display:block';
  }

  private draw(scene: THREE.Scene, center: number, angle: number) {
    const r = 52;
    this.camera.position.set(center + Math.sin(angle) * r, 42, center + Math.cos(angle) * r);
    this.camera.lookAt(center, 0, center);
    // The previews are shown flat (no world bend).
    const prev = bendStrength.value;
    bendStrength.value = 0;
    this.renderer.render(scene, this.camera);
    bendStrength.value = prev;
  }

  /** A still image of the biome's example island (cached). */
  thumbnail(biome: BiomeId, season: Season): string {
    const key = `${biome}:${season}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const s = islandScene(biome, season);
    this.draw(s.scene, s.center, 0.6);
    const url = this.renderer.domElement.toDataURL('image/png');
    s.dispose();
    this.cache.set(key, url);
    return url;
  }

  /** Mount a slowly rotating preview of one biome into `host`. */
  show(host: HTMLElement, biome: BiomeId, season: Season) {
    const key = `${biome}:${season}`;
    if (this.live?.key !== key) {
      this.live?.dispose();
      this.live = { ...islandScene(biome, season), key };
    }
    host.appendChild(this.renderer.domElement);
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      if (!this.renderer.domElement.isConnected) {
        this.running = false;
        return;
      }
      this.angle += ((t - last) / 1000) * 0.25;
      last = t;
      if (this.live) this.draw(this.live.scene, this.live.center, this.angle);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  dispose() {
    this.running = false;
    this.live?.dispose();
    this.live = null;
    this.renderer.dispose();
  }
}
