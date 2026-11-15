# Villager animations (run inside Blender after cat_model.py, cat_fur.py and clothes.py).
#
# The villager is a set of parts that turn around their joints (like the game's rig), so
# every clip is one Action with a slot per part. Clips are written as poses over time and
# keyed on every frame. They all start and end on the shared idle pose (or on the pose of
# the state they lead into: sitting, holding the umbrella), so they flow into each other:
#
#   idle ⇄ walk ⇄ run ⇄ chase            (loops, same stride timing: crossfade freely)
#   idle → surprised → idle               idle → laugh → idle        idle → gift → idle
#   idle → sad_in → sad ⇄ walk_sad → sad_out → idle
#   idle → sit_chair_down → sit_chair → sit_chair_up → idle   (same for sit_ground)
#   idle → umbrella_open → umbrella_hold ⇄ umbrella_walk → umbrella_close → idle

import bpy, bmesh, math
from mathutils import Vector, Matrix

FPS = 30
bpy.context.scene.render.fps = FPS
O = bpy.data.objects
PI = math.pi


def sm(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def win(f, a, b, c, d):
    """0 before a, eases to 1 over a..b, holds, eases back to 0 over c..d."""
    return sm((f - a) / max(1e-6, b - a)) * (1 - sm((f - c) / max(1e-6, d - c)))


def lerp(a, b, t):
    return a + (b - a) * t


# ── Faces and props ──────────────────────────────────────────────────────
INK = bpy.data.materials['ink']

if 'eyeHappyL' in O:  # villager_build.py already made the face sets
    happy = [O['eyeHappyL'], O['eyeHappyR']]; brows = [O['browL'], O['browR']]
    mouth_open, mouth_o, mouth_sad = O['mouthOpen'], O['mouthO'], O['mouthSad']
else:
    MOUTH_IN = flat_mat('mouth_in', '#6b2430', 0.6)
    TONGUE = flat_mat('tongue', '#f08c9c', 0.5)
    # earIn follows its ear
    for s in 'LR':
        parent_keep(O['earIn' + s], O['ear' + s])


    def frame_at(p, n):
        z = n.normalized()
        x = Vector((0, 0, 1)).cross(z).normalized()
        y = z.cross(x)
        return x, y


    def face_tube(name, eye_d, pts_uv, bevel, mat, lift=0.007):
        p, n = head_point(eye_d, lift)
        x, y = frame_at(p, n)
        # lay every point back onto the head's surface
        pts = [head_point((p + x * u + y * v - HC).normalized(), lift)[0] for u, v in pts_uv]
        o = tube(name, pts, [1.0] * len(pts), bevel, head, mat, res=3)
        set_origin(o, p)
        return o


    happy, brows = [], []
    for s, side in ((-1, 'L'), (1, 'R')):
        d = (0.40 * s, -0.86, 0.10)
        # ^ closed happy eyes
        happy.append(face_tube('eyeHappy' + side, d, [(u, 0.026 * (1 - (u / 0.058) ** 2) - 0.006) for u in (-0.058, -0.03, 0, 0.03, 0.058)], 0.0105, INK))
        # sad brows: inner end raised
        brows.append(face_tube('brow' + side, d, [(-s * 0.03, 0.128), (s * 0.0, 0.118), (s * 0.045, 0.098)], 0.0085, INK))

    # Laughing mouth: a "D" with a tongue
    p, n = head_point((0, -0.97, -0.3), -0.002)
    mb = sphere_bm(20, 12)
    for v in mb.verts:
        c = v.co
        v.co = Vector((c.x * 0.058, c.y * 0.014, min(c.z, 0.15) * 0.05))
    mouth_open = finish('mouthOpen', oriented(mb, p, n), p, head, subd=1, mat=MOUTH_IN)
    tb = sphere_bm(14, 10)
    for v in tb.verts:
        c = v.co
        v.co = Vector((c.x * 0.032, c.y * 0.01, c.z * 0.02 - 0.024))
    tongue = finish('tongue', oriented(tb, p + n * 0.006, n), p, mouth_open, subd=1, mat=TONGUE)
    # Surprised "o"
    p, n = head_point((0, -0.97, -0.31), -0.002)
    ob = sphere_bm(16, 10)
    bmesh.ops.scale(ob, vec=(0.026, 0.012, 0.032), verts=ob.verts)
    mouth_o = finish('mouthO', oriented(ob, p, n), p, head, subd=1, mat=MOUTH_IN)
    # Sad mouth: a little arch
    p, n = head_point((0, -0.97, -0.3), 0.004)
    x, y = frame_at(p, n)
    pts = [p + x * u + y * (-0.012 + 0.016 * (1 - (u / 0.042) ** 2)) for u in (-0.042, -0.02, 0, 0.02, 0.042)]
    mouth_sad = tube('mouthSad', pts, [0.7, 1, 1, 1, 0.7], 0.0065, head, INK, res=2)
    set_origin(mouth_sad, p)

EYES = [O['eyeL'], O['eyeR']]
SHINES = [o for o in O if o.name.startswith('shine')]
FACE = {
    'eyes': EYES, 'shines': SHINES, 'happy': happy, 'brows': brows,
    'mouth': [O['mouth']], 'mouthOpen': [mouth_open], 'mouthO': [mouth_o], 'mouthSad': [mouth_sad],
}
EXPR = {
    'normal': ('eyes', 'shines', 'mouth'),
    'happy': ('happy', 'mouth'),
    'laugh': ('happy', 'mouthOpen'),
    'excited': ('eyes', 'shines', 'mouthOpen'),
    'surprised': ('eyes', 'shines', 'mouthO'),
    'sad': ('eyes', 'shines', 'brows', 'mouthSad'),
}

# Gift: a wrapped box with a ribbon and bow, carried in front with both paws.
gift = empty('gift', (0, -0.24, 0.62), body)
GIFT_HOME = Vector((0, -0.24, 0.62))
gb = bmesh.new()
bmesh.ops.create_cube(gb, size=1.0)
bmesh.ops.scale(gb, vec=(0.25, 0.2, 0.19), verts=gb.verts)
bmesh.ops.translate(gb, vec=GIFT_HOME, verts=gb.verts)
box = finish('giftBox', gb, GIFT_HOME, gift, subd=0, mat=flat_mat('gift_paper', '#7cc6de', 0.7))
bev = box.modifiers.new('Bevel', 'BEVEL'); bev.width = 0.025; bev.segments = 3
rib_m = flat_mat('gift_ribbon', '#ffd166', 0.5)
for sx, sy in ((0.255, 0.04), (0.04, 0.205)):
    rb = bmesh.new()
    bmesh.ops.create_cube(rb, size=1.0)
    bmesh.ops.scale(rb, vec=(sx, sy, 0.196), verts=rb.verts)
    bmesh.ops.translate(rb, vec=GIFT_HOME, verts=rb.verts)
    finish('giftRibbon', rb, GIFT_HOME, gift, subd=0, mat=rib_m)
for s in (-1, 1):
    bw = sphere_bm(14, 10)
    bmesh.ops.scale(bw, vec=(0.05, 0.022, 0.032), verts=bw.verts)
    bmesh.ops.rotate(bw, verts=bw.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(0.5 * s, 3, 'Y'))
    bmesh.ops.translate(bw, vec=GIFT_HOME + Vector((0.042 * s, 0, 0.115)), verts=bw.verts)
    finish('giftBow', bw, GIFT_HOME, gift, subd=1, mat=rib_m)

# Umbrella: held in the right paw; the canopy folds with a shape key.
HAND_R = O['armR'].matrix_world.translation + Vector((ARM_B[0] - 0.15 + 0.005, ARM_B[1] - 0.004, ARM_B[2] - 0.705 - 0.012))
umb = empty('umbrella', HAND_R, O['armR'])
SH = 0.95  # shaft above the paw
shaft = capsule(HAND_R + Vector((0, 0, -0.06)), HAND_R + Vector((0, 0, SH)), 0.011, 0.011, 10, 6)
finish('umbShaft', shaft, HAND_R, umb, subd=0, mat=flat_mat('umb_shaft', '#6b4a32', 0.5))
hk = [HAND_R + Vector(v) for v in ((0, 0, -0.06), (0, 0, -0.12), (0.03, 0, -0.16), (0.065, 0, -0.13), (0.07, 0, -0.1))]
hook = tube('umbHook', hk, [1, 1, 1, 1, 1], 0.014, umb, flat_mat('umb_handle', '#8a5a3a', 0.45), res=3)
set_origin(hook, HAND_R)
top = HAND_R + Vector((0, 0, SH))
GORES, RING = 8, 4
cb = bmesh.new()
apex = cb.verts.new(top + Vector((0, 0, 0.02)))
rings = []
for r in range(1, RING + 1):
    t = r / RING
    row = []
    for k in range(GORES * 2):
        a = k / (GORES * 2) * 2 * PI
        rib = k % 2 == 0
        rad = 0.56 * t
        drop = 0.2 * t * t + (0 if rib else 0.025 * t)  # scalloped between the ribs
        row.append(cb.verts.new(top + Vector((math.cos(a) * rad, math.sin(a) * rad, -drop))))
    rings.append(row)
for k in range(GORES * 2):
    cb.faces.new((apex, rings[0][k], rings[0][(k + 1) % (GORES * 2)]))
for r in range(RING - 1):
    for k in range(GORES * 2):
        k2 = (k + 1) % (GORES * 2)
        cb.faces.new((rings[r][k], rings[r + 1][k], rings[r + 1][k2], rings[r][k2]))
canopy = finish('umbCanopy', cb, HAND_R, umb, subd=1)
canopy.data.materials.append(flat_mat('umb_red', '#e05a4f', 0.6))
canopy.data.materials.append(flat_mat('umb_cream', '#fff1d6', 0.6))
for f in canopy.data.polygons:
    a = math.atan2(*(f.center.y, f.center.x)) % (2 * PI)
    f.material_index = int(a / (2 * PI) * GORES) % 2
for m in canopy.data.materials:
    m.use_backface_culling = False
canopy.shape_key_add(name='open')
closed = canopy.shape_key_add(name='closed')
loc_top = top - HAND_R
for i, v in enumerate(canopy.data.vertices):
    co = v.co - loc_top
    r = math.hypot(co.x, co.y)
    if r < 1e-6:
        continue
    t = r / 0.56
    a = math.atan2(co.y, co.x)
    rr = 0.02 + 0.035 * t
    closed.data[i].co = loc_top + Vector((math.cos(a) * rr, math.sin(a) * rr, -0.62 * t))
CANOPY_KEY = canopy.data.shape_keys

# A little chair to sit on (preview prop; in the game the villager sits on real furniture).
SEAT_Z, SEAT_Y = 0.34, 0.1
chair = empty('chair', (0, SEAT_Y, 0))
wood = flat_mat('chair_wood', '#b07a4a', 0.6)
cbm = bmesh.new()
for (sx, sy, sz, x, y, z) in ((0.46, 0.38, 0.05, 0, SEAT_Y, SEAT_Z - 0.025), (0.46, 0.05, 0.42, 0, SEAT_Y + 0.19, SEAT_Z + 0.2),
                              *[(0.05, 0.05, SEAT_Z - 0.05, sx_ * 0.19, SEAT_Y + sy_ * 0.15, (SEAT_Z - 0.05) / 2) for sx_ in (-1, 1) for sy_ in (-1, 1)]):
    bm1 = bmesh.new()
    bmesh.ops.create_cube(bm1, size=1.0)
    bmesh.ops.scale(bm1, vec=(sx, sy, sz), verts=bm1.verts)
    bmesh.ops.translate(bm1, vec=(x, y, z), verts=bm1.verts)
    cbm = merge(cbm, bm1)
chair_mesh = finish('chairMesh', cbm, (0, SEAT_Y, 0), chair, subd=0, mat=wood)
b2 = chair_mesh.modifiers.new('Bevel', 'BEVEL'); b2.width = 0.012; b2.segments = 2

bpy.context.view_layer.update()

# ── Channels ─────────────────────────────────────────────────────────────
# name -> (object, data path, index)
CH = {}
for nm, ob in (('body', O['body']),):
    CH['body.ly'] = (ob, 'location', 1)
    CH['body.lz'] = (ob, 'location', 2)
    for i, a in enumerate('xyz'):
        CH[f'body.r{a}'] = (ob, 'rotation_euler', i)
for nm in ('head', 'armL', 'armR', 'tail'):
    for i, a in enumerate('xyz'):
        CH[f'{nm}.r{a}'] = (O[nm], 'rotation_euler', i)
for nm in ('legL', 'legR', 'earL', 'earR'):
    for i, a in enumerate('xy'):
        CH[f'{nm}.r{a}'] = (O[nm], 'rotation_euler', i)
CH['umb.rx'] = (umb, 'rotation_euler', 0)
CH['umb.ry'] = (umb, 'rotation_euler', 1)
for i, a in enumerate('xyz'):
    CH[f'gift.l{a}'] = (gift, 'location', i)
REST = {k: 0.0 for k in CH}
REST.update({'gift.lx': GIFT_HOME.x, 'gift.ly': GIFT_HOME.y, 'gift.lz': GIFT_HOME.z})
SPECIAL = {'umb.s': 0.0, 'umb.closed': 1.0, 'gift.s': 0.0, 'tail.s': 1.0, 'blink': 0.0, 'eyes.s': 1.0, 'chair.s': 0.0}


def pose(**kw):
    p = dict(REST)
    p.update(SPECIAL)
    p['face'] = 'normal'
    for k, v in kw.items():
        p[k.replace('__', '.')] = v
    return p


def blend(a, b, t):
    out = {k: lerp(a[k], b[k], t) for k in a if k != 'face'}
    out['face'] = b['face'] if t >= 0.5 else a['face']
    return out


def add(p, **kw):
    for k, v in kw.items():
        k = k.replace('__', '.')
        p[k] = p.get(k, 0.0) + v
    return p


def sym_arms(p, rx, ry_in=0.0, rz=0.0):
    """Both arms: rx forward(-)/back(+), ry_in > 0 swings the paws inwards."""
    p['armL.rx'] += rx; p['armR.rx'] += rx
    p['armL.ry'] -= ry_in; p['armR.ry'] += ry_in
    p['armL.rz'] -= rz; p['armR.rz'] += rz
    return p


def ears_droop(p, a):
    p['earL.ry'] -= a; p['earR.ry'] += a
    return p


def hold_umbrella(p, raise_=1.0, open_=1.0, vis=1.0):
    """Right arm up in front, umbrella upright above the head."""
    p['armR.rx'] = lerp(p['armR.rx'], -1.2, raise_)
    p['armR.ry'] = lerp(p['armR.ry'], 0.18, raise_)
    p['umb.rx'] = -p['armR.rx']
    p['umb.ry'] = -p['armR.ry'] - 0.12 * raise_
    p['umb.s'] = vis
    p['umb.closed'] = 1 - open_
    return p


# ── Clips: (frames, loop?, pose(f)) ──────────────────────────────────────
def idle(f, n=72):
    ph = f / n * 2 * PI
    p = pose()
    add(p, body__lz=0.005 * math.sin(ph), body__ry=0.012 * math.sin(ph), head__ry=0.05 * math.sin(ph + 1),
        head__rz=0.08 * math.sin(ph * 1 + 2) * win(f, 10, 22, 50, 64), tail__rz=0.2 * math.sin(ph * 2), tail__rx=0.05 * math.sin(ph))
    sym_arms(p, 0.03 * math.sin(ph))
    p['earR.rx'] += 0.25 * win(f, 46, 48, 49, 53)  # ear twitch
    p['blink'] = win(f, 30, 31.5, 32.5, 34)
    return p


def walk(f, n=20, amp=1.0):
    ph = f / n * 2 * PI
    s, c = math.sin(ph), math.cos(ph)
    p = pose()
    add(p, legL__rx=-0.55 * s * amp, legR__rx=0.55 * s * amp, armL__rx=0.45 * s * amp, armR__rx=-0.45 * s * amp,
        body__lz=0.022 * abs(c) * amp - 0.008, body__ry=0.035 * s, body__rz=0.06 * s, body__rx=0.04,
        head__rz=-0.05 * s, head__ry=-0.03 * s, tail__rz=0.2 * math.sin(ph + 1), tail__rx=0.06 * c)
    sym_arms(p, 0.0, -0.05)
    return p


def run(f, n=14):
    ph = f / n * 2 * PI
    s, c = math.sin(ph), math.cos(ph)
    p = pose()
    add(p, legL__rx=-0.9 * s, legR__rx=0.9 * s, armL__rx=0.75 * s - 0.25, armR__rx=-0.75 * s - 0.25,
        body__lz=0.05 * abs(c) - 0.01, body__rx=0.16, body__rz=0.1 * s, body__ry=0.04 * s,
        head__rx=-0.12, head__rz=-0.06 * s, tail__rx=0.35, tail__rz=0.25 * math.sin(ph + 1))
    ears_droop(p, 0.0); p['earL.rx'] -= 0.2; p['earR.rx'] -= 0.2
    sym_arms(p, 0.0, -0.08)
    return p


def chase(f, n=16):
    ph = f / n * 2 * PI
    s, c = math.sin(ph), math.cos(ph)
    p = pose(face='excited')
    add(p, legL__rx=-0.95 * s, legR__rx=0.95 * s, body__lz=0.055 * abs(c) - 0.01, body__rx=0.3, body__rz=0.08 * s,
        head__rx=-0.3, tail__rx=0.55, tail__rz=0.35 * math.sin(ph * 2))
    # paws reaching forward, grabbing in turn
    p['armL.rx'] = -1.55 + 0.35 * s; p['armR.rx'] = -1.55 - 0.35 * s
    p['armL.ry'] = -0.25; p['armR.ry'] = 0.25
    p['earL.rx'] = 0.25; p['earR.rx'] = 0.25
    return p


def walk_sad(f, n=28):
    ph = f / n * 2 * PI
    s, c = math.sin(ph), math.cos(ph)
    p = sad_pose()
    add(p, legL__rx=-0.3 * s, legR__rx=0.3 * s, armL__rx=0.12 * s, armR__rx=-0.12 * s, body__lz=0.012 * abs(c) - 0.004,
        body__ry=0.03 * s, head__rz=0.05 * s, tail__rz=0.08 * math.sin(ph * 0.5))
    p['body.rx'] = 0.1
    return p


def sad_pose():
    p = pose(face='sad')
    add(p, head__rx=0.45, body__rx=0.06, body__lz=-0.01, tail__rx=-0.6)
    ears_droop(p, 0.9)
    sym_arms(p, -0.15, 0.25)
    return p


def sad(f, n=72):
    ph = f / n * 2 * PI
    p = sad_pose()
    sigh = win(f, 24, 36, 40, 56)
    add(p, body__lz=0.004 * math.sin(ph) + 0.014 * sigh, head__rx=-0.08 * sigh + 0.04 * win(f, 40, 50, 60, 70), head__rz=0.04 * math.sin(ph))
    return p


def sad_in(f, n=18):
    p = blend(idle(0), sad_pose(), sm(f / n))
    p['face'] = 'sad' if f >= 6 else 'normal'
    return p


def sad_out(f, n=18):
    p = blend(sad_pose(), idle(0), sm(f / n))
    p['face'] = 'normal' if f >= 12 else 'sad'
    return p


def laugh(f, n=48):
    e = win(f, 0, 8, 38, 48)
    b = math.sin(f / 6 * 2 * PI)
    p = idle(0)
    add(p, head__rx=-0.3 * e, head__ry=0.1 * e * math.sin(f / 24 * 2 * PI), body__rx=-0.08 * e, body__lz=0.014 * e * abs(b),
        tail__rz=0.3 * e * math.sin(f / 4 * 2 * PI))
    sym_arms(p, -0.55 * e + 0.05 * e * b, 0.35 * e)
    p['earL.rx'] -= 0.15 * e; p['earR.rx'] -= 0.15 * e
    p['face'] = 'laugh' if 4 <= f < 44 else 'normal'
    return p


def surprised(f, n=40):
    p = idle(0)
    crouch = win(f, 0, 3, 4, 6)
    jump = math.sin(min(1, max(0, (f - 4) / 11)) * PI)
    up = win(f, 4, 8, 24, 34)
    add(p, body__lz=-0.03 * crouch + 0.085 * jump, head__rx=-0.22 * up, tail__rx=0.8 * up)
    p['tail.s'] = 1 + 0.25 * up
    p['armL.ry'] += 1.6 * up; p['armR.ry'] -= 1.6 * up  # arms flung up and out
    p['armL.rx'] -= 0.2 * up; p['armR.rx'] -= 0.2 * up
    p['earL.ry'] += 0.15 * up; p['earR.ry'] -= 0.15 * up
    p['eyes.s'] = 1 + 0.2 * up
    p['face'] = 'surprised' if 3 <= f < 32 else 'normal'
    return p


def gift_clip(f, n=84):
    p = idle(0)
    behind = win(f, 0, 14, 18, 30)       # reach behind the back
    hold = win(f, 22, 34, 58, 70)        # hold the gift in front
    offer = win(f, 36, 44, 52, 58)       # hold it out
    sym_arms(p, 0.7 * behind - 1.15 * hold - 0.25 * offer, 0.65 * hold)
    add(p, body__rx=0.06 * behind + 0.12 * offer, head__ry=0.16 * offer, head__rx=0.05 * offer, tail__rz=0.3 * hold * math.sin(f / 5 * 2 * PI))
    # the gift appears behind, comes round to the front, is held out, then taken
    appear = sm((f - 16) / 4)
    taken = sm((f - 56) / 4)
    p['gift.s'] = appear * (1 - taken)
    t = sm((f - 20) / 14)
    p['gift.ly'] = lerp(0.24, GIFT_HOME.y, t) - 0.08 * offer
    p['gift.lz'] = GIFT_HOME.z - 0.04 * (1 - t) + 0.03 * offer
    p['face'] = 'happy' if 40 <= f < 62 else 'normal'
    return p


SIT_CHAIR = dict(body__ly=SEAT_Y, body__lz=SEAT_Z - 0.272, legL__rx=-1.45, legR__rx=-1.45, body__rx=-0.04, tail__rz=1.1, tail__rx=-0.25)
SIT_GROUND = dict(body__lz=-0.272, legL__rx=-1.5, legR__rx=-1.5, body__rx=-0.06, tail__rz=1.3, tail__rx=-0.55)


def sat(kind):
    p = pose(**(SIT_CHAIR if kind == 'chair' else SIT_GROUND))
    sym_arms(p, -0.6 if kind == 'chair' else -0.45, 0.28 if kind == 'chair' else 0.1)
    p['chair.s'] = 1.0 if kind == 'chair' else 0.0
    return p


def sit_loop(kind, f, n=72):
    ph = f / n * 2 * PI
    p = sat(kind)
    k = 0.12 if kind == 'chair' else 0.05
    add(p, legL__rx=k * math.sin(ph * 2), legR__rx=-k * math.sin(ph * 2), body__lz=0.004 * math.sin(ph),
        head__rz=0.12 * math.sin(ph) * win(f, 8, 20, 52, 66), head__ry=0.06 * math.sin(ph + 1), tail__rz=0.1 * math.sin(ph))
    p['blink'] = win(f, 40, 41.5, 42.5, 44)
    return p


def sit_down(kind, f, n=30):
    a, b = idle(0), sat(kind)
    t = sm((f - 6) / 16)
    p = blend(a, b, t)
    hop = math.sin(min(1, max(0, (f - 6) / 14)) * PI)
    p['body.lz'] += (0.06 if kind == 'chair' else 0.0) * hop - 0.03 * win(f, 0, 5, 6, 9) - 0.012 * win(f, 22, 24, 25, 30)
    p['armL.rx'] -= 0.5 * hop; p['armR.rx'] -= 0.5 * hop  # arms out for balance
    p['chair.s'] = 1.0 if kind == 'chair' else 0.0
    return p


def sit_up(kind, f, n=26):
    a, b = sat(kind), idle(0)
    t = sm((f - 4) / 16)
    p = blend(a, b, t)
    lean = win(f, 0, 5, 8, 14)
    p['body.rx'] += 0.22 * lean
    p['body.lz'] += (0.05 if kind == 'chair' else 0.02) * math.sin(min(1, max(0, (f - 4) / 12)) * PI) - 0.015 * win(f, 17, 19, 20, 25)
    p['armL.rx'] -= 0.4 * lean; p['armR.rx'] -= 0.4 * lean
    p['chair.s'] = 1.0 if kind == 'chair' else 0.0
    return p


def umbrella_open(f, n=36):
    p = idle(0)
    hold_umbrella(p, raise_=sm(f / 12), open_=sm((f - 14) / 10) + 0.06 * win(f, 22, 24, 25, 30), vis=sm(f / 3))
    add(p, head__rx=-0.18 * win(f, 10, 16, 26, 34), body__lz=-0.01 * win(f, 22, 24, 25, 30))
    return p


def umbrella_hold(f, n=48):
    p = idle(f * 72 / 48 % 72)
    hold_umbrella(p)
    p['armR.rx'] += 0.03 * math.sin(f / n * 2 * PI)
    p['umb.rx'] = -p['armR.rx']
    p['umb.ry'] += 0.04 * math.sin(f / n * 2 * PI + 1)
    return p


def umbrella_walk(f, n=20):
    p = walk(f, n)
    hold_umbrella(p)
    p['armR.rx'] += 0.04 * math.sin(f / n * 4 * PI)
    p['umb.rx'] = -p['armR.rx']
    return p


def umbrella_close(f, n=34):
    p = idle(0)
    hold_umbrella(p, raise_=1 - sm((f - 12) / 14), open_=1 - sm(f / 11), vis=1 - sm((f - 26) / 4))
    return p


CLIPS = {
    'idle': (72, True, idle),
    'walk': (20, True, walk),
    'run': (14, True, run),
    'chase': (16, True, chase),
    'surprised': (40, False, surprised),
    'laugh': (48, False, laugh),
    'sad_in': (18, False, sad_in),
    'sad': (72, True, sad),
    'walk_sad': (28, True, walk_sad),
    'sad_out': (18, False, sad_out),
    'gift': (84, False, gift_clip),
    'sit_chair_down': (30, False, lambda f: sit_down('chair', f)),
    'sit_chair': (72, True, lambda f: sit_loop('chair', f)),
    'sit_chair_up': (26, False, lambda f: sit_up('chair', f)),
    'sit_ground_down': (30, False, lambda f: sit_down('ground', f)),
    'sit_ground': (72, True, lambda f: sit_loop('ground', f)),
    'sit_ground_up': (26, False, lambda f: sit_up('ground', f)),
    'umbrella_open': (36, False, umbrella_open),
    'umbrella_hold': (48, True, umbrella_hold),
    'umbrella_walk': (20, True, umbrella_walk),
    'umbrella_close': (34, False, umbrella_close),
}


# ── Writing keyframes ────────────────────────────────────────────────────
FACE_OBJS = sorted({o for objs in FACE.values() for o in objs}, key=lambda o: o.name)
KEYED = sorted({ob for ob, _, _ in CH.values()} | set(FACE_OBJS) | {umb, gift, O['tail'], chair}, key=lambda o: o.name)


def apply_pose(p):
    """Set every animated property from a pose (no keys)."""
    for k, (ob, path, i) in CH.items():
        getattr(ob, path)[i] = p[k]
    umb.scale = (p['umb.s'],) * 3
    gift.scale = (p['gift.s'],) * 3
    O['tail'].scale = (p['tail.s'],) * 3
    chair.scale = (p['chair.s'],) * 3
    CANOPY_KEY.key_blocks['closed'].value = p['umb.closed']
    on = set(n for g in EXPR[p['face']] for n in [g])
    for g, objs in FACE.items():
        for o in objs:
            o.scale = (1, 1, 1) if g in on else (0, 0, 0)
    if 'eyes' in on:
        es, bl = p['eyes.s'], p['blink']
        for o in EYES:
            o.scale = (es, es, es * (1 - 0.9 * bl))
        for o in SHINES:
            o.scale = (es,) * 3 if bl < 0.5 else (0, 0, 0)


PATHS = {}
for k, (ob, path, i) in CH.items():
    PATHS.setdefault(ob, set()).add(path)
for ob in (umb, gift, O['tail'], chair, *FACE_OBJS):
    PATHS.setdefault(ob, set()).add('scale')


def key_all(frame):
    for ob, paths in PATHS.items():
        for path in paths:
            ob.keyframe_insert(path, frame=frame)
    CANOPY_KEY.keyframe_insert('key_blocks["closed"].value', frame=frame)


def make_action(name, frames, fn, loop):
    act = bpy.data.actions.get(name)
    if act:
        bpy.data.actions.remove(act)
    act = bpy.data.actions.new(name)
    ids = list(PATHS) + [CANOPY_KEY]
    for idb in ids:
        ad = idb.animation_data_create()
        ad.action = act
    last = frames if loop else frames - 1
    for f in range(0, last + 1):
        apply_pose(fn(f % frames if loop else f))
        key_all(f)
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, last
    act.use_cyclic = loop
    act.use_fake_user = True
    return act


made = {}
for name, (n, loop, fn) in CLIPS.items():
    made[name] = make_action(name, n, fn, loop)


# ── Showreel: the clips one after another, crossfading where loops meet ───
REEL = [('idle', 40), ('walk', 40), ('run', 28), ('chase', 32), ('run', 14), ('walk', 20), ('idle', 24),
        ('surprised', 40), ('idle', 12), ('laugh', 48), ('idle', 10), ('sad_in', 18), ('sad', 40), ('walk_sad', 56),
        ('sad', 16), ('sad_out', 18), ('idle', 12), ('gift', 84), ('idle', 12),
        ('sit_chair_down', 30), ('sit_chair', 60), ('sit_chair_up', 26), ('idle', 14),
        ('sit_ground_down', 30), ('sit_ground', 60), ('sit_ground_up', 26), ('idle', 12),
        ('umbrella_open', 36), ('umbrella_hold', 30), ('umbrella_walk', 60), ('umbrella_hold', 20), ('umbrella_close', 34), ('idle', 40)]
XF = 6  # crossfade frames between loops


def reel_pose(F):
    t = 0
    prev = None
    for name, dur in REEL:
        n, loop, fn = CLIPS[name]
        if F < t + dur:
            f = F - t
            p = fn(f % n if loop else min(f, n - 1))
            if prev and f < XF:
                pn, pt, ploop, pfn, pn_ = prev
                q = pfn((pt + f) % pn_ if ploop else pn_ - 1)
                p = blend(q, p, sm((f + 1) / (XF + 1)))
            return p
        prev = (name, dur, loop, fn, n)
        t += dur
    n, loop, fn = CLIPS['idle']
    return fn(0)


REEL_LEN = sum(d for _, d in REEL)
made['_showreel'] = make_action('_showreel', REEL_LEN, reel_pose, False)

# The scene plays the showreel; the clips are kept as actions (fake user) for export.
for idb in list(PATHS) + [CANOPY_KEY]:
    idb.animation_data.action = made['_showreel']
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 0, REEL_LEN - 1
markers = sc.timeline_markers
markers.clear()
t = 0
for name, dur in REEL:
    markers.new(name, frame=t)
    t += dur
result = {'clips': {k: (v.frame_range[0], v.frame_range[1]) for k, v in made.items()}, 'reel_frames': REEL_LEN}
