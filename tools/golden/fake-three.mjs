// A small, deterministic stand-in for three.js, used only by the golden tests
// (tools/golden). It implements just enough maths and scene-graph behaviour for
// the terrain / water / model builders to run in plain Node, and records what
// they produce so it can be hashed. It is NOT a faithful copy of three.js
// (colour management in particular is simplified); goldens compare the code
// against itself, before and after a refactor.

export const FrontSide = 0, BackSide = 1, DoubleSide = 2, AdditiveBlending = 2, RepeatWrapping = 1000, RGBADepthPacking = 3201;
export const PCFSoftShadowMap = 2, ACESFilmicToneMapping = 4, SRGBColorSpace = 'srgb';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class Color {
  constructor(r, g, b) {
    this.r = 1; this.g = 1; this.b = 1; this.isColor = true;
    if (g !== undefined) this.setRGB(r, g, b);
    else if (r !== undefined) this.set(r);
  }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  set(v) {
    if (v && v.isColor) return this.copy(v);
    if (typeof v === 'number') return this.setRGB(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
    if (typeof v === 'string' && v[0] === '#') {
      const h = v.length === 4 ? v.slice(1).split('').map((c) => c + c).join('') : v.slice(1);
      return this.set(parseInt(h, 16));
    }
    return this;
  }
  setHex(h) { return this.set(h); }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new Color().copy(this); }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
  multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
  add(c) { this.r += c.r; this.g += c.g; this.b += c.b; return this; }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
  lerpColors(a, b, t) { return this.copy(a).lerp(b, t); }
  getHSL(out = {}) {
    const { r, g, b } = this, max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (min + max) / 2;
    if (max !== min) {
      const d = max - min;
      s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    out.h = h; out.s = s; out.l = l; return out;
  }
  setHSL(h, s, l) {
    h = ((h % 1) + 1) % 1; s = clamp01(s); l = clamp01(l);
    if (s === 0) return this.setRGB(l, l, l);
    const p = l <= 0.5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
    const f = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? q + (p - q) * 6 * t : t < 1 / 2 ? p : t < 2 / 3 ? q + (p - q) * 6 * (2 / 3 - t) : q; };
    return this.setRGB(f(h + 1 / 3), f(h), f(h - 1 / 3));
  }
  offsetHSL(h, s, l) { const o = this.getHSL(); return this.setHSL(o.h + h, o.s + s, o.l + l); }
  getHex() { return (Math.round(clamp01(this.r) * 255) << 16) | (Math.round(clamp01(this.g) * 255) << 8) | Math.round(clamp01(this.b) * 255); }
  getHexString() { return this.getHex().toString(16).padStart(6, '0'); }
  getStyle() { return `#${this.getHexString()}`; }
}

export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; this.isVector3 = true; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { return this.set(s, s, s); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
}
export class Euler { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(e) { return this.set(e.x, e.y, e.z); } }
export class Quaternion { constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; } set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } copy(q) { return this.set(q.x, q.y, q.z, q.w); } }
export class Matrix4 { constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; } makeTranslation() { return this; } makeRotationY() { return this; } compose() { return this; } multiply() { return this; } }
export class Box3 {
  constructor() { this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity); }
  expandByPoint(p) { this.min.set(Math.min(this.min.x, p.x), Math.min(this.min.y, p.y), Math.min(this.min.z, p.z)); this.max.set(Math.max(this.max.x, p.x), Math.max(this.max.y, p.y), Math.max(this.max.z, p.z)); return this; }
  expandByObject(o) {
    // Translation only (enough for the Blender exports, which carry no rotation/scale on these nodes).
    const walk = (n, ox, oy, oz) => {
      const x = ox + n.position.x, y = oy + n.position.y, z = oz + n.position.z;
      const p = n.geometry?.attributes?.position?.array;
      if (p) for (let i = 0; i < p.length; i += 3) this.expandByPoint({ x: x + p[i], y: y + p[i + 1], z: z + p[i + 2] });
      for (const c of n.children) walk(c, x, y, z);
    };
    walk(o, 0, 0, 0);
    return this;
  }
}

export class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.needsUpdate = false; }
  getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; } getZ(i) { return this.array[i * this.itemSize + 2]; }
  setXYZ(i, x, y, z) { const k = i * this.itemSize; this.array[k] = x; this.array[k + 1] = y; this.array[k + 2] = z; return this; }
}
export class Float32BufferAttribute extends BufferAttribute { constructor(a, n) { super(Float32Array.from(a), n); } }

