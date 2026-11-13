// Waves on the open sea: a few Gerstner waves displace the sea plane in the vertex
// shader (with matching normals, so the sun glints off the swell), fading out in
// shallow water so they never poke through beaches, river mouths or docks. The sea's
// depth colour is drawn in the same shader (a flat overlay would cut through the
// swell), and the sea-level layers above it (surf, river plumes) ride the same waves.
// waveY() is the CPU twin, for things floating on the water.

import * as THREE from 'three';
import { SEA_LEVEL, Tile, isFreshWater, type Grid, type Weather } from '@hearthwood/shared';
import { windTime } from '../bend.ts';
import { floorAt } from './common.ts';

/** [direction x, direction z, wavelength, amplitude, steepness]: a long swell and shorter chop across it. */
const WAVES: [number, number, number, number, number][] = [
  [0.8, 0.6, 9.5, 0.085, 0.55],
  [0.35, 0.94, 6.2, 0.055, 0.6],
  [-0.62, 0.78, 4.3, 0.035, 0.65],
  [0.96, -0.28, 3.1, 0.022, 0.7],
  [-0.25, -0.97, 2.2, 0.013, 0.7],
];
/** Slower than real water: calmer, cosier. */
const SPEED = 0.42;
const PHASES = [0, 1.7, 4.1, 2.6, 5.3];
/** Lighting sees the slopes this much steeper than they are (stylised: the swell has to read from above). */
const NORMAL_TILT = 2.6;

/** Depth texture: 0..1 stands for this many units of water depth. */
const DEPTH_MAX = 2.125;
const RES = 2; // samples per tile

export const waveUniforms = {
  uWaveAmp: { value: 1 },
  uWaveDepth: { value: null as THREE.DataTexture | null },
  /** Origin x, z of the depth texture and 1 / its size in world units. */
  uWaveRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  /** Deep-water colour (the old depth tint's). */
  uSeaDeep: { value: new THREE.Color('#0b3550') },
};

let cpuDepth: Uint8Array | null = null;
let cpuW = 0;
let cpuOrigin = 0;

/** How strongly the waves move here (0 in the shallows, 1 out in deep water). */
const depthFactor = (d: number) => {
  const t = Math.min(1, Math.max(0, (d - 0.3) / 1.1));
  return t * t * (3 - 2 * t);
};

/** Water depth under every point around the island, for the waves and the sea colour. */
export function setWaveDepth(g: Grid, pad: number, color: string) {
  const W = (g.size + 2 * pad) * RES + 1;
  const data = new Uint8Array(W * W);
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      const px = i / RES - pad, pz = j / RES - pad;
      const x = Math.floor(px), z = Math.floor(pz);
      const t = g.tile(x, z);
      const wet = t === Tile.Sea || (g.isCoastal(x, z) && (t === Tile.River || t === Tile.Shore)) || (isFreshWater(t) && g.level(x, z) === 0);
      let d = wet ? SEA_LEVEL - floorAt(g, px, pz) : 0;
      // Piers stand in calm water (a crest must never come up through the deck).
      for (let dz = -1; dz <= 1 && d > 0; dz++) for (let dx = -1; dx <= 1; dx++) if (g.tile(x + dx, z + dz) === Tile.Dock) d = Math.min(d, dx || dz ? 0.6 : 0.2);
      data[j * W + i] = Math.round(Math.min(1, Math.max(0, d / DEPTH_MAX)) * 255);
    }
  const old = waveUniforms.uWaveDepth.value;
  const tex = new THREE.DataTexture(data, W, W, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  waveUniforms.uWaveDepth.value = tex;
  // Texel centres: sample i sits at world -pad + i / RES.
  const size = (W - 1) / RES + 1 / RES;
  waveUniforms.uWaveRect.value.set(-pad - 0.5 / RES, -pad - 0.5 / RES, 1 / size, 1 / size);
  old?.dispose();
  waveUniforms.uSeaDeep.value.set(color).lerp(new THREE.Color('#06213d'), 0.75);
  cpuDepth = data;
  cpuW = W;
  cpuOrigin = pad;
}

const WEATHER_AMP: Record<Weather, number> = { clear: 0.8, cloudy: 1, rain: 1.15, storm: 1.9, snow: 0.95, fog: 0.6, sandstorm: 1.3, heatwave: 0.6 };
/** Ease the sea towards the weather's mood (bigger swell in storms). */
export function updateSeaState(weather: Weather | undefined, intensity: number, dt: number) {
  const target = (WEATHER_AMP[weather ?? 'clear'] ?? 1) * (0.85 + 0.3 * intensity);
  const u = waveUniforms.uWaveAmp;
  u.value += (target - u.value) * Math.min(1, dt * 0.15);
}

