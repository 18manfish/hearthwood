"""Bohemian furniture pack for the player's house. Game units: 1 = one tile, y up, +z = front.
Floor items sit on y = 0 centred on their tile; wall items hang on the wall plane at z = WALL_Z."""
import math
from kit import Kit, Rng

WALL_Z = 0.5
RAT, RAT_D, RAT_L = '#c9a26b', '#a8814e', '#dcbd8a'
WOOD, WOOD_D = '#8a5a3a', '#6b4429'
TERRA, MUSTARD, SAGE, RUST = '#c46a3c', '#d9a53a', '#8fa77a', '#a8482e'
CREAM, TEAL, PLUM, BLUSH = '#f1e6d2', '#2f7a78', '#7a3f5c', '#e8b4a0'
JUTE, JUTE_D, BRASS, LEAF, LEAF_D = '#c8ad7f', '#a88d60', '#c9a24a', '#4f8a45', '#3a6e35'


def woven_cyl(k, c, y0, y1, r0, r1, bands=6, cols=(RAT, RAT_D), seg=14, role='rattan', g='main'):
    for i in range(bands):
        a, b = i / bands, (i + 1) / bands
        k.cyl(role, cols[i % len(cols)], c, y0 + (y1 - y0) * a, y0 + (y1 - y0) * b, r0 + (r1 - r0) * a, r0 + (r1 - r0) * b, seg=seg, g=g)


def leaf(k, base, tip, w, color, t=0.012, g='main'):
    mid = tuple((base[i] + tip[i]) / 2 for i in range(3))
    d = [tip[i] - base[i] for i in range(3)]
    side = (-d[2], 0, d[0])
    l = math.sqrt(side[0] ** 2 + side[2] ** 2) or 1
    side = (side[0] / l * w, 0.02, side[2] / l * w)
    k.fin('leaf', color, [base, (mid[0] + side[0], mid[1] + side[1], mid[2] + side[2]), tip, (mid[0] - side[0], mid[1] + side[1], mid[2] - side[2])], t=t, g=g)


def cushion(k, c, size, color, r=(0, 0, 0), accent=None, g='main'):
    k.ell('cushion', color, c, (size[0] / 2, size[1] / 2, size[2] / 2), r=r, seg=10, rings=5, g=g)
    if accent:
        k.ell('pattern', accent, (c[0], c[1] + size[1] * 0.02, c[2]), (size[0] * 0.18, size[1] * 0.52, size[2] * 0.18), r=r, seg=8, rings=4, g=g)


def fringe(k, x0, x1, y, z, n, length, color, dz=1):
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        k.rod('fringe', color, (x, y, z), (x, max(0.002, y - 0.002), z + dz * length), 0.006, 0.004, seg=4)


# ── Seating ─────────────────────────────────────────────────────────────────

def peacock_chair():
    k = Kit()
    # Hourglass base.
    woven_cyl(k, (0, 0), 0.0, 0.18, 0.26, 0.12, bands=3)
    woven_cyl(k, (0, 0), 0.18, 0.34, 0.12, 0.3, bands=3)
    k.cyl('rattan', RAT_D, (0, 0), 0.34, 0.38, 0.32, 0.32, seg=16)
    # Fan back: radial slats + rings.
    cx, cy, cz = 0, 0.38, -0.22
    for i in range(13):
        a = math.pi * (0.08 + 0.84 * i / 12)
        tip = (cx + math.cos(a) * 0.62, cy + math.sin(a) * 0.95, cz - 0.08)
        k.rod('rattan', RAT if i % 2 else RAT_D, (cx + math.cos(a) * 0.12, cy + 0.02, cz + 0.06), tip, 0.022, 0.016, seg=5)
    for rr, col in ((0.45, RAT_L), (0.75, RAT_L), (1.0, RAT_D)):
        pts = [(cx + math.cos(math.pi * (0.06 + 0.88 * j / 16)) * 0.62 * rr, cy + math.sin(math.pi * (0.06 + 0.88 * j / 16)) * 0.95 * rr, cz + 0.06 - 0.14 * rr) for j in range(17)]
        for p0, p1 in zip(pts, pts[1:]):
            k.rod('rattan', col, p0, p1, 0.02, seg=5)
    # Armrests.
    for s in (-1, 1):
        k.rod('rattan', RAT_D, (s * 0.3, 0.38, 0.18), (s * 0.33, 0.6, -0.1), 0.03, seg=6)
    cushion(k, (0, 0.43, 0.03), (0.52, 0.1, 0.48), TERRA, accent=MUSTARD)
    cushion(k, (0, 0.62, -0.2), (0.42, 0.3, 0.12), CREAM, r=(-0.25, 0, 0), accent=TEAL)
    return k


