# Builds the Hearthwood terrain tileset in Blender (run inside Blender).
#
# The terrain is assembled from QUARTER tiles (0.5 x 0.5). Each quarter picks a
# piece from its two side neighbours and the diagonal one:
#   edge   - one side is lower           (cliff face along local +x)
#   outer  - both sides are lower        (rounded convex corner)
#   inner  - only the diagonal is lower  (concave corner)
#   flat   - nothing lower               (drawn by the game, not stored here)
# Pieces span x, z in [0, 0.5] with the tile centre at the origin; the top is at
# y = 0 and the foot at y = -1 (the game scales y by the real drop). All edge
# variants share the same cross-section at their ends, so any piece fits next
# to any other. Two families: "cliff" (grass on top) and "bank" (sand, pond and
# river beds: gentler slope).
#
# Coordinates below are GAME coordinates (y up, z south); they're turned into
# Blender's z-up only when the mesh is written, so the glTF export (+Y up)
# gives back exactly these numbers.

import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler

PROFILES = {
    # (inset from the tile edge, y). Top lip first, foot last.
    'cliff': [(0.17, 0.0), (0.125, -0.012), (0.085, -0.05), (0.07, -0.13), (0.075, -0.24), (0.09, -0.3),
              (0.045, -0.31), (0.035, -0.38), (0.05, -0.55), (0.025, -0.63), (0.03, -0.82), (-0.02, -1.0)],
    'bank': [(0.26, 0.0), (0.2, -0.03), (0.15, -0.14), (0.11, -0.34), (0.07, -0.6), (0.03, -0.85), (-0.02, -1.0)],
}
RADIUS = {'cliff': 0.4, 'bank': 0.45}   # outer-corner rounding (must exceed the top inset)
NOISE = {'cliff': (0.022, 0.018), 'bank': (0.012, 0.01)}


def game_to_blender(v):
    x, y, z = v
    return Vector((x, -z, y))


class Piece:
    def __init__(self, seed):
        self.bm = bmesh.new()
        self.rng = random.Random(seed)
        self.cache = {}

    def v(self, p):
        key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
        if key not in self.cache:
            self.cache[key] = self.bm.verts.new(Vector(p))
        return self.cache[key]

    def face(self, pts):
        vs = []
        for p in pts:
            vv = self.v(p)
            if not vs or vs[-1] is not vv:
                vs.append(vv)
        if len(vs) > 2 and vs[0] is vs[-1]:
            vs.pop()
        if len(set(vs)) < 3:
            return None
        try:
            return self.bm.faces.new(vs)
        except ValueError:
            return None

    def noisy(self, prof, fam, ends):
        """Profile with jitter on interior columns (ends keep the shared shape)."""
        if ends:
            return list(prof)
        ni, ny = NOISE[fam]
        out = []
        for k, (i, y) in enumerate(prof):
            if k == 0:
                out.append((i, y))  # the lip stays on the top plane
            elif k == len(prof) - 1:
                out.append((i + self.rng.uniform(-ni, ni) * 0.5, y))  # foot stays on the ground below
            else:
                out.append((i + self.rng.uniform(-ni, ni), y + self.rng.uniform(-ny, ny)))
        return out

    def sweep(self, cols, outward):
        """cols: list of columns, each a list of 3D points top->foot. Quads between columns."""
        faces = []
        for j in range(len(cols) - 1):
            a, b = cols[j], cols[j + 1]
            for k in range(len(a) - 1):
                f = self.face([a[k], b[k], b[k + 1], a[k + 1]])
                if f:
                    faces.append(f)
        # Orient all side faces away from the hill (they're built consistently).
        best = max(faces, key=lambda f: (f.normal_update(), abs(Vector((f.normal.x, 0, f.normal.z)).length))[1])
        c = best.calc_center_median()
        if best.normal.dot(outward(c)) < 0:
            for f in faces:
                f.normal_flip()

    def top(self, pts):
        f = self.face([(x, 0.0, z) for x, z in pts])
        if f:
            f.normal_update()
            if f.normal.y < 0:
                f.normal_flip()

    def cap(self, col, plane):
        """Close the hill's cross-section at a piece end (hidden unless neighbours differ)."""
        if plane == 'z':  # end in a z = const plane; back of the hill is x = 0
            z = col[0][2]
            pts = [(0.0, 0.0, z)] + col + [(0.0, col[-1][1], z)]
        else:  # x = const plane; back is z = 0
            x = col[0][0]
            pts = [(x, 0.0, 0.0)] + col + [(x, col[-1][1], 0.0)]
        self.face(pts)

    def finish(self, name, material):
        bm = self.bm
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='EAR_CLIP')
        for vert in bm.verts:
            vert.co = game_to_blender(vert.co)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        o = bpy.data.objects.new(name, me)
        o.data.materials.append(material)
        bpy.context.scene.collection.objects.link(o)
        return o


