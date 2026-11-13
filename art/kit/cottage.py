"""Cottage furniture pack for the player's house. Game units: 1 = one tile, y up, +z = front.
Floor items sit on y = 0 centred on their tile; wall items hang on the wall plane at z = WALL_Z.

Look: honey oak and painted wood (cream, sage, duck-egg blue), rose and blue florals,
gingham, linen, copper and enamel."""
import math
from kit import Kit, Rng

WALL_Z = 0.5
OAK, OAK_D, OAK_L = '#b07a45', '#8a5a32', '#c9965e'
CREAM, CREAM_D = '#f1e8d6', '#ddd0b6'
SAGE, SAGE_D = '#9db48e', '#7f9871'
DUCK, DUCK_D = '#a9c8c6', '#86a9a7'
ROSE, ROSE_D, ROSE_L = '#d9758a', '#b85a70', '#f1b8c2'
BLUE, BLUE_D = '#6f8fbf', '#4f6f9f'
LINEN, LACE = '#ece4d4', '#fbf7ee'
COPPER, IRON, ENAMEL = '#c07a46', '#3a3532', '#f4efe4'
LEAF, LEAF_D, GERANIUM = '#5d9150', '#457a3c', '#e2463c'
STONE, STONE_D, BRICK = '#b9ada0', '#968a7e', '#b5623f'


def flowers(k, c, rad, seed, n=8, cols=(ROSE, ROSE_L, LACE), g='main'):
    """Little floral sprigs scattered over a surface centred at c (for chintz fabric)."""
    rng = Rng(seed)
    for i in range(n):
        p = (c[0] + rng.u(-rad[0], rad[0]), c[1] + rng.u(-rad[1], rad[1]), c[2] + rng.u(-rad[2], rad[2]))
        k.ell('pattern', cols[i % len(cols)], p, (0.028, 0.028, 0.028), seg=6, rings=3, g=g)


def gingham(k, x0, x1, z0, z1, y, n, a, b, role='cloth'):
    """Checked cloth lying flat at height y."""
    for i in range(n):
        for j in range(n):
            col = a if (i + j) % 2 else b
            xa, xb = x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n
            za, zb = z0 + (z1 - z0) * j / n, z0 + (z1 - z0) * (j + 1) / n
            k.box(role, col, (xa, y, za), (xb, y + 0.008, zb))


def turned_leg(k, x, z, y0, y1, r, col, g='main'):
    """A turned (bobbin) leg: slim shaft with two beads."""
    k.cyl('wood', col, (x, z), y0, y1, r * 0.8, r, seg=8, g=g)
    for f in (0.3, 0.7):
        y = y0 + (y1 - y0) * f
        k.ell('wood', col, (x, y, z), (r * 1.5, r * 1.3, r * 1.5), seg=8, rings=4, g=g)


def cushion(k, c, size, color, r=(0, 0, 0), g='main'):
    k.ell('cushion', color, c, (size[0] / 2, size[1] / 2, size[2] / 2), r=r, seg=12, rings=5, g=g)


# ── Seating ─────────────────────────────────────────────────────────────────

def armchair():
    k = Kit()
    # Wingback in rose chintz on short oak legs.
    for x in (-0.3, 0.3):
        for z in (-0.25, 0.27):
            k.cyl('wood', OAK_D, (x, z), 0.0, 0.1, 0.03, 0.035, seg=8)
    k.box('fabric', ROSE, (-0.38, 0.1, -0.32), (0.38, 0.36, 0.34))
    cushion(k, (0, 0.42, 0.04), (0.56, 0.14, 0.56), ROSE_L)
    # Tall back with wings.
    k.add('fabric', ROSE, [(x, y, z) for x in (-0.38, 0.38) for (y, z) in ((0.36, -0.34), (0.36, -0.2), (1.08, -0.34), (1.0, -0.22))])
    for s in (-1, 1):
        k.add('fabric', ROSE_D, [(s * x, y, z) for x in (0.3, 0.4) for (y, z) in ((0.36, -0.3), (0.95, -0.3), (0.85, 0.0), (0.36, 0.05))])
        # Rolled arms.
        k.rod('fabric', ROSE, (s * 0.35, 0.52, -0.2), (s * 0.35, 0.52, 0.33), 0.065, seg=10)
        k.ell('fabric', ROSE_D, (s * 0.35, 0.52, 0.335), (0.07, 0.07, 0.02), seg=10, rings=4)
    flowers(k, (0, 0.72, -0.21), (0.26, 0.26, 0.0), seed=3, n=10)
    flowers(k, (0, 0.24, 0.345), (0.3, 0.08, 0.0), seed=5, n=6)
    # Lace antimacassar over the top of the back.
    k.add('lace', LACE, [(x, y, z) for x in (-0.16, 0.16) for (y, z) in ((0.88, -0.222), (0.88, -0.212), (1.0, -0.224), (1.0, -0.214))])
    for i in range(7):
        k.ell('lace', LACE, (-0.15 + i * 0.05, 0.875, -0.215), (0.022, 0.016, 0.006), seg=6, rings=3)
    return k