def egg_chair():
    k = Kit()
    k.pivot('swing', (0, 1.78, -0.05))
    # Stand.
    k.cyl('metal', '#2f2a26', (0, -0.05), 0.0, 0.05, 0.34, 0.32, seg=16)
    k.rod('metal', '#2f2a26', (0, 0.05, -0.32), (0, 1.75, -0.32), 0.035, seg=8)
    k.rod('metal', '#2f2a26', (0, 1.75, -0.32), (0, 1.86, -0.05), 0.035, seg=8)
    # Hanging basket (swing group).
    k.rod('chain', '#4a4440', (0, 1.84, -0.05), (0, 1.5, -0.02), 0.012, seg=5, g='swing')
    ring = lambda y, r, z: [(math.cos(2 * math.pi * j / 14) * r, y, z + math.sin(2 * math.pi * j / 14) * r) for j in range(14)]
    profile = [(0.28, 0.06, 0.0), (0.42, 0.24, -0.02), (0.75, 0.32, -0.04), (1.05, 0.28, -0.06), (1.32, 0.17, -0.06), (1.48, 0.03, -0.05)]
    for i, ((y0, r0, z0), (y1, r1, z1)) in enumerate(zip(profile, profile[1:])):
        # Woven shell open at the front: skip the front third of each ring.
        a0 = ring(y0, r0, z0)
        a1 = ring(y1, r1, z1)
        for j in range(14):
            ang = 2 * math.pi * j / 14
            if math.sin(ang) > 0.55 and 0 < i < 4:
                continue
            j2 = (j + 1) % 14
            col = RAT if (i + j) % 2 else RAT_D
            k.add('rattan', col, [a0[j], a0[j2], a1[j], a1[j2], (a0[j][0] * 0.9, a0[j][1], a0[j][2] * 0.9), (a1[j][0] * 0.9, a1[j][1], a1[j][2] * 0.9)], g='swing')
    cushion(k, (0, 0.47, 0.02), (0.5, 0.12, 0.46), MUSTARD, accent=RUST, g='swing')
    cushion(k, (0, 0.75, -0.18), (0.4, 0.34, 0.12), CREAM, r=(-0.2, 0, 0), accent=PLUM, g='swing')
    cushion(k, (0.12, 0.6, -0.06), (0.22, 0.2, 0.08), TEAL, r=(-0.3, 0.4, 0), g='swing')
    return k


def floor_cushions():
    k = Kit()
    cushion(k, (-0.18, 0.07, 0.1), (0.5, 0.14, 0.5), RUST, r=(0, 0.3, 0), accent=MUSTARD)
    cushion(k, (0.22, 0.06, -0.12), (0.44, 0.12, 0.44), SAGE, r=(0, -0.2, 0), accent=CREAM)
    cushion(k, (0.05, 0.17, 0.05), (0.36, 0.1, 0.36), PLUM, r=(0.08, 0.6, 0.05), accent=BLUSH)
    k.rod('cushion', TEAL, (-0.35, 0.08, -0.3), (0.2, 0.08, -0.38), 0.08, seg=10)
    for x in (-0.35, 0.2):
        k.ell('tassel', MUSTARD, (x + (0.02 if x > 0 else -0.02), 0.08, -0.3 if x < 0 else -0.38), (0.02, 0.03, 0.02), seg=6, rings=3)
    for (x, z) in ((-0.43, 0.1), (0.07, 0.35), (0.45, -0.12)):
        k.rod('tassel', MUSTARD, (x, 0.07, z), (x * 1.05, 0.02, z * 1.05), 0.01, 0.018, seg=5)
    return k


def pouf():
    k = Kit()
    k.ell('knit', MUSTARD, (0, 0.15, 0), (0.25, 0.15, 0.25), seg=16, rings=7)
    # Chunky knit ribs running over the top.
    for i in range(12):
        a = 2 * math.pi * i / 12
        pts = [(math.cos(a) * 0.255 * math.sin(t), 0.15 + 0.152 * math.cos(t), math.sin(a) * 0.255 * math.sin(t)) for t in [j * math.pi / 8 for j in range(1, 8)]]
        for p0, p1 in zip(pts, pts[1:]):
            k.rod('knit', '#c48f2c', p0, p1, 0.018, seg=5)
    k.ell('knit', '#b88528', (0, 0.3, 0), (0.05, 0.015, 0.05), seg=8, rings=3)
    return k


def boho_sofa():
    k = Kit()
    # Low wooden frame, deep seat.
    k.box('wood', WOOD, (-0.78, 0.0, -0.38), (0.78, 0.22, 0.38))
    for x in (-0.72, 0.72):
        for z in (-0.32, 0.32):
            k.cyl('wood', WOOD_D, (x, z), 0.0, 0.06, 0.04, 0.035, seg=6)
    k.box('wood', WOOD_D, (-0.8, 0.22, -0.4), (0.8, 0.62, -0.28))
    for x in (-0.8, 0.68):
        k.box('wood', WOOD_D, (x, 0.22, -0.4), (x + 0.12, 0.42, 0.4))
    k.box('cushion', CREAM, (-0.68, 0.22, -0.28), (0.68, 0.36, 0.36))
    # Throw pillows.
    for (x, col, acc, a) in ((-0.5, RUST, MUSTARD, -0.15), (-0.18, TEAL, CREAM, 0.1), (0.15, MUSTARD, RUST, -0.08), (0.48, PLUM, BLUSH, 0.12)):
        cushion(k, (x, 0.52, -0.2), (0.32, 0.3, 0.1), col, r=(-0.25, a, 0), accent=acc)
    # Striped throw draped over one end.
    for i in range(5):
        col = (RUST, MUSTARD, CREAM, TEAL, RUST)[i]
        k.box('throw', col, (0.3 + i * 0.075, 0.36, -0.28), (0.375 + i * 0.075, 0.375, 0.37))
        k.box('throw', col, (0.3 + i * 0.075, 0.12, 0.37), (0.375 + i * 0.075, 0.375, 0.39))
    fringe(k, 0.3, 0.675, 0.12, 0.39, 8, 0.0, CREAM)
    return k


