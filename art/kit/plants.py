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


def bush_round(color, berry, seed, berry_r=0.045, n_berry=9):
    k = Kit()
    k.pivot('leaves', (0, 0, 0))
    k.pivot('berries', (0, 0, 0))
    k.cyl('trunk', '#6d4c2f', (0, 0), 0.0, 0.12, 0.05, 0.04, seg=6, g='leaves')
    clumps(k, color, [((0, 0.32, 0), (0.4, 0.32, 0.4)), ((0.24, 0.24, 0.12), (0.26, 0.22, 0.26)), ((-0.22, 0.23, -0.1), (0.26, 0.21, 0.26)),
                      ((-0.06, 0.24, 0.24), (0.24, 0.2, 0.22)), ((0.08, 0.5, -0.06), (0.24, 0.16, 0.24))], seed)
    clumps(k, shade(color, 1.15), [((0.12, 0.56, 0.1), (0.16, 0.1, 0.16))], seed + 50)
    if berry:
        berries(k, berry, ring_pts(n_berry, 0.43, 0.3, 0.1, seed, yj=0.1), berry_r)
        berries(k, berry, [(0.05, 0.62, 0.12), (-0.12, 0.55, 0.15), (0.2, 0.5, -0.12)], berry_r)
    return k


def bush_cloudberry(color, berry, seed):
    k = Kit()
    k.pivot('leaves', (0, 0, 0))
    k.pivot('berries', (0, 0, 0))
    rng = Rng(seed)
    for i in range(9):
        a = 2 * math.pi * i / 9 + rng.u(-0.3, 0.3)
        r = rng.u(0.12, 0.34)
        c = (math.cos(a) * r, 0.1 + rng.u(0, 0.06), math.sin(a) * r)
        k.rod('stem', STEM, (c[0] * 0.5, 0, c[2] * 0.5), c, 0.012, 0.01, seg=5, g='leaves')
        k.ell('leaves', color if i % 2 else shade(color, 1.15), c, (0.11, 0.025, 0.11), r=(rng.u(-0.3, 0.3), rng.u(0, 3), 0), seg=7, rings=3, g='leaves')
    if berry:
        for i in range(6):
            a = 2 * math.pi * i / 6 + 0.4
            p = (math.cos(a) * 0.2, 0.26 + (i % 2) * 0.04, math.sin(a) * 0.2)
            k.rod('stem', STEM, (p[0] * 0.6, 0.0, p[2] * 0.6), (p[0], p[1] - 0.04, p[2]), 0.008, 0.008, seg=5, g='berries')
            k.ell('berry', berry, p, (0.05, 0.055, 0.05), seg=8, rings=5, g='berries')
    return k


def bush_broadleaf(color, berry, seed, tall=1.0):
    k = Kit()
    k.pivot('leaves', (0, 0, 0))
    k.pivot('berries', (0, 0, 0))
    rng = Rng(seed)
    for i in range(11):
        a = 2 * math.pi * i / 11 + rng.u(-0.2, 0.2)
        up = rng.u(0.35, 0.9)
        L = rng.u(0.42, 0.58) * tall
        base = (0, 0.04, 0)
        mid = (math.cos(a) * L * 0.55, L * up * 0.9, math.sin(a) * L * 0.55)
        tip = (math.cos(a) * L, L * up * 0.6, math.sin(a) * L)
        side = (-math.sin(a) * 0.13 * tall, 0, math.cos(a) * 0.13 * tall)
        col = color if i % 3 else shade(color, 1.18)
        k.rod('stem', shade(color, 0.8), base, mid, 0.016, 0.01, seg=5, g='leaves')
        k.fin('leaves', col, [mid, (mid[0] + side[0], mid[1] + 0.02, mid[2] + side[2]), tip, (mid[0] - side[0], mid[1] + 0.02, mid[2] - side[2])], t=0.02, g='leaves')
    if berry:
        berries(k, berry, ring_pts(7, 0.18, 0.3, 0.05, seed, yj=0.06), 0.04)
    return k