def rocking_chair():
    k = Kit()
    # Rockers.
    for x in (-0.24, 0.24):
        pts = [(x, 0.03 + 0.06 * (1 - math.cos((z + 0.05) / 0.5 * 1.3)) ** 1.0, z) for z in [-0.45 + i * 0.09 for i in range(11)]]
        for p0, p1 in zip(pts, pts[1:]):
            k.rod('wood', OAK_D, p0, p1, 0.025, seg=6)
    # Legs and seat.
    for x in (-0.22, 0.22):
        for z in (-0.2, 0.22):
            k.rod('wood', OAK, (x, 0.05, z), (x, 0.42, z * 0.95), 0.025, seg=6)
    k.box('wood', OAK_L, (-0.26, 0.4, -0.24), (0.26, 0.45, 0.26))
    # Spindle back leaning slightly back.
    for x in (-0.22, 0.22):
        k.rod('wood', OAK, (x, 0.45, -0.22), (x, 1.12, -0.36), 0.025, seg=6)
    k.rod('wood', OAK_D, (-0.24, 1.1, -0.355), (0.24, 1.1, -0.355), 0.035, seg=8)
    for i in range(5):
        x = -0.14 + i * 0.07
        k.rod('wood', OAK, (x, 0.47, -0.225), (x, 1.07, -0.35), 0.012, seg=5)
    for s in (-1, 1):
        k.rod('wood', OAK, (s * 0.25, 0.68, -0.25), (s * 0.25, 0.66, 0.24), 0.022, seg=6)
        k.rod('wood', OAK, (s * 0.25, 0.45, 0.22), (s * 0.25, 0.66, 0.22), 0.018, seg=5)
    # Gingham seat pad and a folded knitted blanket.
    gingham(k, -0.22, 0.22, -0.2, 0.22, 0.45, 4, BLUE, LACE, role='cushion')
    k.rbox('knit', SAGE, (0.0, 0.62, -0.27), (0.42, 0.26, 0.05), r=(-0.2, 0, 0))
    for i in range(4):
        k.rbox('knit', CREAM, (0.0, 0.52 + i * 0.065, -0.248 - i * 0.013), (0.43, 0.012, 0.055), r=(-0.2, 0, 0))
    return k


def loveseat():
    k = Kit()
    # Skirted two-seater in blue-and-cream floral with rolled arms.
    k.box('fabric', BLUE, (-0.78, 0.0, -0.36), (0.78, 0.18, 0.36))
    for i in range(16):
        x = -0.76 + i * 0.1
        k.box('skirt', BLUE_D if i % 2 else BLUE, (x, 0.0, 0.355), (x + 0.1, 0.18, 0.37))
    k.box('fabric', BLUE, (-0.7, 0.18, -0.36), (0.7, 0.3, 0.34))
    for x in (-0.33, 0.33):
        cushion(k, (x, 0.35, 0.03), (0.66, 0.14, 0.6), CREAM)
    k.add('fabric', BLUE, [(x, y, z) for x in (-0.72, 0.72) for (y, z) in ((0.3, -0.36), (0.3, -0.22), (0.86, -0.34), (0.8, -0.24))])
    for x in (-0.33, 0.33):
        cushion(k, (x, 0.6, -0.22), (0.62, 0.36, 0.14), CREAM, r=(-0.15, 0, 0))
    for s in (-1, 1):
        k.box('fabric', BLUE, (s * 0.78 - (0.16 if s > 0 else 0), 0.18, -0.36), (s * 0.78 + (0.16 if s < 0 else 0), 0.42, 0.34))
        k.rod('fabric', BLUE, (s * 0.7, 0.46, -0.34), (s * 0.7, 0.46, 0.35), 0.085, seg=10)
    flowers(k, (0, 0.6, -0.15), (0.6, 0.12, 0.0), seed=11, n=14, cols=(ROSE, LACE, BLUE_D))
    flowers(k, (0, 0.1, 0.37), (0.7, 0.06, 0.0), seed=12, n=10, cols=(ROSE, LACE))
    # Gingham cushion and a heart pillow.
    k.rbox('cushion', ROSE, (-0.42, 0.55, -0.1), (0.3, 0.3, 0.1), r=(-0.25, 0.25, 0))
    gingham(k, -0.56, -0.28, -0.04, -0.03, 0.42, 3, ROSE, LACE, role='pattern')
    k.ell('cushion', ROSE_L, (0.45, 0.55, -0.12), (0.14, 0.13, 0.05), r=(-0.25, -0.2, 0), seg=10, rings=5)
    return k


def footstool():
    k = Kit()
    for x in (-0.2, 0.2):
        for z in (-0.15, 0.15):
            turned_leg(k, x, z, 0.0, 0.16, 0.025, OAK_D)
    k.box('wood', OAK, (-0.24, 0.16, -0.19), (0.24, 0.22, 0.19))
    cushion(k, (0, 0.25, 0), (0.48, 0.12, 0.38), SAGE)
    # Buttoned top.
    for (x, z) in ((-0.1, -0.07), (0.1, -0.07), (0.0, 0.0), (-0.1, 0.07), (0.1, 0.07)):
        k.ell('button', SAGE_D, (x, 0.305, z), (0.018, 0.008, 0.018), seg=6, rings=3)
    return k