/** Height of the waves at a point (CPU twin of the shader, vertical part only). */
export function waveY(x: number, z: number, t = windTime.value): number {
  let d = 2;
  if (cpuDepth) {
    const i = Math.round((x + cpuOrigin) * RES), j = Math.round((z + cpuOrigin) * RES);
    if (i >= 0 && j >= 0 && i < cpuW && j < cpuW) d = (cpuDepth[j * cpuW + i] / 255) * DEPTH_MAX;
  }
  const f = depthFactor(d) * waveUniforms.uWaveAmp.value;
  if (f <= 0) return 0;
  let y = 0;
  WAVES.forEach(([dx, dz, L, A], k) => {
    const kk = (2 * Math.PI) / L, w = Math.sqrt(9.8 * kk) * SPEED;
    y += A * f * Math.sin(kk * (dx * x + dz * z) - w * t + PHASES[k]);
  });
  return y;
}

const f = (v: number) => v.toFixed(5);
const WAVE_GLSL = `
uniform sampler2D uWaveDepth;
uniform vec4 uWaveRect;
uniform float uWaveAmp;
varying float vHwDepth;
varying float vHwCrest;
varying vec2 vHwXZ;
float hwSeaDepth(vec2 p) {
  vec2 uv = (p - uWaveRect.xy) * uWaveRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 2.0;
  return texture2D(uWaveDepth, uv).r * ${f(DEPTH_MAX)};
}
vec3 hwWaves(vec2 p, float amp, out vec3 nrm, out float crest) {
  vec3 d = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float hmax = 0.0;
  ${WAVES.map(([dx, dz, L, A, Q], k) => {
    const len = Math.hypot(dx, dz), kk = (2 * Math.PI) / L, w = Math.sqrt(9.8 * kk) * SPEED;
    return `{
    vec2 dir = vec2(${f(dx / len)}, ${f(dz / len)});
    float a = ${f(A)} * amp;
    float th = ${f(kk)} * dot(dir, p) - ${f(w)} * uTime + ${f(PHASES[k])};
    float c = cos(th), s = sin(th);
    d.xz += ${f(Q)} * a * dir * c;
    d.y += a * s;
    n.xz -= dir * ${f(kk)} * a * c;
    n.y -= ${f(Q * kk)} * a * s;
    hmax += a;
  }`;
  }).join('\n  ')}
  nrm = normalize(vec3(n.x * ${f(NORMAL_TILT)}, n.y, n.z * ${f(NORMAL_TILT)})); // tilted more than real, so the swell reads
  crest = hmax > 1e-4 ? d.y / hmax : 0.0;
  return d;
}
`;

/** Patch a sea-level material so it rides the waves (`normals`: lit materials get the wave normals too). */
export function wavy<T extends THREE.Material>(material: T, normals = false): T {
  const m = material as THREE.Material;
  const inner = m.onBeforeCompile;
  const innerKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, r: unknown) => {
    (inner as ((s: unknown, r: unknown) => void) | undefined)?.call(m, shader, r);
    Object.assign(shader.uniforms, waveUniforms, { uTime: windTime });
    let vs = shader.vertexShader;
    if (!vs.includes('uniform float uTime;')) vs = 'uniform float uTime;\n' + vs;
    vs = vs.replace('void main() {', `${WAVE_GLSL}
void main() {
  vec4 hwWP = modelMatrix * vec4(position, 1.0);
  vHwXZ = hwWP.xz;
  vHwDepth = hwSeaDepth(hwWP.xz);
  float hwF = smoothstep(0.3, 1.4, vHwDepth) * uWaveAmp;
  vec3 hwN;
  vec3 hwD = hwWaves(hwWP.xz, hwF, hwN, vHwCrest);`);
    if (normals) vs = vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = hwN;');
    vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += hwD;');
    shader.vertexShader = vs;
  };
  m.customProgramCacheKey = () => `${innerKey ? innerKey() : ''}|hw-waves${normals ? 'N' : ''}`;
  return material;
}

/**
 * The sea itself: waves, the depth colour (clear in the shallows, dark out at sea),
 * fine ripples that keep the light moving, and whitecaps on big crests in a storm.
 */