def bush_herb(color, flower, seed, sparse=False):
    k = Kit()
    k.pivot('leaves', (0, 0, 0))
    k.pivot('berries', (0, 0, 0))
    rng = Rng(seed)
    n = 13 if sparse else 18
    for i in range(n):
        a = 2 * math.pi * i / n + rng.u(-0.3, 0.3)
        lean = rng.u(0.1, 0.35)
        h = rng.u(0.28, 0.48) * (0.85 if sparse else 1)
        tip = (math.cos(a) * lean * h * 1.6, h, math.sin(a) * lean * h * 1.6)
        k.rod('stem', shade(color, 0.85), (math.cos(a) * 0.04, 0, math.sin(a) * 0.04), tip, 0.014, 0.006, seg=5, g='leaves')
        for j in range(2 if sparse else 3):
            f = 0.35 + j * 0.22
            p = (tip[0] * f, tip[1] * f, tip[2] * f)
            k.ell('leaves', color if (i + j) % 2 else shade(color, 1.12), p, (0.045, 0.02, 0.07), r=(0.4, a, 0), seg=6, rings=3, g='leaves')
        if flower and i % 2 == 0:
            k.ell('berry', flower, (tip[0], tip[1] + 0.03, tip[2]), (0.025, 0.05, 0.025), seg=6, rings=4, g='berries')
    if sparse:
        k.blob('rock', '#b8a58a', (0.14, 0.03, -0.1), (0.07, 0.04, 0.06), seed, n=10, g='leaves')
    return k


def sapling():
    k = Kit()
    k.cyl('mound', '#7a5a3a', (0, 0), 0.0, 0.035, 0.16, 0.12, seg=10)
    k.rod('trunk', '#7a5230', (0, 0.02, 0), (0.01, 0.42, 0.0), 0.022, 0.012, seg=6)
    for i, (a, y, L) in enumerate(((0.3, 0.3, 0.14), (2.4, 0.36, 0.12), (4.3, 0.24, 0.12), (1.3, 0.44, 0.1))):
        tip = (math.cos(a) * L, y + 0.06, math.sin(a) * L)
        k.rod('twig', '#7a5230', (0.0, y - 0.04, 0.0), tip, 0.008, 0.005, seg=5)
        k.ell('leaf', '#6fbf4a' if i % 2 else '#5fae45', tip, (0.05, 0.016, 0.07), r=(0.3, -a, 0), seg=7, rings=3)
    k.ell('leaf', '#7fca55', (0.01, 0.46, 0.0), (0.04, 0.03, 0.04), seg=7, rings=4)
    return k


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


def grass(kind, seed):
    k = Kit()
    rng = Rng(seed)
    cols = {'short': ['#6fbf4a', '#5fae45', '#7fca55'], 'tall': ['#5fae45', '#4f9e3a', '#6dba4f'], 'dry': ['#c9b46a', '#b9a35a', '#d6c27a']}[kind]
    n, H = {'short': (9, 0.16), 'tall': (11, 0.34), 'dry': (8, 0.22)}[kind]
    for i in range(n):
        a = 2 * math.pi * i / n + rng.u(-0.4, 0.4)
        r = rng.u(0.0, 0.05)
        b = (math.cos(a) * r, 0.0, math.sin(a) * r)
        h = H * rng.u(0.7, 1.1)
        lean = rng.u(0.15, 0.45) * h
        tip = (b[0] + math.cos(a) * lean, h, b[2] + math.sin(a) * lean)
        w = 0.022 if kind != 'dry' else 0.016
        side = (-math.sin(a) * w, 0, math.cos(a) * w)
        k.fin('blade', cols[i % 3], [(b[0] + side[0], 0, b[2] + side[2]), (b[0] - side[0], 0, b[2] - side[2]), tip], t=0.008)
    return k


