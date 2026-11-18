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
import { bend, bentDepth } from './bend.ts';
import { own } from './gpu.ts';
import { isMovingPart, plainMeshes } from './parts.ts';

// ── Grouping parts that can share a draw call ────────────────────────────────

interface Part {
  mesh: THREE.Mesh;
  /** Static merge: where the part sits in the model, baked into its vertices. */
  bake: THREE.Matrix4 | null;
  /** A mirrored part: its triangles are wound the other way round. */
  flip: boolean;
}

interface Group {
  material: THREE.Material;
  /** The parts' own colours go into the vertices (`material` is the shared vertex-colour one). */
  colored: boolean;
  cast: boolean;
  receive: boolean;
  parts: Part[];
}

/** See-through parts keep their own mesh (and with it their draw order). */
const opaque = (mesh: THREE.Mesh) => !(mesh.material as THREE.Material).transparent;

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

/** Everything about a material that changes how it is drawn: materials that look the same can share a draw call. */
function look(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial;
  return [
    m.type, s.color?.getHex(), s.map?.id, s.normalMap?.id, s.normalScale?.x, s.roughness, s.metalness, s.emissive?.getHex(), s.emissiveIntensity,
    s.emissiveMap?.id, s.flatShading, m.vertexColors, m.side, m.alphaTest, m.depthWrite, m.blending, m.customProgramCacheKey(),
  ].join('|');
}

/**
 * Sort parts into groups that can each be one mesh: same material (as told by `same`)
 * and same shadow behaviour. A part alone in its group is left out – it is as cheap
 * drawn by itself.
 */