def ladderback_chair():
    k = Kit()
    for x in (-0.2, 0.2):
        for z in (-0.18, 0.2):
            k.cyl('paint', SAGE, (x, z), 0.0, 0.44, 0.022, seg=8)
        k.cyl('paint', SAGE, (x, -0.18), 0.44, 1.02, 0.022, 0.018, seg=8)
        k.ell('paint', SAGE_D, (x, 1.04, -0.18), (0.03, 0.03, 0.03), seg=8, rings=4)
    for y, col in ((0.15, SAGE_D), (0.28, SAGE_D)):
        k.rod('paint', col, (-0.2, y, 0.2), (0.2, y, 0.2), 0.012, seg=5)
        k.rod('paint', col, (-0.2, y, -0.18), (-0.2, y, 0.2), 0.012, seg=5)
        k.rod('paint', col, (0.2, y, -0.18), (0.2, y, 0.2), 0.012, seg=5)
    # Ladder back: curved slats.
    for y in (0.62, 0.76, 0.9):
        k.add('paint', SAGE, [(x, y + dy, -0.18 - 0.03 * (1 - (x / 0.2) ** 2)) for x in (-0.2, -0.1, 0.0, 0.1, 0.2) for dy in (-0.035, 0.035)] +
              [(x, y + dy, -0.16 - 0.03 * (1 - (x / 0.2) ** 2)) for x in (-0.2, 0.2) for dy in (-0.035, 0.035)])
    # Woven rush seat.
    for i in range(6):
        col = '#c9a86a' if i % 2 else '#b8955a'
        k.box('rush', col, (-0.21 + i * 0.07, 0.43, -0.2), (-0.14 + i * 0.07, 0.47, 0.22))
    k.box('rush', '#b8955a', (-0.21, 0.44, -0.2), (0.21, 0.462, 0.22))
    # Tie-on gingham cushion.
    gingham(k, -0.17, 0.17, -0.15, 0.17, 0.47, 4, ROSE, LACE, role='cushion')
    return k


# ── Tables & storage ────────────────────────────────────────────────────────

def farmhouse_table():
    k = Kit()
    # Scrubbed oak top on cream painted turned legs (a little wider than its tile).
    k.box('wood', OAK_L, (-0.6, 0.72, -0.42), (0.6, 0.78, 0.42))
    k.box('wood', OAK, (-0.6, 0.722, -0.42), (0.6, 0.73, 0.42))
    for i in range(1, 6):
        x = -0.6 + i * 0.2
        k.box('grain', OAK, (x - 0.004, 0.779, -0.42), (x + 0.004, 0.782, 0.42))
    k.box('paint', CREAM, (-0.52, 0.62, -0.34), (0.52, 0.72, 0.34))
    for x in (-0.48, 0.48):
        for z in (-0.3, 0.3):
            turned_leg(k, x, z, 0.0, 0.62, 0.035, CREAM)
    # Table runner, enamel jug of wild flowers, bread board.
    k.box('cloth', LINEN, (-0.6, 0.782, -0.12), (0.6, 0.79, 0.12))
    for x in (-0.6, 0.6):
        k.box('cloth', LINEN, (x - 0.004, 0.66, -0.12), (x + 0.004, 0.79, 0.12))
    k.cyl('enamel', ENAMEL, (0.15, 0.0), 0.79, 0.98, 0.07, 0.06, seg=12)
    k.cyl('enamel', BLUE_D, (0.15, 0.0), 0.97, 0.99, 0.062, 0.062, seg=12)
    k.rod('enamel', ENAMEL, (0.21, 0.82, 0.0), (0.24, 0.93, 0.0), 0.012, seg=5)
    rng = Rng(21)
    for i in range(9):
        a = 2 * math.pi * i / 9
        top = (0.15 + math.cos(a) * rng.u(0.06, 0.14), rng.u(1.12, 1.24), math.sin(a) * rng.u(0.05, 0.12))
        k.rod('stem', LEAF, (0.15, 0.97, 0.0), top, 0.006, seg=4)
        k.ell('flower', (LACE, '#f2d24a', ROSE_L, BLUE)[i % 4], top, (0.03, 0.022, 0.03), seg=7, rings=3)
    k.cyl('wood', OAK_D, (-0.25, 0.05), 0.79, 0.81, 0.13, 0.13, seg=14)
    k.ell('bread', '#d9a25a', (-0.25, 0.86, 0.05), (0.1, 0.06, 0.07), seg=10, rings=5)
    for i in range(3):
        k.rbox('bread', '#b8833f', (-0.31 + i * 0.06, 0.905, 0.05), (0.012, 0.01, 0.1), r=(0, 0.3, 0))
    return k


