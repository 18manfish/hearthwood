"""Trees, bushes, rocks and ground cover in an Animal Crossing–like style.

Runs inside Blender (Text editor or the Blender MCP). Everything is built with
Blender's bmesh tools – no modifiers, no exporter, no render – and handed back as
mesh data that art/nature/build_nature.py writes into the game's .glb files:

    run(names) -> {name: model}   model = {kind, parts: [{node, role, color, pos, nrm, idx}], empties: [...]}

pos / nrm are base64 float32 (x, y, z …), idx base64 uint32 triangles.
Coordinates are the game's (three.js): Y up, +Z towards the camera, 1 = one tile.

Style: chunky, rounded and soft – lumpy cotton-ball canopies, stubby flared
trunks, tiered pines with drooping rims, smooth pebble-like stones – with smooth
normals (the game draws these models smooth-shaded).

Trees: root `tree_<species>`, meshes by role (_trunk, _foliage, _branches shown
bare in winter, _snow, _marks, _ribs) and empties `_fruit<i>` where fruit hangs.
Kit models (bushes, rocks, ground cover): groups as nodes (`leaves`, `berries`,
`main`), materials named by role.
"""

import base64
import math
import random
import struct

import bmesh
from mathutils import Matrix, Vector


# ── Geometry helpers (three.js coordinates) ────────────────────────────────

def noise3(p, seed=0.0):
    """Cheap smooth 3D noise in -1..1 (sum of sines)."""
    x, y, z = p.x + seed * 1.7, p.y - seed * 0.9, p.z + seed * 0.4
    return (math.sin(x * 1.9 + math.sin(z * 1.3)) * math.cos(y * 1.7 - 0.4) * 0.5
            + math.sin(z * 2.3 + y * 1.1) * 0.3 + math.cos(x * 3.1 - z * 2.2 + y) * 0.2)


class Part:
    """One mesh (bmesh) of a model: a node (group / tree role) + material role + colour."""

    def __init__(self):
        self.bm = bmesh.new()

    def merge(self, src, smooth=True):
        m = {}
        for v in src.verts:
            m[v] = self.bm.verts.new(v.co)
        for f in src.faces:
            try:
                nf = self.bm.faces.new([m[v] for v in f.verts])
                nf.smooth = smooth
            except ValueError:
                pass
        src.free()


class Model:
    def __init__(self, name, kind):
        self.name, self.kind = name, kind
        self.parts = {}
        self.empties = []

    def part(self, node, role, color):
        key = (node, role, color)
        if key not in self.parts:
            self.parts[key] = Part()
        return self.parts[key]

    def empty(self, name, p):
        self.empties.append({'name': name, 'pos': [round(c, 4) for c in p]})


