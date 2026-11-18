// Fewer draw calls for models made of many small parts.
//
// The procedural and kit models are assembled from parts (a box here, a cylinder
// there, every body part and piece of clothing of a character): one draw call each,
// and one more each in the shadow pass. Two ways to draw them in a few calls:
//
//  · mergeStatic – parts that never move (buildings, furniture) are baked into one
//    geometry per material.
//  · RigidSkin – parts that move as rigid pieces (characters, birds) are merged into
//    one skinned mesh per material, with the part nodes themselves as the bones. The
//    animation keeps moving the same nodes as before; the GPU places the vertices.
//
// In both, parts whose material is just a colour (see plainColor) take the colour into
// their vertices and share one material, so any number of colours is one draw call.
// (Not used for instanced meshes: some GPUs draw vertex-coloured instances black.)

import * as THREE from 'three';
import { KEEP } from './batching.ts';
import { bend, bentDepth } from './bend.ts';
import { own } from './gpu.ts';

interface Source {
  mesh: THREE.Mesh;
  /** Baked into the vertices (static merge). */
  matrix: THREE.Matrix4 | null;
  /** Index of the part's bone (rigid skin). */
  bone: number;
  /** Mirrored part: its triangles are wound the other way round. */
  flip: boolean;
  /** Colour written into the vertices (plain materials). */
  color: THREE.Color | null;
}

interface Group {
  material: THREE.Material;
  cast: boolean;
  receive: boolean;
  sources: Source[];
}

const v = new THREE.Vector3();
const n3 = new THREE.Matrix3();
const m4 = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const IDENTITY = new THREE.Matrix4();

/** Meshes that can go into a merged geometry at all. */
function mergeable(mesh: THREE.Mesh) {
  if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return false;
  const material = mesh.material as THREE.Material | THREE.Material[];
  if (Array.isArray(material) || material.transparent) return false; // see-through parts keep their own draw order
  const geo = mesh.geometry as THREE.BufferGeometry;
  if (!geo.attributes.position || mesh.morphTargetInfluences || Object.keys(geo.morphAttributes).length) return false;
  return true;
}

const vertexColored = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Is the material nothing but a colour (no texture, no glow, not see-through)? Then
 * its parts can take the colour into their vertices and be drawn with the shared
 * material returned here – one per kind of surface, whatever the colours.
 */
function plainColor(m: THREE.Material): THREE.MeshStandardMaterial | null {
  const s = m as THREE.MeshStandardMaterial;
  if (m.type !== 'MeshStandardMaterial' || m.vertexColors || m.transparent || m.alphaTest > 0 || m.customProgramCacheKey() !== 'hw-bend') return null;
  if (s.map || s.normalMap || s.emissiveMap || s.roughnessMap || s.metalnessMap || s.alphaMap || s.aoMap || s.bumpMap || s.envMap) return null;
  if (s.emissive.getHex() !== 0) return null; // (also the window glass, whose glow is turned up at night)
  // (roughness in steps of 0.1: no visible difference on these matt surfaces, and far fewer kinds)
  const rough = Math.round(s.roughness * 10) / 10, metal = Math.round(s.metalness * 10) / 10;
  const key = `${s.flatShading ? 'f' : 's'}|${rough}|${metal}|${m.side}`;
  let shared = vertexColored.get(key);
  if (!shared) {
    shared = bend(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: rough, metalness: metal, flatShading: s.flatShading, side: m.side }));
    vertexColored.set(key, shared);
  }
  return shared;
}

/** Everything about a material that changes how it is drawn: equal signatures can share a draw call. */
function signature(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial;
  return [
    m.type, s.color?.getHex(), s.map?.id, s.normalMap?.id, s.normalScale?.x, s.roughness, s.metalness, s.emissive?.getHex(), s.emissiveIntensity,
    s.emissiveMap?.id, s.flatShading, m.vertexColors, m.side, m.alphaTest, m.depthWrite, m.blending, m.customProgramCacheKey(),
  ].join('|');
}