def canopy_bed():
    # Spans two tiles: this one and the one in front (+z), like the game's big bed.
    k = Kit()
    k.box('wood', WOOD, (-0.48, 0.0, -0.48), (0.48, 0.2, 1.46))
    k.box('mattress', CREAM, (-0.45, 0.2, -0.45), (0.45, 0.34, 1.43))
    # Quilt with patchwork squares.
    cols = [TERRA, MUSTARD, SAGE, PLUM, TEAL, RUST]
    for ix in range(4):
        for iz in range(4):
            x0, z0 = -0.47 + ix * 0.235, 0.35 + iz * 0.275
            k.box('quilt', cols[(ix + iz * 2) % 6], (x0, 0.34, z0), (x0 + 0.235, 0.39, z0 + 0.275))
    k.box('quilt', CREAM, (-0.48, 0.12, 1.44), (0.48, 0.39, 1.47))
    for (x, col, acc) in ((-0.22, CREAM, TEAL), (0.22, CREAM, RUST)):
        cushion(k, (x, 0.42, -0.28), (0.36, 0.12, 0.24), col, accent=acc)
    cushion(k, (0.0, 0.46, -0.12), (0.28, 0.2, 0.08), MUSTARD, r=(-0.4, 0, 0), accent=PLUM)
    # Rattan headboard (sunburst).
    for i in range(11):
        a = math.pi * (0.05 + 0.9 * i / 10)
        k.rod('rattan', RAT if i % 2 else RAT_D, (0, 0.3, -0.47), (math.cos(a) * 0.46, 0.3 + math.sin(a) * 0.62, -0.47), 0.02, 0.014, seg=5)
    pts = [(math.cos(math.pi * j / 14) * 0.46, 0.3 + math.sin(math.pi * j / 14) * 0.62, -0.47) for j in range(15)]
    for p0, p1 in zip(pts, pts[1:]):
        k.rod('rattan', RAT_D, p0, p1, 0.022, seg=5)
    # Canopy: four slim posts, top frame, draped gauze, fairy lights.
    for x in (-0.46, 0.46):
        for z in (-0.46, 1.44):
            k.cyl('wood', WOOD_D, (x, z), 0.2, 1.75, 0.022, seg=6)
    for z in (-0.46, 1.44):
        k.rod('wood', WOOD_D, (-0.46, 1.75, z), (0.46, 1.75, z), 0.02, seg=6)
    for x in (-0.46, 0.46):
        k.rod('wood', WOOD_D, (x, 1.75, -0.46), (x, 1.75, 1.44), 0.02, seg=6)
    for x in (-0.46, 0.46):
        k.add('gauze', '#f6efe2', [(x + dx, y, z) for dx in (-0.006, 0.006) for (y, z) in ((1.75, -0.44), (1.75, 0.15), (1.25, -0.2), (0.4, -0.44), (0.4, -0.3))])
        k.add('gauze', '#f6efe2', [(x + dx, y, z) for dx in (-0.006, 0.006) for (y, z) in ((1.75, 1.42), (1.75, 0.85), (1.25, 1.2), (0.4, 1.42), (0.4, 1.3))])
    for j in range(16):
        f = j / 15
        z = -0.46 + f * 1.9
        y = 1.72 - math.sin(f * math.pi * 3) ** 2 * 0.08
        for x in (-0.47, 0.47):
            k.ell('glow', '#ffe6a0', (x, y, z), (0.018, 0.018, 0.018), seg=6, rings=3)
    return k


# ── Tables & storage ────────────────────────────────────────────────────────

