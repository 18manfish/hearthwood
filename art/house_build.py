# Builds the three Starter House tiers in Blender and exports house.glb.
#
#   house_1  Starter House  – plaster cottage, shingle roof, stone chimney
#   house_2  Timber House   – two storeys, timber framing, porch, dormer
#   house_3  Hearth Manor   – dressed stone, portico & balcony, corner tower
#
# Run it either way:
#   * blender --background --python art/house_build.py
#       (from the repo root; writes art/house.blend and client/public/models/house.glb)
#   * Blender's Text Editor inside art/house.blend
#       (rebuilds the houses and writes house.glb next to the .blend)
#
# Without Blender (needs numpy, scipy and Pillow):
#   python3 art/house_build.py --preview art/house_preview.png   – quick render
#   python3 art/house_build.py --glb client/public/models/house.glb
#       – writes the same .glb directly (no .blend); Blender's export replaces it.
#
# Every part is a convex solid given as a point cloud; Blender turns each one
# into a closed mesh with a convex hull. Parts that share a material are joined
# into one mesh per tier: `house_<tier>_<material>`, parented to an empty
# `house_<tier>`. The game takes colours from the materials (flat shaded), and
# meshes whose material is `glass` become the warm-lit windows.
#
# Coordinates are GAME coordinates: 1 unit = 1 tile, y up, +z = south (the
# front, facing the camera), origin at the centre of the 3×3 footprint on the
# ground. Everything stays inside x, z ∈ [-1.5, 1.5]. They become Blender's
# z-up only when meshes are written, so the +Y-up glTF export gives back
# exactly these numbers.

import math
import os
import sys

PALETTE = {
    # Tier 1
    'plaster': '#f1e3c6',
    'timber': '#7a5230',
    'stone': '#a8a29a',
    'stone_dark': '#7f786f',
    'shingle': '#b5523b',
    'shingle_dark': '#93412f',
    'door': '#6b4226',
    'shutter': '#5f8f5a',
    'pot': '#c46a3c',
    'leaf': '#5fae4a',
    'flower': '#e8607a',
    'glass': '#bfe6ff',
    # Tier 2
    'plaster_warm': '#f3dfb8',
    'frame': '#4e3523',
    'slate_teal': '#4a6670',
    'slate_teal_dark': '#36505a',
    'brick': '#9c4a3a',
    'deck': '#8b6b47',
    'door_green': '#2f5d50',
    'flower_yellow': '#f6c445',
    'iron': '#3b3b3b',
    # Tier 3
    'ashlar': '#efe6d2',
    'quoin': '#d6ccb6',
    'marble': '#fbf8f0',
    'terrace': '#cfc6b4',
    'slate': '#3d5a80',
    'slate_dark': '#2e4663',
    'gold': '#e0b43a',
    'door_wine': '#7a1f3d',
    'hedge': '#3f8a3a',
    'sea_glass': '#9fd8e6',
}

GLASS = {'glass', 'sea_glass'}


# ── Point-cloud primitives (all convex) ─────────────────────────────────────

def _rot(p, rx=0.0, ry=0.0, rz=0.0):
    x, y, z = p
    if rx:
        c, s = math.cos(rx), math.sin(rx)
        y, z = y * c - z * s, y * s + z * c
    if ry:
        c, s = math.cos(ry), math.sin(ry)
        x, z = x * c + z * s, -x * s + z * c
    if rz:
        c, s = math.cos(rz), math.sin(rz)
        x, y = x * c - y * s, x * s + y * c
    return (x, y, z)