export function seaMaterial<T extends THREE.Material>(material: T): T {
  const m = wavy(material, true) as THREE.Material;
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, r: unknown) => {
    (inner as (s: unknown, r: unknown) => void).call(m, shader, r);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uTime;
uniform float uWaveAmp;
uniform vec3 uSeaDeep;
varying float vHwDepth;
varying float vHwCrest;
varying vec2 vHwXZ;
float hwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hwNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hwHash(i), hwHash(i + vec2(1.0, 0.0)), u.x), mix(hwHash(i + vec2(0.0, 1.0)), hwHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float hwRipple(vec2 q) {
  return hwNoise(q + uTime * vec2(0.23, 0.11)) + 0.5 * hwNoise(q * 2.3 - uTime * vec2(0.13, -0.19));
}
float hwLines(vec2 p, float amp) {
  float o = 0.0;
  ${WAVES.slice(0, 2).map(([dx, dz, L], k) => {
    const len = Math.hypot(dx, dz), kk = (2 * Math.PI) / L, w = Math.sqrt(9.8 * kk) * SPEED;
    return `{
    float th = ${f(kk)} * dot(vec2(${f(dx / len)}, ${f(dz / len)}), p) - ${f(w)} * uTime + ${f(PHASES[k])};
    float n = floor((th - 1.5708) / 6.2832 + 0.5);
    th += (hwNoise(p * 0.45 + ${k * 3}.0) - 0.5) * 1.1; // gently wavy, not ruler-straight
    float line = smoothstep(0.982, 0.998, sin(th));
    float pieces = smoothstep(0.5, 0.72, hwNoise(p * ${f(0.28 + k * 0.07)} + vec2(n * 3.7, n * 1.3 + ${k * 5}.0)));
    o = max(o, line * pieces * ${f(1 - k * 0.35)});
  }`;
  }).join('\n  ')}
  return o * amp;
}
void main() {`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // Fine ripples on top of the swell (keep the sun's glitter moving).
    vec2 q = vHwXZ * 2.2;
    float e = 0.06;
    float r0 = hwRipple(q);
    vec3 pw = vec3(r0 - hwRipple(q + vec2(e, 0.0)), 0.0, r0 - hwRipple(q + vec2(0.0, e))) / e * 0.045 * (0.6 + 0.4 * uWaveAmp);
    normal = normalize(normal + (viewMatrix * vec4(pw, 0.0)).xyz);
  }`)
      .replace('#include <opaque_fragment>', `
  {
    // Depth colour, as the separate tint layer used to draw it: clear shallows, dark open sea.
    float t = clamp((vHwDepth - 0.08) / 1.3, 0.0, 1.0);
    float a = 0.78 * t * t * (3.0 - 2.0 * t);
    float sa = diffuseColor.a;
    // Out where the sea floor can't be seen anyway, fully opaque (nothing shows through past the island's terrain).
    float oa = mix(1.0 - (1.0 - sa) * (1.0 - a), 1.0, smoothstep(1.0, 1.4, vHwDepth));
    // The dark water is lit too, so the swell's slopes show out at sea.
    float lum = dot(diffuseColor.rgb, vec3(0.3333)) + 1e-3;
    float shade = clamp(dot(totalDiffuse, vec3(0.3333)) / lum / 0.8, 0.25, 1.5);
    vec3 base = (uSeaDeep * shade * a + (totalDiffuse + totalEmissiveRadiance) * sa * (1.0 - a)) / max(oa, 1e-3);
    // Crests a touch lighter, troughs darker; thin highlight lines along the swell's crests.
    float wf = smoothstep(0.3, 1.4, vHwDepth);
    base *= 1.0 + 0.16 * vHwCrest * wf * min(uWaveAmp, 1.5);
    float hl = hwLines(vHwXZ, wf * (0.55 + 0.45 * min(uWaveAmp, 1.6)));
    base = mix(base, vec3(0.85, 0.94, 0.98) * max(shade, 0.35), hl * 0.3);
    // Whitecaps on the biggest crests when the sea is rough.
    float cap = smoothstep(0.62, 0.95, vHwCrest) * smoothstep(1.05, 1.7, uWaveAmp) * smoothstep(0.9, 1.6, vHwDepth);
    cap *= smoothstep(0.45, 0.75, hwNoise(vHwXZ * 1.7 + uTime * vec2(0.05, 0.08)));
    base = mix(base, vec3(0.92, 0.96, 0.98) * shade, cap * 0.75);
    gl_FragColor = vec4(base + totalSpecular, max(oa, cap * 0.9));
  }`);
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `${key ? key() : ''}|hw-sea`;
  return material;
}
