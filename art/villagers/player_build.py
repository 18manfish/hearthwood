# Player characters (run after villager_build.py with SPECIES_NAME 'human_m' or 'human_f').
# The body is the villagers' body, so every clothing cut and every animation clip fits.
# This adds what a player can customise, as alternatives the game switches between:
#
#   materials  skin / shirt / pants (the always-worn undershirt and trousers), eye, brow,
#              hair, blush, freckle, nose – all tinted in the game from the player's look
#   eyes       eyeL / eyeR groups (the clips blink them) holding eye_<shape>_L/R
#              shapes: round, happy, sleepy, wide (wink = round + happy); lashes on human_f
#   brows      lookbrow_<soft|bold|raised>_L/R
#   nose       nose_dot, nose_button
#   mouth      the `mouth` group holding mouth_<smile|grin|open|small|cat>
#   cheeks     cheek_blush, cheek_freckles
#   hair       hair_<style> for all eight styles (+ hair ties)
#   toolSlot   an empty in the right hand for tools
import bpy, bmesh, math, random
from mathutils import Vector, Matrix

O = bpy.data.objects
SKIN = flat_mat('skin', '#f1c27d', 0.55)
SHIRT = flat_mat('shirt', '#ffffff', 0.85)
PANTS = flat_mat('pants', '#34495e', 0.85)
EARIN = flat_mat('skin_in', '#e8a87c', 0.6)
BROW = flat_mat('brow', '#3b2a20', 0.7)
HAIR = flat_mat('hair', '#5a3a1e', 0.55)
TIE = flat_mat('hair_tie', '#e86fae', 0.5)
BLUSH = flat_mat('blush', '#ff9aa2', 0.7)
FRECKLE = flat_mat('freckle', '#b9805a', 0.7)
NOSEM = flat_mat('nose', '#e0a878', 0.55)
TEETH = flat_mat('teeth', '#ffffff', 0.35)
LIP = flat_mat('lip', '#9c3b3b', 0.6)
LASHES = SPEC.get('lashes', False)


def set_mats(o, mats, rule):
    me = o.data
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    mw = o.matrix_world
    for p in me.polygons:
        p.material_index = rule(mw @ p.center)


A, B = Vector(ARM_A), Vector(ARM_B)


def split_materials():
    """Skin / undershirt / trousers by region (again after baking, which swaps materials)."""
    set_mats(O['head'], [SKIN], lambda c: 0)
    for s, side in ((-1, 'L'), (1, 'R')):
        set_mats(O['ear' + side], [SKIN], lambda c: 0)
        if 'earIn' + side in O:
            set_mats(O['earIn' + side], [EARIN], lambda c: 0)
        a, b = Vector((A.x * s, A.y, A.z)), Vector((B.x * s, B.y, B.z))
        ab = b - a
        set_mats(O['arm' + side], [SHIRT, SKIN], lambda c, a=a, ab=ab: 0 if (c - a).dot(ab) / ab.length_squared < 0.42 else 1)
        set_mats(O['leg' + side], [PANTS, SKIN], lambda c: 0 if c.z > 0.135 else 1)
    set_mats(O['torso'], [SHIRT, PANTS], lambda c: 0 if c.z >= 0.45 else 1)


split_materials()
head = O['head']


def group(name, pivot, parent=head):
    g = empty(name, pivot, parent)
    return g


def regroup(o, g):
    parent_keep(o, g)
    return o


def oval(name, d, sx, sy, sz, mat, parent, lift=-0.006, shift=(0.0, 0.0), cut_top=None):
    """An oval lying on the head at direction d (local x across, y up, z out)."""
    p, n = head_point(d, lift)
    x, y = frame_at(n)
    p = p + x * shift[0] + y * shift[1]
    b = sphere_bm(20, 14)
    for v in b.verts:
        c = v.co
        cz = c.z if cut_top is None else c.z
        cy = min(c.y, cut_top) if cut_top is not None else c.y
        v.co = Vector((c.x * sx, cy * sy, cz * sz))
    o = finish(name, oriented(b, p, n), p, None, subd=1, mat=mat)
    return regroup(o, parent)


def tube_on(name, d, pts_uv, bevel, mat, parent, lift=0.007):
    o = face_tube(name, d, pts_uv, bevel, mat, lift)
    return regroup(o, parent)


