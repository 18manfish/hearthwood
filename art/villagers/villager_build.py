# Build a villager of species SPECIES_NAME (set by the caller) in Blender: the shared
# body, the species' head, ears, snout, nose or beak, tail, and the face sets the
# animations switch between. Every species gets the same node names (earL/earR and tail
# exist even when empty) so one set of animations drives them all.
import bpy, bmesh, math, sys, importlib
from mathutils import Vector, Matrix

sys.path.insert(0, ART + r'\villagers')
import vlib, species
importlib.reload(vlib)
importlib.reload(species)
from vlib import *

SPEC = dict(species.SPECIES[SPECIES_NAME])
clear_scene()

FUR = flat_mat('fur', '#c0a080', 0.85)
PINK = flat_mat('pink', '#f3a3b0', 0.6)
EYE = flat_mat('eye', '#1c1418', 0.18)
WHITE = flat_mat('shine', '#ffffff', 0.3)
INK = flat_mat('ink', '#4a2a1e', 0.7)
MOUTH_IN = flat_mat('mouth_in', '#6b2430', 0.6)
TONGUE = flat_mat('tongue', '#f08c9c', 0.5)

root = empty('villager')
body = empty('body', parent=root)
FUR_PARTS = []

# ── Head ──────────────────────────────────────────────────────────────────
HC = PIV['head']
R = Vector(SPEC['R'])
SNOUT_AMP, SNOUT_W = SPEC.get('snout', (0.03, 0.2))
SNOUT_D = Vector(SPEC.get('snout_d', (0, -0.95, -0.3))).normalized()
CHEEKS = SPEC.get('cheeks', 0.0)
TUFTS = [Vector(v) for v in ((0.93, -0.3, -0.32), (0.82, -0.25, -0.55))] if SPEC.get('tufts') else []
EYE_D = Vector(SPEC.get('eye_d', (0.40, -0.86, 0.10)))


def head_fn(d):
    r = Vector((R.x * (1 + 0.07 * max(0, -d.z) - 0.03 * max(0, d.z)), R.y, R.z * (0.95 if d.z > 0 else 1)))
    p = Vector((d.x * r.x, d.y * r.y, d.z * r.z))
    out = 0.0
    for t in TUFTS:
        for s in (-1, 1):
            out += 0.045 * gauss(d, Vector((t.x * s, t.y, t.z)), 0.09)
    if SPEC.get('pads'):
        for s in (-1, 1):
            out += 0.032 * gauss(d, Vector((0.17 * s, -0.95, -0.30)), 0.16)
        out += 0.02 * gauss(d, Vector((0, -0.85, -0.55)), 0.18)
    if SNOUT_AMP > 0.05:
        out += SNOUT_AMP * gauss(d, SNOUT_D, SNOUT_W)
        out += SNOUT_AMP * 0.35 * gauss(d, SNOUT_D + Vector((0, 0, -0.25)), SNOUT_W * 0.9)  # lower jaw
    if CHEEKS:
        for s in (-1, 1):
            out += CHEEKS * gauss(d, Vector((0.7 * s, -0.55, -0.42)), 0.4)
    if SPEC.get('frog_eyes'):
        for s in (-1, 1):
            out += 0.1 * gauss(d, Vector((EYE_D.x * s, EYE_D.y, EYE_D.z)), 0.3)
    out -= 0.025 * gauss(d, Vector((0, -1, 0.15)), 0.5)
    return HC + p + d * out


def head_point(d, lift=0.0):
    d = Vector(d).normalized()
    p = head_fn(d)
    e = 1e-3
    n = (head_fn((d + Vector((e, 0, 0))).normalized()) - p).cross(head_fn((d + Vector((0, 0, e))).normalized()) - p).normalized()
    if n.dot(d) < 0:
        n = -n
    return p + n * lift, n


def oriented(bm, pos, normal, up=Vector((0, 0, 1))):
    z = normal.normalized()
    x = up.cross(z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(pos) @ m, verts=bm.verts)
    return bm


def frame_at(n):
    z = n.normalized()
    x = Vector((0, 0, 1)).cross(z).normalized()
    return x, z.cross(x)


head = finish('head', blob(head_fn, 40, 26), HC, body, mat=FUR)
FUR_PARTS.append(head)


def null(name, loc, parent):
    """An empty node (keeps the node name animations target, for species without the part)."""
    return empty(name, loc, parent)