def edge_piece(fam, seed, name, mat):
    p = Piece(seed)
    prof = PROFILES[fam]
    zs = [0, 0.125, 0.25, 0.375, 0.5]
    cols = []
    for j, z in enumerate(zs):
        pr = p.noisy(prof, fam, j in (0, len(zs) - 1))
        cols.append([(0.5 - i, y, z) for i, y in pr])
    p.sweep(cols, lambda c: Vector((1, 0, 0)))
    i0 = prof[0][0]
    p.top([(0, 0), (0, 0.5), (0.5 - i0, 0.5), (0.5 - i0, 0)])
    p.cap(cols[0], 'z')
    p.cap(cols[-1], 'z')
    return p.finish(name, mat)


def outer_piece(fam, seed, name, mat):
    p = Piece(seed)
    prof = PROFILES[fam]
    r = RADIUS[fam]
    c = 0.5 - r
    # Path: straight along x = 0.5 - i (z from 0 to c), arc round (c, c), straight along z = 0.5 - i.
    stations = [('a', 0.0), ('a', c / 2)] + [('arc', k * (math.pi / 2) / 4) for k in range(5)] + [('b', c / 2), ('b', 0.0)]

    def at(st, i):
        kind, t = st
        if kind == 'a':
            return (0.5 - i, t)
        if kind == 'b':
            return (t, 0.5 - i)
        return (c + (r - i) * math.cos(t), c + (r - i) * math.sin(t))

    cols = []
    for j, st in enumerate(stations):
        pr = p.noisy(prof, fam, j in (0, len(stations) - 1))
        cols.append([(*[at(st, i)[0]], y, at(st, i)[1]) for i, y in pr])
    p.sweep(cols, lambda q: Vector((q.x - c, 0, q.z - c)).normalized() if (q.x > c and q.z > c) else (Vector((1, 0, 0)) if q.z <= c else Vector((0, 0, 1))))
    i0 = prof[0][0]
    p.top([(0, 0)] + [at(st, i0) for st in stations])
    # Floor in the rounded-off corner, at the foot (else you'd see under the island).
    iF, yF = prof[-1]
    fl = p.face([col[-1] for col in cols] + [(0.5 - iF, yF, 0.5 - iF)])
    if fl:
        fl.normal_update()
        if fl.normal.y < 0:
            fl.normal_flip()
    p.cap(cols[0], 'z')    # the A end lies in the z = 0 plane
    p.cap(cols[-1], 'x')   # the B end lies in the x = 0 plane
    return p.finish(name, mat)


def inner_piece(fam, seed, name, mat):
    p = Piece(seed)
    prof = [(max(i, 0.004), y) for i, y in PROFILES[fam]]
    # Each profile point sweeps a quarter circle of radius i round the tile corner (0.5, 0.5).
    angles = [k * (math.pi / 2) / 4 for k in range(5)]
    cols = []
    for j, a in enumerate(angles):
        pr = p.noisy(prof, fam, j in (0, len(angles) - 1))
        cols.append([(0.5 - max(i, 0.004) * math.sin(a), y, 0.5 - max(i, 0.004) * math.cos(a)) for i, y in pr])
    p.sweep(cols, lambda q: Vector((0.5 - q.x, 0, 0.5 - q.z)).normalized())
    i0 = prof[0][0]
    arc = [(0.5 - i0 * math.sin(a), 0.5 - i0 * math.cos(a)) for a in angles]
    p.top([(0, 0), (0.5, 0)] + arc + [(0, 0.5)])
    p.cap(cols[0], 'x')    # x = 0.5 plane, hill behind towards z = 0
    p.cap(cols[-1], 'z')   # z = 0.5 plane, hill behind towards x = 0
    return p.finish(name, mat)


def hexcol(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c] + [1]


def material(name, color):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = hexcol(color)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    m.diffuse_color = hexcol(color)
    return m


