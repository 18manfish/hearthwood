import math


def rot3(p, r):
    x, y, z = p
    rx, ry, rz = r
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


def frame(d):
    l = math.sqrt(sum(c * c for c in d)) or 1.0
    d = (d[0] / l, d[1] / l, d[2] / l)
    a = (0.0, 1.0, 0.0) if abs(d[1]) < 0.9 else (1.0, 0.0, 0.0)
    u = (d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0])
    lu = math.sqrt(sum(c * c for c in u))
    u = (u[0] / lu, u[1] / lu, u[2] / lu)
    v = (d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0])
    return d, u, v


class Rng:
    def __init__(self, seed):
        self.s = (seed * 2654435761 + 1) % 4294967296

    def r(self):
        self.s = (1103515245 * self.s + 12345) % 2147483648
        return self.s / 2147483648

    def u(self, a, b):
        return a + (b - a) * self.r()


class Kit:
    """Convex parts grouped into pivoting nodes. Points are model coordinates (y up, +z forward)."""

    def __init__(self, scale=1.0):
        self.parts = []
        self.pivots = {'main': (0.0, 0.0, 0.0)}
        self.scale = scale

    def pivot(self, g, p):
        self.pivots[g] = tuple(c * self.scale for c in p)

    def add(self, role, color, pts, g='main'):
        s = self.scale
        self.parts.append((g, role, color.lower(), [(p[0] * s, p[1] * s, p[2] * s) for p in pts]))

    def box(self, role, color, a, b, g='main'):
        self.add(role, color, [(x, y, z) for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])], g)

    def rbox(self, role, color, c, size, r=(0, 0, 0), g='main'):
        h = [v / 2 for v in size]
        pts = []
        for x in (-h[0], h[0]):
            for y in (-h[1], h[1]):
                for z in (-h[2], h[2]):
                    q = rot3((x, y, z), r)
                    pts.append((q[0] + c[0], q[1] + c[1], q[2] + c[2]))
        self.add(role, color, pts, g)

    def ell(self, role, color, c, rad, r=(0, 0, 0), seg=10, rings=6, g='main'):
        pts = []
        for j in range(rings + 1):
            phi = math.pi * j / rings
            n = 1 if j in (0, rings) else seg
            for i in range(n):
                a = 2 * math.pi * i / seg + (j % 2) * math.pi / seg
                q = (math.sin(phi) * math.cos(a) * rad[0], math.cos(phi) * rad[1], math.sin(phi) * math.sin(a) * rad[2])
                q = rot3(q, r)
                pts.append((q[0] + c[0], q[1] + c[1], q[2] + c[2]))
        self.add(role, color, pts, g)

    def rod(self, role, color, a, b, ra, rb=None, seg=8, g='main'):
        rb = ra if rb is None else rb
        d, u, v = frame((b[0] - a[0], b[1] - a[1], b[2] - a[2]))
        pts = []
        for i in range(seg):
            t = 2 * math.pi * i / seg
            cu, cv = math.cos(t), math.sin(t)
            for p, r in ((a, ra), (b, rb)):
                if r > 0:
                    pts.append(tuple(p[k] + (u[k] * cu + v[k] * cv) * r for k in range(3)))
        if ra <= 0:
            pts.append(tuple(a))
        if rb <= 0:
            pts.append(tuple(b))
        self.add(role, color, pts, g)

    def cyl(self, role, color, c, y0, y1, r, rt=None, seg=10, g='main'):
        self.rod(role, color, (c[0], y0, c[1]), (c[0], y1, c[1]), r, r if rt is None else rt, seg, g)

    def blob(self, role, color, c, rad, seed, n=14, g='main'):
        rng = Rng(seed)
        pts = []
        for i in range(n):
            z = rng.u(-1, 1)
            a = rng.u(0, 2 * math.pi)
            s = math.sqrt(max(0.0, 1 - z * z))
            k = rng.u(0.8, 1.05)
            pts.append((c[0] + s * math.cos(a) * rad[0] * k, c[1] + z * rad[1] * k, c[2] + s * math.sin(a) * rad[2] * k))
        self.add(role, color, pts, g)

    def poly(self, role, color, pts2, x0, x1, g='main'):
        # Prism: (z, y) outline extruded along x.
        self.add(role, color, [(x, y, z) for (z, y) in pts2 for x in (x0, x1)], g)

    def fin(self, role, color, pts, t=0.01, g='main'):
        # Thin plate from a planar outline (any plane): thickness along the outline's normal.
        a, b, c = pts[0], pts[1], pts[2]
        u = [b[i] - a[i] for i in range(3)]
        v = [c[i] - a[i] for i in range(3)]
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        ln = math.sqrt(sum(x * x for x in n)) or 1.0
        n = [x / ln * t / 2 for x in n]
        self.add(role, color, [tuple(p[i] + s * n[i] for i in range(3)) for p in pts for s in (-1, 1)], g)

    def loft(self, role, color, rings, seg=10, g='main', only=None):
        # rings: list of (z, half_width, half_height, y_centre); one convex hull per neighbouring pair.
        def ring(z, w, h, yc):
            return [(math.cos(2 * math.pi * i / seg) * w, yc + math.sin(2 * math.pi * i / seg) * h, z) for i in range(seg)]
        for i in range(len(rings) - 1):
            if only is not None and i not in only:
                continue
            self.add(role, color, ring(*rings[i]) + ring(*rings[i + 1]), g)

    def fingerprint(self):
        return [len(self.parts), sum(len(p) for *_, p in self.parts), round(sum(x * 1.1 + y * 2.3 + z * 3.7 for *_, p in self.parts for (x, y, z) in p), 3)]
