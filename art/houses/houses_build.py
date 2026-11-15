# The houses, rebuilt in the style of Animal Crossing: New Horizons – chunky, soft
# (every edge bevelled and smooth shaded), bright, and textured: clapboard and brick
# walls, rounded roof tiles, panelled doors, framed windows with shutters and flower
# boxes, porch lamps.
#
#   house_1  Starter House   – a cottage with a red tiled roof and a chimney
#   house_2  Timber House    – front gable over a porch, side wing, dormer, timber gable
#   house_3  Hearth Manor    – two storeys of stone and plaster, portico and balcony,
#                              a round corner tower
#   vhouse_1 Villager cottage – walls, roof and door in the villager's colours
#   vhouse_2 Two-storey cottage – stone ground floor, porch, dormer and a little garden
#
# Run inside Blender with ART set to the folder holding houses/ (see run_houses.py).
# Blender coordinates: x right, -y front (door side = the game's south), z up, origin
# at the centre of the footprint on the ground. Player houses stay inside a 3×3 tile
# footprint, villager houses inside 2×2.
#
# One object per material and house (`house_1_<material>`), parented to an empty
# `house_1`. Materials named glass and lamp are lit at night by the game; the
# villager houses' vwall / vroof / vtrim / vdoor are white and tinted per villager.
import bpy, bmesh, math, os, sys, importlib
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, ART + r'\houses')
import housetex
importlib.reload(housetex)

OUT = ART + r'\houses'
TEXDIR = OUT + r'\tex'
os.makedirs(TEXDIR, exist_ok=True)

# ── Materials ────────────────────────────────────────────────────────────
# name → (texture or None, colour, roughness, normal strength)
MATS = {
    'wall_cream': ('siding', '#fbf1dc', 0.85, 0.6),
    'wall_mint': ('siding', '#d9efe0', 0.85, 0.6),
    'plaster': ('stucco', '#f6ead2', 0.9, 0.5),
    'plaster_pink': ('stucco', '#f7e1da', 0.9, 0.5),
    'brick': ('brick', '#c4674f', 0.9, 0.9),
    'stone': ('stone', '#cfc6b8', 0.9, 1.0),
    'stone_dark': ('stone', '#9f978c', 0.9, 1.0),
    'roof_red': ('tiles', '#d9533f', 0.7, 1.0),
    'roof_teal': ('tiles', '#3f8f8a', 0.7, 1.0),
    'roof_blue': ('tiles', '#4f73b8', 0.65, 1.0),
    'shingle_brown': ('shingles', '#8a5a3c', 0.85, 0.8),
    'trim': ('paint', '#ffffff', 0.6, 0.3),
    'timber': ('planks', '#7a4e30', 0.8, 0.6),
    'deck': ('planks', '#b07c4f', 0.8, 0.7),
    'door_red': ('planks', '#b8432f', 0.6, 0.6),
    'door_green': ('planks', '#3f7d5c', 0.6, 0.6),
    'door_blue': ('planks', '#3b5f99', 0.6, 0.6),
    'shutter_green': ('planks', '#5f9f6a', 0.6, 0.5),
    'shutter_blue': ('planks', '#5b83c4', 0.6, 0.5),
    'pot': ('stucco', '#c8704a', 0.8, 0.4),
    'leaf': (None, '#5fae4a', 0.8, 0),
    'leaf_dark': (None, '#3f8a3a', 0.8, 0),
    'flower_pink': (None, '#f27aa0', 0.6, 0),
    'flower_yellow': (None, '#f6c445', 0.6, 0),
    'flower_white': (None, '#fbf7ee', 0.6, 0),
    'iron': (None, '#3b3a3f', 0.5, 0),
    'gold': (None, '#e0b43a', 0.35, 0),
    'brass': (None, '#d8a84a', 0.35, 0),
    'glass': (None, '#bfe6ff', 0.15, 0),
    'lamp': (None, '#fff3c4', 0.3, 0),
    'soil': (None, '#7a5536', 0.9, 0),
    # villager houses (tinted in the game)
    'vwall': ('siding', '#ffffff', 0.85, 0.6),
    'vroof': ('tiles', '#ffffff', 0.7, 1.0),
    'vtrim': ('paint', '#ffffff', 0.6, 0.3),
    'vdoor': ('planks', '#ffffff', 0.6, 0.6),
}
TEX_OF = {'siding': 'siding_white', 'stucco': 'stucco_white', 'brick': 'brick_white', 'stone': 'stone_white', 'tiles': 'tiles_white',
          'shingles': 'shingles_white', 'paint': 'paint_white', 'planks': 'planks_white', 'logs': 'logs_white', 'thatch': 'thatch_white'}
_images = {}


