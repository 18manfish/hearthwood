"""Path pieces: low-poly, flat-shaded quarter tiles in the style of the ground.

Every path tile is drawn as four quarters (like the terrain tileset). A quarter
spans x, z ∈ [0, 0.5] from the tile centre (x = z = 0) out to the tile corner;
the game mirrors it into the other three quarters. Each path type has
  full   both sides join another path tile
  edge   the +x side is open (grass there): a ragged border, an edging
  outer  both sides open: a rounded corner
in a few variants. Planks and brick rows run along x; the game turns a whole
tile's quarters (swaps x and z) where the path runs east–west, so they always
lie across / along the way. Heights are above the ground surface (the game follows the
terrain under every vertex). Written to paths.glb as `path_<key>_<piece>_<n>`.
"""
import math

from kit import Kit, Rng

H = 0.5          # quarter size
EDGE = 0.39      # where an open side ends (average)
VARIANTS = 3

COLORS = {
    'dirt': dict(base='#8b6a45', dark='#76583a', light='#a1825a', pebble='#9b948a', pebble_d='#7d786f'),
    'gravel': dict(base='#a39b8c', dark='#8d877c', light='#c6c0b4', stone='#b9b3a7', stone_d='#8a847a', stone_l='#d6d1c6'),
    'stone': dict(stone='#a8a49c', stone_d='#8f8b84', stone_l='#c2beb5', moss='#6f9a48'),
    'brick': dict(mortar='#cdbfa8', brick='#b5553c', brick_d='#9b4732', brick_l='#c4664a', edging='#8f3f2d'),
    'wood': dict(plank='#a0703f', plank_d='#8a5f34', plank_l='#b5844f', beam='#6b4a2e', nail='#4a3a2a'),
}


def edge_profile(seed, n=6, base=EDGE, wob=0.035):
    """Ragged border: (z, x) samples from z = 0 to z = H."""
    r = Rng(seed)
    return [(H * i / n, base + r.u(-wob, wob)) for i in range(n + 1)]


def corner_profile(seed, n=7, base=EDGE, wob=0.03):
    """Rounded outer corner: border points from (base, 0) round to (0, base)."""
    r = Rng(seed)
    out = []
    for i in range(n + 1):
        a = (math.pi / 2) * i / n
        # Squircle: square-ish near the axes, round at the diagonal.
        rad = base / ((abs(math.cos(a)) ** 4 + abs(math.sin(a)) ** 4) ** 0.25)
        rad = min(rad, base + 0.05) * (0.97 if 0 < i < n else 1.0) + (r.u(-wob, wob) if 0 < i < n else 0)
        out.append((math.cos(a) * rad, math.sin(a) * rad))
    return out


def slab(k, role, col, y0, y1, piece, seed, inset=0.0):
    """The flat patch of a quarter, from y0 to y1, as convex strips."""
    if piece == 'full':
        k.box(role, col, (0, y0, 0), (H, y1, H))
        return
    if piece == 'edge':
        prof = edge_profile(seed, base=EDGE - inset)
        for (z0, x0), (z1, x1) in zip(prof, prof[1:]):
            k.add(role, col, [(x, y, z) for (x, z) in ((0, z0), (x0, z0), (x1, z1), (0, z1)) for y in (y0, y1)])
        return
    prof = corner_profile(seed, base=EDGE - inset)
    for (xa, za), (xb, zb) in zip(prof, prof[1:]):
        k.add(role, col, [(x, y, z) for (x, z) in ((0, 0), (xa, za), (xb, zb)) for y in (y0, y1)])


def inside(piece, x, z, margin=0.0):
    """Is (x, z) inside the quarter's patch (roughly), keeping `margin` from open borders?"""
    if piece == 'full':
        return 0 <= x <= H and 0 <= z <= H
    if piece == 'edge':
        return 0 <= z <= H and 0 <= x <= EDGE - margin - 0.035
    return math.hypot(max(0, x), max(0, z)) <= EDGE - margin - 0.04 and x >= 0 and z >= 0


def scatter(r, piece, n, margin, tries=60):
    pts = []
    for _ in range(tries):
        if len(pts) >= n:
            break
        x, z = r.u(0.02, H - 0.02), r.u(0.02, H - 0.02)
        if inside(piece, x, z, margin) and all(math.hypot(x - a, z - b) > margin * 1.6 for a, b in pts):
            pts.append((x, z))
    return pts