def welsh_dresser():
    k = Kit()
    # Duck-egg painted dresser against the wall (back = -z): cupboard base + open plate rack.
    k.box('paint', DUCK, (-0.48, 0.0, -0.45), (0.48, 0.82, -0.02))
    k.box('wood', OAK_L, (-0.5, 0.82, -0.46), (0.5, 0.87, 0.01))
    for x in (-0.46, 0.02):
        k.box('paint', DUCK_D, (x, 0.12, -0.02), (x + 0.44, 0.74, 0.0))
        k.box('paint', DUCK, (x + 0.04, 0.16, -0.005), (x + 0.4, 0.7, 0.008))
        k.ell('knob', COPPER, (x + (0.38 if x < 0 else 0.06), 0.45, 0.015), (0.02, 0.02, 0.02), seg=6, rings=3)
    k.box('paint', DUCK_D, (-0.48, 0.0, -0.02), (0.48, 0.08, 0.0))
    # Upper rack.
    k.box('paint', DUCK, (-0.46, 0.87, -0.45), (0.46, 1.95, -0.41))
    for x in (-0.46, 0.42):
        k.box('paint', DUCK, (x, 0.87, -0.45), (x + 0.04, 1.95, -0.22))
    k.box('paint', DUCK_D, (-0.5, 1.95, -0.47), (0.5, 2.03, -0.18))
    for y in (1.22, 1.58):
        k.box('paint', DUCK, (-0.42, y - 0.02, -0.41), (0.42, y + 0.01, -0.24))
        k.rod('paint', DUCK_D, (-0.42, y + 0.06, -0.255), (0.42, y + 0.06, -0.255), 0.008, seg=4)
    # Plates standing in the rack, jugs and cups on the shelves.
    plate_cols = (BLUE, LACE, ROSE, BLUE, LACE, ROSE)
    for row, y in enumerate((1.23, 1.59)):
        for i in range(5):
            x = -0.32 + i * 0.16
            col = plate_cols[(i + row) % 6]
            k.rod('plate', col, (x, y + 0.13, -0.39), (x, y + 0.13, -0.38), 0.07, seg=14)
            k.rod('plate', LACE if col != LACE else BLUE, (x, y + 0.13, -0.381), (x, y + 0.13, -0.375), 0.04, seg=12)
    for i, (x, col) in enumerate(((-0.3, ROSE), (-0.12, BLUE), (0.06, SAGE), (0.24, LACE))):
        k.cyl('ceramic', col, (x, -0.3), 0.87, 0.95 + 0.04 * (i % 2), 0.045, 0.05, seg=10)
    k.rod('ceramic', LACE, (0.24, 0.92, -0.3), (0.3, 0.92, -0.3), 0.01, seg=4)
    return k


def blanket_chest():
    k = Kit()
    k.box('paint', SAGE, (-0.44, 0.06, -0.26), (0.44, 0.48, 0.26))
    k.box('paint', SAGE_D, (-0.46, 0.48, -0.28), (0.46, 0.53, 0.28))
    for x in (-0.38, 0.38):
        for z in (-0.2, 0.2):
            k.ell('wood', SAGE_D, (x, 0.04, z), (0.05, 0.045, 0.05), seg=8, rings=4)
    # Hand-painted panel with flowers.
    k.box('paint', CREAM, (-0.3, 0.14, 0.26), (0.3, 0.4, 0.27))
    for (x, y, col) in ((-0.15, 0.3, ROSE), (0.0, 0.25, BLUE), (0.15, 0.3, ROSE), (-0.07, 0.22, ROSE_L), (0.08, 0.22, ROSE_L)):
        k.ell('pattern', col, (x, y, 0.272), (0.035, 0.035, 0.006), seg=8, rings=3)
    for (x0, x1) in ((-0.25, 0.25),):
        k.rod('pattern', LEAF, (x0, 0.2, 0.272), (x1, 0.2, 0.272), 0.008, seg=4)
    for x in (-0.46, 0.46):
        k.rod('iron', IRON, (x, 0.32, -0.08), (x, 0.32, 0.08), 0.012, seg=5)
    # Folded patchwork quilt on top.
    cols = (ROSE, LINEN, BLUE, SAGE, ROSE_L, LINEN)
    for i in range(6):
        x0 = -0.36 + i * 0.12
        k.box('quilt', cols[i], (x0, 0.53, -0.2), (x0 + 0.12, 0.62, 0.2))
    return k


def side_table():
    k = Kit()
    k.cyl('wood', OAK, (0, 0), 0.6, 0.64, 0.26, 0.26, seg=16)
    turned_leg(k, 0, 0, 0.08, 0.6, 0.04, OAK_D)
    for i in range(3):
        a = 2 * math.pi * i / 3
        k.rod('wood', OAK_D, (0, 0.12, 0), (math.cos(a) * 0.22, 0.0, math.sin(a) * 0.22), 0.025, 0.02, seg=6)
    # Lace doily with scalloped edge.
    k.cyl('lace', LACE, (0, 0), 0.64, 0.646, 0.2, 0.2, seg=16)
    for i in range(16):
        a = 2 * math.pi * i / 16
        k.ell('lace', LACE, (math.cos(a) * 0.2, 0.643, math.sin(a) * 0.2), (0.03, 0.004, 0.03), seg=6, rings=2)
    # Teacup, saucer and a little bud vase.
    k.cyl('ceramic', LACE, (-0.06, 0.04), 0.646, 0.656, 0.07, 0.07, seg=14)
    k.cyl('ceramic', ROSE_L, (-0.06, 0.04), 0.656, 0.71, 0.04, 0.05, seg=12)
    k.rod('ceramic', ROSE_L, (-0.005, 0.69, 0.04), (0.01, 0.67, 0.04), 0.01, seg=4)
    k.ell('tea', '#9a5a2a', (-0.06, 0.708, 0.04), (0.042, 0.004, 0.042), seg=10, rings=2)
    k.cyl('ceramic', BLUE, (0.1, -0.07), 0.646, 0.76, 0.025, 0.035, seg=10)
    k.rod('stem', LEAF, (0.1, 0.76, -0.07), (0.12, 0.88, -0.07), 0.005, seg=4)
    k.ell('flower', ROSE, (0.12, 0.89, -0.07), (0.03, 0.03, 0.03), seg=8, rings=4)
    return k