# Eyes: big glossy ovals with two highlights each (shineL0, shineL1, ...).
ES = SPEC.get('eye_s', 1.0)
for s, side in ((-1, 'L'), (1, 'R')):
    p, n = head_point((EYE_D.x * s, EYE_D.y, EYE_D.z), -0.006)
    eb = sphere_bm(20, 14)
    bmesh.ops.scale(eb, vec=(0.064 * ES, 0.094 * ES, 0.03), verts=eb.verts)
    finish('eye' + side, oriented(eb, p, n), p, head, subd=1, mat=EYE)
    for k, (off, rad) in enumerate((((0.025 * s, 0.035), 0.022), ((-0.022 * s, -0.035), 0.011))):
        q = p + n * 0.026 + Vector((off[0] * ES, 0, off[1] * ES))
        hb = sphere_bm(12, 8)
        bmesh.ops.scale(hb, vec=(rad * ES, rad * ES, rad * 0.4), verts=hb.verts)
        finish(f'shine{side}{k}', oriented(hb, q, n), q, head, subd=1, mat=WHITE)


def face_tube(name, d, pts_uv, bevel, mat, lift=0.007):
    p, n = head_point(d, lift)
    x, y = frame_at(n)
    pts = [head_point((p + x * u + y * v - HC).normalized(), lift)[0] for u, v in pts_uv]
    o = tube(name, pts, [1.0] * len(pts), bevel, head, mat, res=3)
    set_origin(o, p)
    return o


for s, side in ((-1, 'L'), (1, 'R')):
    d = (EYE_D.x * s, EYE_D.y, EYE_D.z)
    face_tube('eyeHappy' + side, d, [(u * ES, (0.026 * (1 - (u / 0.058) ** 2) - 0.006) * ES) for u in (-0.058, -0.03, 0, 0.03, 0.058)], 0.0105, INK)
    face_tube('brow' + side, d, [(-s * 0.03 * ES, 0.128 * ES), (0, 0.118 * ES), (s * 0.045 * ES, 0.098 * ES)], 0.0085, INK)

# Nose
NOSE = SPEC.get('nose')
NOSE_D = Vector(SPEC.get('nose_d', (0, -0.97, -0.14)))
if NOSE:
    kind, col, size = NOSE
    nm = flat_mat('nose', col, 0.45)
    p, n = head_point(NOSE_D, -0.004)
    nb = sphere_bm(16, 10)
    for v in nb.verts:
        c = v.co
        if kind == 'tri':
            w = size * (1 - 0.45 * max(0, -c.y))
            v.co = Vector((c.x * w, c.y * size * 0.66, c.z * size * 0.52))
        elif kind == 'koala':
            v.co = Vector((c.x * 0.075, c.y * 0.1, c.z * 0.055))
        else:
            v.co = Vector((c.x * size, c.y * size * 0.75, c.z * size * 0.7))
    finish('nose', oriented(nb, p, n), p, head, subd=1, mat=nm)
NOSE_TIP = head_point(NOSE_D)[0] if NOSE else head_point(SNOUT_D)[0]

# Beak (birds) instead of nose and mouth
BEAK = SPEC.get('beak')
if BEAK:
    kind, col = BEAK
    bm_ = flat_mat('beak', col, 0.45)
    if kind == 'bill':
        p, n = head_point((0, -0.97, -0.2), -0.03)
        b = sphere_bm(20, 12)
        for v in b.verts:
            c = v.co
            v.co = Vector((c.x * 0.1 * (1 - 0.15 * c.y), c.y * 0.075 - 0.07, c.z * 0.03 + 0.012 * c.y * c.y))
    elif kind == 'point':
        p, n = head_point((0, -0.97, -0.18), -0.02)
        b = sphere_bm(16, 10)
        for v in b.verts:
            c = v.co
            t = (c.y + 1) / 2
            v.co = Vector((c.x * 0.045 * (0.3 + 0.7 * t), c.y * 0.06 - 0.05, c.z * 0.035 * (0.3 + 0.7 * t)))
    else:  # hook (owl)
        p, n = head_point((0, -0.98, -0.12), -0.02)
        b = sphere_bm(16, 10)
        for v in b.verts:
            c = v.co
            t = (1 - c.z) / 2
            v.co = Vector((c.x * 0.03 * (1 - 0.7 * t), c.y * 0.035 - 0.03 - 0.02 * t, c.z * 0.055))
    # beak meshes are built pointing along -y; place them at p (no extra orientation)
    bmesh.ops.translate(b, vec=p, verts=b.verts)
    finish('beak', b, p, head, subd=1, mat=bm_)
    NOSE_TIP = p + Vector((0, -0.08, 0))

