// Fake three.js add-ons for the golden tests: a GLTFLoader that reads .glb files
// from client/public into the fake scene graph, and inert CSS2D classes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, Object3D } from './fake-three.mjs';

const PUBLIC = fileURLToPath(new URL('../../client/public/', import.meta.url));
const COMP = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const T = COMP[a.componentType], n = a.count * SIZE[a.type];
    const off = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const copy = Buffer.from(buf.subarray(off, off + n * T.BYTES_PER_ELEMENT));
    return new BufferAttribute(new T(copy.buffer, copy.byteOffset, n), SIZE[a.type]);
  };
  const mats = (json.materials ?? []).map((m) => {
    const f = m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    const mm = new MeshStandardMaterial(); mm.color = new Color(f[0], f[1], f[2]); mm.name = m.name; return mm;
  });
  const nodes = json.nodes.map((n) => {
    let o;
    if (n.mesh !== undefined) {
      const p = json.meshes[n.mesh].primitives[0];
      const g = new BufferGeometry();
      g.setAttribute('position', acc(p.attributes.POSITION));
      if (p.indices !== undefined) g.setIndex(acc(p.indices));
      o = new Mesh(g, p.material !== undefined ? mats[p.material] : new MeshStandardMaterial());
    } else o = new Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.set(...n.translation);
    if (n.scale) o.scale.set(...n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => nodes[i].add(nodes[c])));
  const scene = new Group();
  for (const i of json.scenes[json.scene ?? 0].nodes) scene.add(nodes[i]);
  return { scene };
}

export class GLTFLoader {
  load(url, onLoad, _progress, onError) {
    try {
      onLoad(parseGlb(readFileSync(PUBLIC + url.replace(/^\//, ''))));
    } catch (e) {
      onError?.(e);
    }
  }
}
export class CSS2DRenderer { constructor() { this.domElement = {}; } setSize() {} render() {} }
export class CSS2DObject extends Object3D { constructor(el) { super(); this.element = el; } }