def build_tileset():
    """All pieces at the origin, named tile_<family>_<kind>[_<variant>]."""
    out = []
    for fam, color in (('cliff', '#8a7356'), ('bank', '#cdb98a')):
        mat = material(f'tile_{fam}', color)
        for v in range(3):
            out.append(edge_piece(fam, 100 + v + (0 if fam == 'cliff' else 50), f'tile_{fam}_edge_{v}', mat))
        out.append(outer_piece(fam, 200 + (0 if fam == 'cliff' else 50), f'tile_{fam}_outer', mat))
        out.append(inner_piece(fam, 300 + (0 if fam == 'cliff' else 50), f'tile_{fam}_inner', mat))
    return out


# ---------------------------------------------------------------- preview
QUADS = [(1, 1), (-1, 1), (-1, -1), (1, -1)]


def assemble(name, heights, fams, pieces, tops, faces):
    """Same rules as the game (client/src/game/terrain.ts), for a quick preview."""
    data = {}
    for o in pieces:
        me = o.data
        tris = [[game_from_blender(me.vertices[i].co) for i in p.vertices] for p in me.polygons]
        data[o.name] = tris
    H = len(heights); W = len(heights[0])
    hgt = lambda x, z: heights[z][x] if 0 <= x < W and 0 <= z < H else heights[0][0]
    bm = bmesh.new()
    rng = random.Random(1)

    def tri(pts, top_col, face_col):
        vs = [bm.verts.new(game_to_blender(p)) for p in pts]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            return
        f.normal_update()
        ny = abs(f.normal.z)  # blender z = game y
        low = min(v.co.z for v in vs) < top_col - 0.03
        f.material_index = 0 if ny > 0.8 and not low else 1
        f.material_index += 2 * (face_col)

    for z in range(H):
        for x in range(W):
            h = hgt(x, z); fam = fams[z][x]
            for sx, sz in QUADS:
                dA = h - hgt(x + sx, z); dB = h - hgt(x, z + sz); dD = h - hgt(x + sx, z + sz)
                lA, lB, lD = dA > 0.01, dB > 0.01, dD > 0.01
                swap = False
                extra = None
                if lA and lB:
                    key, drop = f'tile_{fam}_outer', max(dA, dB)
                    if dD > drop + 0.01:
                        # Two-level corner: the lower layer needs its own inner corner.
                        extra = (f'tile_{fam}_inner', h - drop - 0.003, dD - drop)
                elif lA:
                    key, drop = f'tile_{fam}_edge_{rng.randrange(3)}', dA
                elif lB:
                    key, drop, swap = f'tile_{fam}_edge_{rng.randrange(3)}', dB, True
                elif lD:
                    key, drop = f'tile_{fam}_inner', dD
                else:
                    key = None
                famidx = 0 if fam == 'cliff' else 1
                if key is None:
                    q = [(0, 0), (0.5, 0), (0.5, 0.5), (0, 0.5)]
                    pts = [(x + 0.5 + sx * a, h, z + 0.5 + sz * b) for a, b in q]
                    tri(pts, h, famidx)
                    continue
                jobs = [(key, h, drop, swap)] + ([(extra[0], extra[1], extra[2], False)] if extra else [])
                for k2, hh, dd, sw in jobs:
                    for t in data[k2]:
                        pts = []
                        for lx, ly, lz in t:
                            if sw:
                                lx, lz = lz, lx
                            pts.append((x + 0.5 + sx * lx, hh + ly * dd, z + 0.5 + sz * lz))
                        tri(pts, hh, famidx)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    for m in faces:
        o.data.materials.append(m)
    bpy.context.scene.collection.objects.link(o)
    return o


def game_from_blender(v):
    return (v.x, v.z, -v.y)



# ---------------------------------------------------------------- stairs
# Stairs sit on a ramp tile: x in [-0.5, 0.5], the bottom edge at z = +0.5 (y = 0)
# and the top edge at z = -0.5 (y = 1, the next cliff level). The game turns
# them to face the ramp's direction. Each kind is an empty `stairs_<kind>` with
# one mesh per material; the colours come from the materials.

def mesh_obj(name, bm, material, parent):
    for vert in bm.verts:
        vert.co = game_to_blender(vert.co)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(material)
    bpy.context.scene.collection.objects.link(o)
    o.parent = parent
    return o


def box(bm, x0, x1, y0, y1, z0, z1, jitter=0.0, rng=None):
    g = bmesh.ops.create_cube(bm, size=1.0)
    for v in g['verts']:
        x = x0 if v.co.x < 0 else x1
        y = y0 if v.co.y < 0 else y1
        z = z0 if v.co.z < 0 else z1
        if jitter and rng:
            x += rng.uniform(-jitter, jitter); y += rng.uniform(-jitter, jitter) * 0.5; z += rng.uniform(-jitter, jitter)
        v.co = Vector((x, y, z))
    return g