class Kit:
    """Collects (material, points) parts for one house."""

    def __init__(self):
        self.parts = []

    def add(self, mat, pts):
        assert mat in PALETTE, mat
        self.parts.append((mat, [tuple(float(c) for c in p) for p in pts]))

    # Axis-aligned box from two corners.
    def box(self, mat, x0, y0, z0, x1, y1, z1):
        self.add(mat, [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)])

    # Box of size (sx, sy, sz) centred on c, rotated (x, then y, then z).
    def rbox(self, mat, c, size, rx=0.0, ry=0.0, rz=0.0):
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        pts = []
        for x in (-hx, hx):
            for y in (-hy, hy):
                for z in (-hz, hz):
                    q = _rot((x, y, z), rx, ry, rz)
                    pts.append((q[0] + c[0], q[1] + c[1], q[2] + c[2]))
        self.add(mat, pts)

    # Thin beam from (x0, y0) to (x1, y1) in a wall plane at depth z (front walls).
    def brace(self, mat, x0, y0, x1, y1, z0, z1, w=0.08):
        L = math.hypot(x1 - x0, y1 - y0)
        a = math.atan2(y1 - y0, x1 - x0)
        self.rbox(mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (L, w, z1 - z0), rz=a)

    # Vertical cylinder (seg-sided prism), optionally tapering.
    def cyl(self, mat, cx, cz, y0, y1, r, seg=12, r_top=None):
        rt = r if r_top is None else r_top
        pts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            pts.append((cx + math.cos(a) * r, y0, cz + math.sin(a) * r))
            pts.append((cx + math.cos(a) * rt, y1, cz + math.sin(a) * rt))
        self.add(mat, pts)

    def cone(self, mat, cx, cz, y0, h, r, seg=12):
        pts = [(cx + math.cos(2 * math.pi * i / seg) * r, y0, cz + math.sin(2 * math.pi * i / seg) * r) for i in range(seg)]
        pts.append((cx, y0 + h, cz))
        self.add(mat, pts)

    def sphere(self, mat, cx, cy, cz, r, seg=8, rings=5, sy=1.0):
        pts = [(cx, cy + r * sy, cz), (cx, cy - r * sy, cz)]
        for j in range(1, rings):
            phi = math.pi * j / rings
            for i in range(seg):
                a = 2 * math.pi * i / seg + (j % 2) * math.pi / seg
                pts.append((cx + math.sin(phi) * math.cos(a) * r, cy + math.cos(phi) * r * sy, cz + math.sin(phi) * math.sin(a) * r))
        self.add(mat, pts)

    # Gable roof, ridge along x at the middle of z0..z1.
    def gable_x(self, mat, x0, x1, z0, z1, y0, h):
        zm = (z0 + z1) / 2
        self.add(mat, [(x, y0, z) for x in (x0, x1) for z in (z0, z1)] + [(x0, y0 + h, zm), (x1, y0 + h, zm)])

    # Gable roof, ridge along z (front-facing gables: dormers, porch roofs).
    def gable_z(self, mat, x0, x1, z0, z1, y0, h):
        xm = (x0 + x1) / 2
        self.add(mat, [(x, y0, z) for x in (x0, x1) for z in (z0, z1)] + [(xm, y0 + h, z0), (xm, y0 + h, z1)])

    # Hip roof: rectangle base, ridge along x shortened by `inset` at both ends.
    def hip(self, mat, x0, x1, z0, z1, y0, h, inset):
        zm = (z0 + z1) / 2
        self.add(mat, [(x, y0, z) for x in (x0, x1) for z in (z0, z1)] + [(x0 + inset, y0 + h, zm), (x1 - inset, y0 + h, zm)])

    # Shingle strips lying on both slopes of a gable_x roof.
    def shingles(self, mat, x0, x1, z0, z1, y0, h, rows=3, t=0.035):
        zm = (z0 + z1) / 2
        run = (z1 - z0) / 2
        a = math.atan2(h, run)
        L = math.hypot(run, h)
        for side in (1, -1):
            for k in range(rows):
                f = (k + 0.5) / (rows + 0.6)
                z = zm + side * run * (1 - f)
                y = y0 + h * f
                nz, ny = side * math.sin(a), math.cos(a)
                c = (0.5 * (x0 + x1), y + ny * t * 0.5, z + nz * t * 0.5)
                self.rbox(mat, c, (x1 - x0 - 0.04, t, L * 0.11), rx=side * a)

    # Window: frame, glass, cross bars (on a front wall at depth z, facing +z).
    def window(self, x, y0, y1, z, w, frame='timber', glass='glass', bars=True, sill=None):
        self.box(frame, x - w / 2 - 0.05, y0 - 0.05, z - 0.01, x + w / 2 + 0.05, y1 + 0.05, z + 0.03)
        self.box(glass, x - w / 2, y0, z + 0.02, x + w / 2, y1, z + 0.045)
        if bars:
            self.box(frame, x - 0.015, y0, z + 0.03, x + 0.015, y1, z + 0.06)
            ym = (y0 + y1) / 2
            self.box(frame, x - w / 2, ym - 0.015, z + 0.03, x + w / 2, ym + 0.015, z + 0.06)
        if sill:
            self.box(sill, x - w / 2 - 0.08, y0 - 0.1, z - 0.01, x + w / 2 + 0.08, y0 - 0.04, z + 0.09)

    # The same on a side wall (x = const), facing +x (side=1) or -x (side=-1).
    def side_window(self, xw, y0, y1, zc, w, side, frame='timber', glass='glass'):
        s = side
        self.box(frame, min(xw - 0.01 * s, xw + 0.03 * s), y0 - 0.05, zc - w / 2 - 0.05, max(xw - 0.01 * s, xw + 0.03 * s), y1 + 0.05, zc + w / 2 + 0.05)
        self.box(glass, min(xw + 0.02 * s, xw + 0.045 * s), y0, zc - w / 2, max(xw + 0.02 * s, xw + 0.045 * s), y1, zc + w / 2)

    def flowers(self, x0, x1, y, z, colours=('flower',)):
        n = max(2, int((x1 - x0) / 0.12))
        for i in range(n):
            x = x0 + (i + 0.5) * (x1 - x0) / n
            self.sphere('leaf', x, y + 0.05, z, 0.06, seg=6, rings=3)
            self.sphere(colours[i % len(colours)], x + 0.01, y + 0.1, z + 0.02, 0.035, seg=6, rings=3)