def fern(seed):
    k = Kit()
    rng = Rng(seed)
    for i in range(7):
        a = 2 * math.pi * i / 7 + rng.u(-0.2, 0.2)
        L = rng.u(0.32, 0.42)
        pts = [(math.cos(a) * L * f, math.sin(math.pi * min(1, f * 1.1)) * 0.22 + 0.01, math.sin(a) * L * f) for f in (0.0, 0.35, 0.7, 1.0)]
        col = '#4f9e3a' if i % 2 else '#5fae45'
        for p0, p1 in zip(pts, pts[1:]):
            k.rod('frond_stem', '#3d7a2e', p0, p1, 0.006, 0.005, seg=4)
            mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2)
            w = 0.07 * (1.15 - math.hypot(mid[0], mid[2]) / L)
            side = (-math.sin(a) * w, 0, math.cos(a) * w)
            k.fin('frond', col, [p0, (mid[0] + side[0], mid[1], mid[2] + side[2]), p1, (mid[0] - side[0], mid[1], mid[2] - side[2])], t=0.008)
    return k


def reeds(seed):
    k = Kit()
    rng = Rng(seed)
    for i in range(9):
        a = 2 * math.pi * i / 9 + rng.u(-0.4, 0.4)
        r = rng.u(0.02, 0.1)
        b = (math.cos(a) * r, 0, math.sin(a) * r)
        h = rng.u(0.45, 0.7)
        tip = (b[0] + math.cos(a) * 0.05, h, b[2] + math.sin(a) * 0.05)
        k.rod('reed', '#7a9a4a' if i % 2 else '#8aa856', b, tip, 0.012, 0.004, seg=5)
        if i % 3 == 0:
            top = (tip[0] * 0.97, h * 0.82, tip[2] * 0.97)
            k.rod('cattail', '#6d4c2f', (top[0], top[1] - 0.06, top[2]), (top[0], top[1] + 0.06, top[2]), 0.022, 0.022, seg=6)
    return k


def wildflowers(seed):
    k = Kit()
    rng = Rng(seed)
    cols = ['#ffffff', '#ffd166', '#ff8fb1', '#a0c4ff', '#cdb4db']
    for i in range(7):
        a = 2 * math.pi * i / 7 + rng.u(-0.3, 0.3)
        r = rng.u(0.03, 0.14)
        b = (math.cos(a) * r, 0, math.sin(a) * r)
        h = rng.u(0.1, 0.19)
        k.rod('stem', STEM, b, (b[0], h, b[2]), 0.006, 0.005, seg=4)
        k.ell('petal', cols[i % 5], (b[0], h, b[2]), (0.025, 0.012, 0.025), seg=6, rings=3)
        k.ell('centre', '#ffd54f', (b[0], h + 0.008, b[2]), (0.009, 0.006, 0.009), seg=5, rings=3)
    for i in range(5):
        a = 2 * math.pi * i / 5
        k.fin('blade', '#6fbf4a', [(math.cos(a) * 0.05 - 0.01, 0, math.sin(a) * 0.05), (math.cos(a) * 0.05 + 0.01, 0, math.sin(a) * 0.05), (math.cos(a) * 0.09, 0.1, math.sin(a) * 0.09)], t=0.006)
    return k


def leaves(seed):
    k = Kit()
    rng = Rng(seed)
    cols = ['#d9822b', '#c0392b', '#e0a83a', '#a0522d', '#f0c419']
    for i in range(9):
        c = (rng.u(-0.25, 0.25), 0.008 + i * 0.002, rng.u(-0.25, 0.25))
        k.ell('leaf', cols[i % 5], c, (0.06, 0.006, 0.035), r=(rng.u(-0.15, 0.15), rng.u(0, 3.1), 0), seg=6, rings=3)
    return k


def snow_clump(seed):
    k = Kit()
    k.blob('snow', '#f4f8fb', (0, 0.03, 0), (0.2, 0.08, 0.17), seed, n=16)
    k.blob('snow', '#e6eef5', (0.13, 0.02, 0.08), (0.1, 0.05, 0.1), seed + 3, n=12)
    return k


def clover(seed):
    k = Kit()
    rng = Rng(seed)
    for i in range(5):
        c = (rng.u(-0.12, 0.12), 0, rng.u(-0.12, 0.12))
        h = rng.u(0.05, 0.09)
        k.rod('stem', STEM, c, (c[0], h, c[2]), 0.005, 0.004, seg=4)
        for j in range(3):
            a = 2 * math.pi * j / 3 + i
            k.ell('leaf', '#4f9e3a', (c[0] + math.cos(a) * 0.022, h, c[2] + math.sin(a) * 0.022), (0.022, 0.006, 0.022), seg=6, rings=3)
    return k