function addToGroup(groups: Map<string, Group>, src: Source, bySignature: boolean) {
  const mesh = src.mesh;
  const material = mesh.material as THREE.Material;
  const flags = `${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`;
  const plain = plainColor(material);
  let key: string, shared: THREE.Material;
  if (plain) {
    key = `plain|${plain.uuid}|${flags}`;
    shared = plain;
    src.color = (material as THREE.MeshStandardMaterial).color;
  } else {
    key = `${bySignature ? signature(material) : material.uuid}|${flags}`;
    shared = material;
  }
  let g = groups.get(key);
  if (!g) groups.set(key, (g = { material: shared, cast: mesh.castShadow, receive: mesh.receiveShadow, sources: [] }));
  g.sources.push(src);
}

const withNormals = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();
/** The normals of a geometry, worked out once when a smooth-shaded part comes without. */
function normalsOf(geo: THREE.BufferGeometry): THREE.BufferAttribute {
  let a = (geo.attributes.normal as THREE.BufferAttribute | undefined) ?? withNormals.get(geo);
  if (!a) {
    const tmp = geo.clone();
    tmp.computeVertexNormals();
    a = tmp.attributes.normal as THREE.BufferAttribute;
    withNormals.set(geo, a);
  }
  return a;
}

/** One geometry out of the sources of a group. `skin`: with bone indices instead of baked positions. */
function buildGeometry(g: Group, skin: boolean): THREE.BufferGeometry {
  const smooth = !(g.material as THREE.MeshStandardMaterial).flatShading;
  let verts = 0, indices = 0, anyNormal = false, anyUv = false, anyColor = false;
  for (const s of g.sources) {
    const geo = s.mesh.geometry as THREE.BufferGeometry;
    const count = geo.attributes.position.count;
    verts += count;
    indices += geo.index ? geo.index.count : count;
    if (geo.attributes.normal) anyNormal = true;
    if (geo.attributes.uv) anyUv = true;
    if (s.color || (g.material.vertexColors && geo.attributes.color)) anyColor = true;
  }
  const needNormal = anyNormal || smooth;
  const position = new Float32Array(verts * 3);
  const normal = needNormal ? new Float32Array(verts * 3) : null;
  const uv = anyUv ? new Float32Array(verts * 2) : null;
  const color = anyColor ? new Float32Array(verts * 3).fill(1) : null;
  const skinIndex = skin ? new Uint16Array(verts * 4) : null;
  const skinWeight = skin ? new Uint8Array(verts * 4) : null;
  const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let vo = 0, io = 0;
  for (const s of g.sources) {
    const geo = s.mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i);
      if (s.matrix) v.applyMatrix4(s.matrix);
      position[(vo + i) * 3] = v.x;
      position[(vo + i) * 3 + 1] = v.y;
      position[(vo + i) * 3 + 2] = v.z;
    }
    if (normal && (geo.attributes.normal || smooth)) {
      const src = normalsOf(geo);
      if (s.matrix) n3.getNormalMatrix(s.matrix);
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(src, i);
        if (s.matrix) v.applyMatrix3(n3).normalize();
        normal[(vo + i) * 3] = v.x;
        normal[(vo + i) * 3 + 1] = v.y;
        normal[(vo + i) * 3 + 2] = v.z;
      }
    }
    const suv = geo.attributes.uv as THREE.BufferAttribute | undefined;
    if (uv && suv) {
      for (let i = 0; i < count; i++) {
        uv[(vo + i) * 2] = suv.getX(i);
        uv[(vo + i) * 2 + 1] = suv.getY(i);
      }
    }
    if (color) {
      const sc = geo.attributes.color as THREE.BufferAttribute | undefined;
      if (s.color) {
        for (let i = 0; i < count; i++) {
          color[(vo + i) * 3] = s.color.r;
          color[(vo + i) * 3 + 1] = s.color.g;
          color[(vo + i) * 3 + 2] = s.color.b;
        }
      } else if (sc && g.material.vertexColors) {
        for (let i = 0; i < count; i++) {
          color[(vo + i) * 3] = sc.getX(i);
          color[(vo + i) * 3 + 1] = sc.getY(i);
          color[(vo + i) * 3 + 2] = sc.getZ(i);
        }
      }
    }
    if (skinIndex && skinWeight) {
      for (let i = 0; i < count; i++) {
        skinIndex[(vo + i) * 4] = s.bone;
        skinWeight[(vo + i) * 4] = 255;
      }
    }
    const si = geo.index;
    const tris = (si ? si.count : count) / 3;
    for (let t = 0; t < tris; t++) {
      const a = si ? si.getX(t * 3) : t * 3, b = si ? si.getX(t * 3 + 1) : t * 3 + 1, c = si ? si.getX(t * 3 + 2) : t * 3 + 2;
      index[io++] = vo + a;
      index[io++] = vo + (s.flip ? c : b);
      index[io++] = vo + (s.flip ? b : c);
    }
    vo += count;
  }
  const out = own(new THREE.BufferGeometry());
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  if (normal) out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  if (skinIndex && skinWeight) {
    out.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4, true));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

