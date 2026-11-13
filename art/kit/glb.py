"""Pure-python glTF (.glb) writer for kit models – no Blender needed.

Each model becomes a root node (named after the model, at the origin) with one
child node per kit group, named `<model>_<group>` and placed at the group's pivot.
Each part is turned into its convex hull; parts sharing a material (role + colour)
are merged into one primitive. Normals are left out on purpose: three.js then
renders the meshes flat-shaded, which is the game's look.

Optional per-model extras (attributes on the Kit):
  kit.merge = 'shadow'     all parts of a group in one primitive / material (named 'shadow')
  kit.wrap = 'body'        wrap all groups in an extra node `<model>_body` (pivot 0)
  kit.parents = {g: p}     parent group g under group p (pivots stay absolute)
  kit.targets = [names]    morph target names; kit.morph(group, role, p) -> {name: (dx, dy, dz)}
                           p is the absolute model-space point
Animations: list of dict(name, channels=[(node_name, path, times, values)]),
  path in 'translation' | 'rotation' (xyzw) | 'weights'; values flattened per key.
Extra plain nodes: instances=[(name, mesh_of_model, translation, rotation_xyzw)].
"""
import json
import struct

import numpy as np
from scipy.spatial import ConvexHull, QhullError


def lin(hx):
    c = [int(hx[j:j + 2], 16) / 255 for j in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def hull(pts):
    a = np.asarray(pts, dtype=np.float64)
    a = np.unique(np.round(a, 7), axis=0)
    try:
        h = ConvexHull(a)
    except QhullError:
        h = ConvexHull(a, qhull_options='QJ')
    used = sorted(set(h.simplices.flatten().tolist()))
    remap = {v: i for i, v in enumerate(used)}
    verts = a[used]
    tris = []
    for s, eq in zip(h.simplices, h.equations):
        p0, p1, p2 = a[s[0]], a[s[1]], a[s[2]]
        n = np.cross(p1 - p0, p2 - p0)
        t = [remap[s[0]], remap[s[1]], remap[s[2]]]
        if np.dot(n, eq[:3]) < 0:
            t = [t[0], t[2], t[1]]
        tris.append(t)
    return verts, tris


class Writer:
    def __init__(self):
        self.gl = {'nodes': [], 'meshes': [], 'materials': [], 'accessors': [], 'bufferViews': []}
        self.blob = bytearray()
        self.mats = {}
        self.tris = 0

    def view(self, data, target=None):
        while len(self.blob) % 4:
            self.blob.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.blob), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.gl['bufferViews'].append(v)
        self.blob.extend(data)
        return len(self.gl['bufferViews']) - 1

    def accessor(self, arr, kind, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        if kind == 'VEC3' or kind == 'VEC4' or (kind == 'SCALAR' and arr.dtype == np.float32):
            comp = 5126
        elif arr.dtype == np.uint16:
            comp = 5123
        else:
            comp = 5125
        acc = {'bufferView': self.view(arr.tobytes(), target), 'componentType': comp, 'count': int(arr.shape[0]), 'type': kind}
        if minmax:
            acc['min'] = [float(x) for x in np.atleast_1d(arr.min(axis=0))]
            acc['max'] = [float(x) for x in np.atleast_1d(arr.max(axis=0))]
        self.gl['accessors'].append(acc)
        return len(self.gl['accessors']) - 1

    def material(self, role, color):
        key = (role, color)
        if key not in self.mats:
            glass = role in ('glass', 'glow', 'glow_spot')
            self.mats[key] = len(self.gl['materials'])
            self.gl['materials'].append({'name': role, 'pbrMetallicRoughness': {
                'baseColorFactor': lin(color) + [1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.25 if glass else 0.9}})
        return self.mats[key]

    def mesh(self, name, parts, pivot, kit, group):
        # kit.merge = 'name': one primitive (material named so) for all parts – simpler to animate.
        merge = getattr(kit, 'merge', None)
        by_mat = {}
        for (role, color, pts) in parts:
            by_mat.setdefault((merge or role, color), []).append((role, pts))
        targets = getattr(kit, 'targets', None)
        prims = []
        for (role, color), plist in by_mat.items():
            V, I, D = [], [], {t: [] for t in (targets or [])}
            for part_role, pts in plist:
                verts, tris = hull(pts)
                base = sum(len(v) for v in V)
                V.append(verts)
                I.extend([[a + base, b + base, c + base] for a, b, c in tris])
                if targets:
                    for p in verts:
                        d = kit.morph(group, part_role, tuple(p))
                        for t in targets:
                            D[t].append(d.get(t, (0.0, 0.0, 0.0)))
            pos = (np.concatenate(V) - np.asarray(pivot)).astype(np.float32)
            idx = np.asarray(I, dtype=np.uint16 if len(pos) < 65536 else np.uint32).reshape(-1)
            self.tris += len(I)
            prim = {'attributes': {'POSITION': self.accessor(pos, 'VEC3', 34962, True)},
                    'indices': self.accessor(idx, 'SCALAR', 34963), 'material': self.material(role, color)}
            if targets:
                prim['targets'] = [{'POSITION': self.accessor(np.asarray(D[t], dtype=np.float32), 'VEC3', 34962, True)} for t in targets]
            prims.append(prim)
        m = {'name': name, 'primitives': prims}
        if targets:
            m['weights'] = [0.0] * len(targets)
            m['extras'] = {'targetNames': list(targets)}
        self.gl['meshes'].append(m)
        return len(self.gl['meshes']) - 1

    def node(self, **kw):
        self.gl['nodes'].append({k: v for k, v in kw.items() if v is not None})
        return len(self.gl['nodes']) - 1

    def model(self, name, kit):
        groups = {}
        for (g, role, color, pts) in kit.parts:
            groups.setdefault(g, []).append((role, color, pts))
        parents = dict(getattr(kit, 'parents', {}) or {})
        wrap = getattr(kit, 'wrap', None)
        idx, meshes = {}, {}
        for g, parts in groups.items():
            pv = kit.pivots.get(g, (0.0, 0.0, 0.0))
            meshes[g] = self.mesh(f'{name}_{g}_mesh', parts, pv, kit, g)
            idx[g] = self.node(name=f'{name}_{g}', mesh=meshes[g])
        top = []
        for g in groups:
            p = parents.get(g)
            pv = kit.pivots.get(g, (0.0, 0.0, 0.0))
            ppv = kit.pivots.get(p, (0.0, 0.0, 0.0)) if p else (0.0, 0.0, 0.0)
            t = [pv[i] - ppv[i] for i in range(3)]
            if any(abs(x) > 1e-9 for x in t):
                self.gl['nodes'][idx[g]]['translation'] = t
            if p:
                self.gl['nodes'][idx[p]].setdefault('children', []).append(idx[g])
            else:
                top.append(idx[g])
        if wrap:
            top = [self.node(name=f'{name}_{wrap}', children=top)]
        root = self.node(name=name, children=top)
        return root, meshes

    def write(self, path, roots, animations=None):
        if animations:
            names = {n['name']: i for i, n in enumerate(self.gl['nodes'])}
            self.gl['animations'] = []
            for a in animations:
                samplers, channels = [], []
                for (node, prop, times, values) in a['channels']:
                    ti = self.accessor(np.asarray(times, dtype=np.float32), 'SCALAR', None, True)
                    vals = np.asarray(values, dtype=np.float32)
                    kind = {'translation': 'VEC3', 'rotation': 'VEC4', 'weights': 'SCALAR'}[prop]
                    vi = self.accessor(vals.reshape(-1, {'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[kind]) if kind != 'SCALAR' else vals.reshape(-1), kind)
                    samplers.append({'input': ti, 'output': vi, 'interpolation': 'LINEAR'})
                    channels.append({'sampler': len(samplers) - 1, 'target': {'node': names[node], 'path': prop}})
                self.gl['animations'].append({'name': a['name'], 'samplers': samplers, 'channels': channels})
        while len(self.blob) % 4:
            self.blob.append(0)
        doc = dict(asset={'version': '2.0', 'generator': 'hearthwood art kit (art/kit/glb.py)'}, scene=0, scenes=[{'nodes': roots}],
                   buffers=[{'byteLength': len(self.blob)}], **{k: v for k, v in self.gl.items() if v})
        js = json.dumps(doc, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        out = (struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(self.blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js
               + struct.pack('<II', len(self.blob), 0x004E4942) + bytes(self.blob))
        with open(path, 'wb') as fh:
            fh.write(out)
        return len(out)


def export(models, path, animations=None):
    w = Writer()
    roots = [w.model(name, kit)[0] for name, kit in models.items()]
    size = w.write(path, roots, animations)
    return {'path': path, 'models': len(models), 'triangles': w.tris, 'kb': size // 1024}