def coffee_table():
    k = Kit()
    k.cyl('wood', WOOD, (0, 0), 0.32, 0.37, 0.42, 0.42, seg=12)
    k.cyl('wood', WOOD_D, (0, 0), 0.3, 0.32, 0.4, 0.4, seg=12)
    for i in range(12):
        a = 2 * math.pi * i / 12
        k.ell('carving', WOOD_D, (math.cos(a) * 0.415, 0.345, math.sin(a) * 0.415), (0.02, 0.018, 0.02), seg=6, rings=3)
    for i in range(3):
        a = 2 * math.pi * i / 3 + 0.5
        k.rod('wood', WOOD_D, (math.cos(a) * 0.3, 0.3, math.sin(a) * 0.3), (math.cos(a) * 0.36, 0.0, math.sin(a) * 0.36), 0.035, 0.03, seg=6)
        k.ell('wood', WOOD, (math.cos(a) * 0.33, 0.15, math.sin(a) * 0.33), (0.045, 0.045, 0.045), seg=8, rings=4)
    # Brass tray with teapot and cups.
    k.cyl('brass', BRASS, (0.05, 0.02), 0.37, 0.39, 0.2, 0.21, seg=14)
    k.ell('ceramic', TEAL, (0.05, 0.46, 0.02), (0.08, 0.07, 0.08), seg=10, rings=6)
    k.rod('ceramic', TEAL, (0.12, 0.45, 0.02), (0.19, 0.5, 0.02), 0.018, 0.01, seg=6)
    k.ell('ceramic', '#e8e2d4', (0.05, 0.53, 0.02), (0.03, 0.02, 0.03), seg=6, rings=3)
    for (x, z) in ((-0.09, 0.1), (0.15, 0.14)):
        k.cyl('ceramic', CREAM, (x, z), 0.39, 0.45, 0.03, 0.035, seg=8)
    k.ell('candle', '#f2e6c8', (-0.25, 0.42, -0.15), (0.04, 0.05, 0.04), seg=8, rings=4)
    k.ell('glow', '#ffd27a', (-0.25, 0.49, -0.15), (0.012, 0.025, 0.012), seg=6, rings=3)
    return k


def vintage_trunk():
    k = Kit()
    k.box('trunk', TEAL, (-0.42, 0.0, -0.26), (0.42, 0.42, 0.26))
    k.add('trunk', TEAL, [(x, 0.42, z) for x in (-0.42, 0.42) for z in (-0.26, 0.26)] + [(x, 0.5, z) for x in (-0.42, 0.42) for z in (-0.18, 0.18)])
    for x in (-0.3, 0.3):
        k.box('leather', '#7a4a2a', (x - 0.035, -0.002, -0.27), (x + 0.035, 0.425, 0.27))
        k.add('leather', '#7a4a2a', [(x + dx, y, z) for dx in (-0.035, 0.035) for (y, z) in ((0.42, -0.27), (0.42, 0.27), (0.505, -0.185), (0.505, 0.185))])
    for x in (-0.42, 0.42):
        for (y0, y1) in ((0.0, 0.06), (0.36, 0.42)):
            for z in (-0.26, 0.26):
                k.box('brass', BRASS, (x - 0.045, y0 - 0.005, z - 0.045), (x + 0.045, y1 + 0.005, z + 0.045))
    k.box('brass', BRASS, (-0.05, 0.3, 0.26), (0.05, 0.4, 0.28))
    k.box('brass', BRASS, (-0.42, 0.395, -0.265), (0.42, 0.425, 0.265))
    # A folded blanket and a stack of books on top.
    k.box('throw', RUST, (-0.32, 0.5, -0.15), (0.05, 0.56, 0.15))
    fringe(k, -0.32, 0.05, 0.5, 0.15, 6, 0.03, CREAM)
    for i, col in enumerate((PLUM, MUSTARD, SAGE)):
        k.rbox('book', col, (0.22, 0.53 + i * 0.045, 0.0), (0.24, 0.04, 0.17), r=(0, 0.2 * (i - 1), 0))
    return k


def ladder_shelf():
    k = Kit()
    # Leans against the wall (back = -z).
    top, bot = (-0.4, 1.7, -0.42), (-0.4, 0.0, -0.05)
    for x in (-0.38, 0.38):
        k.rod('wood', WOOD, (x, 0.0, -0.05), (x, 1.7, -0.44), 0.025, seg=6)
    for i, (y, depth) in enumerate(((0.35, 0.32), (0.78, 0.26), (1.2, 0.2), (1.55, 0.14))):
        zb = -0.05 - (y / 1.7) * 0.39
        k.box('wood', WOOD_D, (-0.36, y - 0.02, zb - 0.01), (0.36, y + 0.01, zb + depth - 0.02))
        z0 = zb + 0.02
        if i == 0:
            woven_cyl(k, (-0.18, z0 + 0.12), y + 0.01, y + 0.2, 0.1, 0.12, bands=3)
            for j in range(6):
                a = j * 1.05
                leaf(k, (-0.18, y + 0.2, z0 + 0.12), (-0.18 + math.cos(a) * 0.2, y + 0.3, z0 + 0.12 + math.sin(a) * 0.12), 0.05, LEAF if j % 2 else LEAF_D)
            for b, col in enumerate((RUST, TEAL, MUSTARD)):
                k.box('book', col, (0.05 + b * 0.06, y + 0.01, z0 + 0.02), (0.1 + b * 0.06, y + 0.24, z0 + 0.2))
        elif i == 1:
            k.cyl('ceramic', TERRA, (0.18, z0 + 0.1), y + 0.01, y + 0.14, 0.06, 0.08, seg=10)
            for j in range(5):
                a = j * 1.25
                k.rod('leaf', LEAF, (0.18, y + 0.14, z0 + 0.1), (0.18 + math.cos(a) * 0.1, y + 0.05, z0 + 0.1 + math.sin(a) * 0.06), 0.012, 0.008, seg=4)
            k.ell('ceramic', CREAM, (-0.15, y + 0.08, z0 + 0.09), (0.07, 0.07, 0.07), seg=10, rings=5)
        elif i == 2:
            for j in range(4):
                k.box('book', (PLUM, SAGE, BLUSH, WOOD)[j], (-0.28 + j * 0.05, y + 0.01, z0), (-0.24 + j * 0.05, y + 0.2 - j * 0.02, z0 + 0.15))
            k.ell('candle', '#f2e6c8', (0.2, y + 0.05, z0 + 0.07), (0.035, 0.045, 0.035), seg=8, rings=4)
        else:
            k.cyl('ceramic', CREAM, (0.0, z0 + 0.06), y + 0.01, y + 0.08, 0.05, 0.06, seg=10)
            for j in range(7):
                a = j * 0.9
                k.rod('leaf', LEAF_D, (0.0, y + 0.08, z0 + 0.06), (math.cos(a) * 0.13, y - 0.15 - (j % 3) * 0.08, z0 + 0.06 + math.sin(a) * 0.05), 0.01, 0.006, seg=4)
    return k


