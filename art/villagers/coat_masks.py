# Marking masks shared by every coat (cats, and every other species via villager_fur.py).
# Uses P, N, part masks, flow, jit, tail_s ... from the fur script.

TC = np.array([0, 0, 0.55], np.float32)
HEAD, TORSO, EARS = is_('head'), is_('torso'), is_('earL', 'earR')
ARMS, LEGS, TAILM = is_('armL', 'armR'), is_('legL', 'legR'), is_('tail')
qh = P - H
qt = P - TC
Z = P[:, 2]
TAIL_LEN = globals().get('TAIL_LEN') or TLs[-1]
ts = np.zeros(len(P), np.float32)
ts[TAILM] = tail_s / TAIL_LEN  # 0 at the base, 1 at the tip


def C(h):
    return hexrgb(h)


def blank(h):
    return np.tile(C(h), (len(P), 1))


def put(col, mask, colour, amount=1.0):
    """Blend `colour` into col where mask (0..1, all texels) says."""
    m = np.clip(mask * amount, 0, 1)
    return col * (1 - m[:, None]) + C(colour) * m[:, None] if isinstance(colour, str) else col * (1 - m[:, None]) + colour * m[:, None]


# ── Masks (0..1 over all texels) ─────────────────────────────────────────
def muzzle(j=jit, grow=0.0):
    m = np.zeros(len(P), np.float32)
    q = qh[HEAD]; jj = j[HEAD]
    v = np.maximum(cap(q, (0, -0.9, -0.5), 0.46 + grow, 0.6 + grow, jj), cap(q, (0, -0.35, -1), 0.42 + grow, 0.58 + grow, jj))
    for s in (-1, 1):
        v = np.maximum(v, cap(q, (0.62 * s, -0.55, -0.6), 0.2 + grow, 0.32 + grow, jj))
    m[HEAD] = v
    return m


def blaze(j=jit, width=0.07):
    """A white stripe up between the eyes (tuxedo, calico)."""
    m = np.zeros(len(P), np.float32)
    q = qh[HEAD]
    w = width * sstep(0.12, -0.05, q[:, 2]) + 0.012
    m[HEAD] = sstep(w, w * 0.6, np.abs(q[:, 0]) + j[HEAD] * 0.08) * sstep(-0.1, -0.2, q[:, 1]) * sstep(0.12, 0.0, q[:, 2])
    return m


def bib(j=jit, wide=0.1, tall=0.23):
    m = np.zeros(len(P), np.float32)
    q = qt[TORSO]; jj = j[TORSO]
    ell = (q[:, 0] / (wide + 0.035 * sstep(0.15, -0.1, q[:, 2]))) ** 2 + ((q[:, 2] - 0.02) / tall) ** 2
    m[TORSO] = sstep(1.0, 0.8, ell + jj * 2.5) * sstep(-0.02, -0.09, q[:, 1])
    return m


def belly(j=jit):
    """Under the body: the whole front-lower half."""
    m = np.zeros(len(P), np.float32)
    q = qt[TORSO]
    m[TORSO] = sstep(0.0, -0.1, q[:, 1] + 0.08 * q[:, 2] / 0.23 + j[TORSO] * 0.4) * sstep(0.12, -0.05, q[:, 2])
    return np.maximum(m, bib(j))


def paws(j=jit, arm_z=0.5, leg_z=0.125):
    m = np.zeros(len(P), np.float32)
    m[ARMS] = sstep(arm_z + 0.01, arm_z - 0.025, Z[ARMS] + j[ARMS] * 0.12)
    m[LEGS] = sstep(leg_z + 0.01, leg_z - 0.025, Z[LEGS] + j[LEGS] * 0.12)
    return m


def points(face=0.95, legs=0.42, arms=0.6):
    """Colourpoint shading (Siamese, Ragdoll): darker on the face, ears, legs, paws and tail."""
    m = np.zeros(len(P), np.float32)
    q = qh[HEAD]
    d = np.linalg.norm(q - np.array([0, -0.27, -0.06]), axis=1)
    m[HEAD] = sstep(0.27, 0.05, d) * face
    m[EARS] = 1.0
    m[LEGS] = sstep(legs, 0.08, Z[LEGS])
    m[ARMS] = sstep(arms, 0.45, Z[ARMS])
    m[TAILM] = sstep(0.0, 0.5, ts[TAILM])
    return np.clip(m, 0, 1)


def blobs(seed, scale, lo, hi, warp=0.6):
    """Big soft-edged patches in 3D (calico, tortie)."""
    w = vnoise(P[:, 0] * 3 + 5, P[:, 1] * 3, P[:, 2] * 3, seed + 1) - 0.5
    n = fbm(P[:, 0] * scale + w * warp * scale, P[:, 1] * scale, P[:, 2] * scale + w * warp * scale, seed, 3)
    return sstep(lo, hi, n + jit * 0.35)