# ── Tier 1: Starter House ───────────────────────────────────────────────────

def tier1():
    k = Kit()
    # Plinth, walls, corner posts, top beam.
    k.box('stone', -1.25, 0.0, -0.95, 1.25, 0.18, 1.05)
    k.box('plaster', -1.15, 0.18, -0.85, 1.15, 1.45, 0.95)
    for x in (-1.15, 1.15):
        for z in (-0.85, 0.95):
            k.box('timber', x - 0.07, 0.18, z - 0.07, x + 0.07, 1.45, z + 0.07)
    k.box('timber', -1.2, 1.4, -0.9, 1.2, 1.5, 1.0)
    # Roof with shingle rows and a ridge cap.
    rx0, rx1, rz0, rz1, ry, rh = -1.4, 1.4, -1.12, 1.22, 1.45, 1.05
    k.gable_x('shingle', rx0, rx1, rz0, rz1, ry, rh)
    k.shingles('shingle_dark', rx0, rx1, rz0, rz1, ry, rh, rows=3)
    zm = (rz0 + rz1) / 2
    k.box('shingle_dark', rx0 - 0.02, ry + rh - 0.05, zm - 0.07, rx1 + 0.02, ry + rh + 0.05, zm + 0.07)
    # Stone chimney.
    k.box('stone_dark', 0.55, 1.4, -0.6, 0.9, 2.75, -0.25)
    k.box('stone', 0.5, 2.75, -0.65, 0.95, 2.85, -0.2)
    # Door with frame, knob, step and a little porch roof.
    k.box('timber', -0.34, 0.18, 0.94, 0.34, 1.18, 0.99)
    k.box('door', -0.27, 0.18, 0.97, 0.27, 1.12, 1.01)
    k.sphere('flower_yellow', 0.18, 0.66, 1.02, 0.025, seg=6, rings=3)
    k.box('stone', -0.42, 0.0, 1.0, 0.42, 0.12, 1.28)
    k.gable_z('shingle', -0.46, 0.46, 0.95, 1.32, 1.2, 0.26)
    # Front windows with shutters and sills, side windows.
    for x in (-0.7, 0.7):
        k.window(x, 0.6, 1.05, 0.95, 0.42, sill='timber')
        for s in (-1, 1):
            k.box('shutter', x + s * 0.27 - 0.05, 0.58, 0.96, x + s * 0.27 + 0.05, 1.07, 1.0)
    for s in (-1, 1):
        k.side_window(s * 1.15, 0.6, 1.05, 0.05, 0.42, s)
    # Flower pots by the door.
    for x in (-0.55, 0.55):
        k.cyl('pot', x, 1.17, 0.0, 0.16, 0.1, seg=8, r_top=0.12)
        k.sphere('leaf', x, 0.25, 1.17, 0.12, seg=7, rings=4)
        k.sphere('flower', x + 0.05, 0.33, 1.2, 0.04, seg=6, rings=3)
        k.sphere('flower', x - 0.05, 0.31, 1.15, 0.04, seg=6, rings=3)
    return k


# ── Tier 2: Timber House ────────────────────────────────────────────────────