def dirt(piece, v):
    c = COLORS['dirt']
    k = Kit()
    seed = 11 + v * 7 + {'full': 0, 'edge': 100, 'outer': 200}[piece]
    r = Rng(seed)
    slab(k, 'path', c['base'], -0.01, 0.006, piece, seed)
    # Darker trodden patches and lighter dry ones, a few pebbles.
    for (x, z) in scatter(r, piece, 3, 0.07):
        k.ell('path_dark', c['dark'] if r.r() < 0.6 else c['light'], (x, 0.004, z), (r.u(0.05, 0.09), 0.004, r.u(0.04, 0.07)), r=(0, r.u(0, 3), 0), seg=7, rings=2)
    for (x, z) in scatter(r, piece, 2, 0.05):
        rr = r.u(0.012, 0.022)
        k.blob('pebble', c['pebble'] if r.r() < 0.5 else c['pebble_d'], (x, 0.008, z), (rr, rr * 0.6, rr * 0.8), seed + int(x * 100), n=8)
    return k


def gravel(piece, v):
    c = COLORS['gravel']
    k = Kit()
    seed = 31 + v * 7 + {'full': 0, 'edge': 100, 'outer': 200}[piece]
    r = Rng(seed)
    slab(k, 'path', c['base'], -0.01, 0.006, piece, seed)
    for (x, z) in scatter(r, piece, 2, 0.08):
        k.ell('path_dark', c['dark'], (x, 0.0045, z), (r.u(0.06, 0.1), 0.004, r.u(0.05, 0.08)), r=(0, r.u(0, 3), 0), seg=7, rings=2)
    for (x, z) in scatter(r, piece, 11, 0.032, tries=200):
        rr = r.u(0.014, 0.026)
        k.blob('gravel', [c['stone'], c['stone_d'], c['stone_l']][int(r.r() * 3)], (x, 0.008, z), (rr, rr * 0.55, rr * 0.85), seed + int(x * 1000 + z * 10), n=8)
    # Loose stones spilling onto the grass along open borders.
    if piece != 'full':
        for i in range(3):
            t = (i + 0.5) / 3
            x, z = (EDGE + r.u(0.0, 0.05), t * H) if piece == 'edge' else (math.cos(t * math.pi / 2) * (EDGE + 0.03), math.sin(t * math.pi / 2) * (EDGE + 0.03))
            rr = r.u(0.012, 0.02)
            k.blob('gravel', c['stone_d'], (x, 0.005, z), (rr, rr * 0.5, rr * 0.8), seed + 500 + i, n=7)
    return k


def stepping(piece, v):
    """Stepping stones: flat slabs in the grass (no base), a bit of moss."""
    c = COLORS['stone']
    k = Kit()
    seed = 51 + v * 7 + {'full': 0, 'edge': 100, 'outer': 200}[piece]
    r = Rng(seed)
    if piece == 'full':
        centres = [(0.26 + r.u(-0.03, 0.03), 0.26 + r.u(-0.03, 0.03), 0.17)]
        if v == 2:
            centres = [(0.15, 0.3, 0.11), (0.36, 0.14, 0.1)]
    elif piece == 'edge':
        centres = [(0.2 + r.u(-0.02, 0.02), 0.26 + r.u(-0.04, 0.04), 0.15)]
    else:
        centres = [(0.17, 0.17, 0.13)]
    for (x, z, rad) in centres:
        pts = []
        sides = 7 + int(r.r() * 3)
        rot = r.u(0, 6.28)
        for i in range(sides):
            a = rot + 2 * math.pi * i / sides
            rr = rad * r.u(0.78, 1.05)
            for y in (-0.01, r.u(0.022, 0.032)):
                pts.append((x + math.cos(a) * rr, y, z + math.sin(a) * rr * r.u(0.8, 1.0)))
        k.add('stone', [c['stone'], c['stone_l']][int(r.r() * 2)], pts)
        # Darker underside rim peeking out, a moss patch.
        k.add('stone_rim', c['stone_d'], [(px + (px - x) * 0.06, -0.01 if py > 0 else -0.012, pz + (pz - z) * 0.06) for (px, py, pz) in pts[::2]] + [(x, 0.012, z)])
        if r.r() < 0.5:
            a = r.u(0, 6.28)
            k.ell('moss', c['moss'], (x + math.cos(a) * rad * 0.55, 0.026, z + math.sin(a) * rad * 0.55), (rad * 0.3, 0.006, rad * 0.22), seg=6, rings=2)
    return k