def pebbles(seed):
    k = Kit()
    rng = Rng(seed)
    for i in range(6):
        c = (rng.u(-0.2, 0.2), 0.015, rng.u(-0.2, 0.2))
        r = rng.u(0.03, 0.06)
        k.blob('pebble', ['#9a9a96', '#b0aca4', '#8a8680'][i % 3], c, (r, r * 0.55, r * 0.8), seed + i, n=9)
    return k


def rock(seed, size=1.0, ore=None, moss=None):
    k = Kit(scale=size)
    k.blob('rock', '#8d8f93', (0, 0.2, 0), (0.46, 0.3, 0.4), seed, n=18)
    k.blob('rock', '#a3a5a8', (0.26, 0.11, 0.2), (0.22, 0.14, 0.2), seed + 1, n=12)
    k.blob('rock', '#7d7f84', (-0.25, 0.08, -0.12), (0.2, 0.1, 0.18), seed + 2, n=12)
    if ore:
        rng = Rng(seed + 9)
        for i in range(6):
            a = rng.u(0, 6.28)
            y = rng.u(0.1, 0.3)
            f = math.sqrt(max(0.2, 1 - ((y - 0.2) / 0.3) ** 2))
            k.blob('ore', ore, (math.cos(a) * 0.34 * f, y, math.sin(a) * 0.3 * f), (0.08, 0.06, 0.08), seed + 20 + i, n=8)
    if moss:
        k.blob('moss', moss, (0.02, 0.44, -0.02), (0.3, 0.07, 0.26), seed + 5, n=14)
    return k


def build():
    m = {}
    bushes = {
        'grassland': ('#3f8f3f', '#5c3fa8', 'round'),
        'tropical': ('#2e9a50', '#d8342a', 'broad'),
        'nordic': ('#3b7445', '#ff9f1c', 'cloud'),
        'forest_edge': ('#357a3a', '#3a1f5a', 'round'),
        'oasis': ('#6f8f3f', '#c5e17a', 'herb'),
        'jungle': ('#1f6e3a', '#f2c230', 'broad'),
        'desert': ('#8a8f4a', '#c9a2e6', 'scrub'),
    }
    for i, (b, (col, berry, kind)) in enumerate(bushes.items()):
        mk = {'round': lambda c, f, s: bush_round(c, f, s), 'broad': lambda c, f, s: bush_broadleaf(c, f, s, 1.5 if b == 'jungle' else 1.0),
              'cloud': bush_cloudberry, 'herb': lambda c, f, s: bush_herb(c, f, s), 'scrub': lambda c, f, s: bush_herb(c, f, s, sparse=True)}[kind]
        m[f'bush_{b}'] = mk(col, berry, 100 + i * 13)
    m['sapling'] = sapling()
    for kind, col in (('tulip', '#ff6f91'), ('buttercup', '#ffd166'), ('bell', '#c77dff'), ('daisy', '#ffffff'), ('poppy', '#ff9f1c'), ('cornflower', '#4cc9f0')):
        m[f'flower_{kind}'] = flower(kind, col)
    m['mushroom'] = mushroom('red')
    m['glowcap'] = mushroom('glow')
    m['mushroom_brown'] = mushroom('brown')
    m['grass_short'] = grass('short', 1)
    m['grass_tall'] = grass('tall', 2)
    m['grass_dry'] = grass('dry', 3)
    m['fern'] = fern(4)
    m['reeds'] = reeds(5)
    m['wildflowers'] = wildflowers(6)
    m['clover'] = clover(7)
    m['fallen_leaves'] = leaves(8)
    m['snow_clump'] = snow_clump(9)
    m['pebbles'] = pebbles(10)
    m['rock_1'] = rock(21)
    m['rock_2'] = rock(37, 0.9)
    m['rock_3'] = rock(53, 1.1)
    m['rock_iron'] = rock(71, 1.0, ore='#b5653a')
    m['rock_mossy'] = rock(89, 1.0, moss='#5f8f4a')
    return m
