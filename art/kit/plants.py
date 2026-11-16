import math
from kit import Kit, Rng

STEM = '#4f9e3a'


def clumps(k, color, centres, seed, g='leaves'):
    rng = Rng(seed)
    for i, (c, r) in enumerate(centres):
        k.ell('leaves', color if i % 2 == 0 else shade(color, 1.08), c, r, r=(rng.u(-0.3, 0.3), rng.u(0, 3), 0), seg=9, rings=5, g=g)


def shade(hx, f):
    c = [int(hx[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{max(0, min(255, int(v * f))):02x}' for v in c)


def berries(k, color, pts, r=0.045):
    for p in pts:
        k.ell('berry', color, p, (r, r, r), seg=7, rings=4, g='berries')


def ring_pts(n, rad, y, jitter, seed, yj=0.1):
    rng = Rng(seed)
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n + rng.u(-0.3, 0.3)
        rr = rad * rng.u(0.85, 1.05)
        out.append((math.cos(a) * rr, y + rng.u(-yj, yj), math.sin(a) * rr))
    return out


def flower(kind, petal, centre='#ffd54f'):
    k = Kit()
    k.pivot('stem', (0, 0, 0))
    k.pivot('bloom', (0, 0.3, 0))
    k.rod('stem', STEM, (0, 0, 0), (0.0, 0.3, 0.0), 0.012, 0.01, seg=5, g='stem')
    for s, y in ((-1, 0.09), (1, 0.16)):
        k.ell('leaf', '#5fae45', (s * 0.05, y, 0), (0.05, 0.012, 0.022), r=(0, 0, -s * 0.5), seg=6, rings=3, g='stem')
    if kind == 'daisy':
        for i in range(10):
            a = 2 * math.pi * i / 10
            k.ell('petal', petal, (math.cos(a) * 0.055, 0.3, math.sin(a) * 0.055), (0.05, 0.01, 0.018), r=(0, -a, 0), seg=6, rings=3, g='bloom')
        k.ell('centre', centre, (0, 0.31, 0), (0.03, 0.018, 0.03), seg=8, rings=4, g='bloom')
    elif kind == 'tulip':
        for i in range(5):
            a = 2 * math.pi * i / 5
            k.ell('petal', petal if i % 2 else shade(petal, 0.9), (math.cos(a) * 0.022, 0.35, math.sin(a) * 0.022), (0.035, 0.065, 0.022), r=(0, -a, 0.18), seg=7, rings=4, g='bloom')
    elif kind == 'bell':
        k.rod('stem', STEM, (0, 0.3, 0), (0.06, 0.34, 0), 0.008, 0.006, seg=5, g='bloom')
        for x, y in ((0.06, 0.3), (0.0, 0.24), (0.07, 0.2)):
            k.rod('petal', petal, (x, y + 0.04, 0), (x, y - 0.02, 0), 0.012, 0.035, seg=7, g='bloom')
    elif kind == 'buttercup':
        for i in range(5):
            a = 2 * math.pi * i / 5
            k.ell('petal', petal, (math.cos(a) * 0.035, 0.31, math.sin(a) * 0.035), (0.038, 0.016, 0.032), r=(0, -a, 0.35), seg=6, rings=3, g='bloom')
        k.ell('centre', '#9a7a1a', (0, 0.315, 0), (0.018, 0.012, 0.018), seg=6, rings=3, g='bloom')
    elif kind == 'poppy':
        for i in range(4):
            a = 2 * math.pi * i / 4 + 0.4
            k.ell('petal', petal, (math.cos(a) * 0.04, 0.31, math.sin(a) * 0.04), (0.05, 0.02, 0.045), r=(0, -a, 0.25), seg=7, rings=3, g='bloom')
        k.ell('centre', '#2a2a2a', (0, 0.32, 0), (0.02, 0.016, 0.02), seg=6, rings=3, g='bloom')
    elif kind == 'cornflower':
        for i in range(9):
            a = 2 * math.pi * i / 9
            k.rod('petal', petal, (math.cos(a) * 0.01, 0.31, math.sin(a) * 0.01), (math.cos(a) * 0.06, 0.34, math.sin(a) * 0.06), 0.008, 0.016, seg=5, g='bloom')
        k.ell('centre', shade(petal, 0.6), (0, 0.315, 0), (0.02, 0.02, 0.02), seg=6, rings=3, g='bloom')
    return k


def mushroom(kind):
    k = Kit()
    if kind == 'red':
        k.cyl('stalk', '#f5ecd7', (0, 0), 0.0, 0.17, 0.045, 0.035, seg=8)
        k.ell('cap', '#d84315', (0, 0.18, 0), (0.15, 0.09, 0.15), seg=12, rings=6)
        k.ell('gills', '#efe2c8', (0, 0.155, 0), (0.13, 0.025, 0.13), seg=12, rings=3)
        for i, (a, r) in enumerate(((0.3, 0.07), (2.2, 0.09), (4.1, 0.08), (5.5, 0.03), (1.2, 0.1))):
            k.ell('dot', '#ffffff', (math.cos(a) * r, 0.18 + 0.085 * math.sqrt(max(0, 1 - (r / 0.15) ** 2)), math.sin(a) * r), (0.022, 0.012, 0.022), seg=6, rings=3)
    elif kind == 'glow':
        for (x, z, h, r) in ((0, 0, 0.2, 0.11), (0.1, 0.06, 0.13, 0.07), (-0.08, 0.07, 0.1, 0.055)):
            k.cyl('stalk', '#e6f6f2', (x, z), 0.0, h, r * 0.3, r * 0.22, seg=7)
            k.ell('glow', '#4dd0e1', (x, h, z), (r, r * 0.55, r), seg=10, rings=5)
            k.ell('glow_spot', '#b2f5ff', (x, h + r * 0.45, z), (r * 0.45, r * 0.12, r * 0.45), seg=8, rings=3)
    elif kind == 'brown':
        for (x, z, h, r) in ((0, 0, 0.13, 0.08), (0.08, 0.05, 0.09, 0.06), (-0.07, 0.05, 0.07, 0.05), (0.02, -0.08, 0.06, 0.045)):
            k.cyl('stalk', '#efe2c8', (x, z), 0.0, h, r * 0.35, r * 0.28, seg=7)
            k.ell('cap', '#8a5a3a', (x, h, z), (r, r * 0.6, r), seg=10, rings=5)
    return k


def build():
    """Flowers and mushrooms. Trees, bushes, the sapling, rocks and ground cover are
    made in Blender now: art/nature/nature_models.py → client/public/models/nature.glb."""
    m = {}
    for kind, col in (('tulip', '#ff6f91'), ('buttercup', '#ffd166'), ('bell', '#c77dff'), ('daisy', '#ffffff'), ('poppy', '#ff9f1c'), ('cornflower', '#4cc9f0')):
        m[f'flower_{kind}'] = flower(kind, col)
    m['mushroom'] = mushroom('red')
    m['glowcap'] = mushroom('glow')
    m['mushroom_brown'] = mushroom('brown')
    return m