def blob(c, r, sub=2, lump=0.0, seed=0.0, flat=None, freq=3.0):
    """A soft lumpy ball: icosphere scaled to radii r, displaced by noise; `flat` squashes the underside."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    cx, cy, cz = c
    rx, ry, rz = r
    for v in bm.verts:
        n = v.co.normalized()
        d = 1.0 + lump * noise3(n * freq, seed)
        p = Vector((n.x * rx * d, n.y * ry * d, n.z * rz * d))
        if flat is not None and p.y < -ry * flat:
            p.y = -ry * flat + (p.y + ry * flat) * 0.25
        v.co = Vector((cx + p.x, cy + p.y, cz + p.z))
    return bm


def lathe(profile, seg=12, cap_top=True, cap_bottom=True, wobble=0.0, seed=0.0, c=(0, 0, 0)):
    """Spin a (radius, y) profile round the Y axis."""
    bm = bmesh.new()
    rings = []
    for (r, y) in profile:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            w = 1.0 + wobble * math.sin(a * 3 + seed + y * 2.0)
            ring.append(bm.verts.new((c[0] + math.cos(a) * r * w, c[1] + y, c[2] + math.sin(a) * r * w)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_bottom and profile[0][0] > 1e-4:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and profile[-1][0] > 1e-4:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(path, radii, seg=10, cap=True):
    """A tube along a polyline of points (Vector-able), radius per point."""
    bm = bmesh.new()
    pts = [Vector(p) for p in path]
    rings = []
    ref = Vector((0, 0, 1))
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        if abs(t.dot(ref)) > 0.95:
            ref = Vector((1, 0, 0))
        u = t.cross(ref).normalized()
        w = t.cross(u).normalized()
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring.append(bm.verts.new(p + (u * math.cos(a) + w * math.sin(a)) * radii[k]))
        rings.append(ring)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def leaf(base, direction, length, width, droop=0.3, segs=6, thick=0.012, curl=0.0, tip=0.0, rnd=None):
    """A thick leaf blade (closed, so it shows from both sides): tapered, arching down by `droop`."""
    bm = bmesh.new()
    d = Vector(direction).normalized()
    up = Vector((0, 1, 0))
    side = d.cross(up)
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    norm = side.cross(d).normalized()
    top, bot = [], []
    base = Vector(base)
    for k in range(segs + 1):
        t = k / segs
        along = d * (length * t)
        fall = -up * (droop * length * t * t)
        w = width * (math.sin(math.pi * min(1.0, t + 0.02)) ** (1.0 - tip * 0.8)) * (1.0 - t * 0.15)
        c = base + along + fall
        cu = side * (w * 0.5)
        lift = norm * (curl * w * 0.5)
        top.append((c - cu + lift, c + cu + lift))
    for k in range(segs + 1):
        a, b = top[k]
        n = norm * thick
        top[k] = (bm.verts.new(a + n * 0.5), bm.verts.new(b + n * 0.5))
        bot.append((bm.verts.new(a - n * 0.5), bm.verts.new(b - n * 0.5)))
    for k in range(segs):
        bm.faces.new((top[k][0], top[k][1], top[k + 1][1], top[k + 1][0]))
        bm.faces.new((bot[k][0], bot[k + 1][0], bot[k + 1][1], bot[k][1]))
        bm.faces.new((top[k][0], top[k + 1][0], bot[k + 1][0], bot[k][0]))
        bm.faces.new((top[k][1], bot[k][1], bot[k + 1][1], top[k + 1][1]))
    bm.faces.new((top[0][0], bot[0][0], bot[0][1], top[0][1]))
    bm.faces.new((top[-1][0], top[-1][1], bot[-1][1], bot[-1][0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def blade(base, direction, length, width, droop=0.25, segs=3):
    """A thin grass blade: an open strip (the game draws ground cover two-sided)."""
    bm = bmesh.new()
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
    pts = []
    for k in range(segs + 1):
        t = k / segs
        c = Vector(base) + d * (length * t) - Vector((0, 1, 0)) * (droop * length * t * t)
        w = width * (1.0 - t) * 0.5 + 0.002
        pts.append((bm.verts.new(c - side * w), bm.verts.new(c + side * w)))
    for k in range(segs):
        bm.faces.new((pts[k][0], pts[k][1], pts[k + 1][1], pts[k + 1][0]))
    return bm


def disc(c, r, n=7, tilt=0.0, yaw=0.0, thick=0.008):
    """A small flat round piece (petal, clover leaf, fallen leaf)."""
    bm = bmesh.new()
    top, bot = [], []
    m = Matrix.Rotation(yaw, 3, 'Y') @ Matrix.Rotation(tilt, 3, 'X')
    for i in range(n):
        a = 2 * math.pi * i / n
        p = m @ Vector((math.cos(a) * r[0], 0, math.sin(a) * r[1]))
        top.append(bm.verts.new(Vector(c) + p + m @ Vector((0, thick / 2, 0))))
        bot.append(bm.verts.new(Vector(c) + p - m @ Vector((0, thick / 2, 0))))
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def cloud(model, node, role, color, centre, radius, rng, n=8, height=1.0, lump=0.12, flat=0.55, sub=2):
    """An AC-style canopy: one big soft ball ringed by smaller puffs, flattish underneath."""
    p = model.part(node, role, color)
    cx, cy, cz = centre
    p.merge(blob(centre, (radius, radius * 0.86 * height, radius), sub=sub + 1, lump=lump, seed=rng.random() * 9, flat=flat))
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.25, 0.25)
        el = rng.uniform(-0.15, 0.55)
        rr = radius * rng.uniform(0.42, 0.55)
        d = radius * 0.78
        c = (cx + math.cos(a) * d * math.cos(el), cy + math.sin(el) * radius * 0.7 * height, cz + math.sin(a) * d * math.cos(el))
        p.merge(blob(c, (rr, rr * 0.9, rr), sub=sub, lump=lump, seed=rng.random() * 9, flat=0.7))
    top = radius * 0.5
    p.merge(blob((cx + rng.uniform(-0.1, 0.1) * radius, cy + radius * 0.62 * height, cz), (top, top * 0.8, top), sub=sub, lump=lump, seed=rng.random() * 9))


def snow_caps(model, node, centre, radius, rng, height=1.0, n=5):
    """Snow lying on top of a canopy: flattened white puffs."""
    p = model.part(node, 'snow', '#f6f9fc')
    cx, cy, cz = centre
    p.merge(blob((cx, cy + radius * 0.72 * height, cz), (radius * 0.62, radius * 0.22, radius * 0.62), sub=2, lump=0.08, seed=rng.random() * 9, flat=0.2))
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.3, 0.3)
        c = (cx + math.cos(a) * radius * 0.55, cy + radius * 0.5 * height, cz + math.sin(a) * radius * 0.55)
        p.merge(blob(c, (radius * 0.3, radius * 0.12, radius * 0.3), sub=1, lump=0.1, seed=rng.random() * 9, flat=0.2))


def trunk(model, height, r0, r1, rng, color='#7a5230', lean=(0.0, 0.0), flare=1.6, roots=5, seg=12, node='trunk'):
    """A stubby, slightly tapered trunk with a soft root flare."""
    p = model.part(node, 'trunk', color)
    prof = [(r0 * flare, 0.0), (r0 * 1.18, 0.06), (r0, 0.16), (r0 * 0.94, height * 0.4), ((r0 + r1) * 0.5, height * 0.7), (r1, height)]
    bm = lathe(prof, seg=seg, cap_bottom=False, wobble=0.05, seed=rng.random() * 9)
    for v in bm.verts:
        t = max(0.0, v.co.y) / height
        v.co.x += lean[0] * t * t
        v.co.z += lean[1] * t * t
    p.merge(bm)
    for i in range(roots):
        a = 2 * math.pi * i / roots + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), 0, math.sin(a)))
        p.merge(tube([d * r0 * 0.6 + Vector((0, 0.12, 0)), d * r0 * 1.5 + Vector((0, 0.03, 0)), d * r0 * 2.1 + Vector((0, -0.01, 0))],
                     [r0 * 0.38, r0 * 0.24, r0 * 0.1], seg=6))


def bare_branches(model, height, r1, rng, color, n=4, spread=0.75, top=0.9):
    """Winter branches for deciduous trees: a few curved limbs with twigs."""
    p = model.part('branches', 'branches', color)
    base = Vector((0, height, 0))
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), 0, math.sin(a)))
        mid = base + d * spread * 0.45 + Vector((0, top * 0.45, 0))
        tip = base + d * spread + Vector((0, top * rng.uniform(0.8, 1.0), 0))
        p.merge(tube([base - Vector((0, 0.15, 0)), mid, tip], [r1 * 0.75, r1 * 0.45, r1 * 0.12], seg=7))
        for s in (-1, 1):
            tw = mid + (d * 0.18 + Vector((-d.z * s, 0, d.x * s)) * 0.2 + Vector((0, 0.3, 0)))
            p.merge(tube([mid, tw], [r1 * 0.22, r1 * 0.06], seg=5))
    p.merge(tube([base - Vector((0, 0.1, 0)), base + Vector((0, top * 1.1, 0))], [r1 * 0.85, r1 * 0.12], seg=8))


def fruit_points(model, centre, radius, n, rng, height=1.0, y0=-0.2, y1=0.25, out=1.0):
    """Where fruit hangs: on the canopy's skin, round the sides."""
    for i in range(n):
        a = 2 * math.pi * (i + 0.5) / n + rng.uniform(-0.2, 0.2)
        y = rng.uniform(y0, y1)
        r = radius * out * math.sqrt(max(0.15, 1 - y * y))
        model.empty(f'fruit{i}', (centre[0] + math.cos(a) * r, centre[1] + y * radius * height, centre[2] + math.sin(a) * r))