# Mouths (all species get the nodes; birds' are empty)
MOUTH_D = Vector(SPEC.get('mouth_d', (0, -0.97, -0.30)))
MW = SPEC.get('mouth_w', 1.0)
if SPEC.get('mouth', True):
    pts = []
    for t in (-1, -0.5, 0, 0.5, 1):
        dd = Vector((0.09 * t * MW, MOUTH_D.y, MOUTH_D.z + 0.045 * abs(t) - 0.03 * (1 - abs(abs(t) - 0.5) * 2) + 0.02 * (t == 0)))
        pts.append(head_point(dd, 0.004)[0])
    mo = tube('mouth', pts, [1.0, 1, 1, 1, 0.6][:5], 0.0065, head, INK, res=2)
    set_origin(mo, head_point(MOUTH_D)[0])
    p, n = head_point(MOUTH_D, -0.002)
    mb = sphere_bm(20, 12)
    for v in mb.verts:
        c = v.co
        v.co = Vector((c.x * 0.058 * MW, c.y * 0.014, min(c.z, 0.15) * 0.05))
    mopen = finish('mouthOpen', oriented(mb, p, n), p, head, subd=1, mat=MOUTH_IN)
    tb = sphere_bm(14, 10)
    for v in tb.verts:
        c = v.co
        v.co = Vector((c.x * 0.032 * MW, c.y * 0.01, c.z * 0.02 - 0.024))
    finish('tongue', oriented(tb, p + n * 0.006, n), p, mopen, subd=1, mat=TONGUE)
    ob = sphere_bm(16, 10)
    bmesh.ops.scale(ob, vec=(0.026, 0.012, 0.032), verts=ob.verts)
    finish('mouthO', oriented(ob, head_point(MOUTH_D, -0.002)[0], n), p, head, subd=1, mat=MOUTH_IN)
    p, n = head_point(MOUTH_D, 0.004)
    x, y = frame_at(n)
    pts = [head_point((p + x * u * MW + y * (-0.012 + 0.016 * (1 - (u / 0.042) ** 2)) - HC).normalized(), 0.004)[0] for u in (-0.042, -0.02, 0, 0.02, 0.042)]
    ms = tube('mouthSad', pts, [0.7, 1, 1, 1, 0.7], 0.0065, head, INK, res=2)
    set_origin(ms, p)
else:
    for nm_ in ('mouth', 'mouthOpen', 'mouthO', 'mouthSad'):
        null(nm_, head_point(MOUTH_D)[0], head)

# ── Ears ──────────────────────────────────────────────────────────────────
EARS = SPEC.get('ears')


def cone_ear(r1, depth, thick, curl=0.12):
    eb = bmesh.new()
    bmesh.ops.create_cone(eb, cap_ends=True, segments=20, radius1=r1, radius2=0.012, depth=depth)
    for v in eb.verts:
        c = v.co
        z = c.z + depth / 2
        v.co = Vector((c.x, c.y * thick, z))
        v.co.y -= curl * (z / depth) ** 2 * depth
    return eb


def disc_ear(r, thick):
    eb = sphere_bm(20, 12)
    for v in eb.verts:
        c = v.co
        v.co = Vector((c.x * r, c.y * thick, c.z * r * 1.0 + r * 0.8))
    return eb


def long_ear(length, width, thick):
    eb = sphere_bm(20, 16)
    for v in eb.verts:
        c = v.co
        t = (c.z + 1) / 2
        v.co = Vector((c.x * width * (0.75 + 0.5 * math.sin(t * math.pi)), c.y * thick, t * length))
    return eb