def room_divider():
    k = Kit()
    # Three hinged rattan panels in a zig-zag.
    angles = (0.5, -0.5, 0.5)
    x = -0.55
    for p, a in enumerate(angles):
        w = 0.4
        dx, dz = math.cos(a) * w, math.sin(a) * w
        x0, z0 = x, (0.0 if p % 2 == 0 else math.sin(angles[p - 1]) * w)
        x1, z1 = x0 + dx, z0 + dz
        if True:
            for (xa, za) in ((x0, z0), (x1, z1)):
                k.cyl('wood', WOOD_D, (xa, za), 0.0, 1.55, 0.02, seg=6)
            for yy in (0.08, 1.48):
                k.rod('wood', WOOD_D, (x0, yy, z0), (x1, yy, z1), 0.018, seg=5)
            # Cane weave: crossing diagonals plus horizontal strands.
            for i in range(6):
                f0 = i / 6
                for (fa, fb) in ((f0, f0 + 1 / 6), (f0 + 1 / 6, f0)):
                    k.rod('cane', RAT_L, (x0 + dx * fa, 0.1, z0 + dz * fa), (x0 + dx * fb, 1.46, z0 + dz * fb), 0.006, seg=4)
            for j in range(8):
                y = 0.15 + j * 0.17
                k.rod('cane', RAT, (x0 + 0.01, y, z0), (x1 - 0.01, y, z1), 0.006, seg=4)
        x = x1
    return k


# ── Rugs ────────────────────────────────────────────────────────────────────

def kilim_rug():
    k = Kit()
    W, D = 1.9, 1.3
    k.box('rug', RUST, (-W / 2, 0.0, -D / 2), (W / 2, 0.012, D / 2))
    k.box('rug', CREAM, (-W / 2 + 0.06, 0.012, -D / 2 + 0.06), (W / 2 - 0.06, 0.016, D / 2 - 0.06))
    k.box('rug', TERRA, (-W / 2 + 0.1, 0.016, -D / 2 + 0.1), (W / 2 - 0.1, 0.019, D / 2 - 0.1))
    # Row of diamonds.
    for i in range(5):
        cx = -0.68 + i * 0.34
        for (s, col, y) in ((0.26, MUSTARD, 0.021), (0.17, TEAL, 0.023), (0.08, CREAM, 0.025)):
            k.add('rug', col, [(cx + dx, yy, dz) for (dx, dz) in ((-s * 0.6, 0), (0, s), (s * 0.6, 0), (0, -s)) for yy in (0.019, y)])
    for zc in (-0.48, 0.48):
        for i in range(9):
            cx = -0.8 + i * 0.2
            k.add('rug', PLUM, [(cx + dx, yy, zc + dz) for (dx, dz) in ((-0.05, 0), (0, 0.05), (0.05, 0), (0, -0.05)) for yy in (0.019, 0.022)])
    for side in (-1, 1):
        z0 = side * D / 2
        for i in range(24):
            x = -W / 2 + 0.04 + i * (W - 0.08) / 23
            k.box('fringe', CREAM, (x - 0.008, 0.0, min(z0, z0 + side * 0.07)), (x + 0.008, 0.006, max(z0, z0 + side * 0.07)))
    return k


def jute_rug():
    k = Kit()
    for i in range(9):
        r0, r1 = i * 0.08, (i + 1) * 0.08
        col = JUTE if i % 2 else JUTE_D
        if i == 0:
            k.cyl('jute', col, (0, 0), 0.0, 0.014, r1, seg=10)
            continue
        n = 10 + i * 4
        for j in range(n):
            a0, a1 = 2 * math.pi * j / n, 2 * math.pi * (j + 1) / n
            k.add('jute', col if j % 2 else (JUTE_D if col == JUTE else JUTE), [(math.cos(a) * r, y, math.sin(a) * r) for a in (a0, a1) for r in (r0, r1) for y in (0.0, 0.014 + 0.002 * (j % 2))])
    return k


# ── Wall pieces (hang on the wall plane z = WALL_Z, facing +z) ──────────────