def prism(bm, pts2d, x0, x1):
    """Extrude a (z, y) polygon along x from x0 to x1."""
    a = [bm.verts.new(Vector((x0, y, z))) for z, y in pts2d]
    b = [bm.verts.new(Vector((x1, y, z))) for z, y in pts2d]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([a[i], a[j], b[j], b[i]])


def cylinder_x(bm, x0, x1, y, z, r, seg=7):
    m = Matrix.Translation(((x0 + x1) / 2, y, z)) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4()  # cone axis z -> x
    return bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=x1 - x0, matrix=m)


def stairs_root(name):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.3
    bpy.context.scene.collection.objects.link(e)
    return e


STEPS = 5


def build_stairs():
    from mathutils import Matrix, Euler  # noqa: F401  (used by helpers)
    out = []
    rng = random.Random(7)
    run = 1.0 / STEPS

    # Stone stairs: chunky blocks between two low cheek walls.
    r = stairs_root('stairs_stone')
    bm = bmesh.new()
    for k in range(STEPS):
        z1 = 0.5 - k * run
        z0 = z1 - run
        top = (k + 1) * run + rng.uniform(-0.008, 0.008)
        box(bm, -0.42, 0.42, max(0.0, top - 0.45), top, z0 - 0.01, z1, 0.012, rng)
    mesh_obj('stairs_stone_steps', bm, material('stairs_stone', '#b3aea4'), r)
    bm = bmesh.new()
    for side in (-1, 1):
        x0, x1 = (0.42, 0.5) if side > 0 else (-0.5, -0.42)
        prism(bm, [(0.5, 0.0), (0.5, 0.16), (-0.5, 1.12), (-0.5, 0.0)], x0, x1)
    mesh_obj('stairs_stone_cheeks', bm, material('stairs_stone_dark', '#8f8a80'), r)
    out.append(r)

    # Wooden stairs: plank treads on two stringers, posts and a hand rail.
    r = stairs_root('stairs_wood')
    bm = bmesh.new()
    for k in range(STEPS):
        z1 = 0.5 - k * run - 0.01
        z0 = z1 - run + 0.03
        top = (k + 1) * run
        box(bm, -0.42, 0.42, top - 0.045, top, z0, z1, 0.006, rng)
    mesh_obj('stairs_wood_treads', bm, material('stairs_wood', '#b98450'), r)
    bm = bmesh.new()
    for x in (-0.38, 0.38):
        prism(bm, [(0.52, 0.0), (0.52, 0.1), (-0.5, 1.02), (-0.5, 0.88)], x - 0.035, x + 0.035)
    for x in (-0.44, 0.44):
        for z, y0 in ((0.42, 0.0), (-0.42, 0.84)):
            box(bm, x - 0.035, x + 0.035, y0, y0 + 0.62, z - 0.035, z + 0.035)
        prism(bm, [(0.46, 0.5), (0.46, 0.56), (-0.46, 1.4), (-0.46, 1.34)], x - 0.025, x + 0.025)
    mesh_obj('stairs_wood_frame', bm, material('stairs_wood_dark', '#7c5534'), r)
    out.append(r)

    # Log steps: logs laid across the slope, held by little stakes.
    r = stairs_root('stairs_log')
    bm = bmesh.new()
    ends = bmesh.new()
    for k in range(STEPS):
        z = 0.5 - (k + 1) * run + 0.04
        y = (0.5 - z) + 0.02
        cylinder_x(bm, -0.44, 0.44, y, z, 0.075 + rng.uniform(-0.008, 0.01))
        for x in (-0.445, 0.445):
            cylinder_x(ends, x - 0.006, x + 0.006, y, z, 0.068)
    mesh_obj('stairs_log_logs', bm, material('stairs_log', '#8b5a2b'), r)
    mesh_obj('stairs_log_ends', ends, material('stairs_log_end', '#d8b07c'), r)
    bm = bmesh.new()
    for k in range(STEPS):
        z = 0.5 - (k + 1) * run + 0.04
        y = 0.5 - z
        for x in (-0.36, 0.36):
            box(bm, x - 0.02, x + 0.02, y - 0.1, y + 0.13, z + 0.09, z + 0.12)
    mesh_obj('stairs_log_stakes', bm, material('stairs_log_stake', '#6b4a2e'), r)
    out.append(r)
    return out