# ── Eyes ─────────────────────────────────────────────────────────────────
EYE_SHAPES = {}
for s, side in ((-1, 'L'), (1, 'R')):
    d = (EYE_D.x * s, EYE_D.y, EYE_D.z)
    e = O['eye' + side]
    e.name = f'eye_round_{side}'
    g = group('eye' + side, e.matrix_world.translation.copy())
    regroup(e, g)
    k = ES
    tube_on(f'eye_happy_{side}', d, [(u * k, (0.026 * (1 - (u / 0.058) ** 2) - 0.006) * k) for u in (-0.058, -0.03, 0, 0.03, 0.058)], 0.0105, INK, g)
    oval(f'eye_sleepy_{side}', d, 0.064 * k, 0.094 * k * 0.55, 0.03, EYE, g, shift=(0, -0.016 * k))
    tube_on(f'eye_sleepy_lid_{side}', d, [(u * k, (0.006 - 0.004 * (u / 0.06) ** 2) * k) for u in (-0.062, -0.03, 0, 0.03, 0.062)], 0.009, INK, g, lift=0.012)
    oval(f'eye_wide_{side}', d, 0.084 * k, 0.11 * k, 0.026, WHITE, g, lift=-0.01)
    oval(f'eye_wide_iris_{side}', d, 0.052 * k, 0.074 * k, 0.03, EYE, g, lift=-0.002)
    if LASHES:
        for j in range(3):
            u0 = s * (0.045 + 0.014 * j) * k
            v0 = (0.055 - 0.012 * j) * k
            tube_on(f'lash{j}_{side}', d, [(u0, v0), (u0 + s * 0.022 * k, v0 + (0.016 - 0.006 * j) * k)], 0.0065, INK, g, lift=0.01)

# ── Brows the player picks (the sad brows `browL/R` stay for expressions) ───
for s, side in ((-1, 'L'), (1, 'R')):
    d = (EYE_D.x * s, EYE_D.y, EYE_D.z)
    k = ES
    tube_on(f'lookbrow_soft_{side}', d, [(-s * 0.035 * k, 0.122 * k), (0, 0.13 * k), (s * 0.04 * k, 0.124 * k)], 0.0075, BROW, head)
    tube_on(f'lookbrow_bold_{side}', d, [(-s * 0.042 * k, 0.118 * k), (0, 0.124 * k), (s * 0.045 * k, 0.122 * k)], 0.0135, BROW, head)
    tube_on(f'lookbrow_raised_{side}', d, [(-s * 0.035 * k, 0.142 * k), (0, 0.16 * k), (s * 0.04 * k, 0.146 * k)], 0.0085, BROW, head)

# ── Nose ─────────────────────────────────────────────────────────────────
oval('nose_dot', (0, -0.98, -0.13), 0.02, 0.015, 0.014, NOSEM, head, lift=-0.002)
oval('nose_button', (0, -0.98, -0.14), 0.034, 0.028, 0.026, NOSEM, head, lift=-0.008)

# ── Mouths ───────────────────────────────────────────────────────────────
old = O['mouth']
old.name = 'mouth_cat'  # the villagers' ω mouth
mg = group('mouth', old.matrix_world.translation.copy())
regroup(old, mg)
md = (MOUTH_D.x, MOUTH_D.y, MOUTH_D.z)
tube_on('mouth_smile', md, [(u, 0.016 * (u / 0.045) ** 2 - 0.004) for u in (-0.045, -0.022, 0, 0.022, 0.045)], 0.0065, INK, mg)
tube_on('mouth_small', md, [(-0.018, 0.0), (0, -0.002), (0.018, 0.0)], 0.0065, INK, mg)
oval('mouth_grin', md, 0.05, 0.03, 0.012, TEETH, mg, lift=-0.002, shift=(0, -0.012), cut_top=0.0)
tube_on('mouth_grin_lip', md, [(u, -0.012 + 0.004 * (u / 0.05) ** 2) for u in (-0.05, -0.025, 0, 0.025, 0.05)], 0.006, LIP, mg, lift=0.008)
oval('mouth_open', md, 0.032, 0.03, 0.012, MOUTH_IN, mg, lift=-0.002, shift=(0, -0.008))
oval('mouth_open_tongue', md, 0.02, 0.011, 0.012, TONGUE, mg, lift=0.004, shift=(0, -0.022))