# ── Kitchen & hearth ────────────────────────────────────────────────────────

def range_stove():
    k = Kit()
    # Cream enamel range cooker with two ovens, hob lids and a copper kettle.
    k.box('enamel', '#f3ead2', (-0.46, 0.04, -0.4), (0.46, 0.82, 0.32))
    k.box('enamel', '#2f2a26', (-0.46, 0.0, -0.38), (0.46, 0.05, 0.3))
    k.box('enamel', '#e3d7b9', (-0.48, 0.82, -0.42), (0.48, 0.86, 0.34))
    for x in (-0.22, 0.22):
        k.box('enamel', '#e7dcbf', (x - 0.19, 0.12, 0.32), (x + 0.19, 0.48, 0.34))
        k.rod('chrome', '#cfcac2', (x - 0.12, 0.52, 0.37), (x + 0.12, 0.52, 0.37), 0.012, seg=6)
        k.box('enamel', '#e7dcbf', (x - 0.19, 0.55, 0.32), (x + 0.19, 0.76, 0.34))
    k.rod('chrome', '#cfcac2', (-0.46, 0.8, 0.38), (0.46, 0.8, 0.38), 0.014, seg=6)
    for x in (-0.46, 0.46):
        k.rod('chrome', '#cfcac2', (x, 0.8, 0.34), (x, 0.8, 0.38), 0.012, seg=5)
    # Tea towel on the rail.
    k.box('cloth', LACE, (-0.12, 0.62, 0.385), (0.06, 0.8, 0.395))
    for i in range(3):
        k.box('cloth', ROSE, (-0.12, 0.65 + i * 0.05, 0.394), (0.06, 0.665 + i * 0.05, 0.398))
    # Domed hob lids.
    for x in (-0.22, 0.22):
        k.ell('chrome', '#d8d3ca', (x, 0.86, -0.04), (0.17, 0.06, 0.17), seg=14, rings=4)
        k.cyl('chrome', '#2f2a26', (x, -0.04), 0.91, 0.93, 0.03, 0.03, seg=8)
    # Splashback tiles.
    for i in range(6):
        for j in range(3):
            col = LACE if (i + j) % 2 else DUCK
            k.box('tile', col, (-0.48 + i * 0.16, 0.86 + j * 0.12, -0.44), (-0.32 + i * 0.16, 0.98 + j * 0.12, -0.42))
    # Copper kettle.
    k.ell('copper', COPPER, (0.22, 1.0, -0.04), (0.11, 0.09, 0.11), seg=12, rings=6)
    k.rod('copper', COPPER, (0.31, 0.98, -0.04), (0.4, 1.06, -0.04), 0.016, 0.01, seg=6)
    for t in range(6):
        a = math.pi * t / 5
        p0 = (0.22 + math.cos(a) * 0.07, 1.08 + math.sin(a) * 0.08, -0.04)
        a1 = math.pi * (t + 1) / 5
        if t < 5:
            k.rod('copper', '#9a5a30', p0, (0.22 + math.cos(a1) * 0.07, 1.08 + math.sin(a1) * 0.08, -0.04), 0.01, seg=4)
    return k


def fireplace():
    k = Kit()
    # Stone hearth against the wall with an oak mantel, logs and a glowing fire.
    k.box('stone', STONE_D, (-0.5, 0.0, -0.45), (0.5, 0.06, 0.25))
    for (x0, x1) in ((-0.5, -0.28), (0.28, 0.5)):
        rng = Rng(int(x0 * 100) + 50)
        for row in range(6):
            y = 0.06 + row * 0.15
            k.rbox('stone', STONE if row % 2 else '#c7bcb0', ((x0 + x1) / 2 + rng.u(-0.01, 0.01), y + 0.07, -0.28), (x1 - x0 - 0.01, 0.14, 0.32))
    k.box('stone', STONE, (-0.5, 0.9, -0.45), (0.5, 1.95, -0.2))
    k.box('brick', '#3a2a22', (-0.28, 0.06, -0.45), (0.28, 0.9, -0.38))
    k.box('wood', OAK_D, (-0.56, 0.9, -0.46), (0.56, 0.98, -0.08))
    # Logs and flames.
    for (a, b) in (((-0.18, 0.12, -0.25), (0.18, 0.1, -0.2)), ((-0.15, 0.1, -0.15), (0.16, 0.12, -0.3))):
        k.rod('log', '#6b4a2e', a, b, 0.045, seg=7)
    for (x, h, col) in ((-0.08, 0.28, '#ffb347'), (0.05, 0.34, '#ff8c3a'), (0.13, 0.22, '#ffd27a'), (-0.15, 0.2, '#ff8c3a')):
        k.ell('glow', col, (x, 0.14 + h / 2, -0.24), (0.05, h / 2, 0.04), seg=8, rings=5)
    # Mantel things: candlesticks, a clock and a small framed picture.
    for x in (-0.42, 0.42):
        k.cyl('brass', '#c9a24a', (x, -0.25), 0.98, 1.1, 0.025, 0.02, seg=8)
        k.cyl('candle', LACE, (x, -0.25), 1.1, 1.22, 0.018, seg=8)
        k.ell('glow', '#ffd27a', (x, 1.25, -0.25), (0.012, 0.025, 0.012), seg=6, rings=3)
    k.box('wood', OAK, (-0.12, 0.98, -0.32), (0.12, 1.2, -0.2))
    k.rod('clock', LACE, (0.0, 1.1, -0.2), (0.0, 1.1, -0.19), 0.07, seg=12)
    k.box('frame', OAK_L, (0.18, 0.98, -0.42), (0.36, 1.2, -0.39))
    k.box('picture', SAGE, (0.2, 1.0, -0.39), (0.34, 1.18, -0.385))
    return k