function groupParts(parts: Part[], same: (m: THREE.Material) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const part of parts) {
    const { mesh } = part;
    const material = mesh.material as THREE.Material;
    const plain = plainColor(material);
    const key = `${plain ? plain.uuid : same(material)}|${mesh.castShadow}|${mesh.receiveShadow}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material: plain ?? material, colored: !!plain, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] }));
    g.parts.push(part);
  }
  return [...groups.values()].filter((g) => g.parts.length > 1);
}

/** A merged mesh casts and receives shadows like the parts it stands for. */
function likeItsParts(merged: THREE.Mesh, g: Group) {
  merged.castShadow = g.cast;
  merged.receiveShadow = g.receive;
  if (g.cast) merged.customDepthMaterial = bentDepth;
}

// ── One geometry out of a group ──────────────────────────────────────────────

const v = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();
const geometryOf = (p: Part) => p.mesh.geometry as THREE.BufferGeometry;
const vertexCount = (p: Part) => geometryOf(p).attributes.position.count;

function copy(to: THREE.BufferAttribute, at: number, from: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  for (let i = 0; i < from.count; i++) for (let c = 0; c < to.itemSize; c++) to.setComponent(at + i, c, from.getComponent(i, c));
}

function each(a: THREE.BufferAttribute, at: number, count: number, change: (v: THREE.Vector3) => void) {
  for (let i = at; i < at + count; i++) {
    change(v.fromBufferAttribute(a, i));
    a.setXYZ(i, v.x, v.y, v.z);
  }
}

const computedNormals = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();
/** The normals of a geometry – worked out (once) when a smooth-shaded part comes without. */
function normalsOf(geo: THREE.BufferGeometry) {
  let normals = geo.attributes.normal ?? computedNormals.get(geo);
  if (!normals) {
    const tmp = geo.clone();
    tmp.computeVertexNormals();
    computedNormals.set(geo, (normals = tmp.attributes.normal as THREE.BufferAttribute));
  }
  return normals;
}

function mergedGeometry(g: Group): THREE.BufferGeometry {
  const out = own(new THREE.BufferGeometry());
  const verts = g.parts.reduce((n, p) => n + vertexCount(p), 0);
  const has = (name: string) => g.parts.some((p) => name in geometryOf(p).attributes);
  const attribute = (name: string, size: number, fill = 0) => {
    const a = new THREE.BufferAttribute(new Float32Array(verts * size).fill(fill), size);
    out.setAttribute(name, a);
    return a;
  };
  const smooth = !(g.material as THREE.MeshStandardMaterial).flatShading;
  const position = attribute('position', 3);
  const normal = smooth || has('normal') ? attribute('normal', 3) : null; // (flat shading works its normals out per pixel)
  const uv = has('uv') ? attribute('uv', 2) : null;
  const color = g.colored || (g.material.vertexColors && has('color')) ? attribute('color', 3, 1) : null;
  const index: number[] = [];
  let at = 0;
  for (const part of g.parts) {
    const geo = geometryOf(part);
    const count = vertexCount(part);
    copy(position, at, geo.attributes.position);
    if (normal && (smooth || geo.attributes.normal)) copy(normal, at, normalsOf(geo));
    if (uv && geo.attributes.uv) copy(uv, at, geo.attributes.uv);
    if (color && g.colored) {
      const tint = (part.mesh.material as THREE.MeshStandardMaterial).color;
      each(color, at, count, (c) => c.set(tint.r, tint.g, tint.b));
    } else if (color && geo.attributes.color) {
      copy(color, at, geo.attributes.color);
    }
    if (part.bake) {
      const bake = part.bake;
      each(position, at, count, (p) => p.applyMatrix4(bake));
      normalMatrix.getNormalMatrix(bake);
      if (normal) each(normal, at, count, (n) => n.applyMatrix3(normalMatrix).normalize());
    }
    const corner = geo.index ? (i: number) => at + geo.index!.getX(i) : (i: number) => at + i;
    const corners = geo.index ? geo.index.count : count;
    for (let i = 0; i < corners; i += 3) index.push(corner(i), corner(part.flip ? i + 2 : i + 1), corner(part.flip ? i + 1 : i + 2));
    at += count;
  }
  out.setIndex(index); // (three.js picks 16 or 32 bit)
  return out;
}

// ── Static models ────────────────────────────────────────────────────────────

/**
 * Bake the parts of `root` that never move into one mesh per material (see the top
 * of the file). Moving parts (parts.ts) stay as they are. Call it on a finished
 * model, before it is shown.
 */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const parts = plainMeshes(root, isMovingPart).filter(opaque).map((mesh): Part => {
    const bake = toRoot.clone().multiply(mesh.matrixWorld);
    return { mesh, bake, flip: bake.determinant() < 0 };
  });
  for (const g of groupParts(parts, (m) => m.uuid)) {
    for (const p of g.parts) p.mesh.removeFromParent();
    const merged = new THREE.Mesh(mergedGeometry(g), g.material);
    merged.name = 'merged';
    likeItsParts(merged, g);
    root.add(merged);
  }
}

/**
 * A placed model that stays where it is: work its matrices out once instead of every
 * frame (three.js otherwise recomputes every node's matrix each frame). Its moving
 * parts keep updating.
 */
export function freeze(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const walk = (o: THREE.Object3D) => {
    if (o !== root && isMovingPart(o)) return;
    o.matrixAutoUpdate = false;
    o.children.forEach(walk);
  };
  walk(root);
}

// ── Rigid parts that move ────────────────────────────────────────────────────

/** Not drawn by any camera: the layer of parts that a RigidSkin draws instead. */
const SKINNED_LAYER = 31;
const IDENTITY = new THREE.Matrix4();
const m4 = new THREE.Matrix4();

/** Is the part mirrored within its model (an odd number of negative scales on the way up)? */
function mirrored(o: THREE.Object3D, root: THREE.Object3D) {
  let flip = false;
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.scale.x * p.scale.y * p.scale.z < 0) flip = !flip;
  return flip;
}

/** A sphere around the parts as they stand now, in the model's space. */
function boundsOf(parts: Part[], root: THREE.Object3D) {
  const bounds = new THREE.Sphere().makeEmpty();
  const one = new THREE.Sphere();
  const place = new THREE.Matrix4();
  for (const { mesh } of parts) {
    // (from the nodes' own position/rotation/scale: their matrices may not be worked out yet)
    place.identity();
    for (let p: THREE.Object3D | null = mesh; p && p !== root; p = p.parent) place.premultiply(m4.compose(p.position, p.quaternion, p.scale));
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    one.copy(geo.boundingSphere!).applyMatrix4(place);
    if (one.radius > 0) bounds.union(one); // (a prop scaled to nothing has no extent yet)
  }
  return bounds;
}

/** Every vertex of a merged geometry follows the bone of the part it came from, and that bone alone. */
function bindToBones(geo: THREE.BufferGeometry, parts: Part[], firstBone: number) {
  const verts = geo.attributes.position.count;
  const bone = new Uint16Array(verts * 4), weight = new Uint8Array(verts * 4);
  let at = 0;
  parts.forEach((part, i) => {
    const end = at + vertexCount(part);
    for (; at < end; at++) {
      bone[at * 4] = firstBone + i;
      weight[at * 4] = 255;
    }
  });
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(bone, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4, true));
}

/**
 * Add one to a model made of rigid moving parts (`model.add(new RigidSkin())`): from
 * then on its visible parts are drawn as one skinned mesh per material. Nothing else
 * changes for the model's code – it shows, hides, adds and animates the same nodes as
 * before, and the skin follows by itself (it is rebuilt whenever the set of visible
 * parts changes: a hat goes on, a tool is swapped…).
 */
export class RigidSkin extends THREE.Object3D {
  private built = Number.NaN; // what the skin was last built from (see `refresh`)
  private readonly meshes: THREE.Mesh[] = [];
  private readonly replaced: THREE.Mesh[] = [];
  private skeleton: THREE.Skeleton | null = null;
  private readonly isMe = (o: THREE.Object3D) => o === this;

  constructor() {
    super();
    this.name = 'rigid-skin';
  }

  /**
   * three.js updates every matrix of a scene before drawing it: the hook that keeps
   * the skin up to date once per frame, in whatever scene the model is shown.
   */
  override updateMatrixWorld(force?: boolean) {
    this.refresh();
    super.updateMatrixWorld(force);
  }

  /** Rebuild if the model's visible parts are not the ones the skin was built from. */
  private refresh() {
    const root = this.parent;
    if (!root?.visible) return;
    this.meshes.length = 0;
    plainMeshes(root, this.isMe, this.meshes);
    let now = this.meshes.length;
    for (const m of this.meshes) now = (Math.imul(now, 31) + m.id * 7 + (m.geometry as THREE.BufferGeometry).id * 3 + (m.material as THREE.Material).id) | 0;
    if (now === this.built) return;
    this.built = now;
    this.rebuild(root);
  }

  private rebuild(root: THREE.Object3D) {
    this.release();
    const groups = groupParts(this.meshes.filter(opaque).map((mesh): Part => ({ mesh, bake: null, flip: mirrored(mesh, root) })), look);
    if (!groups.length) return;
    // The bones are the parts themselves, and the vertices stay in each part's own
    // space: there is no bind pose to undo, so every bind matrix is the identity.
    const bones = groups.flatMap((g) => g.parts.map((p) => p.mesh));
    this.skeleton = new THREE.Skeleton(bones as THREE.Object3D[] as THREE.Bone[], bones.map(() => new THREE.Matrix4()));
    // Given, not measured (three.js would skin every vertex on the CPU to find them),
    // and generous: limbs swing, props pop up, and it only decides whether to draw at all.
    const bounds = boundsOf(groups.flatMap((g) => g.parts), root);
    bounds.radius = Math.max(0, bounds.radius) * 1.4 + 0.6;
    let firstBone = 0;
    for (const g of groups) {
      const geo = mergedGeometry(g);
      bindToBones(geo, g.parts, firstBone);
      firstBone += g.parts.length;
      const skinned = new THREE.SkinnedMesh(geo, g.material);
      likeItsParts(skinned, g);
      skinned.bind(this.skeleton, IDENTITY);
      skinned.boundingSphere = bounds.clone();
      skinned.boundingBox = bounds.getBoundingBox(new THREE.Box3());
      this.add(skinned);
      for (const { mesh } of g.parts) {
        mesh.layers.set(SKINNED_LAYER);
        this.replaced.push(mesh);
      }
    }
  }

  /** Back to the plain parts. */
  private release() {
    for (const m of this.replaced) m.layers.set(0);
    this.replaced.length = 0;
    for (const skinned of [...this.children] as THREE.SkinnedMesh[]) {
      skinned.geometry.dispose();
      skinned.removeFromParent();
    }
    this.skeleton?.dispose();
    this.skeleton = null;
  }
}