# ── Cheeks ───────────────────────────────────────────────────────────────
for s, side in ((-1, 'L'), (1, 'R')):
    oval(f'cheek_blush_{side}', (0.55 * s, -0.8, -0.2), 0.05, 0.026, 0.008, BLUSH, head, lift=-0.003)
    for j, (du, dv) in enumerate(((-0.03, 0.0), (0.0, 0.018), (0.03, -0.004), (0.012, -0.022))):
        oval(f'cheek_freckles_{side}{j}', (0.55 * s, -0.8, -0.18), 0.008, 0.008, 0.006, FRECKLE, head, lift=-0.001, shift=(du, dv))

# ── Hair ─────────────────────────────────────────────────────────────────
HCv = Vector(HC)


def hairline(front=0.3, side=-0.15, back=-0.6, bangs=0.0, part=0.0):
    """z (on the unit sphere) of the hair's lower edge as a function of the azimuth a
    (0 = straight ahead): high over the forehead, low at the back, scalloped bangs."""
    def z(a):
        f = math.cos(a)
        v = side + (front - side) * max(f, 0) + (back - side) * max(-f, 0)
        if bangs and f > 0.35:
            v -= bangs * (0.55 + 0.45 * math.cos(a * 9 + part) ** 2) * min(1, (f - 0.35) * 3)
        return v
    return z


def shell(name, off, edge, extra=None, solid=0.022, U=56, V=18):
    """Hair surface from the hairline up to the crown: rows follow the hairline exactly,
    so the edge is smooth (no stair steps)."""
    b = bmesh.new()
    rows = []
    for j in range(V):
        row = []
        for i in range(U):
            a = i / U * 2 * math.pi
            e0 = math.asin(max(-0.98, min(0.95, edge(a))))
            t = j / V
            e = e0 + (math.pi / 2 - e0) * (1 - (1 - t) ** 1.4)
            d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
            row.append(b.verts.new(head_fn(d) + d * off(d)))
        rows.append(row)
    d_top = Vector((0, 0, 1))
    pole = b.verts.new(head_fn(d_top) + d_top * off(d_top))
    for j in range(V - 1):
        for i in range(U):
            i2 = (i + 1) % U
            b.faces.new((rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]))
    for i in range(U):
        b.faces.new((rows[V - 1][i], rows[V - 1][(i + 1) % U], pole))
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    if extra:
        b = merge(b, *extra)
    _hair_uv(b)
    o = finish(name, b, HC, head, subd=0, mat=HAIR)
    m = o.modifiers.new('Solid', 'SOLIDIFY')
    m.thickness = solid
    m.offset = -1
    o.modifiers.move(len(o.modifiers) - 1, 0)
    return o


def _hair_uv(b):
    uv = b.loops.layers.uv.verify()
    for f in b.faces:
        for l in f.loops:
            q = l.vert.co - HCv
            l[uv].uv = (math.atan2(q.x, -q.y) / (2 * math.pi) * 6 + 3, q.z * 4)


def lumps(dirs, amp, width):
    def f(d):
        return sum(amp * gauss(d, Vector(a), width) for a in dirs)
    return f


def pony(points, radii, bevel, tie_at=0):
    o = tube('_pony', [Vector(p) for p in points], list(radii), bevel, head, HAIR, res=5)
    bpy.context.view_layer.objects.active = o
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    me.transform(o.matrix_world)
    bpy.data.objects.remove(o, do_unlink=True)
    b = bmesh.new()
    b.from_mesh(me)
    bpy.data.meshes.remove(me)
    return b


def tie(name, p, r=0.035):
    tb = sphere_bm(14, 10)
    bmesh.ops.scale(tb, vec=(r, r, r * 0.7), verts=tb.verts)
    bmesh.ops.translate(tb, vec=Vector(p), verts=tb.verts)
    finish(name, tb, p, head, subd=1, mat=TIE)


top = Vector((0, 0, 1))
fringe = [(x, -0.85, 0.45) for x in (-0.45, -0.15, 0.15, 0.45)]

shell('hair_buzz', lambda d: 0.012, hairline(0.38, -0.05, -0.5))
shell('hair_short', lambda d: 0.028 + 0.025 * gauss(d, top, 0.7) + 0.02 * gauss(d, Vector((0.45, -0.55, 0.7)), 0.4) + lumps(fringe, 0.012, 0.22)(d),
      hairline(0.32, -0.12, -0.55, bangs=0.1, part=1.0))