# ── Bed ─────────────────────────────────────────────────────────────────────

def iron_bed():
    # Spans two tiles: this one and the one in front (+z), like the Bohemian canopy bed.
    k = Kit()
    white = '#f4f1ea'
    k.box('frame', '#d9d2c4', (-0.47, 0.18, -0.44), (0.47, 0.24, 1.42))
    k.box('mattress', LINEN, (-0.45, 0.24, -0.43), (0.45, 0.38, 1.41))
    # White iron bedstead: posts with brass knobs, arched rails and spindles.
    for (z, top, n) in ((-0.46, 1.12, 9), (1.44, 0.78, 7)):
        for x in (-0.47, 0.47):
            k.cyl('iron', white, (x, z), 0.0, top, 0.025, seg=8)
            k.ell('brass', '#d4b05a', (x, top + 0.03, z), (0.04, 0.04, 0.04), seg=8, rings=4)
        arch = [(x, top - 0.08 + 0.12 * math.cos(x / 0.47 * math.pi / 2), z) for x in [-0.47 + i * 0.94 / 12 for i in range(13)]]
        for p0, p1 in zip(arch, arch[1:]):
            k.rod('iron', white, p0, p1, 0.016, seg=5)
        k.rod('iron', white, (-0.47, 0.3, z), (0.47, 0.3, z), 0.016, seg=5)
        for i in range(n):
            x = -0.4 + i * 0.8 / (n - 1)
            yt = top - 0.08 + 0.12 * math.cos(x / 0.47 * math.pi / 2)
            k.rod('iron', white, (x, 0.3, z), (x, yt, z), 0.009, seg=4)
    # Patchwork quilt folded back, pillows.
    cols = (ROSE, LINEN, BLUE, SAGE, ROSE_L, DUCK, LINEN, ROSE)
    for ix in range(4):
        for iz in range(5):
            x0, z0 = -0.47 + ix * 0.235, 0.3 + iz * 0.226
            k.box('quilt', cols[(ix * 3 + iz) % 8], (x0, 0.38, z0), (x0 + 0.235, 0.43, z0 + 0.226))
    k.box('quilt', LACE, (-0.48, 0.2, 1.43), (0.48, 0.43, 1.45))
    for x in (-0.48, 0.46):
        k.box('quilt', LACE, (x, 0.2, 0.3), (x + 0.02, 0.43, 1.43))
    k.box('sheet', LACE, (-0.46, 0.38, 0.18), (0.46, 0.44, 0.3))
    for x in (-0.22, 0.22):
        cushion(k, (x, 0.45, -0.25), (0.38, 0.13, 0.26), LACE)
        k.ell('lace', ROSE_L, (x, 0.452, -0.115), (0.17, 0.05, 0.01), seg=8, rings=3)
    return k


# ── Lighting ────────────────────────────────────────────────────────────────

def standard_lamp():
    k = Kit()
    k.cyl('wood', OAK_D, (0, 0), 0.0, 0.05, 0.2, 0.18, seg=14)
    turned_leg(k, 0, 0, 0.05, 1.3, 0.03, OAK)
    k.cyl('glass', '#ffe6a8', (0, 0), 1.25, 1.42, 0.06, 0.06, seg=8)
    # Pleated fabric shade with a fringe.
    prof = [(1.22, 0.3), (1.58, 0.17)]
    n = 18
    for j in range(n):
        a0, a1 = 2 * math.pi * j / n, 2 * math.pi * (j + 1) / n
        col = ROSE_L if j % 2 else '#f5cbd2'
        k.add('shade', col, [(math.cos(a) * r, y, math.sin(a) * r) for a in (a0, a1) for (y, r) in prof] +
              [(math.cos((a0 + a1) / 2) * r * 1.04, y, math.sin((a0 + a1) / 2) * r * 1.04) for (y, r) in prof])
    for j in range(24):
        a = 2 * math.pi * j / 24
        k.rod('fringe', ROSE_D, (math.cos(a) * 0.3, 1.22, math.sin(a) * 0.3), (math.cos(a) * 0.3, 1.17, math.sin(a) * 0.3), 0.006, 0.004, seg=4)
    k.cyl('shade', ROSE_D, (0, 0), 1.2, 1.225, 0.305, 0.305, seg=18)
    k.cyl('shade', ROSE_D, (0, 0), 1.57, 1.59, 0.175, 0.175, seg=18)
    return k


# ── Rug ─────────────────────────────────────────────────────────────────────