// ── Static models ────────────────────────────────────────────────────────────

/** Named so they stay out of the instanced batches, but they never move: fine to bake. */
const STILL = /^(window|bulb)$/;

function moves(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.name && KEEP.test(p.name) && !STILL.test(p.name)) return true;
  return false;
}

/**
 * Bake the parts of `root` that never move into one mesh per material (see the top
 * of the file). Moving and looked-up parts (the names in batching.ts) stay as they
 * are. Call it on a finished model, before it is shown.
 */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const groups = new Map<string, Group>();
  const inv = m4.copy(root.matrixWorld).invert();
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mergeable(mesh)) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    if (moves(o, root)) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    addToGroup(groups, { mesh, matrix, bone: 0, flip: matrix.determinant() < 0, color: null }, false);
  });
  for (const g of groups.values()) {
    if (g.sources.length < 2 && !g.sources[0].color) continue; // nothing to gain
    const geo = buildGeometry(g, false);
    const merged = new THREE.Mesh(geo, g.material);
    merged.name = 'merged';
    merged.castShadow = g.cast;
    merged.receiveShadow = g.receive;
    if (g.cast) merged.customDepthMaterial = bentDepth;
    for (const s of g.sources) s.mesh.removeFromParent();
    root.add(merged);
  }
}

/**
 * A placed model that stays where it is: work its matrices out once instead of every
 * frame (three.js otherwise recomputes every node's matrix each frame). Its moving
 * parts – the names in batching.ts – keep updating.
 */
export function freeze(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const walk = (o: THREE.Object3D) => {
    if (o !== root && o.name && KEEP.test(o.name) && !STILL.test(o.name)) return;
    o.matrixAutoUpdate = false;
    for (const c of o.children) walk(c);
  };
  walk(root);
}

// ── Rigid parts that move ────────────────────────────────────────────────────

/** Not drawn by any camera: the layer of parts that a RigidSkin draws instead. */
const SKINNED_LAYER = 31;

/** Sign of the scale between a part and the model root (a mirrored part has -1). */
function mirrored(o: THREE.Object3D, root: THREE.Object3D) {
  let sign = 1;
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) {
    const s = p.scale.x * p.scale.y * p.scale.z;
    if (s < 0) sign = -sign;
  }
  return sign < 0;
}

/** The part's transform in the root's space, from the nodes' own position/rotation/scale. */
function toRoot(o: THREE.Object3D, root: THREE.Object3D, out: THREE.Matrix4) {
  out.identity();
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) out.premultiply(m4b.compose(p.position, p.quaternion, p.scale));
  return out;
}

/**
 * Add one to a model made of rigid moving parts (`model.add(new RigidSkin())`): from
 * then on its visible parts are drawn as one skinned mesh per material. Nothing else
 * changes for the model's code – it shows, hides, adds and animates the same nodes as
 * before, and the skin follows by itself (it is rebuilt whenever the set of visible
 * parts changes: a hat goes on, a tool is swapped…).
 */