def macrame_hanging():
    k = Kit()
    z = WALL_Z + 0.03
    k.rod('wood', WOOD, (-0.4, 1.85, z), (0.4, 1.85, z), 0.024, seg=8)
    for x in (-0.42, 0.42):
        k.ell('wood', WOOD_D, (x, 1.85, z), (0.03, 0.03, 0.03), seg=6, rings=3)
    cord, knot = '#efe4cf', '#e2d2b2'
    n = 14
    xs = [-0.35 + i * 0.7 / (n - 1) for i in range(n)]
    mid = (n - 1) / 2
    for i, x in enumerate(xs):
        depth = 0.45 + 0.4 * (1 - abs(i - mid) / mid)
        k.rod('cord', cord, (x, 1.84, z), (x, 1.84 - depth - 0.28, z + 0.004), 0.012, 0.008, seg=5)
        # Square-knot rows: alternating offsets, forming a V that follows the cords.
        rows = int(depth / 0.075)
        for r in range(rows):
            if (i + r) % 2 == 0 and i < n - 1:
                yk = 1.8 - r * 0.075
                k.ell('knot', knot, (x + 0.7 / (n - 1) / 2, yk, z + 0.012), (0.03, 0.026, 0.016), seg=7, rings=4)
    # Wrapped band and beads.
    k.rod('knot', MUSTARD, (-0.36, 1.78, z + 0.016), (0.36, 1.78, z + 0.016), 0.014, seg=6)
    for (x, y, col) in ((-0.16, 1.42, TERRA), (0.16, 1.42, TERRA), (0.0, 1.22, MUSTARD), (-0.08, 1.32, SAGE), (0.08, 1.32, SAGE)):
        k.ell('bead', col, (x, y, z + 0.02), (0.028, 0.028, 0.022), seg=8, rings=4)
    return k


def tapestry():
    k = Kit()
    z = WALL_Z + 0.02
    k.rod('wood', WOOD_D, (-0.5, 2.0, z + 0.01), (0.5, 2.0, z + 0.01), 0.018, seg=6)
    k.box('cloth', CREAM, (-0.42, 1.0, z - 0.008), (0.42, 1.98, z + 0.002))
    # Mandala: concentric petal rings.
    cx, cy = 0.0, 1.5
    for (rr, n, col, s) in ((0.32, 16, TERRA, 0.06), (0.24, 12, MUSTARD, 0.055), (0.15, 8, TEAL, 0.05), (0.07, 6, PLUM, 0.035)):
        for i in range(n):
            a = 2 * math.pi * i / n
            k.ell('pattern', col, (cx + math.cos(a) * rr, cy + math.sin(a) * rr, z + 0.004), (s * 0.55, s, 0.003), r=(0, 0, a - math.pi / 2), seg=6, rings=3)
    k.ell('pattern', RUST, (cx, cy, z + 0.005), (0.035, 0.035, 0.003), seg=8, rings=3)
    for y, col in ((1.06, RUST), (1.92, RUST)):
        k.box('pattern', col, (-0.42, y - 0.02, z + 0.002), (0.42, y + 0.02, z + 0.004))
    fringe(k, -0.4, 0.4, 1.0, z - 0.003, 18, 0.0, CREAM)
    for i in range(18):
        x = -0.4 + (i + 0.5) * 0.8 / 18
        k.rod('fringe', CREAM, (x, 1.0, z - 0.003), (x, 0.9, z - 0.003), 0.005, 0.003, seg=4)
    return k


def dreamcatcher():
    k = Kit()
    z = WALL_Z + 0.03
    cx, cy, R = 0.0, 1.6, 0.18
    pts = [(cx + math.cos(2 * math.pi * j / 18) * R, cy + math.sin(2 * math.pi * j / 18) * R, z) for j in range(19)]
    for p0, p1 in zip(pts, pts[1:]):
        k.rod('hoop', WOOD, p0, p1, 0.012, seg=5)
    # Web.
    inner = [(cx + math.cos(2 * math.pi * j / 9 + 0.35) * R * 0.55, cy + math.sin(2 * math.pi * j / 9 + 0.35) * R * 0.55, z) for j in range(9)]
    for j in range(9):
        k.rod('string', '#efe4cf', pts[j * 2], inner[j], 0.003, seg=3)
        k.rod('string', '#efe4cf', inner[j], inner[(j + 1) % 9], 0.003, seg=3)
    k.ell('bead', TEAL, (cx, cy, z + 0.005), (0.018, 0.018, 0.012), seg=6, rings=3)
    # Feathers.
    for (x, l, col) in ((-0.12, 0.3, CREAM), (0.0, 0.36, TERRA), (0.12, 0.3, CREAM)):
        y0 = cy - R * (1 if x == 0 else 0.8)
        k.rod('string', '#efe4cf', (x, y0, z), (x, y0 - 0.12, z), 0.003, seg=3)
        k.ell('bead', MUSTARD, (x, y0 - 0.12, z + 0.004), (0.014, 0.014, 0.01), seg=6, rings=3)
        k.ell('feather', col, (x, y0 - 0.12 - l / 2, z), (0.04, l / 2, 0.006), seg=8, rings=4)
        k.rod('feather', '#8a6a4a', (x, y0 - 0.13, z + 0.004), (x, y0 - 0.12 - l, z + 0.004), 0.004, seg=3)
    return k


# ── Lighting ────────────────────────────────────────────────────────────────