# ── Trees ──────────────────────────────────────────────────────────────────

def tree_round(name, seed, h=1.25, rad=0.86, fruit=0, pink=False, wide=1.0):
    """Oak / apple / cherry: a stubby trunk under one big lumpy cotton-ball canopy."""
    rng = random.Random(seed)
    m = Model(f'tree_{name}', 'tree')
    trunk(m, h, 0.16, 0.12, rng, lean=(rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04)))
    c = (0.0, h + rad * 0.7, 0.0)
    cloud(m, 'foliage', 'foliage', '#5fae46', c, rad * wide, rng, n=8 if not pink else 9, lump=0.14 if not pink else 0.18)
    snow_caps(m, 'snow', c, rad * wide, rng)
    bare_branches(m, h, 0.12, rng, '#7a5230')
    if fruit:
        fruit_points(m, c, rad * wide, fruit, rng, out=1.02)
    return m


def tree_birch(seed):
    rng = random.Random(seed)
    m = Model('tree_birch', 'tree')
    h = 1.7
    trunk(m, h, 0.09, 0.065, rng, color='#e8e4da', flare=1.35, roots=4, seg=10)
    # Dark bark marks: thin curved patches hugging the trunk.
    mk = m.part('marks', 'marks', '#2b2622')
    for i in range(9):
        y = rng.uniform(0.25, h - 0.1)
        a = rng.uniform(0, 2 * math.pi)
        r = 0.083 - y * 0.012
        arc = [Vector((math.cos(a + t * 0.9) * (r + 0.004), y + rng.uniform(-0.01, 0.01), math.sin(a + t * 0.9) * (r + 0.004))) for t in (0, 0.5, 1)]
        mk.merge(tube(arc, [0.012, 0.016, 0.01], seg=5))
    # A tall soft oval of stacked puffs.
    fol = m.part('foliage', 'foliage', '#7fc650')
    for k, (y, r) in enumerate(((h + 0.25, 0.46), (h + 0.62, 0.42), (h + 0.95, 0.32))):
        fol.merge(blob((rng.uniform(-0.04, 0.04), y, rng.uniform(-0.04, 0.04)), (r, r * 0.9, r), sub=3, lump=0.14, seed=rng.random() * 9, flat=0.6))
        for i in range(5):
            a = 2 * math.pi * i / 5 + k
            fol.merge(blob((math.cos(a) * r * 0.75, y + rng.uniform(-0.1, 0.1), math.sin(a) * r * 0.75), (r * 0.45,) * 3, sub=2, lump=0.12, seed=rng.random() * 9))
    sn = m.part('snow', 'snow', '#f6f9fc')
    sn.merge(blob((0, h + 1.2, 0), (0.24, 0.09, 0.24), sub=2, lump=0.06, flat=0.2))
    sn.merge(blob((0, h + 0.86, 0), (0.36, 0.08, 0.36), sub=2, lump=0.06, flat=0.2))
    bare_branches(m, h, 0.065, rng, '#e8e4da', n=5, spread=0.42, top=1.0)
    return m


def tree_pine(seed):
    """A tiered cedar: soft cones with drooping skirts, stacked with a little gap, trunk showing."""
    rng = random.Random(seed)
    m = Model('tree_pine', 'tree')
    trunk(m, 1.0, 0.12, 0.09, rng, color='#5b3b25', flare=1.4, roots=4)
    fol = m.part('foliage', 'foliage', '#2e6b43')
    sn = m.part('snow', 'snow', '#f6f9fc')
    tiers = ((0.78, 0.8, 0.78), (1.27, 0.64, 0.7), (1.72, 0.47, 0.62), (2.1, 0.3, 0.55))
    for (y, r, hgt) in tiers:
        # skirt: tucked-in underside, rounded drooping rim, then the slope up to a soft point
        prof = [(r * 0.18, y + 0.06), (r * 0.78, y - 0.02), (r * 0.97, y + 0.02), (r, y + 0.08), (r * 0.9, y + 0.15),
                (r * 0.6, y + hgt * 0.45), (r * 0.3, y + hgt * 0.72), (r * 0.08, y + hgt * 0.88), (0.0, y + hgt * 0.9)]
        fol.merge(lathe(prof, seg=16, cap_top=False, cap_bottom=True, wobble=0.05, seed=rng.random() * 9))
        # snow lies on the upper slope of each tier: the slope above the rim, lifted just off it
        f0 = 0.3
        slope = [(r * (0.9 - 0.3 * f0), y + 0.15 + (hgt * 0.45 - 0.15) * f0), (r * 0.6, y + hgt * 0.45), (r * 0.3, y + hgt * 0.72),
                 (r * 0.08, y + hgt * 0.88), (0.0, y + hgt * 0.9)]
        sn.merge(lathe([(a * 1.06, b + 0.03) for a, b in slope], seg=16, cap_top=False, cap_bottom=False, wobble=0.07, seed=rng.random() * 9))
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        y, r = ((0.82, 0.74), (1.31, 0.6), (1.76, 0.44), (0.86, 0.72), (1.33, 0.58))[i]
        m.empty(f'fruit{i}', (math.cos(a) * r, y, math.sin(a) * r))
    return m


