"""Just enough of Blender's bmesh to run art/nature/nature_models.py outside Blender.

Mirrors what the script uses: new(), verts.new, faces.new (ValueError on a
duplicate face), ops.create_icosphere (Blender's numbering: subdivisions=2 → 80
faces), ops.recalc_face_normals (consistent winding, pointing outwards),
ops.triangulate, normal_update, verts.index_update, free.
"""
import math
from collections import defaultdict, deque

from mathutils import Vector


class BMVert:
    __slots__ = ('co', 'normal', 'index', 'faces')

    def __init__(self, co):
        self.co = Vector(co)
        self.normal = Vector((0, 0, 1))
        self.index = 0
        self.faces = []


class BMFace:
    __slots__ = ('verts', 'smooth', 'normal', 'material_index')

    def __init__(self, verts):
        self.verts = list(verts)
        self.smooth = False
        self.normal = Vector((0, 0, 1))
        self.material_index = 0

    def calc_normal(self):
        n = Vector((0, 0, 0))
        vs = self.verts
        for i in range(len(vs)):
            a, b = vs[i].co, vs[(i + 1) % len(vs)].co
            n = n + Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        return n


class _Verts(list):
    def new(self, co):
        v = BMVert(co)
        self.append(v)
        return v

    def index_update(self):
        for i, v in enumerate(self):
            v.index = i


class _Faces(list):
    def __init__(self):
        super().__init__()
        self._keys = set()

    def new(self, verts):
        verts = list(verts)
        key = frozenset(id(v) for v in verts)
        if len(key) < 3 or key in self._keys:
            raise ValueError('face exists or is degenerate')
        self._keys.add(key)
        f = BMFace(verts)
        self.append(f)
        return f


class BMesh:
    def __init__(self):
        self.verts = _Verts()
        self.faces = _Faces()

    def free(self):
        self.verts.clear()
        self.faces.clear()

    def normal_update(self):
        acc = defaultdict(lambda: Vector((0, 0, 0)))
        for f in self.faces:
            n = f.calc_normal()
            f.normal = n.normalized()
            for v in f.verts:
                acc[id(v)] = acc[id(v)] + n
        for v in self.verts:
            v.normal = acc[id(v)].normalized() if id(v) in acc else Vector((0, 0, 1))


def new():
    return BMesh()


class ops:
    @staticmethod
    def create_icosphere(bm, subdivisions=2, radius=1.0, **_):
        t = (1 + 5 ** 0.5) / 2
        pts = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
        faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
                 (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        pts = [Vector(p).normalized() for p in pts]
        for _ in range(max(0, subdivisions - 1)):
            cache, nf = {}, []

            def mid(a, b):
                k = (min(a, b), max(a, b))
                if k not in cache:
                    pts.append((pts[a] + pts[b]).normalized())
                    cache[k] = len(pts) - 1
                return cache[k]
            for a, b, c in faces:
                ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
                nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
            faces = nf
        vs = [bm.verts.new(p * radius) for p in pts]
        for a, b, c in faces:
            bm.faces.new((vs[a], vs[b], vs[c]))
        ops.recalc_face_normals(bm, faces=bm.faces)

    @staticmethod
    def recalc_face_normals(bm, faces=None):
        """Make each connected piece's winding consistent, then point it outwards."""
        faces = list(faces if faces is not None else bm.faces)
        edge_faces = defaultdict(list)
        for f in faces:
            vs = f.verts
            for i in range(len(vs)):
                edge_faces[frozenset((id(vs[i]), id(vs[(i + 1) % len(vs)])))].append(f)
        seen = set()
        for start in faces:
            if id(start) in seen:
                continue
            comp, q = [], deque([start])
            seen.add(id(start))
            while q:
                f = q.popleft()
                comp.append(f)
                vs = f.verts
                for i in range(len(vs)):
                    a, b = vs[i], vs[(i + 1) % len(vs)]
                    for g in edge_faces[frozenset((id(a), id(b)))]:
                        if id(g) in seen:
                            continue
                        # Neighbours must walk the shared edge the other way round.
                        gv = g.verts
                        ia = next(k for k in range(len(gv)) if gv[k] is a)
                        if gv[(ia + 1) % len(gv)] is b:
                            g.verts.reverse()
                        seen.add(id(g))
                        q.append(g)
            # Outwards: signed volume about the piece's centre.
            cvs = {id(v): v for f in comp for v in f.verts}
            cen = Vector((0, 0, 0))
            for v in cvs.values():
                cen = cen + v.co
            cen = cen / max(1, len(cvs))
            vol = 0.0
            for f in comp:
                n = f.calc_normal()
                c = Vector((0, 0, 0))
                for v in f.verts:
                    c = c + v.co
                c = c / len(f.verts)
                vol += n.dot(c - cen)
            if vol < 0:
                for f in comp:
                    f.verts.reverse()

    @staticmethod
    def triangulate(bm, faces=None):
        out = []
        for f in list(bm.faces):
            vs = f.verts
            if len(vs) == 3:
                out.append(f)
                continue
            for i in range(1, len(vs) - 1):
                t = BMFace((vs[0], vs[i], vs[i + 1]))
                t.smooth = f.smooth
                t.material_index = f.material_index
                out.append(t)
        bm.faces[:] = out