def brick(piece, v):
    """Running-bond bricks on mortar; a soldier course along open borders."""
    c = COLORS['brick']
    k = Kit()
    seed = 71 + v * 7 + {'full': 0, 'edge': 100, 'outer': 200}[piece]
    r = Rng(seed)
    lim = H if piece == 'full' else EDGE - 0.07
    slab(k, 'mortar', c['mortar'], -0.01, 0.01, piece, seed)
    bw, bh, gap = 0.25, 0.125, 0.016
    for row in range(int(H / bh)):
        z0 = row * bh + gap / 2
        z1 = z0 + bh - gap
        off = (bw / 2) if row % 2 else 0.0
        x = -off
        while x < H:
            xa, xb = max(0.0, x + gap / 2), min(H, x + bw - gap / 2)
            col = [c['brick'], c['brick_d'], c['brick_l']][(row * 5 + int(round((x + off) / bw)) * 3) % 3]
            x += bw
            # Clip to the open border (the edging closes it off).
            if piece == 'edge':
                xb = min(xb, lim)
            elif piece == 'outer':
                rz = max(abs(z0), abs(z1))
                xb = min(xb, math.sqrt(max(0.0, (EDGE - 0.08) ** 2 - rz ** 2)))
            if xb - xa < 0.04:
                continue
            k.box('brick', col, (xa, 0.0, z0), (xb, 0.026, z1))
    # Edging: bricks on end along the open side(s).
    if piece == 'edge':
        for i in range(4):
            z0, z1 = i * 0.125 + gap / 2, (i + 1) * 0.125 - gap / 2
            k.box('edging', c['edging'], (lim - 0.005, -0.01, z0), (lim + 0.06, 0.035, z1))
    elif piece == 'outer':
        n = 6
        for i in range(n):
            a0, a1 = (math.pi / 2) * i / n + 0.03, (math.pi / 2) * (i + 1) / n - 0.03
            r0, r1 = EDGE - 0.07, EDGE - 0.005
            k.add('edging', c['edging'], [(math.cos(a) * rr, y, math.sin(a) * rr) for a in (a0, a1) for rr in (r0, r1) for y in (-0.01, 0.035)])
    return k


def wood(piece, v):
    """Boardwalk: planks across the path on two beams; a rail beam along open sides."""
    c = COLORS['wood']
    k = Kit()
    seed = 91 + v * 7 + {'full': 0, 'edge': 100, 'outer': 200}[piece]
    r = Rng(seed)
    y0, y1 = 0.035, 0.065
    pw, gap = 0.1, 0.014
    xmax = H if piece == 'full' else EDGE
    if piece != 'outer':
        k.box('beam', c['beam'], (0.0, -0.01, 0.17), (xmax - 0.02 if piece != 'full' else H, y0, 0.24))
    for i in range(int(H / pw)):
        z0, z1 = i * pw + gap / 2, (i + 1) * pw - gap / 2
        zc = (z0 + z1) / 2
        if piece == 'outer':
            end = math.sqrt(max(0.0, EDGE ** 2 - zc ** 2))
            if end < 0.08:
                continue
        else:
            end = xmax + r.u(-0.015, 0.015) if piece != 'full' else H
        col = [c['plank'], c['plank_d'], c['plank_l']][(i * 2) % 3]
        k.box('plank', col, (0.0, y0, z0), (end, y1 + r.u(-0.004, 0.004), z1))
        if piece != 'full':
            k.box('nail', c['nail'], (end - 0.05, y1, zc - 0.008), (end - 0.034, y1 + 0.004, zc + 0.008))
    if piece == 'edge':
        k.box('beam', c['beam'], (EDGE - 0.03, -0.02, 0.0), (EDGE + 0.04, y1 + 0.01, H))
    elif piece == 'outer':
        n = 5
        for i in range(n):
            a0, a1 = (math.pi / 2) * i / n, (math.pi / 2) * (i + 1) / n
            k.add('beam', c['beam'], [(math.cos(a) * rr, y, math.sin(a) * rr) for a in (a0, a1) for rr in (EDGE - 0.04, EDGE + 0.04) for y in (-0.02, y1 + 0.01)])
        k.cyl('beam', c['beam'], (math.cos(math.pi / 4) * EDGE, math.sin(math.pi / 4) * EDGE), -0.02, y1 + 0.06, 0.04, seg=6)
    return k


TYPES = {'dirt': dirt, 'gravel': gravel, 'stone': stepping, 'brick': brick, 'wood': wood}
PIECES = ('full', 'edge', 'outer')


def build():
    out = {}
    for key, make in TYPES.items():
        for piece in PIECES:
            for v in range(VARIANTS):
                out[f'path_{key}_{piece}_{v}'] = make(piece, v)
    return out