def tex_image(kind, colour):
    """Paint `kind` in `colour` (cached) and save it as PNG next to the scripts."""
    key = (kind, colour)
    if key in _images:
        return _images[key]
    rgb, h = housetex.paint(TEX_OF[kind])
    rgb = rgb * (housetex.hexrgb(colour)[None, None, :])
    n = housetex.normal_map(h, 2.0)
    out = []
    for nm, arr, cs in ((f'{kind}_{colour[1:]}', rgb, 'sRGB'), (f'{kind}_n', n, 'Non-Color')):
        img = bpy.data.images.get(nm)
        if img is None:
            img = bpy.data.images.new(nm, housetex.N, housetex.N, alpha=False)
            img.colorspace_settings.name = cs  # (before the pixels: changing it reloads the buffer)
            a = np.ones((housetex.N, housetex.N, 4), np.float32)
            a[..., :3] = arr
            img.pixels.foreach_set(a.ravel())
            img.update()
            img.filepath_raw = TEXDIR + '\\' + nm + '.png'
            img.file_format = 'PNG'
            img.save()
        out.append(img)
    _images[key] = tuple(out)
    return _images[key]


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    kind, colour, rough, nstr = MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    try:
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
    except KeyError:
        pass
    if kind:
        img, nimg = tex_image(kind, colour)
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nimg
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = nstr
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    else:
        c = housetex.hexrgb(colour)
        lin = [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c]
        bsdf.inputs['Base Color'].default_value = (*lin, 1)
        if name in ('glass', 'lamp'):
            bsdf.inputs['Emission Color'].default_value = (1.0, 0.8, 0.45, 1)
            bsdf.inputs['Emission Strength'].default_value = 0.4 if name == 'glass' else 1.5
    return m


# ── Building blocks ──────────────────────────────────────────────────────
PARTS = []  # (object, material name)


def _box_uv(bm, scale=1.0):
    """UVs in metres from the dominant axis of each face (in the part's own frame)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            if ax == 0:
                l[uv].uv = (c.y * (1 if n.x > 0 else -1) * scale, c.z * scale)
            elif ax == 1:
                l[uv].uv = (c.x * (-1 if n.y > 0 else 1) * scale, c.z * scale)
            else:
                l[uv].uv = (c.x * scale, c.y * (1 if n.z > 0 else -1) * scale)


def _finish(bm, mat, matrix=None, bevel=0.03, segs=3, angle=None, smooth=True, uv=True):
    if uv:
        _box_uv(bm)
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    me = bpy.data.meshes.new(mat)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(mat, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(material(mat))
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    if bevel:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = segs
        b.limit_method = 'ANGLE' if angle else 'NONE'
        if angle:
            b.angle_limit = math.radians(angle)
        o.modifiers.new('WN', 'WEIGHTED_NORMAL').keep_sharp = True
    PARTS.append((o, mat))
    return o


def box(mat, a, b, bevel=0.03, segs=3):
    """Axis-aligned box between corners a and b (Blender coordinates)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    lo = Vector([min(a[i], b[i]) for i in range(3)])
    hi = Vector([max(a[i], b[i]) for i in range(3)])
    size = hi - lo
    bevel = min(bevel, min(size) * 0.45)
    for v in bm.verts:
        v.co = Vector((v.co.x * size.x, v.co.y * size.y, v.co.z * size.z)) + (lo + hi) / 2
    return _finish(bm, mat, bevel=bevel, segs=segs)