def palm_trunk(m, h, lean, rng, color, rings=9, r0=0.12, r1=0.08):
    """A curved palm trunk of slightly bulging rings."""
    p = m.part('trunk', 'trunk', color)
    pts = []
    for k in range(rings + 1):
        t = k / rings
        pts.append(Vector((lean[0] * t * t, h * t, lean[1] * t * t)))
    for k in range(rings):
        a, b = pts[k], pts[k + 1]
        r = r0 + (r1 - r0) * k / rings
        p.merge(tube([a, a.lerp(b, 0.15), a.lerp(b, 0.7), b], [r * 0.92, r * 1.08, r * 1.05, r * 0.9], seg=10))
    return pts[-1]


def tree_palm(seed, date=False):
    rng = random.Random(seed)
    m = Model('tree_date_palm' if date else 'tree_palm', 'tree')
    h = 2.05 if date else 1.85
    top = palm_trunk(m, h, (0.05, 0.02) if date else (0.32, 0.1), rng, '#a77b4f', rings=11 if date else 9)
    fol = m.part('foliage', 'foliage', '#3fae4a')
    n = 10 if date else 8
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.15, 0.15)
        up = rng.uniform(0.25, 0.55) if date else rng.uniform(0.1, 0.4)
        d = (math.cos(a), up, math.sin(a))
        fol.merge(leaf(top + Vector((0, 0.03, 0)), d, 0.92 if date else 0.95, 0.4 if date else 0.48, droop=0.7 if not date else 0.55, segs=9, thick=0.022, curl=0.4, tip=0.35))
    fol.merge(blob((top.x, top.y + 0.02, top.z), (0.13, 0.1, 0.13), sub=2, lump=0.05))
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.4
        if date:
            m.empty(f'fruit{i}', (top.x + math.cos(a) * 0.17, top.y - 0.16, top.z + math.sin(a) * 0.17))
        else:
            m.empty(f'fruit{i}', (top.x + math.cos(a) * 0.12, top.y - 0.1, top.z + math.sin(a) * 0.12))
    return m


def tree_banana(seed):
    rng = random.Random(seed)
    m = Model('tree_banana', 'tree')
    tr = m.part('trunk', 'trunk', '#7c9a3a')
    tr.merge(lathe([(0.19, 0), (0.17, 0.12), (0.14, 0.7), (0.12, 1.25), (0.1, 1.42)], seg=12, cap_bottom=False, wobble=0.06))
    fol = m.part('foliage', 'foliage', '#58b947')
    top = Vector((0, 1.38, 0))
    for i in range(7):
        a = 2 * math.pi * i / 6 + rng.uniform(-0.2, 0.2)
        fol.merge(leaf(top, (math.cos(a), rng.uniform(0.6, 1.0), math.sin(a)), 1.02, 0.5, droop=0.6, segs=9, thick=0.022, curl=0.3, tip=0.6))
    fol.merge(leaf(top, (0.05, 1, 0.02), 0.6, 0.28, droop=0.05, segs=5, thick=0.022, curl=0.6, tip=0.5))
    for i in range(4):
        a = 2 * math.pi * i / 4 + 0.6
        m.empty(f'fruit{i}', (math.cos(a) * 0.19, 1.1, math.sin(a) * 0.19))
    return m


def tree_flat(name, seed, h, trunk_color, rad, fork=False, buttress=False):
    """Acacia (forked trunk, wide flat top) and kapok (tall, buttress roots, layered top)."""
    rng = random.Random(seed)
    m = Model(f'tree_{name}', 'tree')
    tr = m.part('trunk', 'trunk', trunk_color)
    if fork:
        base = Vector((0, 0, 0))
        mid = Vector((0.04, h * 0.45, 0.02))
        tr.merge(tube([base, base + Vector((0, 0.08, 0)), mid], [0.14, 0.11, 0.09], seg=10))
        for s in (-1, 1):
            tr.merge(tube([mid, mid + Vector((s * 0.22, h * 0.3, s * 0.06)), Vector((s * 0.42, h, s * 0.1))], [0.08, 0.065, 0.05], seg=8))
        tops = [Vector((-0.42, h + 0.08, -0.1)), Vector((0.42, h + 0.08, 0.1))]
    else:
        trunk(m, h, 0.2, 0.14, rng, color=trunk_color, flare=2.0 if buttress else 1.5, roots=7 if buttress else 0)
        tops = [Vector((0, h, 0))]
    fol = m.part('foliage', 'foliage', '#7a9a3a')
    for t in tops:
        fol.merge(blob((t.x, t.y + 0.12, t.z), (rad * 0.62, rad * 0.2, rad * 0.62), sub=3, lump=0.12, seed=rng.random() * 9, flat=0.4))
    for i in range(9):
        a = 2 * math.pi * i / 9 + rng.uniform(-0.2, 0.2)
        r = rad * rng.uniform(0.55, 0.78)
        y = tops[0].y + (0.16 if not buttress else 0.1) + rng.uniform(-0.04, 0.08)
        c = (math.cos(a) * r, y, math.sin(a) * r)
        rr = rad * rng.uniform(0.3, 0.4)
        fol.merge(blob(c, (rr, rr * 0.42, rr), sub=2, lump=0.12, seed=rng.random() * 9, flat=0.3))
    if buttress:
        fol.merge(blob((0, h + 0.42, 0), (rad * 0.55, rad * 0.22, rad * 0.55), sub=2, lump=0.12, flat=0.3))
    return m