def rag_rug():
    k = Kit()
    # Oval braided rag rug: concentric braided rings in soft colours.
    cols = (ROSE, LINEN, SAGE, BLUE, ROSE_L, LINEN, DUCK, ROSE, CREAM_D)
    n = len(cols)
    for i in range(n):
        r0, r1 = i / n, (i + 1) / n
        seg = 14 + i * 4
        for j in range(seg):
            a0, a1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
            col = cols[i] if j % 2 else cols[(i + 4) % n] if i % 3 == 0 else cols[i]
            pts = []
            for a in (a0, a1):
                for r in (max(0.0, r0), r1):
                    for y in (0.0, 0.014 + 0.003 * (j % 2)):
                        pts.append((math.cos(a) * r * 0.85, y, math.sin(a) * r * 0.6))
            k.add('rug', col, pts)
    return k


# ── Wall pieces (hang on the wall plane z = WALL_Z, facing +z) ──────────────

def cuckoo_clock():
    k = Kit()
    z = WALL_Z + 0.02
    # Carved chalet clock with a little gabled roof, door, dial, pendulum and pine-cone weights.
    k.box('wood', OAK_D, (-0.18, 1.45, z), (0.18, 1.8, z + 0.14))
    for s in (-1, 1):
        k.add('roof', '#6b4429', [(x, y, zz) for zz in (z - 0.01, z + 0.18) for (x, y) in ((0, 1.98), (s * 0.24, 1.76), (s * 0.24, 1.73), (0, 1.95))])
    for i in range(5):
        x = -0.16 + i * 0.08
        k.ell('leaf', LEAF_D, (x, 1.79, z + 0.15), (0.035, 0.02, 0.01), seg=6, rings=3)
    k.box('door', OAK_L, (-0.04, 1.71, z + 0.14), (0.04, 1.77, z + 0.145))
    k.ell('bird', '#e8c14a', (0.0, 1.74, z + 0.16), (0.025, 0.02, 0.02), seg=6, rings=3)
    k.rod('dial', LACE, (0.0, 1.58, z + 0.14), (0.0, 1.58, z + 0.15), 0.085, seg=14)
    k.rod('hand', IRON, (0.0, 1.58, z + 0.152), (0.0, 1.645, z + 0.152), 0.006, seg=4)
    k.rod('hand', IRON, (0.0, 1.58, z + 0.152), (0.045, 1.58, z + 0.152), 0.006, seg=4)
    for x in (-0.06, 0.06):
        k.rod('chain', '#8a7a4a', (x, 1.45, z + 0.06), (x, 1.08 + (0.08 if x > 0 else 0), z + 0.06), 0.004, seg=3)
        y = 1.08 + (0.08 if x > 0 else 0)
        k.ell('cone', '#7a5230', (x, y - 0.06, z + 0.06), (0.03, 0.07, 0.03), seg=8, rings=5)
    k.rod('pendulum', '#c9a24a', (0.0, 1.45, z + 0.09), (0.0, 1.2, z + 0.09), 0.005, seg=4)
    k.rod('pendulum', '#c9a24a', (0.0, 1.18, z + 0.09), (0.0, 1.18, z + 0.1), 0.04, seg=10)
    return k


def sampler():
    k = Kit()
    z = WALL_Z + 0.02
    # Embroidered cross-stitch sampler in an oak frame: border, house, hearts, letters.
    k.box('frame', OAK, (-0.3, 1.25, z), (0.3, 1.85, z + 0.04))
    k.box('linen', LINEN, (-0.25, 1.3, z + 0.04), (0.25, 1.8, z + 0.045))
    def st(x, y, col, w=0.02):
        k.box('stitch', col, (x - w / 2, y - w / 2, z + 0.045), (x + w / 2, y + w / 2, z + 0.05))
    for i in range(21):
        x = -0.22 + i * 0.022
        st(x, 1.77, ROSE if i % 2 else SAGE)
        st(x, 1.33, ROSE if i % 2 else SAGE)
    for j in range(19):
        y = 1.35 + j * 0.022
        st(-0.22, y, ROSE if j % 2 else SAGE)
        st(0.22, y, ROSE if j % 2 else SAGE)
    # Little house.
    for ix in range(5):
        for iy in range(3):
            st(-0.044 + ix * 0.022, 1.44 + iy * 0.022, BRICK if (ix, iy) != (2, 0) else OAK_D)
    for ix in range(7):
        st(-0.066 + ix * 0.022, 1.506 + 0.022 * (3 - abs(ix - 3)) - 0.022 * 0, BLUE_D)
    for (x, y) in ((-0.022, 1.484), (0.022, 1.484)):
        st(x, y, '#f2d24a')
    # Hearts either side and a row of 'letters'.
    for cx in (-0.15, 0.15):
        for (dx, dy) in ((-0.022, 0.022), (0.022, 0.022), (-0.022, 0), (0, 0), (0.022, 0), (0, -0.022)):
            st(cx + dx, 1.47 + dy, ROSE)
    for i in range(12):
        st(-0.12 + i * 0.022, 1.68 if i % 3 else 1.7, BLUE_D, w=0.016)
        st(-0.12 + i * 0.022, 1.64, BLUE_D if i % 2 else SAGE_D, w=0.016)
    k.rod('nail', IRON, (0.0, 1.88, z + 0.01), (0.0, 1.88, z + 0.03), 0.01, seg=5)
    return k