def slab(mat, size, matrix, bevel=0.03, segs=3):
    """A box of `size` centred at the origin, UV'd in its own frame, then moved by matrix."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bevel = min(bevel, min(size) * 0.45)
    return _finish(bm, mat, matrix=matrix, bevel=bevel, segs=segs)


def cyl(mat, c, r, h, seg=20, r_top=None, axis='Z', bevel=0.02, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=seg, radius1=r, radius2=r if r_top is None else r_top, depth=h)
    rot = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
    _box_uv(bm)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ rot, verts=bm.verts)
    return _finish(bm, mat, bevel=bevel, segs=2, angle=40, uv=False)


def sphere(mat, c, r, sx=1.0, sy=1.0, sz=1.0, seg=14):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * r * sx, v.co.y * r * sy, v.co.z * r * sz)) + Vector(c)
    return _finish(bm, mat, bevel=0, uv=True)


def prism_gable(mat, x0, x1, y0, y1, z0, rise):
    """Triangular gable wall between x0 and x1 (ridge along x), base from y0 to y1 at z0."""
    bm = bmesh.new()
    yc = (y0 + y1) / 2
    pts = [(y0, z0), (y1, z0), (yc, z0 + rise)]
    vs0 = [bm.verts.new((x0, y, z)) for y, z in pts]
    vs1 = [bm.verts.new((x1, y, z)) for y, z in pts]
    bm.faces.new(vs0[::-1])
    bm.faces.new(vs1)
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((vs0[i], vs0[j], vs1[j], vs1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(bm, mat, bevel=0.03, segs=2)


def gable_y(mat, y0, y1, x0, x1, z0, rise):
    """Gable wall whose ridge runs along y (a front-facing gable)."""
    bm = bmesh.new()
    xc = (x0 + x1) / 2
    pts = [(x0, z0), (x1, z0), (xc, z0 + rise)]
    vs0 = [bm.verts.new((x, y0, z)) for x, z in pts]
    vs1 = [bm.verts.new((x, y1, z)) for x, z in pts]
    bm.faces.new(vs0)
    bm.faces.new(vs1[::-1])
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((vs0[j], vs0[i], vs1[i], vs1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(bm, mat, bevel=0.03, segs=2)


def roof_x(mat, x0, x1, y0, y1, z_eave, rise, thick=0.13, over=0.22, ridge='trim', ridge_r=0.07):
    """Gable roof, ridge along x: two chunky tiled boards and a round ridge cap."""
    yc = (y0 + y1) / 2
    d = (y1 - y0) / 2
    ang = math.atan2(rise, d)
    L = math.hypot(d, rise) + over
    for s in (-1, 1):
        # board local: x along the ridge, y up the slope, z the thickness
        m = (Matrix.Translation(Vector((0, yc, z_eave + rise))) @ Matrix.Rotation(-s * ang, 4, 'X') @
             Matrix.Translation(Vector(((x0 + x1) / 2, s * L / 2, thick / 2))))
        # orient so v runs up the slope (UV taken before the move)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * (x1 - x0), v.co.y * L, v.co.z * thick))
        uv = bm.loops.layers.uv.verify()
        for f in bm.faces:
            for l in f.loops:
                c = l.vert.co
                l[uv].uv = (c.x, (-s * c.y + L / 2) if abs(f.normal.z) > 0.5 else c.z)
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        _finish(bm, mat, bevel=min(0.045, thick * 0.4), segs=3, uv=False)
    if ridge:
        cyl(ridge, (((x0 + x1) / 2), yc, z_eave + rise + thick * 0.85), ridge_r, x1 - x0 + 0.02, axis='X', bevel=0.02)


def roof_y(mat, y0, y1, x0, x1, z_eave, rise, thick=0.12, over=0.15, ridge='trim', ridge_r=0.06):
    """Gable roof with its ridge along y (front-facing gables, dormers, porches)."""
    xc = (x0 + x1) / 2
    d = (x1 - x0) / 2
    ang = math.atan2(rise, d)
    L = math.hypot(d, rise) + over
    for s in (-1, 1):
        m = (Matrix.Translation(Vector((xc, 0, z_eave + rise))) @ Matrix.Rotation(s * ang, 4, 'Y') @
             Matrix.Translation(Vector((s * L / 2, (y0 + y1) / 2, thick / 2))))
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * L, v.co.y * (y1 - y0), v.co.z * thick))
        uv = bm.loops.layers.uv.verify()
        for f in bm.faces:
            for l in f.loops:
                c = l.vert.co
                l[uv].uv = (c.y, (-s * c.x + L / 2) if abs(f.normal.z) > 0.5 else c.z)
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        _finish(bm, mat, bevel=min(0.04, thick * 0.4), segs=3, uv=False)
    if ridge:
        cyl(ridge, (xc, (y0 + y1) / 2, z_eave + rise + thick * 0.85), ridge_r, y1 - y0 + 0.02, axis='Y', bevel=0.02)


def cone_roof(mat, c, r, h, seg=24):
    cyl(mat, c + Vector((0, 0, h / 2)), r, h, seg=seg, r_top=0.02, bevel=0.03)


class Wall:
    """A wall face: local u (along, left→right seen from outside), v (up), n (out)."""

    def __init__(self, o, U, N):
        self.o, self.U, self.N = Vector(o), Vector(U), Vector(N)
        self.V = Vector((0, 0, 1))

    def p(self, u, v, n=0.0):
        return self.o + self.U * u + self.V * v + self.N * n

    def box(self, mat, u0, v0, n0, u1, v1, n1, bevel=0.02):
        c = self.p((u0 + u1) / 2, (v0 + v1) / 2, (n0 + n1) / 2)
        Y = self.N if self.U.cross(self.N).dot(self.V) > 0 else -self.N
        m = Matrix((self.U, Y, self.V)).transposed().to_4x4()
        m.translation = c
        return slab(mat, (abs(u1 - u0), abs(n1 - n0), abs(v1 - v0)), m, bevel)


def walls_of(x0, x1, y0, y1):
    return {
        'front': Wall((0, y0, 0), (1, 0, 0), (0, -1, 0)),
        'back': Wall((0, y1, 0), (-1, 0, 0), (0, 1, 0)),
        'left': Wall((x0, 0, 0), (0, -1, 0), (-1, 0, 0)),
        'right': Wall((x1, 0, 0), (0, 1, 0), (1, 0, 0)),
    }


def window(w, u, v0, width, height, frame='trim', shutters=None, box_flowers=None, cross=True, sill=True):
    """Framed window: chunky frame, glass, a cross of glazing bars, a sill, shutters, a flower box."""
    f = 0.06
    u0, u1, v1 = u - width / 2, u + width / 2, v0 + height
    w.box('glass', u0 + 0.01, v0 + 0.01, -0.02, u1 - 0.01, v1 - 0.01, 0.015, bevel=0.0)
    w.box(frame, u0 - f, v0 - f, -0.01, u0, v1 + f, 0.06)
    w.box(frame, u1, v0 - f, -0.01, u1 + f, v1 + f, 0.06)
    w.box(frame, u0, v1, -0.01, u1, v1 + f, 0.06)
    w.box(frame, u0, v0 - f, -0.01, u1, v0, 0.06)
    if cross:
        w.box(frame, u - 0.018, v0, 0.0, u + 0.018, v1, 0.035, bevel=0.01)
        w.box(frame, u0, (v0 + v1) / 2 - 0.018, 0.0, u1, (v0 + v1) / 2 + 0.018, 0.035, bevel=0.01)
    if sill:
        w.box(frame, u0 - f - 0.03, v0 - f - 0.04, -0.01, u1 + f + 0.03, v0 - f + 0.005, 0.11)
    if shutters:
        sw = width * 0.48
        for s in (-1, 1):
            a = u0 - f - sw - 0.02 if s < 0 else u1 + f + 0.02
            w.box(shutters, a, v0 - f, 0.0, a + sw, v1 + f, 0.045, bevel=0.015)
            for k in range(3):
                vv = v0 + (k + 0.5) * (height / 3)
                w.box(shutters, a + 0.03, vv - 0.012, 0.04, a + sw - 0.03, vv + 0.012, 0.06, bevel=0.008)
    if box_flowers:
        vb = v0 - f - 0.16
        w.box('timber', u0 - 0.04, vb, 0.0, u1 + 0.04, vb + 0.12, 0.17, bevel=0.02)
        n = max(3, int(width / 0.12))
        for k in range(n):
            uu = u0 + (k + 0.5) * (width + 0.04) / n - 0.02
            sphere('leaf', w.p(uu, vb + 0.16, 0.09), 0.065)
            sphere(box_flowers[k % len(box_flowers)], w.p(uu + 0.02, vb + 0.21, 0.13), 0.035)


def round_window(w, u, v, r, frame='trim'):
    ax = 'Y' if abs(w.N.y) > 0.5 else 'X'
    cyl(frame, w.p(u, v, 0.0), r + 0.05, 0.04, seg=24, axis=ax, bevel=0.015)
    cyl('glass', w.p(u, v, 0.03), r, 0.02, seg=24, axis=ax, bevel=0.0)
    w.box(frame, u - 0.015, v - r, 0.05, u + 0.015, v + r, 0.075, bevel=0.006)
    w.box(frame, u - r, v - 0.015, 0.05, u + r, v + 0.015, 0.075, bevel=0.006)


def door(w, u, v0, width, height, mat='door_red', frame='trim', arch=True, lamp=1, step='stone', lamp_d=0.2, lamp_s=1.0):
    """Panelled door with a round top, frame, brass knob, a step and a porch lamp."""
    u0, u1 = u - width / 2, u + width / 2
    top = v0 + height
    ax = 'Y' if abs(w.N.y) > 0.5 else 'X'
    w.box(mat, u0, v0, -0.02, u1, top, 0.04, bevel=0.015)
    w.box(frame, u0 - 0.07, v0, -0.01, u0, top + (0.0 if arch else 0.07), 0.07)
    w.box(frame, u1, v0, -0.01, u1 + 0.07, top + (0.0 if arch else 0.07), 0.07)
    if arch:
        r = width / 2
        cyl(mat, w.p(u, top, 0.01), r, 0.06, seg=24, axis=ax, bevel=0.012)
        cyl(frame, w.p(u, top, 0.0), r + 0.07, 0.07, seg=24, axis=ax, bevel=0.015)
        cyl('glass', w.p(u, top + r * 0.35, 0.045), r * 0.42, 0.02, seg=20, axis=ax, bevel=0.0)
    else:
        w.box(frame, u0 - 0.07, top, -0.01, u1 + 0.07, top + 0.07, 0.07)
    # raised panels
    for pv0, pv1 in ((v0 + 0.1, v0 + height * 0.45), (v0 + height * 0.52, top - 0.06)):
        for pu0, pu1 in ((u0 + 0.06, u - 0.03), (u + 0.03, u1 - 0.06)):
            w.box(mat, pu0, pv0, 0.03, pu1, pv1, 0.055, bevel=0.012)
    sphere('brass', w.p(u1 - 0.07, v0 + height * 0.48, 0.08), 0.03)
    if step:
        w.box(step, u0 - 0.12, -0.0, -0.02, u1 + 0.12, v0 + 0.0001 if v0 > 0.01 else 0.08, 0.3, bevel=0.03)
    if lamp:
        lu = u1 + lamp_d if lamp > 0 else u0 - lamp_d
        k = lamp_s
        w.box('iron', lu - 0.05 * k, top - 0.12 * k, 0.0, lu + 0.05 * k, top - 0.02 * k, 0.1 * k, bevel=0.01)
        sphere('lamp', w.p(lu, top - 0.2 * k, 0.1 * k), 0.065 * k, sz=1.25)
        w.box('iron', lu - 0.06 * k, top - 0.07 * k, 0.04 * k, lu + 0.06 * k, top - 0.04 * k, 0.16 * k, bevel=0.01)


def chimney(x, y, z0, z1, mat='brick', w=0.32):
    box(mat, (x - w / 2, y - w / 2, z0), (x + w / 2, y + w / 2, z1), bevel=0.03)
    box('stone_dark', (x - w / 2 - 0.04, y - w / 2 - 0.04, z1 - 0.02), (x + w / 2 + 0.04, y + w / 2 + 0.04, z1 + 0.09), bevel=0.03)


def bush(x, y, r=0.2, flowers=None):
    for k, (dx, dy, dz, rr) in enumerate(((0, 0, 0.8, 1.0), (0.55, 0.1, 0.6, 0.75), (-0.5, 0.15, 0.6, 0.7), (0.1, -0.35, 0.55, 0.7))):
        sphere('leaf' if k % 2 == 0 else 'leaf_dark', (x + dx * r, y + dy * r, dz * r), r * rr)
    if flowers:
        for k in range(5):
            a = k * 2.4
            sphere(flowers[k % len(flowers)], (x + math.cos(a) * r * 0.7, y - 0.15 * r + math.sin(a) * r * 0.5, r * (1.1 + 0.2 * math.sin(k))), r * 0.16)


def corner_posts(x0, x1, y0, y1, z0, z1, mat='trim', t=0.07):
    for x in (x0, x1):
        for y in (y0, y1):
            box(mat, (x - t, y - t, z0), (x + t, y + t, z1), bevel=0.025)


# ── The houses ───────────────────────────────────────────────────────────

def house_1():
    """Starter House: cream clapboard cottage, red tiled roof, green shutters, chimney."""
    x0, x1, y0, y1 = -1.15, 1.15, -0.95, 0.95
    zf, ze = 0.2, 1.35
    box('stone', (x0 - 0.06, y0 - 0.06, 0), (x1 + 0.06, y1 + 0.06, zf))
    box('wall_cream', (x0, y0, zf), (x1, y1, ze), bevel=0.02)
    corner_posts(x0, x1, y0, y1, zf, ze)
    box('trim', (x0 - 0.05, y0 - 0.05, ze - 0.06), (x1 + 0.05, y1 + 0.05, ze + 0.02))
    prism_gable('wall_cream', x0, x1, y0, y1, ze - 0.02, 0.85 + 0.02)
    roof_x('roof_red', x0 - 0.17, x1 + 0.17, y0, y1, ze, 0.85, over=0.24)
    W = walls_of(x0, x1, y0, y1)
    door(W['front'], 0.0, zf, 0.5, 0.78, 'door_red')
    for u in (-0.72, 0.72):
        window(W['front'], u, 0.62, 0.42, 0.44, shutters='shutter_green', box_flowers=('flower_pink', 'flower_yellow', 'flower_white'))
    for side in ('left', 'right'):
        window(W[side], 0.0, 0.62, 0.42, 0.44)
        round_window(W[side], 0.0, ze + 0.42, 0.13)
    window(W['back'], 0.4, 0.62, 0.42, 0.44)
    chimney(0.62, 0.3, 1.5, 2.45)
    bush(-1.3, -1.15, 0.18, ('flower_pink',))
    bush(1.32, -1.12, 0.16)


def house_2():
    """Timber House: a front gable over a porch, a dormer, timber framing, a side bay."""
    x0, x1, y0, y1 = -1.25, 1.25, -0.9, 1.0
    zf, ze = 0.22, 1.5
    box('stone', (x0 - 0.06, y0 - 0.06, 0), (x1 + 0.06, y1 + 0.06, zf))
    box('wall_mint', (x0, y0, zf), (x1, y1, ze), bevel=0.02)
    corner_posts(x0, x1, y0, y1, zf, ze)
    box('trim', (x0 - 0.05, y0 - 0.05, ze - 0.06), (x1 + 0.05, y1 + 0.05, ze + 0.02))
    prism_gable('wall_mint', x0, x1, y0, y1, ze - 0.02, 0.95 + 0.02)
    roof_x('roof_teal', x0 - 0.15, x1 + 0.15, y0, y1, ze, 0.95, over=0.22)
    # front cross gable (timber framed) above the door
    gx0, gx1, gy0 = -0.55, 0.55, y0 - 0.12
    box('wall_mint', (gx0, gy0, zf), (gx1, y0 + 0.05, ze), bevel=0.02)
    gable_y('plaster', gy0, y0 + 0.6, gx0, gx1, ze, 0.42)
    # timber frame on the gable: a king post and two braces
    box('timber', (-0.03, gy0 - 0.03, ze), (0.03, gy0 + 0.01, ze + 0.36), bevel=0.012)
    for s in (-1, 1):
        m = Matrix.Translation(Vector((s * 0.2, gy0 - 0.01, ze + 0.13))) @ Matrix.Rotation(s * 0.95, 4, 'Y')
        slab('timber', (0.045, 0.04, 0.3), m, bevel=0.012)
    box('timber', (gx0, gy0 - 0.03, ze - 0.02), (gx1, gy0 + 0.01, ze + 0.04), bevel=0.012)
    roof_y('roof_teal', gy0 - 0.47, y0 + 0.62, gx0 - 0.12, gx1 + 0.12, ze, 0.42, over=0.12)
    Wg = Wall((0, gy0, 0), (1, 0, 0), (0, -1, 0))
    door(Wg, 0.0, zf, 0.48, 0.8, 'door_green', lamp=1)
    round_window(Wg, 0.0, ze + 0.17, 0.1)
    # porch: deck, two posts and the gable roof above carries on
    box('deck', (-0.62, gy0 - 0.42, 0), (0.62, gy0, 0.16), bevel=0.03)
    for s in (-1, 1):
        cyl('trim', (s * 0.52, gy0 - 0.33, 0.16 + (ze - 0.16) / 2), 0.045, ze - 0.16, seg=12)
    W = walls_of(x0, x1, y0, y1)
    for u in (-0.92, 0.92):
        window(W['front'], u, 0.66, 0.4, 0.5, shutters='shutter_blue', box_flowers=('flower_yellow', 'flower_white'))
    # dormer on the front slope, right
    dz = ze + 0.12
    box('wall_mint', (0.58, y0 + 0.3, dz - 0.1), (0.98, y0 + 0.75, dz + 0.28), bevel=0.02)
    roof_y('roof_teal', y0 + 0.2, y0 + 0.78, 0.5, 1.06, dz + 0.28, 0.16, thick=0.08, over=0.06, ridge_r=0.035)
    window(Wall((0, y0 + 0.3, 0), (1, 0, 0), (0, -1, 0)), 0.78, dz - 0.02, 0.24, 0.22, cross=True, sill=False)
    for side in ('left', 'right'):
        window(W[side], 0.05, 0.66, 0.42, 0.5)
        round_window(W[side], 0.05, ze + 0.45, 0.13)
    window(W['back'], -0.5, 0.66, 0.42, 0.5)
    window(W['back'], 0.5, 0.66, 0.42, 0.5)
    chimney(-0.75, 0.45, 1.6, 2.75)
    bush(-1.35, -1.2, 0.17, ('flower_yellow',))
    bush(1.28, -1.18, 0.17, ('flower_pink',))


def house_3():
    """Hearth Manor: stone ground floor, plaster upper floor, portico with balcony, corner tower."""
    x0, x1, y0, y1 = -1.2, 1.3, -0.85, 1.05
    zf, zm, ze = 0.22, 1.2, 2.25
    box('stone', (x0 - 0.07, y0 - 0.07, 0), (x1 + 0.07, y1 + 0.07, zf))
    box('stone', (x0, y0, zf), (x1, y1, zm), bevel=0.02)
    box('trim', (x0 - 0.06, y0 - 0.06, zm - 0.03), (x1 + 0.06, y1 + 0.06, zm + 0.07))
    box('plaster_pink', (x0, y0, zm + 0.07), (x1, y1, ze), bevel=0.02)
    corner_posts(x0, x1, y0, y1, zm + 0.07, ze, mat='stone', t=0.08)
    box('trim', (x0 - 0.06, y0 - 0.06, ze - 0.07), (x1 + 0.06, y1 + 0.06, ze + 0.03))
    prism_gable('plaster_pink', x0, x1, y0, y1, ze - 0.02, 0.95 + 0.02)
    roof_x('roof_blue', x0 - 0.15, x1 + 0.15, y0, y1, ze, 0.95, over=0.2, ridge='gold', ridge_r=0.06)
    # pediment over the centre
    gable_y('plaster_pink', y0 - 0.06, y0 + 0.6, -0.5, 0.7, ze, 0.34)
    roof_y('roof_blue', y0 - 0.22, y0 + 0.62, -0.6, 0.8, ze, 0.34, over=0.1, ridge='gold', ridge_r=0.04)
    round_window(Wall((0, y0 - 0.06, 0), (1, 0, 0), (0, -1, 0)), 0.1, ze + 0.15, 0.09, frame='gold')
    W = walls_of(x0, x1, y0, y1)
    # portico: columns, balcony floor with balustrade, french window above
    door(W['front'], 0.1, zf, 0.56, 0.86, 'door_blue', frame='trim', lamp=0)
    py = y0 - 0.5
    box('stone', (-0.45, py - 0.05, 0), (0.65, y0, 0.22), bevel=0.03)
    for s in (-0.35, 0.55):
        cyl('trim', (s, py + 0.1, 0.22 + (zm - 0.22) / 2), 0.07, zm - 0.22, seg=16)
        box('trim', (s - 0.1, py, zm - 0.06), (s + 0.1, py + 0.2, zm))
    box('trim', (-0.5, py - 0.03, zm), (0.7, y0, zm + 0.1), bevel=0.03)
    for k in range(9):
        x = -0.45 + k * 0.137
        cyl('trim', (x, py + 0.02, zm + 0.1 + 0.16), 0.025, 0.32, seg=10)
    box('trim', (-0.5, py - 0.02, zm + 0.42), (0.7, py + 0.08, zm + 0.48), bevel=0.02)
    window(W['front'], 0.1, zm + 0.18, 0.46, 0.72, frame='trim', cross=True, sill=False)
    for u in (0.95,):
        window(W['front'], u, 0.55, 0.36, 0.48, shutters='shutter_blue')
        window(W['front'], u, zm + 0.35, 0.36, 0.5, shutters='shutter_blue', box_flowers=('flower_pink', 'flower_white'))
    sphere('lamp', (-0.32, y0 - 0.12, 0.95), 0.06, sz=1.25)
    sphere('lamp', (0.52, y0 - 0.12, 0.95), 0.06, sz=1.25)
    for side in ('left', 'right'):
        window(W[side], 0.0, 0.55, 0.4, 0.48)
        window(W[side], 0.0, zm + 0.35, 0.4, 0.5)
    for u in (-0.6, 0.6):
        window(W['back'], u, 0.55, 0.4, 0.48)
        window(W['back'], u, zm + 0.35, 0.4, 0.5)
    # round tower at the front-left corner
    tc = Vector((-1.05, -0.75, 0))
    cyl('stone', tc + Vector((0, 0, zm / 2)), 0.44, zm, seg=28, bevel=0.03)
    cyl('trim', tc + Vector((0, 0, zm + 0.02)), 0.47, 0.1, seg=28)
    cyl('plaster_pink', tc + Vector((0, 0, zm + 0.07 + (2.75 - zm) / 2)), 0.42, 2.75 - zm, seg=28, bevel=0.03)
    cyl('trim', tc + Vector((0, 0, 2.78)), 0.47, 0.08, seg=28)
    cone_roof('roof_blue', tc + Vector((0, 0, 2.8)), 0.52, 1.15)
    sphere('gold', tc + Vector((0, 0, 3.98)), 0.07)
    cyl('gold', tc + Vector((0, 0, 4.12)), 0.012, 0.2, seg=8, bevel=0)
    for a in (-2.2, -1.2):
        Wt = Wall(tc + Vector((math.cos(a), math.sin(a), 0)) * 0.42, (-math.sin(a), math.cos(a), 0), (math.cos(a), math.sin(a), 0))
        window(Wt, 0.0, zm + 0.45, 0.26, 0.48, cross=False, sill=False)
    chimney(0.85, 0.55, 2.3, 3.45, mat='stone_dark')
    bush(1.3, -1.25, 0.15, ('flower_pink', 'flower_white'))
    bush(-0.6, -1.32, 0.13, ('flower_yellow',))


def vhouse_1():
    """Villager cottage (2×2): walls, roof, trim and door take the villager's colours."""
    x0, x1, y0, y1 = -0.78, 0.78, -0.62, 0.66
    zf, ze = 0.12, 1.02
    box('stone', (x0 - 0.06, y0 - 0.06, 0), (x1 + 0.06, y1 + 0.06, zf))
    box('vwall', (x0, y0, zf), (x1, y1, ze), bevel=0.02)
    corner_posts(x0, x1, y0, y1, zf, ze, mat='vtrim', t=0.055)
    box('vtrim', (x0 - 0.04, y0 - 0.04, ze - 0.05), (x1 + 0.04, y1 + 0.04, ze + 0.02))
    prism_gable('vwall', x0, x1, y0, y1, ze - 0.02, 0.66 + 0.02)
    roof_x('vroof', x0 - 0.15, x1 + 0.15, y0, y1, ze, 0.66, thick=0.11, over=0.22, ridge='vtrim', ridge_r=0.055)
    W = walls_of(x0, x1, y0, y1)
    door(W['front'], 0.0, zf, 0.38, 0.62, 'vdoor', frame='vtrim', lamp=1, lamp_d=0.13, lamp_s=0.75)
    for u in (-0.55, 0.55):
        window(W['front'], u, 0.48, 0.22, 0.32, frame='vtrim', box_flowers=('flower_pink', 'flower_yellow') if u < 0 else None)
    for side in ('left', 'right'):
        window(W[side], 0.0, 0.48, 0.3, 0.32, frame='vtrim')
    chimney(0.42, 0.22, 1.1, 1.92, mat='brick', w=0.24)
    sphere('pot', (0.62, y0 - 0.2, 0.09), 0.1, sz=0.9)
    bush(0.62, y0 - 0.2, 0.1, ('flower_pink',))


