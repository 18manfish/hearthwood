# Example villager: a smooth cat (geometry). Run inside Blender with vlib.py next to it.
import bpy, bmesh, math, sys, importlib
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, ART + r'\villagers')
import vlib
importlib.reload(vlib)
from vlib import *

clear_scene()

FUR = flat_mat('fur', '#e07b39', 0.85)
PINK = flat_mat('pink', '#f08c9c', 0.6)
EYE = flat_mat('eye', '#1c1418', 0.18)
WHITE = flat_mat('shine', '#ffffff', 0.3)
INK = flat_mat('ink', '#5a2f1c', 0.7)

root = empty('villager')
body = empty('body', parent=root)

# ── Head ──────────────────────────────────────────────────────────────────
HC = PIV['head']
R = Vector((0.345, 0.30, 0.29))
TUFTS = [Vector(v) for v in ((0.93, -0.3, -0.32), (0.82, -0.25, -0.55))]


def head_fn(d):
    r = Vector((R.x * (1 + 0.07 * max(0, -d.z) - 0.03 * max(0, d.z)), R.y, R.z * (0.95 if d.z > 0 else 1)))
    p = Vector((d.x * r.x, d.y * r.y, d.z * r.z))
    out = 0.0
    # cheek tufts (soft points, cat fluff)
    for t in TUFTS:
        for s in (-1, 1):
            out += 0.045 * gauss(d, Vector((t.x * s, t.y, t.z)), 0.09)
    # whisker pads and chin
    for s in (-1, 1):
        out += 0.032 * gauss(d, Vector((0.17 * s, -0.95, -0.30)), 0.16)
    out += 0.02 * gauss(d, Vector((0, -0.85, -0.55)), 0.18)
    # a slightly flatter face
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


head = finish('head', blob(head_fn, 40, 26), HC, body, mat=FUR)


def oriented(bm, pos, normal, up=Vector((0, 0, 1))):
    z = normal.normalized()
    x = up.cross(z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(pos) @ m, verts=bm.verts)
    return bm


# Eyes: big glossy ovals with two highlights.
for s, side in ((-1, 'L'), (1, 'R')):
    p, n = head_point((0.40 * s, -0.86, 0.10), -0.006)
    eb = sphere_bm(20, 14)
    bmesh.ops.scale(eb, vec=(0.064, 0.094, 0.03), verts=eb.verts)
    finish('eye' + side, oriented(eb, p, n), p, head, subd=1, mat=EYE)
    for off, rad in (((0.025 * s, 0.035), 0.022), ((-0.022 * s, -0.035), 0.011)):
        q = p + n * 0.026 + Vector((off[0], 0, off[1]))
        hb = sphere_bm(12, 8)
        bmesh.ops.scale(hb, vec=(rad, rad, rad * 0.4), verts=hb.verts)
        finish('shine' + side, oriented(hb, q, n), q, head, subd=1, mat=WHITE)

# Nose: a small rounded triangle.
p, n = head_point((0, -0.97, -0.14), -0.004)
nb = sphere_bm(16, 10)
for v in nb.verts:
    c = v.co
    w = 0.042 * (1 - 0.45 * max(0, -c.y))  # narrower at the bottom
    v.co = Vector((c.x * w, c.y * 0.028, c.z * 0.022))
finish('nose', oriented(nb, p, n), p, head, subd=1, mat=PINK)

# Mouth: a little "w".
pts, rad = [], []
for t in (-1, -0.5, 0, 0.5, 1):
    d = (0.09 * t, -0.97, -0.30 + 0.045 * abs(t) - 0.03 * (1 - abs(abs(t) - 0.5) * 2) + 0.02 * (t == 0))
    q, n = head_point(d, 0.004)
    pts.append(q)
    rad.append(1.0 if abs(t) < 1 else 0.6)
tube('mouth', pts, rad, 0.0065, head, INK, res=2)