def tier2():
    k = Kit()
    k.box('stone', -1.35, 0.0, -1.05, 1.35, 0.32, 1.0)
    # Ground floor and jettied first floor.
    k.box('plaster_warm', -1.25, 0.32, -0.95, 1.25, 1.35, 0.9)
    k.box('frame', -1.37, 1.3, -1.05, 1.37, 1.42, 1.03)
    k.box('plaster_warm', -1.32, 1.42, -1.0, 1.32, 2.4, 0.98)
    k.box('frame', -1.36, 2.32, -1.04, 1.36, 2.44, 1.02)
    # Timber framing – ground floor posts, first floor posts and braces.
    for x in (-1.25, -0.45, 0.45, 1.25):
        k.box('frame', x - 0.05, 0.32, 0.88, x + 0.05, 1.32, 0.94)
    for x in (-1.32, -0.66, 0.0, 0.66, 1.32):
        k.box('frame', x - 0.05, 1.42, 0.96, x + 0.05, 2.34, 1.02)
    k.box('frame', -1.32, 1.82, 0.97, 1.32, 1.88, 1.01)
    for (xa, xb) in ((-1.32, -0.66), (0.66, 1.32)):
        k.brace('frame', xa, 1.45, xb, 1.82, 0.97, 1.01, w=0.06)
        k.brace('frame', xa, 2.3, xb, 1.88, 0.97, 1.01, w=0.06)
    for s in (-1, 1):
        for z in (-1.0, 0.0, 0.98):
            k.box('frame', s * 1.32 - 0.04, 1.42, z - 0.05, s * 1.32 + 0.04, 2.34, z + 0.05)
        for z in (-0.95, 0.0, 0.9):
            k.box('frame', s * 1.25 - 0.04, 0.32, z - 0.05, s * 1.25 + 0.04, 1.32, z + 0.05)
    # Steep slate roof, ridge cap, dormer.
    rx0, rx1, rz0, rz1, ry, rh = -1.46, 1.46, -1.25, 1.22, 2.38, 1.3
    k.gable_x('slate_teal', rx0, rx1, rz0, rz1, ry, rh)
    k.shingles('slate_teal_dark', rx0, rx1, rz0, rz1, ry, rh, rows=4, t=0.03)
    zm = (rz0 + rz1) / 2
    k.box('slate_teal_dark', rx0 - 0.02, ry + rh - 0.05, zm - 0.07, rx1 + 0.02, ry + rh + 0.05, zm + 0.07)
    k.box('plaster_warm', -0.33, 2.5, 0.2, 0.33, 3.05, 0.78)
    k.gable_z('slate_teal', -0.45, 0.45, 0.12, 0.88, 3.0, 0.38)
    k.window(0.0, 2.6, 2.92, 0.78, 0.36, frame='frame')
    # Brick chimney.
    k.box('brick', -1.0, 2.3, -0.6, -0.62, 3.85, -0.22)
    k.box('stone', -1.05, 3.85, -0.65, -0.57, 3.95, -0.17)
    # Porch: deck, steps, posts, shed roof.
    k.box('deck', -0.95, 0.0, 0.9, 0.95, 0.3, 1.42)
    k.box('stone', -0.45, 0.0, 1.38, 0.45, 0.15, 1.5)
    for x in (-0.85, 0.85):
        k.box('frame', x - 0.05, 0.3, 1.3, x + 0.05, 1.28, 1.4)
        k.box('frame', x - 0.04, 0.55, 1.33, x + 0.04, 0.6, 1.37)
    k.box('frame', -0.95, 1.22, 1.3, 0.95, 1.3, 1.42)
    k.add('slate_teal', [(x, y, z) for x in (-1.02, 1.02) for (y, z) in ((1.36, 0.9), (1.46, 0.9), (1.2, 1.48), (1.28, 1.48))])
    # Door, fanlight, lantern.
    k.box('frame', -0.36, 0.32, 0.89, 0.36, 1.3, 0.94)
    k.box('door_green', -0.29, 0.32, 0.92, 0.29, 1.12, 0.96)
    k.box('glass', -0.22, 1.15, 0.92, 0.22, 1.25, 0.96)
    k.sphere('flower_yellow', 0.19, 0.72, 0.97, 0.025, seg=6, rings=3)
    k.box('iron', 0.47, 0.88, 0.9, 0.59, 1.06, 1.0)
    k.box('glass', 0.49, 0.9, 0.95, 0.57, 1.04, 1.01)
    # Windows: ground floor with flower boxes, first floor between the posts.
    for x in (-0.85, 0.85):
        k.window(x, 0.62, 1.08, 0.9, 0.42, frame='frame')
        k.box('timber', x - 0.27, 0.48, 0.9, x + 0.27, 0.6, 1.02)
        k.flowers(x - 0.24, x + 0.24, 0.58, 0.97, colours=('flower', 'flower_yellow'))
    for x in (-0.99, -0.33, 0.33, 0.99):
        k.window(x, 1.98, 2.25, 0.98, 0.3, frame='frame', bars=False)
    for s in (-1, 1):
        k.side_window(s * 1.25, 0.62, 1.05, -0.45, 0.36, s, frame='frame')
        k.side_window(s * 1.32, 1.6, 2.1, 0.5, 0.36, s, frame='frame')
        k.side_window(s * 1.32, 1.6, 2.1, -0.5, 0.36, s, frame='frame')
    return k