# ---------------------------------------------------------------- docks
# Dock pieces, each an empty `dock_<part>` with one mesh per material:
#   deck     one tile of walkway (x, z in [-0.5, 0.5]); planks run across x, top at y = 0
#   post     a pile from just above the deck down into the sea floor
#   ramp     gangway onto the beach: top from y = 0 at z = -0.5 (dock side) down to
#            y = -1 at z = +0.5; the game stretches it to the real drop
#   bollard  a mooring post with a coil of rope, standing on the deck

def build_docks():
    out = []
    rng = random.Random(11)
    plank = material('dock_plank', '#a57d50')
    beam = material('dock_beam', '#6e4f33')
    postm = material('dock_post', '#5a3e2b')
    rope = material('dock_rope', '#d8c39a')

    r = stairs_root('dock_deck')
    bm = bmesh.new()
    for k in range(4):
        zc = -0.375 + k * 0.25
        y = rng.uniform(-0.006, 0.004)
        box(bm, -0.5, 0.5, y - 0.055, y, zc - 0.112, zc + 0.112, 0.004, rng)
    mesh_obj('dock_deck_planks', bm, plank, r)
    bm = bmesh.new()
    for x in (-0.33, 0.33):
        box(bm, x - 0.05, x + 0.05, -0.17, -0.055, -0.5, 0.5)
    mesh_obj('dock_deck_beams', bm, beam, r)
    out.append(r)

    r = stairs_root('dock_post')
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=7, radius1=0.08, radius2=0.075, depth=2.3, matrix=Matrix.Translation((0, -0.93, 0)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4())
    mesh_obj('dock_post_pile', bm, postm, r)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=7, radius1=0.088, radius2=0.088, depth=0.05, matrix=Matrix.Translation((0, 0.08, 0)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4())
    mesh_obj('dock_post_band', bm, rope, r)
    out.append(r)

    r = stairs_root('dock_ramp')
    bm = bmesh.new()
    for k in range(4):
        z0, z1 = -0.5 + k * 0.25 + 0.012, -0.5 + (k + 1) * 0.25 - 0.012
        t0, t1 = -(z0 + 0.5), -(z1 + 0.5)
        prism(bm, [(z0, t0), (z1, t1), (z1, t1 - 0.055), (z0, t0 - 0.055)], -0.46, 0.46)
    mesh_obj('dock_ramp_planks', bm, plank, r)
    bm = bmesh.new()
    for x in (-0.33, 0.33):
        prism(bm, [(-0.5, -0.055), (0.5, -1.055), (0.5, -1.16), (-0.5, -0.16)], x - 0.05, x + 0.05)
    mesh_obj('dock_ramp_beams', bm, beam, r)
    out.append(r)

    r = stairs_root('dock_bollard')
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.085, radius2=0.075, depth=0.26, matrix=Matrix.Translation((0, 0.13, 0)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4())
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.11, radius2=0.1, depth=0.05, matrix=Matrix.Translation((0, 0.285, 0)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4())
    mesh_obj('dock_bollard_post', bm, postm, r)
    bm = bmesh.new()
    for k in range(3):
        rr = 0.1 + k * 0.004
        segs = 10
        ring = []
        for j in range(segs):
            a = j * 2 * math.pi / segs
            ring.append((math.cos(a) * rr, 0.07 + k * 0.035, math.sin(a) * rr))
        g = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=rr + 0.022, radius2=rr + 0.022, depth=0.03, matrix=Matrix.Translation((0, 0.08 + k * 0.035, 0)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4())
    mesh_obj('dock_bollard_rope', bm, rope, r)
    out.append(r)
    return out


if __name__ == '__main__':
    # Run from Blender's Text Editor: rebuilds the pieces and exports tileset.glb next to the .blend.
    import os
    for o in [o for o in bpy.data.objects if o.name.startswith('tile_')]:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in bpy.data.objects if o.name.startswith(('stairs_', 'dock_'))]:
        bpy.data.objects.remove(o, do_unlink=True)
    pieces = build_tileset()
    stairs = build_stairs() + build_docks()
    keep = set(pieces) | set(stairs) | {c for s in stairs for c in s.children}
    for o in bpy.data.objects:
        o.select_set(o in keep)
    target = os.path.join(os.path.dirname(bpy.data.filepath) or os.path.expanduser('~'), 'tileset.glb')
    bpy.ops.export_scene.gltf(filepath=target, export_format='GLB', use_selection=True, export_yup=True,
                              export_normals=False, export_materials='EXPORT')
    print('exported', target)
