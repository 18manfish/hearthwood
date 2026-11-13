"""Looping school of small fish: deterministic, seamless (all motion uses whole harmonics of the loop)."""
import math

T = 10.0          # loop length, seconds
FPS = 24
NF = int(T * FPS)  # frames per loop (frame NF == frame 0)
A_X, A_Z = 2.2, 1.7   # figure-8 size (tiles)
SWIM_CYCLE = 0.45     # tail-beat period of the small fish at cruising speed


def rnd(i, j):
    x = math.sin(i * 127.1 + j * 311.7) * 43758.5453
    return x - math.floor(x)


def slots(n=24):
    """Home positions in the school frame (right, up, forward) – a loose lens shape."""
    out = []
    rows, lanes, layers = 4, 3, 2
    for r in range(rows):
        for l in range(lanes):
            for y in range(layers):
                i = len(out)
                f = (1.5 - r) * 0.22 + (rnd(i, 1) - 0.5) * 0.05
                s = (l - 1) * 0.16 + (r % 2) * 0.07 + (rnd(i, 2) - 0.5) * 0.04
                u = (y - 0.5) * 0.11 + (rnd(i, 3) - 0.5) * 0.03
                out.append((s, u, f))
    return out[:n]


def centre(t):
    """School centre on a figure-8 (lemniscate of Gerono) with a gentle rise and fall."""
    a = 2 * math.pi * t / T
    return (A_X * math.sin(a), 0.06 * math.sin(2 * a + 0.7), A_Z * math.sin(a) * math.cos(a))


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def norm(v):
    l = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / l, v[1] / l, v[2] / l)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def school_frame(t):
    dt = 1e-3
    f = norm(sub(centre(t + dt), centre(t - dt)))
    r = norm(cross((0, 1, 0), f))
    u = cross(f, r)
    return r, u, f


def fish_pos(i, slot, t):
    c = centre(t)
    r, u, f = school_frame(t)
    a = 2 * math.pi * t / T
    # Each fish wanders around its slot (whole harmonics of the loop so it repeats).
    w = [0.03 * math.sin(k * a + rnd(i, 10 + k) * 6.28) for k in (2, 3, 5)]
    s0, u0, f0 = slot
    s0 += w[0]
    u0 += 0.6 * w[1]
    f0 += w[2]
    return (c[0] + r[0] * s0 + u[0] * u0 + f[0] * f0,
            c[1] + r[1] * s0 + u[1] * u0 + f[1] * f0,
            c[2] + r[2] * s0 + u[2] * u0 + f[2] * f0)


def fish_state(i, slot, t):
    """Position, orientation axes (right, up, forward in game coords) and speed."""
    dt = 1.0 / FPS / 4
    p = fish_pos(i, slot, t)
    pa, pb = fish_pos(i, slot, t - dt), fish_pos(i, slot, t + dt)
    v = sub(pb, pa)
    speed = math.sqrt(sum(c * c for c in v)) / (2 * dt)
    f = norm(v)
    # Bank into turns: compare heading a little later.
    f2 = norm(sub(fish_pos(i, slot, t + 4 * dt + dt), fish_pos(i, slot, t + 4 * dt - dt)))
    turn = cross(f, f2)[1]  # >0 turning left
    roll = max(-0.5, min(0.5, -turn * 60))
    r = norm(cross((0, 1, 0), f))
    u = cross(f, r)
    cr, sr = math.cos(roll), math.sin(roll)
    r, u = (tuple(r[k] * cr + u[k] * sr for k in range(3)), tuple(u[k] * cr - r[k] * sr for k in range(3)))
    return p, r, u, f, speed


def tail_cycles(i):
    """Whole number of tail beats per loop, varied per fish."""
    base = T / SWIM_CYCLE
    return int(round(base)) + int(rnd(i, 20) * 5) - 2


def quat_from_axes(r, u, f):
    """Quaternion (w, x, y, z) for a rotation whose columns are r, u, f (local x, y, z)."""
    m00, m01, m02 = r[0], u[0], f[0]
    m10, m11, m12 = r[1], u[1], f[1]
    m20, m21, m22 = r[2], u[2], f[2]
    tr = m00 + m11 + m22
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        return (0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s)
    if m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2
        return ((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s)
    if m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2
        return ((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s)
    s = math.sqrt(1.0 + m22 - m00 - m11) * 2
    return ((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s)


def frames(n=24):
    """All keyframes: per fish lists of (pos, quat_wxyz, weights)."""
    sl = slots(n)
    out = []
    for i, s in enumerate(sl):
        keys = []
        nc = tail_cycles(i)
        ph0 = rnd(i, 30) * 2 * math.pi
        prev = None
        for fr in range(NF + 1):
            t = fr / FPS
            p, r, u, f, sp = fish_state(i, s, t)
            q = quat_from_axes(r, u, f)
            if prev and sum(a * b for a, b in zip(q, prev)) < 0:
                q = tuple(-c for c in q)
            prev = q
            ph = ph0 + 2 * math.pi * nc * t / T
            keys.append((p, q, (math.sin(ph), -math.cos(ph), 0.5 + 0.5 * math.sin(2 * ph))))
        out.append(keys)
    return out