# Ears: rounded triangles with a pink inside.
for s, side in ((-1, 'L'), (1, 'R')):
    base, n = head_point((0.52 * s, 0.02, 0.85), -0.05)
    tilt = Matrix.Rotation(-0.42 * s, 4, 'Y') @ Matrix.Rotation(0.12, 4, 'X')
    for name, r1, depth, thick, fwd, mat in (('ear', 0.14, 0.25, 0.62, 0.0, FUR), ('earIn', 0.09, 0.18, 0.25, -0.042, PINK)):
        eb = bmesh.new()
        bmesh.ops.create_cone(eb, cap_ends=True, segments=20, radius1=r1, radius2=0.012, depth=depth)
        for v in eb.verts:
            c = v.co
            z = c.z + depth / 2  # 0 at the base
            v.co = Vector((c.x, c.y * thick, z))
            # curve the tip forward a touch
            v.co.y -= 0.12 * (z / depth) ** 2 * depth
        bmesh.ops.transform(eb, matrix=Matrix.Translation(base + Vector((0, fwd, 0.03 if name == 'earIn' else 0))) @ tilt, verts=eb.verts)
        finish(name + side, eb, base, head, subd=2, mat=mat)

# ── Body ─────────────────────────────────────────────────────────────────
TC = Vector((0, 0, 0.55))


def torso_fn(d):
    widen = 1 + 0.2 * max(0, -d.z) - 0.1 * max(0, d.z) - 0.12 * max(0, d.z - 0.75) * 4
    r = Vector((0.205 * widen, 0.17 * widen * (1.05 if d.y < 0 else 1), 0.235))
    return TC + Vector((d.x * r.x, d.y * r.y, d.z * r.z))


finish('torso', blob(torso_fn, 32, 20), (0, 0, 0.36), body, mat=FUR)

# Arms grow out of the shoulders: they start inside the torso (so the joint stays hidden
# when they swing), taper outwards and end in a round mitten paw.
ARM_A, ARM_B, ARM_R0, ARM_R1 = (0.13, 0.0, 0.71), (0.285, -0.035, 0.475), 0.078, 0.056
PIV['armL'] = Vector((-0.15, 0, 0.705)); PIV['armR'] = Vector((0.15, 0, 0.705))
for s, side in ((-1, 'L'), (1, 'R')):
    a = capsule((ARM_A[0] * s, ARM_A[1], ARM_A[2]), (ARM_B[0] * s, ARM_B[1], ARM_B[2]), ARM_R0, ARM_R1)
    paw = sphere_bm(20, 14)
    bmesh.ops.scale(paw, vec=(0.066, 0.064, 0.07), verts=paw.verts)
    bmesh.ops.translate(paw, vec=(ARM_B[0] * s + 0.004 * s, ARM_B[1] - 0.004, ARM_B[2] - 0.012), verts=paw.verts)
    finish('arm' + side, merge(a, paw), PIV['arm' + side], body, mat=FUR)
    # Legs: short, with oval feet.
    leg = capsule((0.1 * s, 0, 0.35), (0.1 * s, -0.005, 0.1), 0.088, 0.08)
    foot = sphere_bm(20, 14)
    bmesh.ops.scale(foot, vec=(0.088, 0.125, 0.062), verts=foot.verts)
    bmesh.ops.translate(foot, vec=(0.1 * s, -0.04, 0.058), verts=foot.verts)
    finish('leg' + side, merge(leg, foot), PIV['leg' + side], body, mat=FUR)

# Tail: curling up behind.
TAIL_PTS = TAIL = ((0, 0.13, 0.42), (0.07, 0.29, 0.40), (0.2, 0.38, 0.52), (0.24, 0.37, 0.72), (0.17, 0.31, 0.84))
tail = tube('tail', [Vector(p) for p in TAIL],
            [1.0, 0.95, 0.9, 0.85, 0.65], 0.047, body, FUR, res=5)
set_origin(tail, (0, 0.13, 0.42))
tail.modifiers.new('Subdivision', 'SUBSURF').levels = 1

hat = empty('hatSlot', HC, head)
bpy.context.view_layer.update()
result = {'objects': len(bpy.data.objects)}
