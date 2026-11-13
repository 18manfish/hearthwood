"""Pixel-art icon generator for Hearthwood fish & birds (16x16).

Each icon is built on a small canvas from shapes, markings and colours, then
gets an automatic selective outline (a darker shade of the neighbouring
pixel). Output: Lua grid files for Aseprite's paint_grid + local previews.
"""
import json, math, os, re, sys
from PIL import Image

N = 16

def hx(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))

def to_hex(rgb):
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(v)))) for v in rgb)

def mix(a, b, t):
    a, b = hx(a), hx(b)
    return to_hex(tuple(a[i] + (b[i] - a[i]) * t for i in range(3)))

def dark(c, k=0.35):
    return mix(c, '#1a1410', k)

def light(c, k=0.35):
    return mix(c, '#ffffff', k)


class Canvas:
    def __init__(self):
        self.p = [[None] * N for _ in range(N)]

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < N and 0 <= y < N and c:
            self.p[y][x] = c

    def get(self, x, y):
        x, y = int(round(x)), int(round(y))
        return self.p[y][x] if 0 <= x < N and 0 <= y < N else None

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(N):
            for x in range(N):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                    self.set(x, y, c(x, y) if callable(c) else c)

    def poly(self, pts, c):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        for y in range(max(0, int(min(ys))), min(N, int(max(ys)) + 1)):
            for x in range(max(0, int(min(xs))), min(N, int(max(xs)) + 1)):
                if inside(x, y, pts):
                    self.set(x, y, c(x, y) if callable(c) else c)

    def line(self, x0, y0, x1, y1, c):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            t = i / max(1, n)
            self.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)

    def recolor(self, f):
        for y in range(N):
            for x in range(N):
                if self.p[y][x]:
                    r = f(x, y, self.p[y][x])
                    if r:
                        self.p[y][x] = r

    def outline(self, k=0.55, skip=()):
        out = [row[:] for row in self.p]
        for y in range(N):
            for x in range(N):
                if self.p[y][x]:
                    continue
                nb = [self.get(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                nb = [n for n in nb if n and n not in skip]
                if nb:
                    out[y][x] = dark(nb[0], k)
        self.p = out


def inside(x, y, pts):
    # Sample the pixel centre.
    px, py = x + 0.0, y + 0.0
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]; xj, yj = pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi:
            c = not c
        j = i
    return c


# ── Fish ──────────────────────────────────────────────────────────────────────
# Fish face left. p: dict of shape and colour parameters.
def fish(p):
    cv = Canvas()
    top, belly = p['top'], p['belly']
    fin = p.get('fin', dark(top, 0.15))
    cx, cy = p.get('cx', 7), p.get('cy', 8)
    rx, ry = p.get('rx', 5.2), p.get('ry', 3.2)
    tail = p.get('tail', 'fork')
    tx = cx + rx - 0.5  # where the tail starts
    # Tail
    if tail == 'fork':
        cv.poly([(tx - 1, cy), (tx + 3.6, cy - ry - 0.6), (tx + 3.2, cy - 0.3), (tx + 2.2, cy), (tx + 3.2, cy + 0.3), (tx + 3.6, cy + ry + 0.6)], fin)
    elif tail == 'round':
        cv.ellipse(tx + 2.2, cy, 2.2, ry * 0.85, fin)
    elif tail == 'fan':  # fancy goldfish tail
        cv.poly([(tx - 1, cy), (tx + 4.5, cy - ry - 2), (tx + 3.5, cy), (tx + 4.5, cy + ry + 2)], fin)
        cv.line(tx + 1, cy - 1, tx + 3.5, cy - ry - 1, light(fin, 0.3))
        cv.line(tx + 1, cy + 1, tx + 3.5, cy + ry + 1, light(fin, 0.3))
    elif tail == 'shark':
        cv.poly([(tx - 1, cy), (tx + 3.5, cy - ry - 1.6), (tx + 2.5, cy + 0.2), (tx + 3, cy + ry - 0.4)], fin)
    elif tail == 'square':
        cv.poly([(tx - 1, cy), (tx + 3, cy - ry), (tx + 3, cy + ry)], fin)
    # Dorsal fin
    d = p.get('dorsal', 'small')
    if d == 'small':
        cv.poly([(cx - 1.5, cy - ry + 0.5), (cx + 0.5, cy - ry - 1.6), (cx + 2.2, cy - ry + 0.8)], fin)
    elif d == 'spiny':
        for i, h in enumerate([1.8, 2.2, 1.8, 1.2]):
            cv.line(cx - 2 + i, cy - ry, cx - 2 + i, cy - ry - h, fin)
        cv.poly([(cx + 1.5, cy - ry + 0.5), (cx + 2.5, cy - ry - 1.2), (cx + 3.5, cy - ry + 0.8)], fin)
    elif d == 'long':
        cv.poly([(cx - 3, cy - ry + 0.8), (cx - 1, cy - ry - 1.4), (cx + 3.5, cy - ry - 0.8), (cx + 4, cy - ry + 0.8)], fin)
    # Belly fins
    if p.get('ventral', True):
        cv.poly([(cx - 1, cy + ry - 0.6), (cx, cy + ry + 1.4), (cx + 1.2, cy + ry - 0.4)], fin)
    # Body with a dark back and light belly.
    split = p.get('split', 0.15)
    def body(x, y):
        return top if (y - cy) / ry < split else belly
    cv.ellipse(cx, cy, rx, ry, body)
    # Snout
    if p.get('snout'):
        cv.poly([(cx - rx + 1, cy - 1), (cx - rx - p['snout'], cy - 0.2 + p.get('snout_dy', 0)), (cx - rx + 1, cy + 1)], body)
    # Pattern
    pat = p.get('pattern')
    pc = p.get('pc', dark(top, 0.4))
    if pat == 'vstripes':
        for sx in p.get('sx', [cx - 2, cx, cx + 2]):
            for y in range(N):
                if cv.get(sx, y) in (top, belly) and (y - cy) / ry < 0.6:
                    cv.set(sx, y, pc)
    elif pat == 'bands':  # clownfish
        for sx in p.get('sx', [cx - 2, cx + 1]):
            for y in range(N):
                if cv.get(sx, y) in (top, belly):
                    cv.set(sx, y, '#ffffff')
                    if cv.get(sx - 1, y) in (top, belly): cv.set(sx - 1, y, pc)
                    if cv.get(sx + 1, y) in (top, belly): cv.set(sx + 1, y, pc)
    elif pat == 'spots':
        for (sx, sy) in p.get('spots', []):
            if cv.get(sx, sy) in (top, belly): cv.set(sx, sy, pc)
    elif pat == 'lateral':
        for x in range(N):
            y = int(round(cy + p.get('ly', 0)))
            if cv.get(x, y) in (top, belly): cv.set(x, y, pc)
    elif pat == 'waves':
        for x in range(N):
            for y in range(N):
                if cv.get(x, y) == top and (x + y * 2) % 4 == 0: cv.set(x, y, pc)
    elif pat == 'patches':
        for (sx, sy, r) in p.get('patches', []):
            for y in range(N):
                for x in range(N):
                    if (x - sx) ** 2 + (y - sy) ** 2 <= r * r and cv.get(x, y) in (top, belly):
                        cv.set(x, y, pc)
    elif pat == 'scales':
        for y in range(N):
            for x in range(N):
                if cv.get(x, y) in (top, belly) and (x + (y % 2) * 1) % 2 == 0 and y % 2 == 0:
                    cv.set(x, y, pc)
    for extra in p.get('dots', []):
        if cv.get(extra[0], extra[1]): cv.set(extra[0], extra[1], extra[2])
    # Gill line and eye
    ex, ey = int(cx - rx + 2 + p.get('eye_dx', 0)), int(cy - 1 + p.get('eye_dy', 0))
    gx = ex + 2
    for y in range(int(cy - ry + 1), int(cy + ry)):
        if cv.get(gx, y) in (top, belly) and p.get('gill', True):
            cv.set(gx, y, dark(cv.get(gx, y), 0.18))
    cv.set(ex, ey, '#1b1b22')
    if p.get('big_eye'):
        cv.set(ex, ey - 1, '#1b1b22'); cv.set(ex + 1, ey, '#ffffff')
    # Mouth
    if p.get('teeth'):
        cv.set(ex - 1, ey + 2, '#ffffff'); cv.set(ex, ey + 2, '#ffffff')
    if p.get('barbels'):
        bx, by = ex - 1, ey + 2
        for i in range(p['barbels']):
            cv.set(bx - i, by + i, dark(top, 0.2))
    # Highlight along the back
    for x in range(N):
        for y in range(N):
            if cv.get(x, y) == top and cv.get(x, y - 1) is None and x < cx + 1:
                cv.set(x, y, light(top, 0.25))
                break
    for k in p.get('finlets', []):
        cv.set(k[0], k[1], k[2])
    cv.outline(p.get('ol', 0.55))
    return cv


def eel(top, belly, crest=None, head='#5a5a3a'):
    cv = Canvas()
    # S-shaped body from head (top-left) to tail (bottom-right).
    pts = [(1.5 + t * 13, 8 + 2.6 * math.sin(t * math.pi * 2.2 + 0.3)) for t in [i / 52 for i in range(53)]]
    for i, (x, y) in enumerate(pts):
        w = 1.5 if i < 40 else 1.5 - (i - 40) * 0.1
        for yy in range(int(y - w), int(y + w) + 1):
            if abs(yy - y) <= w:
                cv.set(x, yy, top if yy < y + 0.2 else belly)
        if crest and i > 3:
            cv.set(x, y - w - 0.6, crest)
            if i < 9: cv.set(x, y - w - 1.6, crest)
    hx0, hy0 = pts[1]
    cv.set(hx0 + 0.5, hy0 - 0.6, '#1b1b22')
    cv.outline(0.55)
    return cv


def frog():
    cv = Canvas()
    g, gl, gd = '#5fae3e', '#a6d66a', '#3b7a2a'
    cv.ellipse(8, 10, 5.2, 3.6, lambda x, y: gl if y > 11 else g)   # body
    cv.ellipse(8, 6.5, 4.6, 2.6, g)                                # head
    for ex in (5, 11):                                             # eyes
        cv.ellipse(ex, 4.3, 1.6, 1.6, g)
        cv.set(ex, 4, '#ffffff'); cv.set(ex, 4.6, '#1b1b22')
    cv.line(6, 8, 10, 8, gd)                                       # mouth
    for (x, y) in ((4, 13), (12, 13)):                             # feet
        cv.set(x - 1, y + 1, g); cv.set(x, y + 1, g); cv.set(x + 1, y + 1, g)
    for (x, y) in ((6, 10), (10, 9), (8, 11)):
        cv.set(x, y, gd)
    cv.outline(0.55)
    return cv


FISH = {
    'fish_carp': dict(top='#8f7a3a', belly='#e2c77e', fin='#b86a3c', rx=5.4, ry=3.4, pattern='scales', pc='#7a6430', barbels=2),
    'fish_perch': dict(top='#8aa23a', belly='#f0e6a0', fin='#e0572a', dorsal='spiny', pattern='vstripes', pc='#44551e', sx=[5, 7, 9]),
    'fish_pike': dict(top='#5b7a3a', belly='#e4e2bc', fin='#7a8a3a', rx=6, ry=2.4, cx=7, snout=2, dorsal='none', tail='fork', pattern='spots', pc='#cfd98a',
                      spots=[(4, 7), (7, 6), (9, 7), (11, 6), (6, 8), (10, 8)], ventral=True),
    'fish_trout': dict(top='#7f8a52', belly='#f2e8d8', fin='#8c8a5a', pattern='lateral', pc='#e57a98', ly=0.6,
                       dots=[(5, 6, '#3a3a24'), (8, 6, '#3a3a24'), (10, 7, '#3a3a24'), (7, 5, '#3a3a24')]),
    'fish_salmon': dict(top='#6f8394', belly='#f0c6bc', fin='#8a7f86', rx=5.6, ry=3.2, split=0.0,
                        dots=[(6, 6, '#3a4250'), (9, 6, '#3a4250'), (11, 7, '#3a4250')]),
    'fish_char': dict(top='#4d5e48', belly='#e2603a', fin='#e2603a', split=0.25, pattern='spots', pc='#e8d9a0', spots=[(5, 6), (8, 5), (10, 7), (7, 7)]),
    'fish_tilapia': dict(top='#6f8296', belly='#d8dde2', fin='#b8434a', ry=3.6, dorsal='long', pattern='vstripes', pc='#5d6e80', sx=[6, 9]),
    'fish_koi': dict(top='#f4b52c', belly='#ffe089', fin='#f6c84a', rx=5.6, ry=3.2, tail='round', pattern='patches', pc='#ffffff', patches=[(6, 6, 1.4), (10, 8, 1.2)], barbels=1),
    'fish_catfish': dict(top='#5e574f', belly='#c9bfae', fin='#5e574f', rx=6, ry=2.8, cy=8.5, dorsal='small', tail='round', barbels=3, gill=False),
    'fish_piranha': dict(top='#7f8b96', belly='#d8402c', fin='#6b7680', rx=4.6, ry=4.2, cx=7, cy=8, split=0.1, teeth=True, big_eye=True, tail='square'),
    'fish_bitterling': dict(top='#a9b8c8', belly='#eaa6c0', fin='#c78aa6', rx=4.2, ry=2.8, cx=7, pattern='lateral', pc='#3fa0a0', ly=0, dorsal='small'),
    'fish_goldfish': dict(top='#f0761e', belly='#ffb15a', fin='#f6913a', rx=4, ry=3.6, cx=6, tail='fan', dorsal='small'),
    'fish_dace': dict(top='#8b97a5', belly='#eef1f4', fin='#a7b0ba', rx=5, ry=2.4, pattern='lateral', pc='#c3ccd6', ly=0.3),
    'fish_sweetfish': dict(top='#959b6a', belly='#eef0e0', fin='#c9b45a', rx=5.4, ry=2.5, dots=[(6, 8, '#f2d24a'), (7, 8, '#f2d24a')]),
    'fish_sturgeon': dict(top='#6c7882', belly='#d6dbde', fin='#5a646d', rx=6.2, ry=2.4, cx=7, snout=2, snout_dy=0.6, tail='shark', dorsal='none', pattern='spots', pc='#e4e8ea',
                          spots=[(3, 7), (5, 6), (7, 6), (9, 6), (11, 6)], barbels=1),
    'fish_arowana': dict(top='#c9ac58', belly='#efe1a8', fin='#a8853a', rx=6.2, ry=2.6, cx=7, pattern='scales', pc='#a8873a', tail='round', dorsal='long', barbels=2),
    'fish_sardine': dict(top='#3a6fa0', belly='#e8eef4', fin='#7f9cb8', rx=5, ry=2.3, pattern='spots', pc='#22344a', spots=[(5, 8), (7, 8), (9, 8)]),
    'fish_mackerel': dict(top='#2f7f8a', belly='#e4ecef', fin='#3d6a72', rx=5.6, ry=2.6, pattern='waves', pc='#16343a',
                          finlets=[(11, 6, '#e6c84a'), (11, 10, '#e6c84a')]),
    'fish_seabass': dict(top='#677783', belly='#dfe5e8', fin='#59656f', dorsal='spiny', rx=5.4, ry=3),
    'fish_cod': dict(top='#9a8a5a', belly='#ece4cc', fin='#8a7a4c', rx=5.6, ry=3.2, pattern='spots', pc='#6f6036', spots=[(5, 6), (8, 5), (10, 6), (7, 7), (11, 8)],
                     barbels=1, dots=[(x, 9, '#efe6c8') for x in range(4, 12)]),
    'fish_herring': dict(top='#4a6f9a', belly='#e8eef4', fin='#8aa0b8', rx=5, ry=2.6),
    'fish_clownfish': dict(top='#f07020', belly='#f68a3a', fin='#f07020', rx=4.6, ry=3.2, tail='round', pattern='bands', pc='#1b1b22', sx=[5, 9]),
    'fish_butterfly': dict(top='#f2d02a', belly='#f8e070', fin='#f2d02a', rx=4.4, ry=4.4, cx=7, tail='square', dorsal='long', pattern='vstripes', pc='#1b1b22', sx=[5],
                           dots=[(4, 7, '#ffffff'), (4, 8, '#ffffff'), (4, 9, '#ffffff')]),
    'fish_tuna': dict(top='#23395f', belly='#dfe6ee', fin='#23395f', rx=5.8, ry=3.4, tail='fork', split=0.1,
                      finlets=[(11, 5, '#f2c230'), (12, 6, '#f2c230'), (11, 11, '#f2c230'), (12, 10, '#f2c230')]),
    'fish_mahi': dict(top='#2f9e5a', belly='#f2d02a', fin='#3a7fbf', rx=5.4, ry=3.4, dorsal='long', split=0.0, pattern='spots', pc='#3a7fbf', spots=[(6, 7), (8, 6), (10, 7), (9, 8)], eye_dx=0),
    'fish_seabream': dict(top='#e0646c', belly='#f8d0d0', fin='#d0505a', rx=4.8, ry=4, tail='fork', dorsal='spiny', pattern='spots', pc='#5fb8e8', spots=[(6, 6), (8, 5), (10, 6), (7, 7)]),
}


# ── Birds ─────────────────────────────────────────────────────────────────────
# Birds face left, perched. colors: body, wing, belly, beak (from the game data).
def bird(body, wing, belly, beak, f=None):
    f = f or {}
    cv = Canvas()
    hx0, hy0 = f.get('head', (5.5, 5.5))
    hr = f.get('hr', 2.8)
    bx, by = f.get('bodyc', (8.5, 9))
    brx, bry = f.get('bodyr', (4.6, 3.6))
    leg = f.get('leg', '#6b5a48')
    ll = f.get('legs', 2)
    late = []
    def legs():
        for lx in f.get('legx', (8, 10)):
            for y in range(int(by + bry + 0.5), int(by + bry + ll + 0.5)):
                if not cv.get(lx, y): cv.set(lx, y, leg)
            cv.set(lx - 1, by + bry + ll - 0.5, leg)
    late.append(legs)
    # Tail (pointing back-down to the right)
    tl = f.get('tail', 3.5)
    tc = f.get('tailc', wing)
    ty = f.get('tail_dy', 0.5)
    cv.poly([(bx + brx - 2, by - 1.4), (bx + brx + tl, by + ty + tl * 0.45 - 1.2), (bx + brx + tl - 0.5, by + ty + tl * 0.45 + 0.6), (bx + brx - 2, by + 1.6)], tc)
    # Body + belly
    bsplit = f.get('bsplit', 0)
    cv.ellipse(bx, by, brx, bry, lambda x, y: belly if (x < bx + 0.5 and y > by - 1 + bsplit) else body)
    # Wing
    wc = (bx + 1, by - 0.3)
    cv.ellipse(wc[0], wc[1], f.get('wingr', (3.4, 2.2))[0], f.get('wingr', (3.4, 2.2))[1], wing)
    for i in range(3):
        cv.set(wc[0] - 1 + i * 1.5, wc[1] + 1.4, dark(wing, 0.25))
    # Head
    hcol = f.get('headc', body)
    cv.ellipse(hx0, hy0, hr, hr, hcol)
    if f.get('cheek'):
        cv.ellipse(hx0 - 0.4, hy0 + 1, 1.6, 1.2, f['cheek'])
    if f.get('cap'):
        for y in range(N):
            for x in range(N):
                if cv.get(x, y) == hcol and y <= hy0 - f.get('cap_y', 0.6):
                    cv.set(x, y, f['cap'])
    if f.get('breast'):
        cv.ellipse(hx0 + 0.5, hy0 + 2.6, 2.6, 2.4, f['breast'])
    # Crest
    if f.get('crest'):
        cc = f.get('crestc', hcol)
        for (x, y) in f['crest']:
            cv.set(x, y, cc)
    # Beak
    bk = f.get('beak', 'short')
    ex, ey = hx0 - 1, hy0 - 0.6
    if bk == 'short':
        cv.set(hx0 - hr - 0.2, hy0 + 0.2, beak); cv.set(hx0 - hr - 1, hy0 + 0.5, beak)
    elif bk == 'long':
        def lb():
            for i in range(f.get('beakl', 4)):
                x, y = hx0 - hr - i - 0.4, hy0 + 0.4 + i * f.get('beak_droop', 0.15)
                if not cv.get(x, y) or i < 1: cv.set(x, y, beak)
        late.append(lb)
    elif bk == 'thick':
        cv.poly([(hx0 - hr + 0.6, hy0 - 0.8), (hx0 - hr - 1.8, hy0 + 0.6), (hx0 - hr + 0.6, hy0 + 1.6)], beak)
    elif bk == 'hook':
        cv.poly([(hx0 - hr + 0.6, hy0 - 1.2), (hx0 - hr - 1.4, hy0 - 0.6), (hx0 - hr - 1.6, hy0 + 1.4), (hx0 - hr + 0.6, hy0 + 1.4)], beak)
        cv.set(hx0 - hr - 1.4, hy0 + 1.8, beak)
    elif bk == 'toucan':
        cv.poly([(hx0 - hr + 0.8, hy0 - 1.6), (hx0 - hr - 5, hy0 + 0.6), (hx0 - hr - 4.6, hy0 + 1.6), (hx0 - hr + 0.8, hy0 + 1.8)], beak)
        cv.set(hx0 - hr - 4.4, hy0 + 0.8, '#1b1b22')
        for x in range(int(hx0 - hr - 3), int(hx0 - hr + 1)):
            cv.set(x, hy0 - 1, '#7bc142') if x == int(hx0 - hr) else None
    # Eye
    cv.set(ex, ey, f.get('eyec', '#1b1b22'))
    if f.get('mask'):
        for x in range(int(hx0 - hr + 0.5), int(hx0 + 1)):
            cv.set(x, ey, f['mask'])
        cv.set(ex, ey, '#1b1b22')
    if f.get('eyering'):
        cv.set(ex, ey - 1, f['eyering']); cv.set(ex + 1, ey, f['eyering'])
    for (x, y, c) in f.get('dots', []):
        if cv.get(x, y): cv.set(x, y, c)
    if f.get('wingbars'):
        for y in range(N):
            for x in range(N):
                if cv.get(x, y) == wing and y % 2 == 0:
                    cv.set(x, y, f['wingbars'])
    cv.outline(0.55)
    for fn in late: fn()
    return cv


def owl():
    cv = Canvas()
    body, wing, face, beak = '#8b5e3c', '#6b4429', '#c9a27a', '#e0b23a'
    cv.ellipse(8, 9.5, 5, 5, body)
    for x in (4, 12):
        cv.ellipse(x, 9.5, 1.8, 4, wing)
    cv.ellipse(8, 6.5, 4.4, 3.4, body)
    cv.poly([(3.8, 2.6), (5.2, 4.2), (4.2, 5)], body); cv.poly([(12.2, 2.6), (10.8, 4.2), (11.8, 5)], body)
    cv.ellipse(6.1, 6.6, 1.8, 1.8, face); cv.ellipse(9.9, 6.6, 1.8, 1.8, face)
    cv.set(6, 6.5, '#1b1b22'); cv.set(10, 6.5, '#1b1b22'); cv.set(6.6, 6, '#ffffff'); cv.set(10.6, 6, '#ffffff')
    cv.set(8, 7.8, beak); cv.set(8, 8.6, dark(beak, 0.2))
    for (x, y) in ((7, 11), (9, 11), (8, 12.5), (6.5, 13), (9.5, 13)):
        cv.set(x, y, light(body, 0.35))
    cv.set(7, 14.6, beak); cv.set(9, 14.6, beak)
    cv.outline(0.55)
    return cv


def flamingo(body, wing, light_c, beak):
    cv = Canvas()
    leg = '#e57396'
    cv.line(9, 10, 9, 15, leg); cv.line(10, 10, 11, 12, leg); cv.line(11, 12, 10, 13, leg)
    cv.ellipse(9.5, 8.2, 4.2, 2.6, body)
    cv.ellipse(10.5, 7.8, 3, 1.6, wing)
    cv.poly([(12.5, 7.4), (15, 8.6), (12.5, 9.4)], wing)
    # S-neck
    for (x, y) in ((6.5, 7.5), (5.6, 6.6), (5, 5.6), (5, 4.6), (5.4, 3.6), (6.2, 2.9)):
        cv.set(x, y, body)
    cv.ellipse(6.8, 2.6, 1.4, 1.2, body)
    cv.set(5.2, 3.1, beak); cv.set(4.6, 3.6, '#1b1b22'); cv.set(5.6, 3.6, '#f6e0d0')
    cv.set(6.6, 2.3, '#1b1b22')
    cv.outline(0.55)
    return cv


def hummingbird(body, wing, throat, beak):
    cv = Canvas()
    cv.ellipse(9, 9, 3.4, 2.4, body)
    cv.poly([(11, 8.4), (15, 10.8), (14, 12), (11, 10)], dark(body, 0.15))
    cv.ellipse(6.4, 7.2, 2.2, 2.2, body)
    cv.ellipse(6.6, 8.6, 1.6, 1, throat)
    for i in range(5):
        cv.set(4.2 - i, 7.4 + i * 0.12, beak)
    cv.set(6, 6.6, '#1b1b22')
    cv.poly([(8, 7.8), (11, 2), (13, 2.6), (10.5, 8)], light(wing, 0.15))
    cv.line(10, 4, 11.5, 2.6, light(wing, 0.5))
    cv.set(8.5, 11.4, '#3b3b3b')
    cv.outline(0.55)
    return cv


B = {}  # filled from birds.json (game colours)

def bird_icon(id, colors):
    body, wing, belly, beak = colors
    if id == 'bird_owl': return owl()
    if id == 'bird_flamingo': return flamingo(body, wing, belly, beak)
    if id == 'bird_hummingbird': return hummingbird(body, wing, belly, beak)
    f = {}
    if id == 'bird_sparrow':
        f = dict(cap='#7b6a5a', cheek='#e8e0d0', dots=[(5, 8, '#2b2b2b'), (9, 8, '#3a2a1c'), (11, 9, '#3a2a1c')], beak='thick')
    elif id == 'bird_robin':
        f = dict(breast='#e2672e', beak='short', bodyc=(8.5, 9.2), dots=[])
    elif id == 'bird_blue_tit':
        f = dict(cap='#3d7cc9', headc='#ffffff', mask='#1d2a44', breast=None, beak='short', hr=2.6)
        body = '#7aa84a'
    elif id == 'bird_magpie':
        f = dict(headc='#1f2430', tail=6, tailc='#1f2430', tail_dy=-0.5, bodyr=(4.2, 3.2), bodyc=(7.8, 9), wingr=(3, 1.8), beak='thick')
        belly = '#f4f4f4'
    elif id == 'bird_crow':
        f = dict(headc='#20232a', beak='thick', tail=4, eyec='#7a808c')
    elif id == 'bird_woodpecker':
        f = dict(cap='#1b1b1b', headc='#f2f2f2', beak='long', beakl=3, tail=4, tailc='#222222', dots=[(7, 5, '#d12a2a'), (8, 5, '#d12a2a'), (12, 10, '#d12a2a'), (9, 8, '#f2f2f2'), (10, 9, '#f2f2f2')])
        belly = '#e8e4dc'
    elif id == 'bird_bullfinch':
        f = dict(cap='#1d1d1d', cap_y=0.2, breast='#e05a47', beak='thick', bodyr=(4.8, 3.8))
        belly = '#e05a47'
    elif id == 'bird_snow_bunting':
        f = dict(headc='#f1efe9', beak='short', dots=[(9, 7, '#8a6f52'), (10, 8, '#8a6f52'), (8, 8, '#8a6f52')])
        wing = '#8a6f52'
    elif id == 'bird_waxwing':
        f = dict(crest=[(6, 2), (7, 2), (8, 2), (8, 1), (9, 1), (10, 1)], crestc='#c49a7a', mask='#1b1b22', beak='short', dots=[(11, 9, '#e2302a'), (14, 11, '#f3c94a'), (13, 11, '#f3c94a')])
        belly = '#d9b89a'
    elif id == 'bird_kingfisher':
        f = dict(hr=3.2, head=(5.5, 6), beak='long', beakl=4, bodyr=(4, 3.2), tail=2.5, cheek='#e8823a', legs=1, leg='#e2582a',
                 dots=[(5, 4, '#7fd8ea'), (7, 4, '#7fd8ea'), (6, 3, '#7fd8ea')])
        belly = '#e8823a'
    elif id == 'bird_pheasant':
        f = dict(headc='#f5c542', crest=[(5, 2), (6, 2), (7, 2), (8, 3), (9, 3)], crestc='#f5c542', cheek='#d8342a', tail=7, tailc='#c98a3a', tail_dy=-1.2, bodyr=(4.2, 3.4), bodyc=(7.6, 9.2), beak='short')
        wing = '#2a5fa8'
    elif id == 'bird_seagull':
        f = dict(headc='#f4f4f4', beak='thick', tail=3, tailc='#2b2b2b', legs=2, leg='#e8b07a', wingr=(4, 2.2), bodyr=(5, 3.4))
        wing = '#9aa4ad'
    elif id == 'bird_sandpiper':
        f = dict(beak='long', beakl=4, legs=4, leg='#4a4a3a', bodyr=(4, 3), bodyc=(8.5, 8), head=(5.5, 5), hr=2.4, dots=[(9, 6, '#5f4f3a'), (10, 7, '#5f4f3a')])
    elif id == 'bird_parrot':
        f = dict(beak='hook', tail=6.5, tailc='#2a6fd0', tail_dy=1, wingr=(3.4, 2.4), dots=[(9, 8, '#f4c430'), (10, 8, '#f4c430'), (11, 9, '#2a6fd0'), (5, 6, '#f2f2f2')])
        belly = body
    elif id == 'bird_toucan':
        f = dict(beak='toucan', headc='#161616', breast='#f5f5f0', hr=2.6, head=(7, 5.5), bodyc=(9.5, 9), bodyr=(4, 3.6), eyering='#7bc142')
        belly = '#161616'
    elif id == 'bird_lorikeet':
        f = dict(headc='#2e5fc9', breast='#f28c28', beak='hook', tail=5, tailc='#3aa84a', dots=[(6, 8, '#e43b3b')])
        beak = '#e43b3b'; belly = '#3aa84a'; wing = '#3aa84a'
    elif id == 'bird_roadrunner':
        f = dict(crest=[(6, 2), (7, 2), (8, 3), (8, 2)], crestc='#4f4334', tail=7, tail_dy=-1.6, beak='long', beakl=3, legs=3, bodyr=(4.2, 3), dots=[(8, 8, '#e6d9bf'), (10, 8, '#e6d9bf'), (9, 9, '#4f4334')])
    elif id == 'bird_lark':
        f = dict(crest=[(6, 2), (5, 2)], beak='short', dots=[(5, 8, '#8a6f45'), (6, 9, '#8a6f45'), (9, 7, '#8a6f45'), (11, 9, '#8a6f45')])
    elif id == 'bird_hoopoe':
        f = dict(headc='#d9945a', crest=[(4, 2), (5, 1), (6, 1), (7, 1), (8, 2), (5, 2), (6, 2), (7, 2), (8, 3)], crestc='#d9945a', beak='long', beakl=4, beak_droop=0.3,
                 dots=[(5, 1, '#1f1f1f'), (6, 1, '#1f1f1f'), (7, 1, '#1f1f1f')], wingbars='#f2e3cf')
        body = '#d9945a'; belly = '#e8b88a'
    elif id == 'bird_nightjar':
        f = dict(bodyr=(5.4, 2.8), bodyc=(8.5, 10), head=(5, 8), hr=2.6, beak='short', legs=1, tail=4, tail_dy=0,
                 dots=[(5, 7, '#b8a07e'), (8, 9, '#b8a07e'), (10, 9, '#3f342a'), (12, 10, '#b8a07e'), (7, 10, '#3f342a'), (9, 11, '#b8a07e')])
    return bird(body, wing, belly, beak, f)


def save_preview(icons, path, cols=10, scale=6):
    rows = (len(icons) + cols - 1) // cols
    im = Image.new('RGBA', (cols * (N + 2) * scale, rows * (N + 2) * scale), (244, 239, 228, 255))
    for i, (iid, cv) in enumerate(icons):
        ox, oy = (i % cols) * (N + 2) + 1, (i // cols) * (N + 2) + 1
        for y in range(N):
            for x in range(N):
                c = cv.p[y][x]
                if c:
                    for sy in range(scale):
                        for sx in range(scale):
                            im.putpixel(((ox + x) * scale + sx, (oy + y) * scale + sy), hx(c) + (255,))
    im.save(path)


CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!$%&*+-/:;<=>?@^_~'

def lua_grid(cv):
    pal = {}
    rows = []
    for y in range(N):
        r = ''
        for x in range(N):
            c = cv.p[y][x]
            if not c:
                r += '.'
                continue
            if c not in pal:
                pal[c] = CHARS[len(pal)]
            r += pal[c]
        rows.append(r)
    pal_s = ', '.join(f'["{ch}"] = "{col.upper()}"' for col, ch in pal.items())
    rows_s = ',\n    '.join(f'"{r}"' for r in rows)
    return f'return {{\n  palette = {{ {pal_s} }},\n  rows = {{\n    {rows_s}\n  }}\n}}\n'


def build():
    birds = json.load(open(os.path.join(os.path.dirname(__file__), 'birds.json')))
    fish_order = json.load(open(os.path.join(os.path.dirname(__file__), 'fish.json')))
    fish_icons = []
    for fid in fish_order:
        if fid == 'fish_frog': cv = frog()
        elif fid == 'fish_eel': cv = eel('#5a5a3a', '#c8b878')
        elif fid == 'fish_oarfish': cv = eel('#c8d0d8', '#e8ecf0', crest='#e03a3a')
        else: cv = fish(FISH[fid])
        fish_icons.append((fid, cv))
    bird_icons = [(b['id'], bird_icon(b['id'], b['colors'])) for b in birds]
    return fish_icons, bird_icons


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    fi, bi = build()
    save_preview(fi, os.path.join(out, 'preview_fish.png'))
    save_preview(bi, os.path.join(out, 'preview_birds.png'))
    os.makedirs(os.path.join(out, 'grids'), exist_ok=True)
    for iid, cv in fi + bi:
        open(os.path.join(out, 'grids', f'{iid}.lua'), 'w').write(lua_grid(cv))
    print(len(fi), 'fish,', len(bi), 'birds')