# ── Tier 3: Hearth Manor ────────────────────────────────────────────────────

def tier3():
    k = Kit()
    # Terrace and main block (shifted right to make room for the tower).
    k.box('terrace', -1.45, 0.0, -1.2, 1.45, 0.3, 1.15)
    k.box('ashlar', -1.25, 0.3, -1.05, 1.15, 2.65, 0.85)
    # Quoins on the two front corners and the back-right corner.
    for (x, z) in ((1.15, 0.85), (-1.25, 0.85), (1.15, -1.05)):
        for i in range(9):
            y = 0.32 + i * 0.26
            wide = i % 2 == 0
            hx = 0.13 if wide else 0.08
            k.box('quoin', x - hx, y, z - (0.13 if not wide else 0.08), x + hx, y + 0.22, z + (0.13 if not wide else 0.08))
    # String course and cornice.
    k.box('marble', -1.29, 1.45, -1.09, 1.19, 1.55, 0.89)
    k.box('marble', -1.33, 2.6, -1.13, 1.23, 2.75, 0.93)
    k.box('gold', -1.33, 2.58, 0.92, 1.23, 2.61, 0.94)
    # Hip roof, ridge, finials, dormer, chimneys.
    k.hip('slate', -1.38, 1.28, -1.24, 1.04, 2.74, 1.15, inset=0.75)
    k.box('slate_dark', -0.68, 3.86, -0.16, 0.58, 3.94, -0.04)
    for x in (-0.66, 0.56):
        k.sphere('gold', x, 4.0, -0.1, 0.07, seg=8, rings=4)
        k.cone('gold', x, -0.1, 4.05, 0.22, 0.03, seg=6)
    k.box('ashlar', 0.32, 2.82, 0.15, 0.88, 3.3, 0.72)
    k.gable_z('slate', 0.22, 0.98, 0.08, 0.84, 3.26, 0.34)
    k.window(0.6, 2.9, 3.18, 0.72, 0.3, frame='marble', glass='sea_glass')
    for x in (-0.75, 0.82):
        k.box('quoin', x - 0.18, 2.6, -0.8, x + 0.18, 4.25, -0.45)
        k.box('marble', x - 0.22, 4.25, -0.84, x + 0.22, 4.33, -0.41)
    # Portico: floor, steps, columns, entablature, balcony.
    k.box('marble', -0.82, 0.28, 0.85, 0.72, 0.36, 1.33)
    k.box('marble', -0.6, 0.0, 1.3, 0.5, 0.2, 1.48)
    k.box('marble', -0.6, 0.18, 1.25, 0.5, 0.3, 1.38)
    for x in (-0.7, -0.29, 0.19, 0.6):
        k.box('marble', x - 0.09, 0.36, 1.13, x + 0.09, 0.42, 1.31)
        k.cyl('marble', x, 1.22, 0.42, 1.36, 0.065, seg=10, r_top=0.055)
        k.box('marble', x - 0.09, 1.36, 1.13, x + 0.09, 1.42, 1.31)
    k.box('marble', -0.84, 1.42, 0.85, 0.74, 1.58, 1.35)
    k.box('gold', -0.84, 1.48, 1.35, 0.74, 1.51, 1.37)
    for i in range(9):
        x = -0.76 + i * 0.185
        k.cyl('marble', x, 1.28, 1.58, 1.8, 0.03, seg=6)
    for z in (0.95, 1.12):
        k.cyl('marble', -0.76, z, 1.58, 1.8, 0.03, seg=6)
        k.cyl('marble', 0.72, z, 1.58, 1.8, 0.03, seg=6)
    k.box('marble', -0.8, 1.8, 1.24, 0.76, 1.85, 1.32)
    for x in (-0.8, 0.76):
        k.box('marble', x - 0.04, 1.8, 0.85, x + 0.04, 1.85, 1.32)
    # Double door with gold knobs and a fanlight.
    k.box('marble', -0.38, 0.36, 0.84, 0.28, 1.36, 0.88)
    k.box('door_wine', -0.31, 0.36, 0.86, -0.06, 1.24, 0.9)
    k.box('door_wine', -0.04, 0.36, 0.86, 0.21, 1.24, 0.9)
    for x in (-0.09, -0.01):
        k.sphere('gold', x, 0.8, 0.91, 0.022, seg=6, rings=3)
    fan = [(-0.05 + math.cos(math.pi * i / 10) * 0.25, 1.24 + math.sin(math.pi * i / 10) * 0.12, z) for i in range(11) for z in (0.86, 0.9)]
    k.add('sea_glass', fan)
    # Windows (sea glass, marble frames, gold keystones).
    def tall(x, y0, y1, z=0.85):
        k.window(x, y0, y1, z, 0.3, frame='marble', glass='sea_glass')
        k.box('gold', x - 0.04, y1 + 0.04, z + 0.01, x + 0.04, y1 + 0.11, z + 0.06)
    tall(0.92, 0.55, 1.25)
    for x in (-0.45, 0.35, 0.92):
        tall(x, 1.8, 2.4)
    k.box('door_wine', -0.2, 1.58, 0.84, 0.1, 2.3, 0.88)
    k.box('sea_glass', -0.16, 1.85, 0.86, 0.06, 2.22, 0.9)
    for s in (-1, 1):
        xw = 1.15 if s > 0 else -1.25
        for zc in (-0.55, 0.25):
            k.side_window(xw, 0.6, 1.25, zc, 0.3, s, frame='marble', glass='sea_glass')
            k.side_window(xw, 1.8, 2.4, zc, 0.3, s, frame='marble', glass='sea_glass')
    # Corner tower with bands, windows, conical roof, finial and pennant.
    tx, tz, tr = -1.0, 0.8, 0.4
    k.cyl('ashlar', tx, tz, 0.3, 3.3, tr, seg=16)
    for y in (1.45, 3.2):
        k.cyl('marble', tx, tz, y, y + 0.12, tr + 0.04, seg=16)
    k.cyl('gold', tx, tz, 3.31, 3.34, tr + 0.05, seg=16)
    k.cone('slate', tx, tz, 3.32, 1.35, tr + 0.1, seg=16)
    k.sphere('gold', tx, 4.72, tz, 0.07, seg=8, rings=4)
    k.cyl('gold', tx, tz, 4.7, 5.05, 0.015, seg=6)
    k.add('door_wine', [(tx, 4.86, tz), (tx, 5.03, tz), (tx + 0.28, 4.95, tz), (tx, 4.86, tz + 0.01), (tx, 5.03, tz + 0.01), (tx + 0.28, 4.95, tz + 0.01)])
    for (y0, y1) in ((0.7, 1.2), (1.8, 2.35), (2.65, 3.05)):
        zf = tz + tr
        k.box('marble', tx - 0.12, y0 - 0.04, zf - 0.06, tx + 0.12, y1 + 0.04, zf + 0.02)
        k.box('sea_glass', tx - 0.08, y0, zf - 0.03, tx + 0.08, y1, zf + 0.04)
    # Gold lantern posts at the steps, hedge and topiary on the right.
    for x in (-0.72, 0.62):
        k.cyl('iron', x, 1.42, 0.0, 0.85, 0.025, seg=6)
        k.box('gold', x - 0.07, 0.85, 1.35, x + 0.07, 1.05, 1.49)
        k.box('glass', x - 0.05, 0.87, 1.37, x + 0.05, 1.03, 1.5)
        k.cone('gold', x, 1.42, 1.05, 0.1, 0.09, seg=6)
    k.box('hedge', 0.78, 0.3, 0.93, 1.42, 0.62, 1.12)
    k.box('marble', 1.02, 0.3, 1.18, 1.32, 0.5, 1.45)
    k.sphere('hedge', 1.17, 0.72, 1.31, 0.17, seg=8, rings=5)
    k.sphere('hedge', 1.17, 0.98, 1.31, 0.11, seg=8, rings=4)
    return k