EAR_DEF = {
    #  kind: (builder, inner builder or None, base dir, tilt out (rad), tilt fwd)
    'cat': (lambda: cone_ear(0.14, 0.25, 0.62), lambda: cone_ear(0.09, 0.18, 0.25), (0.52, 0.02, 0.85), -0.42, 0.12),
    'fox': (lambda: cone_ear(0.16, 0.33, 0.55), lambda: cone_ear(0.1, 0.25, 0.22), (0.48, 0.02, 0.86), -0.3, 0.08),
    'wolf': (lambda: cone_ear(0.15, 0.27, 0.6), lambda: cone_ear(0.095, 0.2, 0.24), (0.5, 0.02, 0.85), -0.34, 0.1),
    'squirrel': (lambda: cone_ear(0.1, 0.24, 0.55, 0.05), lambda: cone_ear(0.06, 0.15, 0.22), (0.45, 0.04, 0.88), -0.2, 0.05),
    'tufts': (lambda: cone_ear(0.075, 0.17, 0.4, 0.0), None, (0.6, -0.1, 0.78), 0.45, -0.1),
    'round': (lambda: disc_ear(0.09, 0.05), lambda: disc_ear(0.055, 0.02), (0.62, 0.0, 0.76), 0.4, 0.0),
    'round_small': (lambda: disc_ear(0.075, 0.045), lambda: disc_ear(0.045, 0.02), (0.6, 0.0, 0.78), 0.4, 0.0),
    'koala': (lambda: disc_ear(0.15, 0.07), lambda: disc_ear(0.1, 0.03), (0.86, 0.05, 0.42), 1.05, 0.0),
    'long': (lambda: long_ear(0.44, 0.075, 0.045), lambda: long_ear(0.36, 0.045, 0.02), (0.3, 0.05, 0.95), 0.14, -0.08),
    'deer': (lambda: long_ear(0.24, 0.085, 0.035), lambda: long_ear(0.19, 0.05, 0.015), (0.8, 0.05, 0.5), 1.15, 0.1),
    'floppy': (lambda: long_ear(0.3, 0.095, 0.045), lambda: None, (0.84, 0.02, 0.45), 2.7, 0.15),
}
EAR_PARTS = []
for s, side in ((-1, 'L'), (1, 'R')):
    if not EARS:
        null('ear' + side, HC + Vector((0.25 * s, 0, 0.2)), head)
        continue
    build, inner, bd, tilt, fwd = EAR_DEF[EARS]
    base, n = head_point((bd[0] * s, bd[1], bd[2]), -0.05)
    rot = Matrix.Rotation(tilt * s, 4, 'Y') @ Matrix.Rotation(fwd, 4, 'X')
    eb = build()
    bmesh.ops.transform(eb, matrix=Matrix.Translation(base) @ rot, verts=eb.verts)
    ear = finish('ear' + side, eb, base, head, subd=2, mat=FUR)
    EAR_PARTS.append(ear)
    ib = inner() if inner else None
    if ib:
        bmesh.ops.transform(ib, matrix=Matrix.Translation(base) @ rot @ Matrix.Translation((0, -0.03 if EARS not in ('long', 'deer') else -0.025, 0.03 if EARS not in ('round', 'round_small', 'koala') else 0.01)), verts=ib.verts)
        finish('earIn' + side, ib, base, ear, subd=2, mat=PINK)
FUR_PARTS += EAR_PARTS

# ── Body (shared by every species) ───────────────────────────────────────
TC = Vector((0, 0, 0.55))


def torso_fn(d):
    widen = 1 + 0.2 * max(0, -d.z) - 0.1 * max(0, d.z) - 0.12 * max(0, d.z - 0.75) * 4
    r = Vector((0.205 * widen, 0.17 * widen * (1.05 if d.y < 0 else 1), 0.235))
    return TC + Vector((d.x * r.x, d.y * r.y, d.z * r.z))