export class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; this.isBufferGeometry = true; }
  setAttribute(k, v) { this.attributes[k] = v; return this; }
  setFromPoints(pts) { const arr = new Float32Array(pts.length * 3); pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; }); return this.setAttribute('position', new BufferAttribute(arr, 3)); }
  getAttribute(k) { return this.attributes[k]; }
  setIndex(i) { this.index = i ? (i.array ? i : new BufferAttribute(Uint32Array.from(i), 1)) : null; return this; }
  computeVertexNormals() { return this; }
  computeBoundingBox() { return this; }
  computeBoundingSphere() { return this; }
  rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; } translate() { return this; } scale() { return this; }
  toNonIndexed() {
    const g = new BufferGeometry();
    if (!this.index) return this;
    const idx = this.index.array;
    for (const [k, a] of Object.entries(this.attributes)) {
      const out = new a.array.constructor(idx.length * a.itemSize);
      for (let i = 0; i < idx.length; i++) for (let j = 0; j < a.itemSize; j++) out[i * a.itemSize + j] = a.array[idx[i] * a.itemSize + j];
      g.setAttribute(k, new BufferAttribute(out, a.itemSize));
    }
    return g;
  }
  clone() { const g = new BufferGeometry(); Object.assign(g.attributes, this.attributes); g.index = this.index; return g; }
  dispose() {}
}
// Primitive geometries: only their parameters matter to the goldens.
const prim = (name) => class extends BufferGeometry { constructor(...args) { super(); this.type = name; this.parameters = args; } };
export const BoxGeometry = prim('Box'), CircleGeometry = prim('Circle'), ConeGeometry = prim('Cone'), CylinderGeometry = prim('Cylinder');
export const DodecahedronGeometry = prim('Dodecahedron'), IcosahedronGeometry = prim('Icosahedron'), PlaneGeometry = prim('Plane'), RingGeometry = prim('Ring');
export const TorusGeometry = prim('Torus');
export const SphereGeometry = prim('Sphere'), ShapeGeometry = prim('ShapeG'), ExtrudeGeometry = prim('Extrude');
export class Shape { constructor() { this.cmds = []; return new Proxy(this, { get: (t, k) => (k in t ? t[k] : (...a) => { t.cmds.push([k, ...a]); return t; }) }); } }

export class Material {
  constructor(o = {}) { this.isMaterial = true; this.side = FrontSide; this.transparent = false; this.opacity = 1; this.color = new Color(); this.setValues(o); }
  setValues(o) { for (const [k, v] of Object.entries(o)) { if (k === 'color') this.color = new Color().set(v); else this[k] = v; } }
  clone() { const m = new this.constructor(); Object.assign(m, this); m.color = this.color.clone(); return m; }
  dispose() {}
}
export class MeshStandardMaterial extends Material {}
export class MeshBasicMaterial extends Material {}
export class MeshDepthMaterial extends Material {}
export class PointsMaterial extends Material {}
export class LineBasicMaterial extends Material {}
export class SpriteMaterial extends Material {}

let ids = 0;
export class Object3D {
  constructor() {
    this.id = ++ids; this.name = ''; this.children = []; this.parent = null; this.userData = {};
    this.position = new Vector3(); this.rotation = new Euler(); this.scale = new Vector3(1, 1, 1); this.quaternion = new Quaternion();
    this.visible = true; this.castShadow = false; this.receiveShadow = false; this.renderOrder = 0; this.frustumCulled = true; this.isObject3D = true;
  }
  add(...cs) { for (const c of cs) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); } return this; }
  remove(...cs) { for (const c of cs) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parent = null; } } return this; }
  traverse(fn) { fn(this); for (const c of [...this.children]) c.traverse(fn); }
  clear() { for (const c of [...this.children]) this.remove(c); return this; }
  getObjectByName(n) { if (this.name === n) return this; for (const c of this.children) { const r = c.getObjectByName(n); if (r) return r; } return undefined; }
  updateMatrixWorld() {} updateMatrix() {} lookAt() {}
  clone(recursive = true) {
    const o = new this.constructor(this.geometry, this.material);
    o.name = this.name; o.position.copy(this.position); o.rotation.copy(this.rotation); o.scale.copy(this.scale);
    o.userData = { ...this.userData }; o.visible = this.visible; o.castShadow = this.castShadow; o.receiveShadow = this.receiveShadow;
    o.renderOrder = this.renderOrder; o.customDepthMaterial = this.customDepthMaterial;
    if (recursive) for (const c of this.children) o.add(c.clone(true));
    return o;
  }
}
export class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
export class Scene extends Object3D { constructor() { super(); this.background = null; this.fog = null; } }
export class Mesh extends Object3D { constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial()) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; } }
export class InstancedMesh extends Mesh {
  constructor(g, m, count) { super(g, m); this.count = count; this.isInstancedMesh = true; this.matrices = []; this.instanceMatrix = { needsUpdate: false }; }
  setMatrixAt(i, m) { this.matrices[i] = m.elements ? [...m.elements] : m; }
  setColorAt() {}
}
export class Points extends Mesh { constructor(g, m) { super(g, m); this.isPoints = true; } }
export class Line extends Mesh { constructor(g, m) { super(g, m); this.isLine = true; } }
export class Sprite extends Mesh { constructor(m) { super(new BufferGeometry(), m); this.isSprite = true; } }
export class Light extends Object3D { constructor(color, intensity) { super(); this.color = new Color(color); this.intensity = intensity ?? 1; this.shadow = { camera: {}, mapSize: { set() {} } }; this.target = new Object3D(); } }
export class DirectionalLight extends Light {}
export class HemisphereLight extends Light {}
export class PointLight extends Light {}
export class PerspectiveCamera extends Object3D { updateProjectionMatrix() {} }
export class Fog { constructor(c, n, f) { this.color = new Color(c); this.near = n; this.far = f; } }
export class Plane { constructor(n, c) { this.normal = n; this.constant = c; } }
export class Raycaster { setFromCamera() {} intersectObject() { return []; } intersectObjects() { return []; } }
export class Clock { getDelta() { return 0; } getElapsedTime() { return 0; } }
export class CanvasTexture { constructor(image) { this.image = image; this.offset = new Vector2(); this.repeat = new Vector2(1, 1); this.needsUpdate = false; } clone() { const t = new CanvasTexture(this.image); return t; } }
export class WebGLRenderer { constructor() { throw new Error('fake-three: no renderer in golden tests'); } }