export class RigidSkin extends THREE.Object3D {
  private sig = Number.NaN;
  private readonly parts: THREE.Mesh[] = [];
  private readonly replaced: THREE.Mesh[] = [];
  private skeleton: THREE.Skeleton | null = null;

  constructor() {
    super();
    this.name = 'rigid-skin';
    this.userData.dispose = () => this.release();
    // three.js updates every matrix of a scene before drawing it: the hook that keeps
    // the skin up to date once per frame, in whatever scene the model is shown.
    const update = THREE.Object3D.prototype.updateMatrixWorld;
    this.updateMatrixWorld = (force?: boolean) => {
      this.refresh();
      update.call(this, force);
    };
  }

  private collect(o: THREE.Object3D) {
    if (!o.visible || o === this) return;
    const mesh = o as THREE.Mesh;
    if (mergeable(mesh)) this.parts.push(mesh);
    for (const c of o.children) this.collect(c);
  }

  private refresh() {
    const root = this.parent;
    if (!root?.visible) return;
    this.parts.length = 0;
    this.collect(root);
    let h = this.parts.length;
    for (const m of this.parts) h = (Math.imul(h, 31) + m.id * 7 + (m.geometry as THREE.BufferGeometry).id * 3 + (m.material as THREE.Material).id) | 0;
    if (h === this.sig) return;
    this.rebuild(root);
    this.sig = h;
  }

  private rebuild(root: THREE.Object3D) {
    this.release();
    const groups = new Map<string, Group>();
    const bones: THREE.Object3D[] = [];
    for (const mesh of this.parts) addToGroup(groups, { mesh, matrix: null, bone: 0, flip: mirrored(mesh, root), color: null }, true);
    // (a part alone in its group is as cheap drawn by itself)
    for (const [key, g] of groups) if (g.sources.length < 2 && !g.sources[0].color) groups.delete(key);
    if (!groups.size) return;
    const bounds = new THREE.Sphere();
    const part = new THREE.Sphere();
    let first = true;
    for (const g of groups.values()) {
      for (const s of g.sources) {
        s.bone = bones.length;
        bones.push(s.mesh);
        const geo = s.mesh.geometry as THREE.BufferGeometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        part.copy(geo.boundingSphere!).applyMatrix4(toRoot(s.mesh, root, m4));
        if (part.radius > 0) {
          if (first) bounds.copy(part);
          else bounds.union(part);
          first = false;
        }
      }
    }
    // Generous: limbs swing, props pop up, and it only decides whether to draw at all.
    bounds.radius = bounds.radius * 1.4 + 0.6;
    const skeleton = (this.skeleton = new THREE.Skeleton(bones as THREE.Bone[], bones.map(() => new THREE.Matrix4())));
    for (const g of groups.values()) {
      const skinned = new THREE.SkinnedMesh(buildGeometry(g, true), g.material);
      // The bones are the parts themselves and the vertices stay in each part's own
      // space, so there is no bind pose to undo: identity all the way.
      skinned.bind(skeleton, IDENTITY);
      skinned.castShadow = g.cast;
      skinned.receiveShadow = g.receive;
      if (g.cast) skinned.customDepthMaterial = bentDepth;
      // (given, not measured: three.js would otherwise skin every vertex on the CPU to find them)
      skinned.boundingSphere = bounds.clone();
      skinned.boundingBox = bounds.getBoundingBox(new THREE.Box3());
      this.add(skinned);
      for (const s of g.sources) {
        s.mesh.layers.set(SKINNED_LAYER);
        this.replaced.push(s.mesh);
      }
    }
  }

  /** Back to the plain parts (also when the model is disposed). */
  private release() {
    for (const m of this.replaced) m.layers.set(0);
    this.replaced.length = 0;
    for (const c of [...this.children]) {
      ((c as THREE.Mesh).geometry as THREE.BufferGeometry).dispose();
      c.removeFromParent();
    }
    this.skeleton?.dispose();
    this.skeleton = null;
    this.sig = Number.NaN; // (rebuilt if the model is shown again after all)
  }
}