def tree_cactus(seed):
    rng = random.Random(seed)
    m = Model('tree_cactus', 'tree')
    body = m.part('trunk', 'trunk', '#4f8a3c')
    ribs = m.part('ribs', 'ribs', '#3f7030')

    def column(base, top, r):
        body.merge(tube([base, base.lerp(top, 0.5), top], [r, r, r], seg=12, cap=False))
        body.merge(blob((top.x, top.y, top.z), (r, r * 0.95, r), sub=2))
        for i in range(8):
            a = 2 * math.pi * i / 8
            o = Vector((math.cos(a) * r, 0, math.sin(a) * r))
            ribs.merge(tube([base + o * 1.02, top + o * 1.02, top + o * 0.6 + Vector((0, r * 0.6, 0))], [0.012, 0.012, 0.008], seg=4))

    column(Vector((0, 0, 0)), Vector((0, 1.32, 0)), 0.2)
    for s, y0, y1, out in ((1, 0.5, 1.02, 0.42), (-1, 0.7, 1.12, 0.38)):
        p0 = Vector((s * 0.16, y0, 0.02 * s))
        p1 = Vector((s * out, y0 + 0.02, 0.04 * s))
        body.merge(tube([p0, p0.lerp(p1, 0.5) + Vector((0, -0.04, 0)), p1], [0.12, 0.12, 0.12], seg=10, cap=False))
        body.merge(blob((p1.x, p1.y, p1.z), (0.12, 0.12, 0.12), sub=2))
        column(p1, Vector((s * out, y1, 0.04 * s)), 0.12)
    sn = m.part('snow', 'snow', '#f6f9fc')
    sn.merge(blob((0, 1.47, 0), (0.17, 0.07, 0.17), sub=2, flat=0.2))
    for s, y1, out in ((1, 1.02, 0.42), (-1, 1.12, 0.38)):
        sn.merge(blob((s * out, y1 + 0.13, 0.04 * s), (0.1, 0.05, 0.1), sub=2, flat=0.2))
    for i, (x, y, z) in enumerate(((0.0, 1.5, 0.08), (0.45, 1.14, 0.06), (-0.4, 1.24, -0.04), (0.12, 1.47, -0.1))):
        m.empty(f'fruit{i}', (x, y, z))
    return m


# ── Bushes, sapling ────────────────────────────────────────────────────────

def berries(m, color, pts, r=0.045):
    p = m.part('berries', 'berry', color)
    for c in pts:
        p.merge(blob(c, (r, r, r), sub=1))


def bush_round(name, color, berry, seed, size=1.0):
    """A rounded leafy mound of soft lumps (grassland, forest)."""
    rng = random.Random(seed)
    m = Model(name, 'kit')
    m.part('leaves', 'trunk', '#6d4c2f').merge(lathe([(0.05, 0), (0.04, 0.12)], seg=6))
    cloud(m, 'leaves', 'leaves', color, (0, 0.33 * size, 0), 0.36 * size, rng, n=6, height=0.8, lump=0.14, flat=0.75, sub=2)
    if berry:
        pts = []
        for i in range(10):
            a = 2 * math.pi * i / 10 + rng.uniform(-0.2, 0.2)
            y = rng.uniform(0.18, 0.55) * size
            r = (0.42 - abs(y - 0.33 * size) * 0.5) * size
            pts.append((math.cos(a) * r, y, math.sin(a) * r))
        berries(m, berry, pts)
    return m


def bush_broad(name, color, berry, seed, size=1.0):
    """A big, glossy rounded shrub of large puffs, flowers dotted over it (tropical, jungle)."""
    rng = random.Random(seed)
    m = Model(name, 'kit')
    cloud(m, 'leaves', 'leaves', color, (0, 0.3 * size, 0), 0.38 * size, rng, n=7, height=0.78, lump=0.1, flat=0.8, sub=2)
    lv = m.part('leaves', 'leaves', color)
    for i in range(6):  # a few big leaves poking out of the mound
        a = 2 * math.pi * i / 6 + rng.uniform(-0.3, 0.3)
        lv.merge(leaf((math.cos(a) * 0.2 * size, 0.12 * size, math.sin(a) * 0.2 * size), (math.cos(a), 0.3, math.sin(a)), 0.32 * size, 0.2 * size, droop=0.5, segs=5, thick=0.02, curl=0.3, tip=0.5))
    if berry:
        p = m.part('berries', 'berry', berry)
        for i in range(5):
            a = 2 * math.pi * i / 5 + 0.3
            y = (0.32 + 0.16 * (i % 2)) * size
            r = (0.38 - (y - 0.3 * size) * 0.6) * size
            c = (math.cos(a) * r, y, math.sin(a) * r)
            out = Vector((math.cos(a), 0.4, math.sin(a))).normalized()
            for k in range(5):  # hibiscus: five round petals round a yellow middle
                b = 2 * math.pi * k / 5
                side = out.cross(Vector((0, 1, 0))).normalized()
                up = side.cross(out).normalized()
                pc = Vector(c) + (side * math.cos(b) + up * math.sin(b)) * 0.045 * size
                p.merge(blob(tuple(pc), (0.038 * size,) * 3, sub=1))
            m.part('berries', 'centre', '#ffd54f').merge(blob(tuple(Vector(c) + out * 0.02), (0.02 * size,) * 3, sub=1))
    return m