def vhouse_2():
    """Two-storey villager cottage: stone ground floor, upper floor in their colours, porch, dormer, garden."""
    x0, x1, y0, y1 = -0.84, 0.84, -0.55, 0.72
    zf, zm, ze = 0.14, 0.95, 1.72
    box('stone', (x0 - 0.06, y0 - 0.06, 0), (x1 + 0.06, y1 + 0.06, zf))
    box('stone', (x0, y0, zf), (x1, y1, zm), bevel=0.02)
    box('vtrim', (x0 - 0.05, y0 - 0.05, zm - 0.02), (x1 + 0.05, y1 + 0.05, zm + 0.06))
    box('vwall', (x0, y0, zm + 0.06), (x1, y1, ze), bevel=0.02)
    corner_posts(x0, x1, y0, y1, zm + 0.06, ze, mat='vtrim', t=0.05)
    box('vtrim', (x0 - 0.04, y0 - 0.04, ze - 0.05), (x1 + 0.04, y1 + 0.04, ze + 0.02))
    prism_gable('vwall', x0, x1, y0, y1, ze - 0.02, 0.72 + 0.02)
    roof_x('vroof', x0 - 0.13, x1 + 0.13, y0, y1, ze, 0.72, thick=0.11, over=0.2, ridge='vtrim', ridge_r=0.05)
    W = walls_of(x0, x1, y0, y1)
    door(W['front'], 0.0, zf, 0.36, 0.6, 'vdoor', frame='vtrim', lamp=1, lamp_d=0.13, lamp_s=0.75)
    # porch roof on two posts
    py = y0 - 0.32
    box('deck', (-0.42, py - 0.02, 0), (0.42, y0, 0.12), bevel=0.025)
    for s in (-1, 1):
        cyl('vtrim', (s * 0.34, py + 0.06, 0.12 + 0.36), 0.035, 0.72, seg=12)
    m = Matrix.Translation(Vector((0, y0 - 0.17, 0.9))) @ Matrix.Rotation(-0.35, 4, 'X')
    slab('vroof', (0.9, 0.42, 0.07), m, bevel=0.025)
    for u in (-0.6, 0.6):
        window(W['front'], u, 0.42, 0.2, 0.32, frame='vtrim')
        window(W['front'], u * 0.95, zm + 0.28, 0.28, 0.32, frame='vtrim', box_flowers=('flower_yellow', 'flower_pink'))
    for side in ('left', 'right'):
        window(W[side], 0.05, 0.42, 0.3, 0.32, frame='vtrim')
        window(W[side], 0.05, zm + 0.28, 0.3, 0.32, frame='vtrim')
    # dormer
    dz = ze + 0.28
    box('vwall', (-0.2, y0 + 0.2, dz - 0.22), (0.2, y0 + 0.7, dz + 0.22), bevel=0.02)
    roof_y('vroof', y0 + 0.12, y0 + 0.75, -0.26, 0.26, dz + 0.22, 0.13, thick=0.07, over=0.05, ridge='vtrim', ridge_r=0.03)
    window(Wall((0, y0 + 0.2, 0), (1, 0, 0), (0, -1, 0)), 0.0, dz - 0.12, 0.2, 0.24, frame='vtrim', sill=False)
    chimney(-0.45, 0.3, 1.8, 2.6, mat='brick', w=0.24)
    # little garden: fence and flowers
    for x in (-0.95, -0.72, 0.72, 0.95):
        box('trim', (x - 0.025, y0 - 0.35, 0), (x + 0.025, y0 - 0.31, 0.3), bevel=0.012)
    for x0f, x1f in ((-0.98, -0.69), (0.69, 0.98)):
        box('trim', (x0f, y0 - 0.345, 0.17), (x1f, y0 - 0.315, 0.21), bevel=0.008)
    for k in range(3):
        bush(0.7 + k * 0.1 - 0.1, y0 - 0.15, 0.07, ('flower_pink', 'flower_yellow'))
        bush(-0.8 + k * 0.1, y0 - 0.15, 0.07, ('flower_white',))


