"""Three generic ambient fish (small / medium / large) with a looping swim cycle.

Geometry: convex parts (kit). Animation: three morph targets / shape keys
  swim_a, swim_b  - travelling body wave: x += A(u) * (sin(wt) * cos(ku) - cos(wt) * sin(ku))
                    -> weights a = sin(wt), b = -cos(wt) with targets A*cos(ku), A*sin(ku)
  fins            - pectoral fin flap (weight 0..1)
Coordinates: game units (tiles), y up, +z = forward (nose), origin at body centre.
"""
import math
from kit import Kit

FISH = {
    # name: length, depth, width, colours (back, side, belly, fins), cycle seconds, tail amplitude (fraction of length), fin rate
    'ambient_fish_small': dict(L=0.22, D=0.2, W=0.11, back='#2f6f9a', side='#b9d3e0', belly='#eef4f6', fins='#9fb9c8', accent='#3fa7d6',
                               cycle=0.45, amp=0.11, tail='fork', dorsal=0.5),
    'ambient_fish_medium': dict(L=0.5, D=0.3, W=0.13, back='#2e7a6e', side='#8fc4b4', belly='#e8f0e2', fins='#e0b84a', accent='#f2d36a',
                                cycle=0.75, amp=0.09, tail='fork', dorsal=0.75),
    'ambient_fish_large': dict(L=1.1, D=0.24, W=0.15, back='#26405e', side='#7d95ab', belly='#e2e8ee', fins='#3e5a78', accent='#c9d6e2',
                               cycle=1.2, amp=0.075, tail='lunate', dorsal=0.6),
}

RINGS = 13
SHADOW = '#1c2630'


def body_profile(f, blunt):
    # f: 0 = tail root, 1 = nose. Peak a little ahead of the middle.
    p = math.log(0.5) / math.log(0.58)
    r = math.sin(math.pi * (f ** p)) ** 0.7
    if f > 0.85:
        r = max(r, blunt * (1 - ((f - 0.85) / 0.15) ** 2) + 0.12)
    return max(r, 0.2 * (1 - f) + 0.04)


def build_one(S):
    k = Kit(scale=S['L'])
    D, W = S['D'], S['W']
    fs = [i / (RINGS - 1) for i in range(RINGS)]
    zs = [-0.42 + f * 0.86 for f in fs]
    rings = [(z, W / 2 * body_profile(f, 0.35), D / 2 * body_profile(f, 0.35), 0.0) for f, z in zip(fs, zs)]
    k.loft('body', SHADOW, rings, seg=12)
    nose = zs[-1]
    top = lambda z: max(h for (zz, w, h, _) in rings if abs(zz - z) < 0.08)
    # Dorsal, anal and pelvic fins.
    dh = D * S['dorsal']
    k.fin('fin', SHADOW, [(0, top(0.08) * 0.9, 0.1), (0, top(-0.14) * 0.9, -0.14), (0, top(-0.04) + dh * 0.6, -0.1), (0, top(0.04) + dh * 0.7, 0.02)], t=0.012)
    k.fin('fin', SHADOW, [(0, -top(-0.1) * 0.9, -0.06), (0, -top(-0.24) * 0.9, -0.25), (0, -top(-0.2) - D * 0.25, -0.22)], t=0.01)
    # Pectoral fins (own material so they can flap).
    for s in (-1, 1):
        px = [w for (z, w, h, _) in rings if abs(z - (nose - 0.17)) < 0.05][0]
        k.fin('pfin', SHADOW, [(s * px * 0.85, -D * 0.06, nose - 0.15), (s * px * 0.85, -D * 0.14, nose - 0.2), (s * (px + 0.09), -D * 0.24, nose - 0.31), (s * (px + 0.07), -D * 0.08, nose - 0.27)], t=0.008)
    # Tail.
    tz = zs[0]
    th = rings[1][2]
    if S['tail'] == 'fork':
        for sy in (1, -1):
            k.fin('tail', SHADOW, [(0, sy * th * 0.4, tz + 0.03), (0, sy * D * 0.62, tz - 0.19), (0, sy * D * 0.14, tz - 0.11), (0, 0, tz - 0.07)], t=0.012)
    else:
        for sy in (1, -1):
            k.fin('tail', SHADOW, [(0, sy * th * 0.4, tz + 0.03), (0, sy * D * 0.85, tz - 0.17), (0, sy * D * 0.62, tz - 0.13), (0, 0, tz - 0.04)], t=0.012)
    return k


def deform(p, S, phase):
    """Swim displacement (model units already scaled by L) – used only for the local preview."""
    L = S['L']
    nose = 0.44 * L
    u = (nose - p[2]) / L  # 0 at the nose, ~1.1 at the tail tip
    A = S['amp'] * L * (0.06 + 0.94 * max(0.0, u) ** 2)
    kk = 2 * math.pi / 1.15
    return (p[0] + A * math.sin(phase - kk * u), p[1], p[2])


def build():
    return {n: build_one(S) for n, S in FISH.items()}