def bush_cloudberry(name, color, berry, seed):
    """Low and spread out: round leaves on short stems, orange berries (nordic)."""
    rng = random.Random(seed)
    m = Model(name, 'kit')
    lv = m.part('leaves', 'leaves', color)
    st = m.part('leaves', 'stem', '#4f9e3a')
    for i in range(10):
        a = 2 * math.pi * i / 10 + rng.uniform(-0.3, 0.3)
        r = rng.uniform(0.1, 0.27)
        c = (math.cos(a) * r, 0.1 + rng.uniform(0, 0.08), math.sin(a) * r)
        st.merge(tube([(c[0] * 0.4, 0, c[2] * 0.4), c], [0.012, 0.01], seg=5))
        lv.merge(blob(c, (0.1, 0.035, 0.1), sub=2, lump=0.15, seed=rng.random() * 9))
    lv.merge(blob((0, 0.1, 0), (0.16, 0.08, 0.16), sub=2, lump=0.12))
    if berry:
        berries(m, berry, [(math.cos(a) * 0.17, 0.2, math.sin(a) * 0.17) for a in (0.4, 1.5, 2.7, 3.9, 5.1)] + [(0.03, 0.2, -0.02)], r=0.04)
    return m


def bush_herb(name, color, flower, seed, sparse=False):
    """A tall narrow clump of soft spikes (oasis herbs) or a sparse twiggy scrub (desert)."""
    rng = random.Random(seed)
    m = Model(name, 'kit')
    lv = m.part('leaves', 'leaves', color)
    st = m.part('leaves', 'stem', '#7b6a3a' if sparse else '#5a8f3a')
    n = 7 if sparse else 9
    if not sparse:
        lv.merge(blob((0, 0.16, 0), (0.17, 0.15, 0.17), sub=2, lump=0.1, seed=seed, flat=0.7))
    tops = []
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.3, 0.3)
        r = rng.uniform(0.04, 0.12)
        top = Vector((math.cos(a) * r * 1.8, rng.uniform(0.32, 0.5), math.sin(a) * r * 1.8))
        st.merge(tube([(math.cos(a) * r * 0.3, 0, math.sin(a) * r * 0.3), top * 0.55, top], [0.016, 0.012, 0.008], seg=5))
        if sparse:
            for k in range(3):
                lv.merge(blob(tuple(top * (0.55 + k * 0.2)), (0.045, 0.04, 0.045), sub=1, lump=0.15, seed=rng.random() * 9))
        else:
            lv.merge(blob(tuple(top * 0.7), (0.09, 0.13, 0.09), sub=2, lump=0.1, seed=rng.random() * 9))
        tops.append(top)
    if sparse:
        m.part('leaves', 'rock', '#b59a74').merge(blob((0.12, 0.03, -0.08), (0.08, 0.05, 0.07), sub=2, lump=0.15, flat=0.5))
    if flower:
        p = m.part('berries', 'berry', flower)
        for t in tops[::2]:
            p.merge(blob(tuple(t + Vector((0, 0.02, 0))), (0.03, 0.03, 0.03), sub=1))
    return m


def sapling():
    rng = random.Random(5)
    m = Model('sapling', 'kit')
    m.part('main', 'mound', '#7a5a3a').merge(blob((0, 0.0, 0), (0.17, 0.06, 0.15), sub=2, lump=0.12, flat=0.1))
    m.part('main', 'trunk', '#8a6a45').merge(tube([(0, 0.02, 0), (0.01, 0.2, 0), (-0.01, 0.4, 0.01)], [0.025, 0.02, 0.014], seg=7))
    tw = m.part('main', 'twig', '#8a6a45')
    tw.merge(tube([(0.0, 0.26, 0), (0.08, 0.36, 0.02)], [0.01, 0.006], seg=5))
    lf = m.part('main', 'leaf', '#6fc24f')
    for c, d in (((-0.01, 0.42, 0.01), (0.2, 1, 0.1)), ((0.08, 0.36, 0.02), (1, 0.6, 0.2)), ((0.0, 0.3, 0.0), (-1, 0.5, -0.3))):
        lf.merge(leaf(c, d, 0.13, 0.08, droop=0.25, segs=4, thick=0.01, curl=0.2))
    return m


# ── Rocks, pebbles ─────────────────────────────────────────────────────────

def rock(name, seed, size=1.0, color='#a7a29a', ore=None, moss=None):
    """A smooth, chunky boulder: a soft lump with a flat underside."""
    rng = random.Random(seed)
    m = Model(name, 'kit')
    main = m.part('main', 'rock', color)
    main.merge(blob((0, 0.2 * size, 0), (0.42 * size, 0.3 * size, 0.34 * size), sub=3, lump=0.16, seed=rng.random() * 9, flat=0.62, freq=2.2))
    main.merge(blob((0.22 * size, 0.12 * size, 0.1 * size), (0.2 * size, 0.15 * size, 0.18 * size), sub=2, lump=0.15, seed=rng.random() * 9, flat=0.6))
    if ore:
        o = m.part('main', 'ore', ore)
        for i in range(6):
            a = 2 * math.pi * i / 6 + rng.uniform(-0.3, 0.3)
            y = rng.uniform(0.12, 0.36) * size
            o.merge(blob((math.cos(a) * 0.37 * size, y, math.sin(a) * 0.3 * size), (0.06, 0.05, 0.06), sub=1, lump=0.2, seed=rng.random() * 9))
    if moss:
        mo = m.part('main', 'moss', moss)
        mo.merge(blob((0, 0.42 * size, 0.0), (0.33 * size, 0.1 * size, 0.27 * size), sub=2, lump=0.2, seed=rng.random() * 9, flat=0.3))
        for i in range(3):
            a = 2 * math.pi * i / 3 + 0.5
            mo.merge(blob((math.cos(a) * 0.24 * size, 0.36 * size, math.sin(a) * 0.2 * size), (0.13, 0.06, 0.12), sub=1, lump=0.2, seed=rng.random() * 9, flat=0.3))
    return m