TIERS = {1: tier1, 2: tier2, 3: tier3}


def check(k, name):
    """Every point must stay inside the 3×3 footprint and above the ground."""
    for mat, pts in k.parts:
        for (x, y, z) in pts:
            if abs(x) > 1.5 + 1e-6 or abs(z) > 1.5 + 1e-6 or y < -1e-6:
                raise ValueError(f'{name}: {mat} point {(x, y, z)} outside the footprint')


# ── Blender ─────────────────────────────────────────────────────────────────

def build_in_blender(target_glb):
    import bpy
    import bmesh
    from mathutils import Vector

    def to_blender(p):
        x, y, z = p
        return Vector((x, -z, y))

    mats = {}

    def material(name):
        if name in mats:
            return mats[name]
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        hexv = PALETTE[name].lstrip('#')
        srgb = [int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
            bsdf.inputs['Roughness'].default_value = 0.2 if name in GLASS else 0.9
        m.diffuse_color = (*lin, 1.0)
        mats[name] = m
        return m

    # Remove the previous build.
    for o in [o for o in bpy.data.objects if o.name.startswith('house_')]:
        bpy.data.objects.remove(o, do_unlink=True)
    for me in [m for m in bpy.data.meshes if m.name.startswith('house_') and m.users == 0]:
        bpy.data.meshes.remove(me)

    coll = bpy.context.scene.collection
    roots = []
    for lvl, make in TIERS.items():
        k = make()
        check(k, f'house_{lvl}')
        root = bpy.data.objects.new(f'house_{lvl}', None)
        root.empty_display_type = 'PLAIN_AXES'
        root.location = ((lvl - 2) * 4.0, 0, 0)  # side by side in the .blend
        coll.objects.link(root)
        by_mat = {}
        for mat, pts in k.parts:
            by_mat.setdefault(mat, []).append(pts)
        for mat, parts in by_mat.items():
            bm = bmesh.new()
            for pts in parts:
                vs = [bm.verts.new(to_blender(p)) for p in pts]
                res = bmesh.ops.convex_hull(bm, input=vs)
                junk = [g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)]
                if junk:
                    bmesh.ops.delete(bm, geom=junk, context='VERTS')
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
            bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts, edges=bm.edges)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(f'house_{lvl}_{mat}')
            bm.to_mesh(me)
            bm.free()
            me.materials.append(material(mat))
            for poly in me.polygons:
                poly.use_smooth = False
            ob = bpy.data.objects.new(f'house_{lvl}_{mat}', me)
            coll.objects.link(ob)
            ob.parent = root
        roots.append(root)

    for o in bpy.data.objects:
        o.select_set(o.name.startswith('house_'))
    os.makedirs(os.path.dirname(target_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=target_glb, export_format='GLB', use_selection=True, export_yup=True,
                              export_normals=False, export_materials='EXPORT')
    print('exported', target_glb)
    return roots


def blender_main():
    import bpy
    here = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() and os.path.exists(__file__) else ''
    repo = os.path.dirname(here) if here and os.path.basename(here) == 'art' else ''
    if bpy.data.filepath:
        # Text Editor in a saved .blend: export next to it (copy to client/public/models/).
        target = os.path.join(os.path.dirname(bpy.data.filepath), 'house.glb')
        build_in_blender(target)
        return
    # Command line: start clean, build, save art/house.blend, export into the client.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    base = repo or os.getcwd()
    target = os.path.join(base, 'client', 'public', 'models', 'house.glb') if repo else os.path.join(base, 'house.glb')
    build_in_blender(target)
    blend = os.path.join(base, 'art', 'house.blend') if repo else os.path.join(base, 'house.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print('saved', blend)


# ── Preview without Blender ─────────────────────────────────────────────────

def preview(path):
    """Small z-buffered software render of all three tiers (numpy, scipy, Pillow)."""
    import numpy as np
    from scipy.spatial import ConvexHull
    from PIL import Image

    W, H = 560, 820
    ya, pa = math.radians(-35), math.radians(32)
    Ry = np.array([[math.cos(ya), 0, math.sin(ya)], [0, 1, 0], [-math.sin(ya), 0, math.cos(ya)]])
    Rx = np.array([[1, 0, 0], [0, math.cos(pa), -math.sin(pa)], [0, math.sin(pa), math.cos(pa)]])
    R = Rx @ Ry
    light = np.array([0.45, 0.85, 0.55])
    light /= np.linalg.norm(light)
    rgb = lambda hx: np.array([int(hx[j:j + 2], 16) / 255 for j in (1, 3, 5)])

    def render(k):
        zb = np.full((H, W), np.inf)
        img = np.ones((H, W, 3)) * np.array([0.93, 0.96, 0.9])
        ground = [(x, y, z) for x in (-1.6, 1.6) for y in (-0.03, -0.01) for z in (-1.6, 1.6)]
        for colour, pts in [(rgb('#8fbf6a'), ground)] + [(rgb(PALETTE[m]), p) for m, p in k.parts]:
            P = np.array(pts)
            hull = ConvexHull(P, qhull_options='QJ')
            Q = P @ R.T
            for simplex, eq in zip(hull.simplices, hull.equations):
                shade = 0.5 + 0.5 * max(0.0, float(eq[:3] @ light))
                t = Q[simplex]
                xs, ys, zs = W / 2 + t[:, 0] * 118, H * 0.7 - t[:, 1] * 118, -t[:, 2]
                x0, x1 = int(max(0, np.floor(xs.min()))), int(min(W - 1, np.ceil(xs.max())))
                y0, y1 = int(max(0, np.floor(ys.min()))), int(min(H - 1, np.ceil(ys.max())))
                if x1 < x0 or y1 < y0:
                    continue
                gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
                d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
                if abs(d) < 1e-9:
                    continue
                l1 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d
                l2 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d
                l3 = 1 - l1 - l2
                inside = (l1 >= -1e-4) & (l2 >= -1e-4) & (l3 >= -1e-4)
                z = l1 * zs[0] + l2 * zs[1] + l3 * zs[2]
                sub = zb[y0:y1 + 1, x0:x1 + 1]
                upd = inside & (z < sub)
                sub[upd] = z[upd]
                img[y0:y1 + 1, x0:x1 + 1][upd] = np.clip(colour * shade, 0, 1)
        return (img * 255).astype(np.uint8)

    frames = []
    for lvl, make in TIERS.items():
        k = make()
        check(k, f'house_{lvl}')
        frames.append(render(k))
    Image.fromarray(np.concatenate(frames, axis=1)).save(path)
    print('preview', path)


def export_glb_without_blender(path):
    """Write house.glb straight from the geometry (numpy + scipy), same layout as the Blender export."""
    import json
    import struct
    import numpy as np
    from scipy.spatial import ConvexHull

    def linear(hx):
        c = [int(hx[j:j + 2], 16) / 255 for j in (1, 3, 5)]
        return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

    blob = bytearray()
    views, accessors, meshes, nodes, materials, mat_index = [], [], [], [], [], {}
    roots = []

    def add_view(data, target):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        return len(views) - 1

    for lvl, make in TIERS.items():
        k = make()
        check(k, f'house_{lvl}')
        by_mat = {}
        for mat, pts in k.parts:
            P = np.array(pts, dtype=np.float64)
            hull = ConvexHull(P, qhull_options='QJ')
            tris = by_mat.setdefault(mat, [])
            for simplex, eq in zip(hull.simplices, hull.equations):
                a, b2, c = P[simplex[0]], P[simplex[1]], P[simplex[2]]
                if np.dot(np.cross(b2 - a, c - a), eq[:3]) < 0:
                    b2, c = c, b2
                if np.linalg.norm(np.cross(b2 - a, c - a)) < 1e-10:
                    continue
                tris.append((a, b2, c))
        children = []
        for mat, tris in by_mat.items():
            if mat not in mat_index:
                mat_index[mat] = len(materials)
                materials.append({'name': mat, 'pbrMetallicRoughness': {'baseColorFactor': linear(PALETTE[mat]) + [1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.2 if mat in GLASS else 0.9}})
            pos = np.array([v for t in tris for v in t], dtype=np.float32)
            idx = np.arange(len(pos), dtype=np.uint32)
            pv = add_view(pos.tobytes(), 34962)
            accessors.append({'bufferView': pv, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()})
            iv = add_view(idx.tobytes(), 34963)
            accessors.append({'bufferView': iv, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'})
            meshes.append({'name': f'house_{lvl}_{mat}', 'primitives': [{'attributes': {'POSITION': len(accessors) - 2}, 'indices': len(accessors) - 1, 'material': mat_index[mat]}]})
            nodes.append({'name': f'house_{lvl}_{mat}', 'mesh': len(meshes) - 1})
            children.append(len(nodes) - 1)
        nodes.append({'name': f'house_{lvl}', 'children': children, 'translation': [(lvl - 2) * 4.0, 0.0, 0.0]})
        roots.append(len(nodes) - 1)

    while len(blob) % 4:
        blob.append(0)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'hearthwood art/house_build.py (no Blender)'},
        'scene': 0, 'scenes': [{'nodes': roots}], 'nodes': nodes, 'meshes': meshes, 'materials': materials,
        'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(out)
    print('exported', path, f'({len(out) // 1024} KB, no Blender)')


if __name__ == '__main__':
    try:
        import bpy  # noqa: F401
        IN_BLENDER = True
    except ImportError:
        IN_BLENDER = False
    if IN_BLENDER:
        blender_main()
    elif '--glb' in sys.argv:
        export_glb_without_blender(sys.argv[sys.argv.index('--glb') + 1])
    else:
        out = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'house_preview.png')
        preview(out)
