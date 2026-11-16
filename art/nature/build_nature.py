"""Writes the trees, bushes, rocks and ground cover into the game.

    python3 art/nature/build_nature.py                 build the models here (bmesh stand-in) and write
    python3 art/nature/build_nature.py data.json       write meshes exported from Blender
                                                       (run(...) in nature_models.py, saved as JSON)

Outputs client/public/models/trees.glb (one root per species, meshes by role,
fruit empties) and client/public/models/nature.glb (kit format: root per model,
group nodes, materials named by role), plus preview sheets in art/nature/.
Meshes carry smooth normals; the game draws models that have normals smooth-shaded.
"""
import base64
import json
import math
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
OUT = os.path.join(ROOT, 'client', 'public', 'models')


def lin(hx):
    c = [int(hx[j:j + 2], 16) / 255 for j in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def arrays(part):
    pos = np.frombuffer(base64.b64decode(part['pos']), dtype='<f4').reshape(-1, 3)
    nrm = np.frombuffer(base64.b64decode(part['nrm']), dtype='<f4').reshape(-1, 3)
    idx = np.frombuffer(base64.b64decode(part['idx']), dtype='<u4').reshape(-1, 3)
    return pos, nrm, idx


# ── glTF writer (positions, normals, indices; one material per role + colour) ──

class Glb:
    def __init__(self):
        self.gl = {'asset': {'version': '2.0', 'generator': 'hearthwood art/nature'}, 'scene': 0, 'scenes': [{'nodes': []}],
                   'nodes': [], 'meshes': [], 'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': []}
        self.blob = bytearray()
        self.mats = {}
        self.tris = 0

    def _view(self, data, target):
        while len(self.blob) % 4:
            self.blob += b'\0'
        off = len(self.blob)
        self.blob += data
        self.gl['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
        return len(self.gl['bufferViews']) - 1

    def _acc(self, arr, ctype, typ, target, minmax=False):
        v = self._view(arr.tobytes(), target)
        a = {'bufferView': v, 'componentType': ctype, 'count': int(arr.shape[0] if typ == 'VEC3' else arr.size), 'type': typ}
        if minmax:
            a['min'] = [float(x) for x in arr.min(axis=0)]
            a['max'] = [float(x) for x in arr.max(axis=0)]
        self.gl['accessors'].append(a)
        return len(self.gl['accessors']) - 1

    def material(self, role, color):
        key = (role, color)
        if key not in self.mats:
            self.gl['materials'].append({'name': role, 'pbrMetallicRoughness': {'baseColorFactor': lin(color) + [1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.9}})
            self.mats[key] = len(self.gl['materials']) - 1
        return self.mats[key]

    def mesh(self, name, parts):
        prims = []
        for part in parts:
            pos, nrm, idx = arrays(part)
            if not len(idx):
                continue
            self.tris += len(idx)
            prims.append({'attributes': {'POSITION': self._acc(pos.astype('<f4'), 5126, 'VEC3', 34962, True),
                                         'NORMAL': self._acc(nrm.astype('<f4'), 5126, 'VEC3', 34962)},
                          'indices': self._acc(idx.astype('<u4').reshape(-1), 5125, 'SCALAR', 34963),
                          'material': self.material(part['role'], part['color'])})
        self.gl['meshes'].append({'name': name, 'primitives': prims})
        return len(self.gl['meshes']) - 1

    def node(self, **kw):
        self.gl['nodes'].append({k: v for k, v in kw.items() if v is not None})
        return len(self.gl['nodes']) - 1

    def write(self, path, roots):
        self.gl['scenes'][0]['nodes'] = roots
        while len(self.blob) % 4:
            self.blob += b'\0'
        self.gl['buffers'] = [{'byteLength': len(self.blob)}]
        js = json.dumps(self.gl, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.blob))
        out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(self.blob), 0x004E4942) + bytes(self.blob)
        with open(path, 'wb') as f:
            f.write(out)
        return len(out)


def write_trees(models, path):
    g = Glb()
    roots = []
    for name, m in models.items():
        kids = []
        by_role = {}
        for p in m['parts']:
            by_role.setdefault(p['node'], []).append(p)
        for role, parts in by_role.items():
            # One primitive per role (the loader recolours the role's single mesh).
            merged = merge_parts(parts)
            kids.append(g.node(name=f'{name}_{role}', mesh=g.mesh(f'{name}_{role}', [merged])))
        for e in m['empties']:
            kids.append(g.node(name=f"{name}_{e['name']}", translation=e['pos']))
        roots.append(g.node(name=name, children=kids))
    size = g.write(path, roots)
    return {'path': os.path.relpath(path, ROOT), 'models': len(models), 'triangles': g.tris, 'kb': size // 1024}


def merge_parts(parts):
    """Several (colour) parts of one role into one part, keeping the first colour."""
    if len(parts) == 1:
        return parts[0]
    P, N, I, off = [], [], [], 0
    for p in parts:
        pos, nrm, idx = arrays(p)
        P.append(pos)
        N.append(nrm)
        I.append(idx + off)
        off += len(pos)
    enc = lambda a, t: base64.b64encode(np.concatenate(a).astype(t).tobytes()).decode()
    return {'node': parts[0]['node'], 'role': parts[0]['role'], 'color': parts[0]['color'], 'pos': enc(P, '<f4'), 'nrm': enc(N, '<f4'), 'idx': enc(I, '<u4')}


def write_kit(models, path):
    g = Glb()
    roots = []
    for name, m in models.items():
        groups = {}
        for p in m['parts']:
            groups.setdefault(p['node'], []).append(p)
        kids = [g.node(name=f'{name}_{grp}', mesh=g.mesh(f'{name}_{grp}', parts)) for grp, parts in groups.items()]
        roots.append(g.node(name=name, children=kids))
    size = g.write(path, roots)
    return {'path': os.path.relpath(path, ROOT), 'models': len(models), 'triangles': g.tris, 'kb': size // 1024}


# ── Previews: a small smooth-shading rasteriser, roughly the game's camera ──

# Game colours for the tree previews (shared/src/data/biomes.ts TREES: summer / default foliage).
TREE_LOOK = {
    'oak': ('#7a5230', '#4f9e3a'), 'apple': ('#80583a', '#5bab45'), 'cherry': ('#6d4433', '#ffb7d0'), 'pine': ('#5b3b25', '#2e6b43'),
    'birch': ('#e8e4da', '#6db64a'), 'palm': ('#a77b4f', '#3fae4a'), 'date_palm': ('#946c45', '#5a9a3c'), 'banana': ('#7c9a3a', '#58b947'),
    'jungle_giant': ('#6a5139', '#1f7a3a'), 'cactus': ('#4f8a3c', '#4f8a3c'), 'acacia': ('#7d5a3a', '#7a9a3a'),
}


def render(items, path, cols, cell=260, pitch=34, tile_px=None, bg=(214, 232, 196)):
    """items: [(label, [(pos, nrm, idx, rgb)], scale)]. Orthographic, looking down `pitch` degrees."""
    from PIL import Image, ImageDraw
    rows = (len(items) + cols - 1) // cols
    W, H = cols * cell, rows * cell
    img = np.zeros((H, W, 3), dtype=np.float32)
    img[:] = np.array(bg) / 255
    zbuf = np.full((H, W), np.inf, dtype=np.float32)
    p = math.radians(pitch)
    yaw = math.radians(28)
    Ry = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    Rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    R = Rx @ Ry
    light = np.array([-0.45, 0.8, 0.4])
    light /= np.linalg.norm(light)
    for k, (label, parts, scale) in enumerate(items):
        ox, oy = (k % cols) * cell + cell / 2, (k // cols) * cell + cell * 0.86
        s = (tile_px or cell * 0.3) * scale
        for pos, nrm, idx, rgb in parts:
            v = pos @ R.T
            n = nrm @ R.T
            lw = nrm @ light
            col = np.array(rgb)
            sx = ox + v[:, 0] * s
            sy = oy - v[:, 1] * s
            sz = -v[:, 2]
            for a, b, c in idx:
                xs = np.array([sx[a], sx[b], sx[c]])
                ys = np.array([sy[a], sy[b], sy[c]])
                x0, x1 = int(max(0, math.floor(xs.min()))), int(min(W - 1, math.ceil(xs.max())))
                y0, y1 = int(max(0, math.floor(ys.min()))), int(min(H - 1, math.ceil(ys.max())))
                if x1 < x0 or y1 < y0:
                    continue
                den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
                if abs(den) < 1e-9:
                    continue
                gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
                w0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
                w1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
                w2 = 1 - w0 - w1
                inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
                if not inside.any():
                    continue
                z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c]
                region = zbuf[y0:y1 + 1, x0:x1 + 1]
                draw = inside & (z < region)
                if not draw.any():
                    continue
                region[draw] = z[draw]
                l = w0 * lw[a] + w1 * lw[b] + w2 * lw[c]
                l = np.abs(l) if False else l
                shade = 0.48 + 0.62 * np.clip(l, 0, 1)
                img[y0:y1 + 1, x0:x1 + 1][draw] = np.clip(col[None, :] * shade[draw][:, None], 0, 1)
    im = Image.fromarray((img * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for k, (label, _, _) in enumerate(items):
        d.text(((k % cols) * cell + 8, (k // cols) * cell + 6), label, fill=(40, 52, 40))
    im.save(path)
    return path


def srgb(hx):
    return [int(hx[j:j + 2], 16) / 255 for j in (1, 3, 5)]


def preview_trees(models, path, winter=False):
    items = []
    for name, m in models.items():
        sp = name[5:]
        trunk, fol = TREE_LOOK.get(sp, ('#7a5230', '#4f9e3a'))
        has_branches = any(p['node'] == 'branches' for p in m['parts'])
        parts = []
        for p in m['parts']:
            role = p['node']
            if role == 'branches' and not winter:
                continue
            if role == 'snow' and not winter:
                continue
            if winter and role == 'foliage' and has_branches:
                continue
            if winter and role == 'branches' and not has_branches:
                continue
            if winter and role == 'snow' and has_branches:
                continue
            col = {'trunk': trunk, 'branches': trunk, 'foliage': fol, 'snow': '#f6f9fc', 'marks': '#2b2622', 'ribs': '#3f7030'}.get(role, p['color'])
            pos, nrm, idx = arrays(p)
            parts.append((pos, nrm, idx, srgb(col)))
        for e in m['empties']:
            if winter:
                break
            # fruit: little red balls to see where it hangs
            pass
        items.append((sp, parts, 1.0))
    return render(items, path, cols=6, cell=240, tile_px=62)


def preview_kit(models, path):
    items = []
    for name, m in models.items():
        parts = [(*arrays(p), srgb(p['color'])) for p in m['parts']]
        big = name.startswith(('bush', 'rock', 'sapling'))
        items.append((name, parts, 1.0 if big else 1.0))
    return render(items, path, cols=8, cell=180, tile_px=150, pitch=38)


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            data = json.load(f)
    else:
        sys.path.insert(0, os.path.join(HERE, 'shim'))
        sys.path.insert(0, HERE)
        import nature_models
        data = nature_models.run()
    trees = {k: v for k, v in data.items() if v['kind'] == 'tree'}
    kit = {k: v for k, v in data.items() if v['kind'] == 'kit'}
    print(write_trees(trees, os.path.join(OUT, 'trees.glb')))
    print(write_kit(kit, os.path.join(OUT, 'nature.glb')))
    if '--no-preview' not in sys.argv:
        print(preview_trees(trees, os.path.join(HERE, 'trees_preview.png')))
        print(preview_trees(trees, os.path.join(HERE, 'trees_winter_preview.png'), winter=True))
        print(preview_kit(kit, os.path.join(HERE, 'nature_preview.png')))


if __name__ == '__main__':
    main()