def pebbles():
    rng = random.Random(10)
    m = Model('pebbles', 'kit')
    for i, c in enumerate(((-0.12, 0, 0.02), (0.06, 0, -0.05), (0.16, 0, 0.06), (-0.02, 0, 0.08))):
        col = '#b9b2a6' if i % 2 == 0 else '#9e988e'
        r = rng.uniform(0.045, 0.07)
        m.part('main', 'pebble', col).merge(blob((c[0], r * 0.32, c[2]), (r, r * 0.45, r * 0.8), sub=1, lump=0.12, seed=rng.random() * 9, flat=0.4))
    return m


# ── Ground cover (instanced in thousands: kept light) ───────────────────────

def tuft(name, n, h, w, seed, spread=0.06, droop=0.25):
    rng = random.Random(seed)
    m = Model(name, 'kit')
    p = m.part('main', 'blade', '#7fc650')
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.3, 0.3)
        base = (math.cos(a) * spread * rng.uniform(0.3, 1), 0, math.sin(a) * spread * rng.uniform(0.3, 1))
        d = (math.cos(a) * 0.35, 1, math.sin(a) * 0.35)
        p.merge(blade(base, d, h * rng.uniform(0.75, 1.05), w, droop=droop, segs=2), smooth=False)
    return m


def fern():
    rng = random.Random(4)
    m = Model('fern', 'kit')
    p = m.part('main', 'frond', '#4f9e3a')
    for i in range(6):
        a = 2 * math.pi * i / 6 + rng.uniform(-0.2, 0.2)
        p.merge(leaf((0, 0.02, 0), (math.cos(a), 0.55, math.sin(a)), 0.36, 0.13, droop=0.8, segs=4, thick=0.004, curl=0.15), smooth=False)
    return m


def reeds():
    rng = random.Random(5)
    m = Model('reeds', 'kit')
    p = m.part('main', 'reed', '#7fae4a')
    for i in range(6):
        a = 2 * math.pi * i / 6 + rng.uniform(-0.3, 0.3)
        p.merge(blade((math.cos(a) * 0.05, 0, math.sin(a) * 0.05), (math.cos(a) * 0.15, 1, math.sin(a) * 0.15), rng.uniform(0.5, 0.68), 0.04, droop=0.15, segs=3), smooth=False)
    c = m.part('main', 'cattail', '#7a4e2c')
    for x, z, hgt in ((0.02, -0.03, 0.62), (-0.05, 0.04, 0.55)):
        st = m.part('main', 'reed', '#7fae4a')
        st.merge(tube([(x, 0, z), (x, hgt, z)], [0.008, 0.006], seg=4))
        c.merge(lathe([(0.0, hgt - 0.02), (0.025, hgt), (0.028, hgt + 0.08), (0.0, hgt + 0.11)], seg=6, cap_top=False, cap_bottom=False))
    return m


def wildflowers():
    rng = random.Random(6)
    m = Model('wildflowers', 'kit')
    bl = m.part('main', 'blade', '#6fbf4f')
    for i in range(4):
        a = 2 * math.pi * i / 4 + 0.3
        bl.merge(blade((math.cos(a) * 0.03, 0, math.sin(a) * 0.03), (math.cos(a) * 0.4, 1, math.sin(a) * 0.4), 0.14, 0.03, segs=2), smooth=False)
    for i, (x, z, col) in enumerate(((0.05, 0.02, '#ffffff'), (-0.06, 0.05, '#ff8fb1'), (0.0, -0.08, '#ffd54f'))):
        hgt = rng.uniform(0.15, 0.2)
        m.part('main', 'stem', '#4f9e3a').merge(tube([(x * 0.4, 0, z * 0.4), (x, hgt, z)], [0.006, 0.005], seg=4))
        pe = m.part('main', 'petal', col)
        for k in range(5):
            b = 2 * math.pi * k / 5
            pe.merge(disc((x + math.cos(b) * 0.022, hgt + 0.004, z + math.sin(b) * 0.022), (0.02, 0.013), n=5, tilt=0.25, yaw=-b), smooth=False)
        m.part('main', 'centre', '#ffcf3a').merge(blob((x, hgt + 0.01, z), (0.012, 0.008, 0.012), sub=1))
    return m


def clover():
    rng = random.Random(7)
    m = Model('clover', 'kit')
    lf = m.part('main', 'leaf', '#5fb04a')
    for i in range(4):
        a = 2 * math.pi * i / 4 + rng.uniform(-0.3, 0.3)
        c = (math.cos(a) * 0.08, rng.uniform(0.04, 0.07), math.sin(a) * 0.08)
        m.part('main', 'stem', '#4f9e3a').merge(blade((c[0] * 0.3, 0, c[2] * 0.3), (c[0], c[1], c[2]), 0.07, 0.01, droop=0, segs=1), smooth=False)
        for k in range(3):
            b = 2 * math.pi * k / 3 + a
            lf.merge(disc((c[0] + math.cos(b) * 0.025, c[1], c[2] + math.sin(b) * 0.025), (0.026, 0.022), n=6, tilt=0.1, yaw=-b), smooth=False)
    return m


def fallen_leaves():
    rng = random.Random(8)
    m = Model('fallen_leaves', 'kit')
    for i in range(7):
        col = ('#d98a2b', '#c9622b', '#e8b23a')[i % 3]
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.02, 0.22)
        m.part('main', 'leaf', col).merge(disc((math.cos(a) * r, 0.006 + i * 0.002, math.sin(a) * r), (0.05, 0.03), n=6, tilt=rng.uniform(-0.15, 0.15), yaw=rng.uniform(0, 6)), smooth=False)
    return m