def worley(scale, seed):
    """Distance to the nearest scattered point (and that point's random value), in 3D."""
    X = P * scale
    base = np.floor(X).astype(np.int64)
    best = np.full(len(P), 9.0, np.float32)
    val = np.zeros(len(P), np.float32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = base + np.array([dx, dy, dz])
                jx = furpaint._hash(c[:, 0], c[:, 1], c[:, 2], seed)
                jy = furpaint._hash(c[:, 0], c[:, 1], c[:, 2], seed + 1)
                jz = furpaint._hash(c[:, 0], c[:, 1], c[:, 2], seed + 2)
                pt = c + np.stack([jx, jy, jz], 1) * 0.8 + 0.1
                d = np.linalg.norm(X - pt, axis=1)
                upd = d < best
                best[upd] = d[upd]
                val[upd] = furpaint._hash(c[upd, 0], c[upd, 1], c[upd, 2], seed + 3)
    return best / scale, val


def ear_tips(c, colour, amount=0.7, start=0.72):
    m = np.zeros(len(P), np.float32)
    et = globals().get('ear_t')
    if et is None:
        m[EARS] = sstep(1.27, 1.36, Z[EARS] + jit[EARS] * 0.2)
    else:
        m[EARS] = sstep(start, start + 0.12, et[EARS] + jit[EARS] * 0.2)
    return put(c, m, colour, amount)


def head_stripes(c, colour, amount=0.9, j=jit):
    m = np.zeros(len(P), np.float32)
    q = qh[HEAD]; jj = j[HEAD]
    mz = muzzle(j)[HEAD]
    top = sstep(-0.02, 0.1, q[:, 2]) * (1 - mz)
    st = sstep(0.62, 0.86, np.cos(q[:, 0] * 57 + jj * 6)) * top * sstep(-0.3, -0.18, -np.abs(q[:, 0]))
    ch = sstep(0.62, 0.88, np.cos((q[:, 2] + 0.03) * 75 + jj * 5)) * sstep(0.2, 0.28, np.abs(q[:, 0])) * sstep(-0.13, -0.07, q[:, 2]) * sstep(0.07, 0.02, q[:, 2]) * sstep(0.05, -0.05, q[:, 1])
    m[HEAD] = np.maximum(st, ch)
    return put(c, m, colour, amount)


def limb_rings(c, colour, amount=0.8, j=jit):
    m = np.zeros(len(P), np.float32)
    for mm, zc in ((ARMS, 0.5), (LEGS, 0.125)):
        m[mm] = sstep(0.66, 0.88, np.cos(Z[mm] * 44 + j[mm] * 4)) * sstep(zc + 0.03, zc + 0.07, Z[mm])
    return put(c, m, colour, amount)


def tail_rings(c, colour, tip=None, amount=0.85, freq=30):
    m = np.zeros(len(P), np.float32)
    m[TAILM] = sstep(0.6, 0.86, np.cos(tail_s * freq + jit[TAILM] * 4))
    c = put(c, m, colour, amount)
    if tip:
        t = np.zeros(len(P), np.float32)
        t[TAILM] = sstep(0.82, 0.92, ts[TAILM])
        c = put(c, t, tip, 0.9)
    return c


def mackerel(c, colour, amount=0.85, n=7):
    m = np.zeros(len(P), np.float32)
    q = qt[TORSO]
    th = np.arctan2(q[:, 0], q[:, 1])
    back = sstep(-0.6, 0.1, np.cos(th))
    m[TORSO] = sstep(0.6, 0.86, np.cos(th * n + 1.2 * vnoise(P[TORSO][:, 0] * 5, P[TORSO][:, 1] * 5, P[TORSO][:, 2] * 5, 9) + jit[TORSO] * 5)) * back
    return put(c, m, colour, amount)


def _face_pt(d):
    hp = globals().get('head_point')
    return np.array(hp(d)[0], np.float32) if hp else None


def blush(c, colour='#f6a99a', amount=0.6, size=0.07):
    m = np.zeros(len(P), np.float32)
    for s in (-1, 1):
        q = _face_pt((0.55 * s, -0.78, -0.2))
        if q is None:
            q = np.array([0.2 * s, -0.235, 0.9])
        b = np.linalg.norm(P - q, axis=1)
        m = np.maximum(m, sstep(size, size * 0.2, b) * HEAD)
    return put(c, m, colour, amount)


def whisker_dots(c, colour):
    m = np.zeros(len(P), np.float32)
    for s in (-1, 1):
        for dx, dz in ((0.07, 0.925), (0.105, 0.93), (0.09, 0.905)):
            q = _face_pt((dx * s / 0.33, -0.95, (dz - 0.98) / 0.29)) if 'head_point' in globals() else None
            dd = np.linalg.norm(P - (q if q is not None else np.array([dx * s, -0.292, dz])), axis=1)
            m = np.maximum(m, sstep(0.01, 0.006, dd) * HEAD)
    return put(c, m, colour)



def under(j=jit):
    """Chin, throat, chest and belly (light undersides of foxes, wolves, deer)."""
    return np.maximum.reduce([muzzle(j), belly(j)])


def socks(c, colour, leg_z=0.24, arm_z=0.56, amount=1.0):
    return put(c, paws(arm_z=arm_z, leg_z=leg_z), colour, amount)


def back(lo=-0.05, hi=0.12):
    m = np.zeros(len(P), np.float32)
    m[TORSO] = sstep(lo, hi, qt[TORSO][:, 1] + jit[TORSO] * 0.4)
    return m


def tail_tip(c, colour, start=0.78, amount=1.0):
    m = np.zeros(len(P), np.float32)
    m[TAILM] = sstep(start, start + 0.1, ts[TAILM] + jit[TAILM] * 0.3)
    return put(c, m, colour, amount)


def ear_backs(c, colour, amount=0.9):
    m = np.zeros(len(P), np.float32)
    m[EARS] = sstep(-0.01, 0.02, N[EARS][:, 1])  # the side facing away
    return put(c, m, colour, amount)


def spots(scale, seed, size, region):
    d, v = worley(scale, seed)
    return sstep(size * (0.7 + 0.5 * v), size * (0.4 + 0.3 * v), d) * region
