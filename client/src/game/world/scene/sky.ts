// The scenery around every island: the sea plane, stars, northern lights and the
// rain / snow particles. Built once when the World starts.

import * as THREE from 'three';
import { bend } from '../../bend.ts';
import { auroraTexture, WATER_Y } from '../common.ts';
import { seaMaterial } from '../../water/waves.ts';

/**
 * Light and fairly clear in the shallows, dark out at sea, with rolling waves
 * (water/waves.ts). Half-unit grid, so the shortest waves stay smooth; it travels
 * with the player in steps of 2, a whole number of cells, so the waves don't swim.
 */
export function createSea(): THREE.Mesh {
  const wg = new THREE.PlaneGeometry(220, 220, 440, 440);
  wg.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wg, seaMaterial(bend(new THREE.MeshStandardMaterial({ color: '#4fb7d8', transparent: true, opacity: 0.66, roughness: 0.25, metalness: 0.05 }))));
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  return water;
}

export function createStars(): THREE.Points {
  const sp = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 0.9);
    sp[i * 3] = Math.sin(ph) * Math.cos(th) * 150;
    sp[i * 3 + 1] = Math.cos(ph) * 150;
    sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 150;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  return new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
}

/**
 * Northern lights: curtains of light hung in the sky band above the curved
 * horizon. They live in camera space (always in view, behind the land) and ripple slowly.
 */
export function createAurora(): THREE.Group {
  const aurora = new THREE.Group();
  const curtainTex = auroraTexture();
  const tints = ['#5dffa8', '#3cf0c0', '#9d7dff'];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(420, 70, 90, 1);
    const tex = curtainTex.clone();
    tex.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: tex, color: tints[i], transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(-30 + i * 40, 30 + i * 12, -220 - i * 25);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    mesh.userData.base = Float32Array.from((g.attributes.position as THREE.BufferAttribute).array as Float32Array);
    aurora.add(mesh);
  }
  return aurora;
}

/** Rain and snow: falling points that the environment update moves. */
export function createRain(): { rain: THREE.Points; vel: Float32Array } {
  const N = 1600;
  const rp = new Float32Array(N * 3);
  const vel = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rp[i * 3] = (Math.random() - 0.5) * 40;
    rp[i * 3 + 1] = Math.random() * 20;
    rp[i * 3 + 2] = (Math.random() - 0.5) * 40;
    vel[i] = 0.7 + Math.random() * 0.6;
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.Points(rg, bend(new THREE.PointsMaterial({ color: '#cfe8ff', size: 0.08, transparent: true, opacity: 0.8, depthWrite: false })));
  rain.visible = false;
  rain.frustumCulled = false;
  return { rain, vel };
}