HOUSES = {'house_1': house_1, 'house_2': house_2, 'house_3': house_3, 'vhouse_1': vhouse_1, 'vhouse_2': vhouse_2}
FOOT = {'house_1': 1.5, 'house_2': 1.5, 'house_3': 1.5, 'vhouse_1': 1.0, 'vhouse_2': 1.0}


def build(name, offset=(0, 0, 0)):
    """Build one house: apply modifiers, join per material under an empty."""
    PARTS.clear()
    HOUSES[name]()
    dg = bpy.context.evaluated_depsgraph_get()
    by_mat = {}
    for o, mat in PARTS:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        by_mat.setdefault(mat, []).append(me)
        bpy.data.objects.remove(o, do_unlink=True)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    lo = Vector((9, 9, 9)); hi = Vector((-9, -9, -9))
    for mat, meshes in by_mat.items():
        bm = bmesh.new()
        for me in meshes:
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
        me = bpy.data.meshes.new(f'{name}_{mat}')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material(mat))
        o = bpy.data.objects.new(f'{name}_{mat}', me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = root
        for v in me.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i]); hi[i] = max(hi[i], v.co[i])
    root.location = offset
    f = FOOT[name] + 0.07
    bad = [round(c, 2) for c in (lo.x, lo.y, hi.x, hi.y) if abs(c) > f]
    return {'name': name, 'materials': len(by_mat), 'faces': sum(len(o.data.polygons) for o in root.children),
            'bounds': [round(lo.x, 2), round(lo.y, 2), round(hi.x, 2), round(hi.y, 2), round(hi.z, 2)], 'outside': bad}


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)


if __name__ in ('houses', '__main__'):
    clear()
    result = [build(n, (i * 3.6 - 7.2, 0, 0)) for i, n in enumerate(globals().get('ONLY') or HOUSES)]