# spiky: a short base and cones pointing out of the crown
spikes = []
random.seed(4)
for i in range(11):
    a = i * 2.4
    el = 0.45 + 0.4 * (i % 3) / 2
    d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el) * 0.9 + 0.1, math.sin(el))).normalized()
    if d.y < -0.55:
        continue
    base = head_fn(d) + d * 0.01
    cb = bmesh.new()
    bmesh.ops.create_cone(cb, cap_ends=True, segments=10, radius1=0.065, radius2=0.004, depth=0.16)
    bmesh.ops.translate(cb, vec=(0, 0, 0.08), verts=cb.verts)
    rot = Vector((0, 0, 1)).rotation_difference(d + Vector((0, 0.25, 0.2))).to_matrix().to_4x4()
    bmesh.ops.transform(cb, matrix=Matrix.Translation(base) @ rot, verts=cb.verts)
    spikes.append(cb)
shell('hair_spiky', lambda d: 0.026 + 0.01 * gauss(d, top, 0.8), hairline(0.33, -0.1, -0.5, bangs=0.08, part=0.3), extra=spikes)
curl_dirs = []
random.seed(7)
while len(curl_dirs) < 46:
    v = Vector((random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1))).normalized()
    if v.z > -0.25 and v.y < 0.95:
        curl_dirs.append(v)
shell('hair_curly', lambda d: 0.04 + lumps(curl_dirs, 0.035, 0.2)(d), hairline(0.3, -0.25, -0.55, bangs=0.05), solid=0.03)
# long: a cap, a drape down the back to the shoulders and two side locks
drape = sphere_bm(24, 16)
for v in drape.verts:
    c = v.co
    t = (c.z + 1) / 2
    v.co = Vector((c.x * (0.3 + 0.04 * (1 - t)), c.y * 0.13 + 0.17 + 0.03 * (1 - t), 0.66 + t * 0.4))
locks = []
for s in (-1, 1):
    lb = sphere_bm(16, 12)
    for v in lb.verts:
        c = v.co
        t = (c.z + 1) / 2
        v.co = Vector((s * 0.3 + c.x * 0.07, -0.02 + c.y * 0.09, 0.74 + t * 0.28))
    locks.append(lb)
shell('hair_long', lambda d: 0.03 + 0.02 * gauss(d, top, 0.7) + lumps(fringe, 0.01, 0.22)(d), hairline(0.32, -0.3, -0.75, bangs=0.08),
      extra=[drape] + locks)
pt = [(0, 0.27, 1.12), (0, 0.4, 1.06), (0, 0.47, 0.92), (0, 0.45, 0.76)]
shell('hair_ponytail', lambda d: 0.022 + 0.012 * gauss(d, top, 0.7), hairline(0.34, -0.15, -0.5), extra=[pony(pt, (0.8, 1.15, 1.0, 0.45), 0.075)])
tie('hair_ponytail_tie', Vector(pt[0]) + Vector((0, 0.03, -0.01)))
shell('hair_bob', lambda d: 0.035 + 0.045 * max(0.0, -d.z) * (1 + d.y * 0.3) + lumps(fringe, 0.008, 0.22)(d),
      hairline(0.26, -0.62, -0.8, bangs=0.04), solid=0.028)
tails = []
for s in (-1, 1):
    pts = [(s * 0.3, 0.06, 1.0), (s * 0.44, 0.1, 0.92), (s * 0.48, 0.12, 0.76), (s * 0.45, 0.1, 0.66)]
    tails.append(pony(pts, (0.75, 1.1, 0.95, 0.4), 0.065))
    tie(f'hair_pigtails_tie{"LR"[s > 0]}', Vector(pts[0]) + Vector((s * 0.03, 0, 0)))
shell('hair_pigtails', lambda d: 0.022 + 0.012 * gauss(d, top, 0.7), hairline(0.34, -0.15, -0.5, bangs=0.06), extra=tails)
for o in [o for o in O if o.name.startswith('hair_') and o.name.endswith(('_tie', '_tieL', '_tieR'))]:
    o['hair'] = o.name.split('_')[1]

# Hats sit on top of the hair.
hs = O['hatSlot']
hs.location.z += 0.035
hs.scale = tuple(x * 1.1 for x in hs.scale)

# Tools are held in the right hand.
ts = empty('toolSlot', Vector((B.x, B.y - 0.01, B.z - 0.03)), O['armR'])
bpy.context.view_layer.update()
result = {'player': SPECIES_NAME, 'hair': sorted(o.name for o in O if o.name.startswith('hair_'))}
