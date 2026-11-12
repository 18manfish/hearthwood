// The Animal Crossing "rolling log" look: the world curves away from the
// player along the camera's viewing axis (world z). Implemented as a vertex
// shader patch so every material, sprite and shadow bends consistently.

import * as THREE from 'three';

/** Curvature strength (0 = flat). Shared by every patched material. */
export const bendStrength = { value: 0.0085 };
/** World z of the point the camera focuses on (the player). */
export const bendFocusZ = { value: 0 };

const HEADER = 'uniform float uBend;\nuniform float uBendZ;\n';
// Drop each vertex by k·Δz² along world-up, expressed in view space so it
// works for meshes, sprites and the shadow (light) camera alike.
const BEND = `
  {
    vec4 hwWorld = modelMatrix * vec4( transformed, 1.0 );
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

export function bend<T extends THREE.Material>(material: T): T {
  const m = material as THREE.Material;
  m.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string }) => {
    shader.uniforms.uBend = bendStrength;
    shader.uniforms.uBendZ = bendFocusZ;
    // (uniform objects are shared, so changing .value updates every material)
    shader.vertexShader = HEADER + shader.vertexShader;
    if (shader.vertexShader.includes('#include <project_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + BEND);
    } else {
      shader.vertexShader = shader.vertexShader.replace('gl_Position = projectionMatrix * mvPosition;', SPRITE_BEND);
    }
  };
  m.customProgramCacheKey = () => 'hw-bend';
  return material;
}

/** Depth material used for shadow casting – bent the same way. */
export const bentDepth = bend(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));

/** CPU-side twin of the shader, for things not drawn by WebGL (labels, raycasts). */
export function bendDrop(worldZ: number) {
  const dz = worldZ - bendFocusZ.value;
  return bendStrength.value * dz * dz;
}