def moroccan_lantern():
    k = Kit()
    k.cyl('brass', BRASS, (0, 0), 0.0, 0.05, 0.16, 0.14, seg=8)
    k.cyl('brass', '#a8823a', (0, 0), 0.05, 0.42, 0.14, 0.14, seg=8)
    # Pierced filigree: glowing cut-outs in every facet.
    for y in (0.1, 0.19, 0.28, 0.37):
        for i in range(8):
            a = 2 * math.pi * (i + 0.5) / 8 + (0.0 if int(y * 100) % 2 else math.pi / 8)
            r = 0.141
            k.add('glow', '#ffd27a', [(math.cos(a) * rr + math.cos(a + math.pi / 2) * dx, y + dy, math.sin(a) * rr + math.sin(a + math.pi / 2) * dx)
                                      for rr in (r - 0.004, r + 0.004) for (dx, dy) in ((-0.022, 0), (0, 0.032), (0.022, 0), (0, -0.032))])
    for i in range(8):
        a = 2 * math.pi * i / 8
        k.rod('brass', BRASS, (math.cos(a) * 0.146, 0.05, math.sin(a) * 0.146), (math.cos(a) * 0.146, 0.42, math.sin(a) * 0.146), 0.01, seg=4)
    k.cyl('brass', BRASS, (0, 0), 0.42, 0.46, 0.15, 0.15, seg=8)
    k.cyl('brass', BRASS, (0, 0), 0.46, 0.66, 0.15, 0.0, seg=8)
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        k.ell('glow', '#ffd27a', (math.cos(a) * 0.1, 0.53, math.sin(a) * 0.1), (0.012, 0.02, 0.012), seg=5, rings=3)
    k.ell('brass', BRASS, (0, 0.7, 0), (0.025, 0.04, 0.025), seg=6, rings=3)
    k.rod('brass', BRASS, (0, 0.73, 0), (0, 0.8, 0), 0.006, seg=4)
    return k


def rattan_floor_lamp():
    k = Kit()
    for i in range(3):
        a = 2 * math.pi * i / 3
        k.rod('wood', WOOD, (math.cos(a) * 0.28, 0.0, math.sin(a) * 0.28), (0, 1.25, 0), 0.02, 0.016, seg=6)
    k.cyl('glass', '#ffe2a0', (0, 0), 1.12, 1.3, 0.06, 0.06, seg=8)
    # Woven dome shade.
    prof = [(1.08, 0.32), (1.2, 0.3), (1.32, 0.24), (1.42, 0.14), (1.47, 0.04)]
    for i, ((y0, r0), (y1, r1)) in enumerate(zip(prof, prof[1:])):
        n = 16
        for j in range(n):
            a0, a1 = 2 * math.pi * j / n, 2 * math.pi * (j + 1) / n
            col = RAT if (i + j) % 2 else RAT_D
            k.add('rattan', col, [(math.cos(a) * r, y, math.sin(a) * r) for a in (a0, a1) for (y, r) in ((y0, r0), (y1, r1))] +
                  [(math.cos(a) * r * 0.94, y, math.sin(a) * r * 0.94) for a in (a0, a1) for (y, r) in ((y0, r0), (y1, r1))])
    k.cyl('rattan', RAT_D, (0, 0), 1.06, 1.09, 0.335, 0.335, seg=16)
    return k


# ── Plants ──────────────────────────────────────────────────────────────────

def monstera_basket():
    k = Kit()
    woven_cyl(k, (0, 0), 0.0, 0.32, 0.18, 0.22, bands=5)
    k.cyl('rattan', RAT_D, (0, 0), 0.32, 0.35, 0.225, 0.225, seg=14)
    k.cyl('soil', '#4a3626', (0, 0), 0.3, 0.33, 0.2, 0.2, seg=14)
    rng = Rng(7)
    for i in range(9):
        a = 2 * math.pi * i / 9 + rng.u(-0.2, 0.2)
        h = rng.u(0.6, 1.0)
        reach = rng.u(0.22, 0.36)
        stem_top = (math.cos(a) * reach, h, math.sin(a) * reach)
        k.rod('stem', '#5a8a45', (0, 0.32, 0), stem_top, 0.012, 0.009, seg=4)
        col = LEAF if i % 2 else LEAF_D
        # Broad heart-shaped leaf drooping outwards, with two slits on each side.
        c = (math.cos(a) * (reach + 0.1), h - 0.03, math.sin(a) * (reach + 0.1))
        k.ell('leaf', col, c, (0.12, 0.008, 0.15), r=(0.0, -a + math.pi / 2, 0.0), seg=10, rings=4)
        for s in (-1, 1):
            for d in (0.04, 0.09):
                px = (c[0] + math.cos(a + s * 1.2) * d, c[1] + 0.009, c[2] + math.sin(a + s * 1.2) * d)
                k.rbox('slit', '#2f5a2a', px, (0.06, 0.004, 0.008), r=(0, -(a + s * 1.2), 0))
    return k