def wall_shelf():
    k = Kit()
    z = WALL_Z
    # Painted wall shelf with scalloped brackets, preserve jars and a hanging mug row.
    k.box('paint', CREAM, (-0.42, 1.48, z), (0.42, 1.52, z + 0.22))
    k.box('paint', CREAM, (-0.42, 1.52, z), (0.42, 1.72, z + 0.02))
    for x in (-0.36, 0.36):
        k.add('paint', CREAM_D, [(x + dx, y, zz) for dx in (-0.015, 0.015) for (y, zz) in ((1.48, z), (1.48, z + 0.2), (1.32, z))])
    for i, (x, col, lid) in enumerate(((-0.28, '#c43a3a', ROSE), (-0.12, '#e09a2a', BLUE), (0.04, '#7a3a6a', ROSE), (0.2, '#d9a53a', BLUE))):
        h = 0.14 + 0.03 * (i % 2)
        k.cyl('glass', col, (x, z + 0.1), 1.52, 1.52 + h, 0.055, 0.055, seg=12)
        k.cyl('glass', '#dfe8ea', (x, z + 0.1), 1.52 + h - 0.02, 1.52 + h, 0.05, 0.05, seg=12)
        gingham(k, x - 0.07, x + 0.07, z + 0.03, z + 0.17, 1.52 + h, 3, lid, LACE, role='cloth')
        k.box('label', LACE, (x - 0.03, 1.56, z + 0.155), (x + 0.03, 1.6, z + 0.158))
    k.rod('wood', OAK, (-0.4, 1.42, z + 0.12), (0.4, 1.42, z + 0.12), 0.01, seg=5)
    for i, (x, col) in enumerate(((-0.24, BLUE), (0.0, ROSE), (0.24, SAGE))):
        k.rod('hook', IRON, (x, 1.42, z + 0.12), (x, 1.38, z + 0.13), 0.005, seg=3)
        k.cyl('ceramic', col, (x, z + 0.14), 1.26, 1.37, 0.045, 0.05, seg=10)
        k.rod('ceramic', col, (x + 0.05, 1.33, z + 0.14), (x + 0.07, 1.3, z + 0.14), 0.01, seg=4)
    return k


# ── Plants ──────────────────────────────────────────────────────────────────

def geranium_pot():
    k = Kit()
    k.cyl('terracotta', '#c1663f', (0, 0), 0.0, 0.26, 0.15, 0.2, seg=14)
    k.cyl('terracotta', '#b05a35', (0, 0), 0.26, 0.31, 0.215, 0.215, seg=14)
    k.cyl('soil', '#4a3626', (0, 0), 0.27, 0.3, 0.19, 0.19, seg=14)
    rng = Rng(9)
    for i in range(10):
        a = 2 * math.pi * i / 10 + rng.u(-0.2, 0.2)
        r = rng.u(0.08, 0.2)
        k.ell('leaf', LEAF if i % 2 else LEAF_D, (math.cos(a) * r, rng.u(0.36, 0.46), math.sin(a) * r), (0.09, 0.03, 0.09), seg=8, rings=4)
    for i in range(6):
        a = 2 * math.pi * i / 6 + 0.3
        r = rng.u(0.04, 0.14)
        top = (math.cos(a) * r, rng.u(0.6, 0.74), math.sin(a) * r)
        k.rod('stem', LEAF_D, (top[0] * 0.5, 0.4, top[2] * 0.5), top, 0.008, seg=4)
        for j in range(6):
            b = 2 * math.pi * j / 6
            k.ell('flower', GERANIUM if (i + j) % 3 else '#f06a5a', (top[0] + math.cos(b) * 0.035, top[1] + rng.u(-0.01, 0.02), top[2] + math.sin(b) * 0.035), (0.026, 0.022, 0.026), seg=6, rings=3)
    # A tied gingham bow round the pot.
    k.cyl('cloth', BLUE, (0, 0), 0.17, 0.2, 0.19, 0.195, seg=14)
    for s in (-1, 1):
        k.ell('cloth', BLUE, (s * 0.05, 0.19, 0.2), (0.05, 0.03, 0.015), r=(0, 0, s * 0.3), seg=8, rings=4)
    return k


def build():
    return {
        'cottage_armchair': armchair(), 'cottage_rocking_chair': rocking_chair(), 'cottage_loveseat': loveseat(), 'cottage_footstool': footstool(),
        'cottage_ladderback_chair': ladderback_chair(), 'cottage_farmhouse_table': farmhouse_table(), 'cottage_welsh_dresser': welsh_dresser(),
        'cottage_blanket_chest': blanket_chest(), 'cottage_side_table': side_table(), 'cottage_range_stove': range_stove(), 'cottage_fireplace': fireplace(),
        'cottage_iron_bed': iron_bed(), 'cottage_standard_lamp': standard_lamp(), 'cottage_rag_rug': rag_rug(),
        'cottage_cuckoo_clock': cuckoo_clock(), 'cottage_sampler': sampler(), 'cottage_wall_shelf': wall_shelf(), 'cottage_geranium_pot': geranium_pot(),
    }