def snow_clump():
    m = Model('snow_clump', 'kit')
    m.part('main', 'snow', '#f4f8fb').merge(blob((0, 0, 0), (0.2, 0.08, 0.14), sub=2, lump=0.15, seed=3, flat=0.05))
    m.part('main', 'snow', '#f4f8fb').merge(blob((0.12, 0, 0.05), (0.1, 0.05, 0.09), sub=1, lump=0.1, seed=5, flat=0.05))
    return m


# ── The catalogue ──────────────────────────────────────────────────────────

BUSHES = {
    'grassland': ('#4f9e45', '#6a4bb8', 'round', 1.0),
    'forest_edge': ('#3d8743', '#3a1f5a', 'round', 1.0),
    'tropical': ('#2e9a50', '#e8463c', 'broad', 1.0),
    'jungle': ('#24804a', '#f2c230', 'broad', 1.45),
    'nordic': ('#47804f', '#ff9f1c', 'cloud', 1.0),
    'oasis': ('#7a9a48', '#c5e17a', 'herb', 1.0),
    'desert': ('#8f9452', '#c9a2e6', 'scrub', 1.0),
}


def catalogue():
    c = {
        'tree_oak': lambda: tree_round('oak', 11, h=1.25, rad=0.9),
        'tree_apple': lambda: tree_round('apple', 12, h=1.05, rad=0.8, fruit=6),
        'tree_cherry': lambda: tree_round('cherry', 13, h=1.1, rad=0.84, fruit=6, pink=True),
        'tree_birch': lambda: tree_birch(14),
        'tree_pine': lambda: tree_pine(15),
        'tree_palm': lambda: tree_palm(16),
        'tree_date_palm': lambda: tree_palm(17, date=True),
        'tree_banana': lambda: tree_banana(18),
        'tree_jungle_giant': lambda: tree_flat('jungle_giant', 19, 2.45, '#6a5139', 1.1, buttress=True),
        'tree_acacia': lambda: tree_flat('acacia', 20, 1.45, '#7d5a3a', 1.1, fork=True),
        'tree_cactus': lambda: tree_cactus(21),
        'sapling': sapling,
        'rock_1': lambda: rock('rock_1', 21, 1.0, '#a7a29a'),
        'rock_2': lambda: rock('rock_2', 37, 0.9, '#9c978f'),
        'rock_3': lambda: rock('rock_3', 53, 1.1, '#b0aaa0'),
        'rock_iron': lambda: rock('rock_iron', 71, 1.0, '#9c978f', ore='#c8743f'),
        'rock_mossy': lambda: rock('rock_mossy', 89, 1.0, '#a39e95', moss='#6fae4a'),
        'pebbles': pebbles,
        'grass_short': lambda: tuft('grass_short', 5, 0.15, 0.05, 1),
        'grass_tall': lambda: tuft('grass_tall', 7, 0.32, 0.055, 2, spread=0.09),
        'grass_dry': lambda: tuft('grass_dry', 5, 0.22, 0.04, 3, droop=0.45),
        'fern': fern,
        'reeds': reeds,
        'wildflowers': wildflowers,
        'clover': clover,
        'fallen_leaves': fallen_leaves,
        'snow_clump': snow_clump,
    }
    for b, (col, berry, kind, size) in BUSHES.items():
        name = f'bush_{b}'
        seed = 100 + len(c)
        if kind == 'round':
            c[name] = (lambda n=name, col=col, berry=berry, seed=seed: bush_round(n, col, berry, seed))
        elif kind == 'broad':
            c[name] = (lambda n=name, col=col, berry=berry, seed=seed, size=size: bush_broad(n, col, berry, seed, size))
        elif kind == 'cloud':
            c[name] = (lambda n=name, col=col, berry=berry, seed=seed: bush_cloudberry(n, col, berry, seed))
        else:
            c[name] = (lambda n=name, col=col, berry=berry, seed=seed, sparse=(kind == 'scrub'): bush_herb(n, col, berry, seed, sparse=sparse))
    return c


# ── Hand the meshes back ────────────────────────────────────────────────────

def _b64(fmt, values):
    return base64.b64encode(struct.pack(f'<{len(values)}{fmt}', *values)).decode()


def export(model):
    parts = []
    for (node, role, color), part in model.parts.items():
        bm = part.bm
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.normal_update()
        bm.verts.index_update()
        pos, nrm, idx = [], [], []
        # Smooth faces share vertex normals; flat ones (blades) get their own corners.
        flat_faces = [f for f in bm.faces if not f.smooth]
        for v in bm.verts:
            pos += [v.co.x, v.co.y, v.co.z]
            nrm += [v.normal.x, v.normal.y, v.normal.z]
        for f in bm.faces:
            if f.smooth:
                idx += [v.index for v in f.verts]
        base = len(bm.verts)
        for f in flat_faces:
            for v in f.verts:
                pos += [v.co.x, v.co.y, v.co.z]
                nrm += [f.normal.x, f.normal.y, f.normal.z]
            idx += [base, base + 1, base + 2]
            base += 3
        bm.free()
        parts.append({'node': node, 'role': role, 'color': color, 'pos': _b64('f', pos), 'nrm': _b64('f', nrm), 'idx': _b64('I', idx), 'tris': len(idx) // 3})
    return {'kind': model.kind, 'parts': parts, 'empties': model.empties}


def run(names=None):
    cat = catalogue()
    out = {}
    for n in names or list(cat):
        out[n] = export(cat[n]())
    return out