def plant_stand():
    k = Kit()
    for x in (-0.3, 0.3):
        for z in (-0.12, 0.12):
            k.rod('wood', WOOD, (x, 0.0, z), (x * 0.85, 1.0, z), 0.018, seg=6)
    for i, (y, w) in enumerate(((0.3, 0.3), (0.62, 0.27), (0.95, 0.25))):
        k.box('wood', WOOD_D, (-w - 0.02, y - 0.02, -0.15), (w + 0.02, y + 0.01, 0.15))
    # Plants: trailing pothos, snake plant, cactus, little pots.
    k.cyl('ceramic', TERRA, (-0.15, 0), 0.31, 0.45, 0.07, 0.09, seg=10)
    for j in range(8):
        a = j * 0.8
        end = (-0.15 + math.cos(a) * 0.14, 0.12 + (j % 3) * 0.06, math.sin(a) * 0.12)
        k.rod('vine', LEAF, (-0.15, 0.45, 0.0), end, 0.008, 0.006, seg=4)
        k.ell('leaf', LEAF if j % 2 else '#6aa85a', end, (0.03, 0.012, 0.03), seg=6, rings=3)
    k.cyl('ceramic', CREAM, (0.17, 0), 0.31, 0.43, 0.07, 0.07, seg=10)
    for j in range(5):
        a = j * 1.3
        k.rod('leaf', '#4a7a4a' if j % 2 else '#5f8f4a', (0.17 + math.cos(a) * 0.02, 0.43, math.sin(a) * 0.02), (0.17 + math.cos(a) * 0.05, 0.62 + (j % 2) * 0.06, math.sin(a) * 0.04), 0.022, 0.0, seg=4)
    k.cyl('ceramic', '#e0b8a0', (0.0, 0), 0.63, 0.73, 0.06, 0.075, seg=10)
    k.ell('cactus', '#5f8f5a', (0.0, 0.8, 0.0), (0.045, 0.09, 0.045), seg=8, rings=5)
    k.ell('cactus', '#5f8f5a', (0.05, 0.82, 0.0), (0.02, 0.04, 0.02), seg=6, rings=3)
    k.ell('flower', BLUSH, (0.0, 0.89, 0.0), (0.02, 0.012, 0.02), seg=6, rings=3)
    k.cyl('ceramic', TEAL, (-0.12, 0), 0.96, 1.04, 0.05, 0.06, seg=10)
    for j in range(6):
        a = j * 1.05
        k.rod('leaf', LEAF_D, (-0.12, 1.04, 0), (-0.12 + math.cos(a) * 0.08, 1.12, math.sin(a) * 0.06), 0.01, 0.005, seg=4)
    k.cyl('ceramic', MUSTARD, (0.14, 0), 0.96, 1.03, 0.045, 0.05, seg=10)
    k.ell('leaf', '#7aa86a', (0.14, 1.06, 0), (0.05, 0.04, 0.05), seg=8, rings=4)
    return k


def pampas_vase():
    k = Kit()
    k.ell('ceramic', TERRA, (0, 0.2, 0), (0.14, 0.2, 0.14), seg=12, rings=6)
    k.cyl('ceramic', TERRA, (0, 0), 0.36, 0.5, 0.06, 0.08, seg=12)
    k.cyl('ceramic', '#b05a30', (0, 0), 0.5, 0.52, 0.085, 0.085, seg=12)
    for i, y in enumerate((0.12, 0.2, 0.28)):
        k.cyl('pattern', CREAM if i % 2 else RUST, (0, 0), y - 0.012, y + 0.012, 0.13 + 0.01 * (i == 1), 0.135 + 0.01 * (i == 1), seg=12)
    rng = Rng(3)
    for i in range(7):
        a = 2 * math.pi * i / 7 + rng.u(-0.3, 0.3)
        lean = rng.u(0.12, 0.3)
        h = rng.u(1.1, 1.45)
        top = (math.cos(a) * lean, h, math.sin(a) * lean)
        k.rod('stem', '#c9b48a', (0, 0.5, 0), (top[0] * 0.7, h - 0.25, top[2] * 0.7), 0.008, 0.006, seg=4)
        plume = (top[0] * 0.7, h - 0.25, top[2] * 0.7)
        k.rod('plume', '#efe2c4' if i % 2 else '#e6d2a8', plume, top, 0.035, 0.012, seg=7)
    return k


def build():
    return {
        'boho_peacock_chair': peacock_chair(), 'boho_egg_chair': egg_chair(), 'boho_floor_cushions': floor_cushions(), 'boho_pouf': pouf(),
        'boho_sofa': boho_sofa(), 'boho_canopy_bed': canopy_bed(), 'boho_coffee_table': coffee_table(), 'boho_trunk': vintage_trunk(),
        'boho_ladder_shelf': ladder_shelf(), 'boho_room_divider': room_divider(), 'boho_kilim_rug': kilim_rug(), 'boho_jute_rug': jute_rug(),
        'boho_macrame': macrame_hanging(), 'boho_tapestry': tapestry(), 'boho_dreamcatcher': dreamcatcher(), 'boho_lantern': moroccan_lantern(),
        'boho_floor_lamp': rattan_floor_lamp(), 'boho_monstera': monstera_basket(), 'boho_plant_stand': plant_stand(), 'boho_pampas_vase': pampas_vase(),
    }
