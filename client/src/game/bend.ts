// The Animal Crossing "rolling log" look: the world curves away from the
// player along the camera's viewing axis (world z). Implemented as a vertex
// shader patch so every material, sprite and shadow bends consistently.
// Optional wind sway for grass and foliage.

import * as THREE from 'three';

/** Curvature strength (0 = flat). Shared by every patched material. */
export const bendStrength = { value: 0.0085 };
/** World z of the point the camera focuses on (the player). */
export const bendFocusZ = { value: 0 };
/** Seconds, for wind animation. */
export const windTime = { value: 0 };

const HEADER = 'uniform float uBend;\nuniform float uBendZ;\nuniform float uTime;\n';

// World position of the vertex (works with and without instancing).
const WORLD = `
  #ifdef USE_INSTANCING
    vec4 hwWorld = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
  #else
    vec4 hwWorld = modelMatrix * vec4( transformed, 1.0 );
  #endif
`;
// Drop each vertex by k·Δz² along world-up, expressed in view space so it
// works for meshes, sprites and the shadow (light) camera alike.
const BEND = `
  {
    ${WORLD}
    float hwDz = hwWorld.z - uBendZ;
    vec3 hwUp = ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz;
    mvPosition.xyz -= hwUp * ( uBend * hwDz * hwDz );
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const SPRITE_BEND = `
  {
    vec4 hwCenter = modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
    float hwDz = hwCenter.z - uBendZ;
    vec3 hwUp = ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz;
    mvPosition.xyz -= hwUp * ( uBend * hwDz * hwDz );
  }
  gl_Position = projectionMatrix * mvPosition;
`;
// Wind: tips move more than roots (local y = height above the ground).
const SWAY = `
  #include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      vec2 hwP = instanceMatrix[3].xz;
    #else
      vec2 hwP = vec2( 0.0 );
    #endif
    float hwH = max( position.y, 0.0 );
    float hwS = sin( uTime * 1.7 + hwP.x * 0.6 + hwP.y * 0.45 ) * 0.5 + sin( uTime * 3.3 + hwP.x * 1.7 ) * 0.18;
    transformed.x += hwS * hwH * 0.35;
    transformed.z += hwS * hwH * 0.15;
  }
`;

export function bend<T extends THREE.Material>(material: T, opts: { sway?: boolean } = {}): T {
  const m = material as THREE.Material;
  m.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string }) => {
    // (uniform objects are shared, so changing .value updates every material)
    shader.uniforms.uBend = bendStrength;
    shader.uniforms.uBendZ = bendFocusZ;
    shader.uniforms.uTime = windTime;
    shader.vertexShader = HEADER + shader.vertexShader;
    if (opts.sway) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', SWAY);
    if (shader.vertexShader.includes('#include <project_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + BEND);
    } else {
      shader.vertexShader = shader.vertexShader.replace('gl_Position = projectionMatrix * mvPosition;', SPRITE_BEND);
    }
  };
  m.customProgramCacheKey = () => (opts.sway ? 'hw-bend-sway' : 'hw-bend');
  return material;
}

/** Depth material used for shadow casting – bent the same way. */
export const bentDepth = bend(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));

/** CPU-side twin of the shader, for things not drawn by WebGL (labels, raycasts). */
export function bendDrop(worldZ: number) {
  const dz = worldZ - bendFocusZ.value;
  return bendStrength.value * dz * dz;
}