FUR_PARTS.append(finish('torso', blob(torso_fn, 32, 20), (0, 0, 0.36), body, mat=FUR))
ARM_A, ARM_B, ARM_R0, ARM_R1 = (0.13, 0.0, 0.71), (0.285, -0.035, 0.475), 0.078, 0.056
PIV['armL'] = Vector((-0.15, 0, 0.705)); PIV['armR'] = Vector((0.15, 0, 0.705))
WING = SPEC.get('arms') == 'wing'
for s, side in ((-1, 'L'), (1, 'R')):
    a = capsule((ARM_A[0] * s, ARM_A[1], ARM_A[2]), (ARM_B[0] * s, ARM_B[1], ARM_B[2]), ARM_R0, ARM_R1)
    if WING:
        # flatter, a bit broader, no round paw: a wing that still holds things
        for v in a.verts:
            v.co.y = v.co.y * 0.55
            v.co.x = (v.co.x - ARM_A[0] * s) * 1.12 + ARM_A[0] * s
        arm_bm = a
    else:
        paw = sphere_bm(20, 14)
        bmesh.ops.scale(paw, vec=(0.066, 0.064, 0.07), verts=paw.verts)
        bmesh.ops.translate(paw, vec=(ARM_B[0] * s + 0.004 * s, ARM_B[1] - 0.004, ARM_B[2] - 0.012), verts=paw.verts)
        arm_bm = merge(a, paw)
    FUR_PARTS.append(finish('arm' + side, arm_bm, PIV['arm' + side], body, mat=FUR))
    leg = capsule((0.1 * s, 0, 0.35), (0.1 * s, -0.005, 0.1), 0.088, 0.08)
    foot = sphere_bm(20, 14)
    web = SPEC.get('feet') == 'web'
    bmesh.ops.scale(foot, vec=(0.1 if web else 0.088, 0.14 if web else 0.125, 0.05 if web else 0.062), verts=foot.verts)
    bmesh.ops.translate(foot, vec=(0.1 * s, -0.05 if web else -0.04, 0.05 if web else 0.058), verts=foot.verts)
    FUR_PARTS.append(finish('leg' + side, merge(leg, foot), PIV['leg' + side], body, mat=FUR))

# ── Tail ──────────────────────────────────────────────────────────────────
TAIL = SPEC.get('tail')
TAIL_PTS = None
if TAIL in species.TAILS:
    pts, radii, bevel = species.TAILS[TAIL]
    TAIL_PTS = pts
    tail = tube('tail', [Vector(p) for p in pts], list(radii), bevel, body, FUR, res=5)
    set_origin(tail, pts[0])
    tail.modifiers.new('Subdivision', 'SUBSURF').levels = 1
    FUR_PARTS.append(tail)
elif TAIL in ('puff', 'ball', 'tiny'):
    r = {'puff': 0.075, 'ball': 0.055, 'tiny': 0.035}[TAIL]
    c = Vector((0, 0.17 + r * 0.4, 0.38))
    tb = sphere_bm(20, 14)
    bmesh.ops.scale(tb, vec=(r, r, r), verts=tb.verts)
    bmesh.ops.translate(tb, vec=c, verts=tb.verts)
    FUR_PARTS.append(finish('tail', tb, (0, 0.14, 0.38), body, mat=FUR))
elif TAIL in ('flat', 'wedge', 'duck', 'feathers'):
    parts = []
    shapes = {'flat': [((0, 0.19, 0.42), (0.06, 0.05, 0.09), 0.5)], 'wedge': [((0, 0.18, 0.2), (0.07, 0.04, 0.08), -0.6)],
              'duck': [((0, 0.19, 0.42), (0.06, 0.05, 0.09), 0.9)],
              'feathers': [((x * 0.045, 0.19, 0.36), (0.035, 0.03, 0.1), 0.2) for x in (-1, 0, 1)]}[TAIL]
    for c, sc_, tilt in shapes:
        tb = sphere_bm(16, 12)
        bmesh.ops.scale(tb, vec=sc_, verts=tb.verts)
        bmesh.ops.rotate(tb, verts=tb.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(tilt, 3, 'X'))
        bmesh.ops.translate(tb, vec=c, verts=tb.verts)
        parts.append(tb)
    FUR_PARTS.append(finish('tail', merge(*parts), (0, 0.14, 0.4), body, mat=FUR))
else:
    null('tail', (0, 0.14, 0.4), body)

# Hats are modelled on the cat's head; other heads get them moved and scaled.
CAT_R = Vector((0.345, 0.30, 0.29))
hs = (R.x / CAT_R.x + R.z / CAT_R.z) / 2
hat = empty('hatSlot', HC + Vector((0, 0, (R.z - CAT_R.z) * 0.8)), head)
hat.scale = (hs, hs, hs)
# Start on the normal face: the other expression sets are hidden (scale 0).
for nm_ in ('eyeHappyL', 'eyeHappyR', 'browL', 'browR', 'mouthOpen', 'mouthO', 'mouthSad'):
    if nm_ in bpy.data.objects:
        bpy.data.objects[nm_].scale = (0, 0, 0)
bpy.context.view_layer.update()
result = {'species': SPECIES_NAME, 'fur_parts': [o.name for o in FUR_PARTS]}
