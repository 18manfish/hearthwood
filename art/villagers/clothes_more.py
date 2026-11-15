# The rest of the clothing cuts (exec'd inside clothes.py, before the fabric textures):
# shirt, dresses, skirts, jacket, coat and the other hats. Pattern items get their own
# cut so the pattern can live in the atlas: shirt_gingham, skirt_denim, jacket_denim.


def skirt_bm(z_top, z_bot, r_top, flare, pleats=0, tiers=0, u=64, v=14):
    """A surface of revolution around the legs (elliptic, a bit flatter front to back)."""
    bm = bmesh.new()
    rows = []
    for j in range(v + 1):
        t = j / v
        z = z_top + (z_bot - z_top) * t
        r = r_top + flare * (z_top - z) + (0.012 * math.sin(t * tiers * math.pi) ** 2 if tiers else 0)
        row = []
        for i in range(u):
            a = i / u * 2 * math.pi
            rr = r * (1 + (0.05 * abs(math.sin(a * pleats / 2)) * t if pleats else 0))
            # a wavy hem
            zz = z - (0.006 * math.sin(a * 7) * t if not pleats else 0)
            row.append(bm.verts.new((math.sin(a) * rr, -math.cos(a) * rr * 0.88, zz)))
        rows.append(row)
    for j in range(v):
        for i in range(u):
            i2 = (i + 1) % u
            bm.faces.new((rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]))
    bm.normal_update()
    return bm


def waist_r(z):
    """Torso half-width at height z (outer surface)."""
    dz = (z - 0.55) / 0.235
    widen = 1 + 0.2 * max(0, -dz)
    return 0.205 * widen * math.sqrt(max(0.0, 1 - dz * dz))


def top_parts(prefix, off, z_lo, z_hi, sleeve, cuff=0.008, extra=()):
    parts = [('body', merge(band(torso_fn, off, z_lo, z_hi), *extra), body, (0, 0, 0.36))]
    if sleeve:
        for s in 'LR':
            parts.append(('arm' + s, arm_shell(s, off, sleeve, cuff), arms[s], arms[s].matrix_world.translation.copy()))
    return parts


def buttons(xs, zs, y_off=0.02, r=0.011):
    bms = []
    for x in xs:
        for z in zs:
            p = offset_fn(torso_fn, y_off)(Vector((x, -1, (z - 0.55) / 0.235)).normalized())
            b = sphere_bm(10, 6)
            bmesh.ops.scale(b, vec=(r, r * 0.5, r), verts=b.verts)
            bmesh.ops.translate(b, vec=p, verts=b.verts)
            bms.append(b)
    return merge(*bms)


def collar(off, z0, z1, flare=0.02):
    """A shirt collar: a band round the neck whose front points fold down."""
    bm = band(torso_fn, off + flare, z0, z1)
    for v in bm.verts:
        if v.co.y < 0:
            v.co.z -= 0.025 * max(0, 1 - abs(v.co.x) / 0.08)
    return bm


SHIRT = lambda name: top_parts(name, 0.018, 0.4, 0.77, 0.78, 0.01,
                               (collar(0.018, 0.74, 0.785), band(torso_fn, 0.026, 0.4, 0.42)))
garment('shirt', SHIRT('shirt'))
garment('shirt_gingham', SHIRT('shirt_gingham'))

# Dresses: a sleeveless bodice and a skirt flaring from the waist.
for nm_, z_bot, fl in (('dress_short', 0.3, 0.42), ('dress_knee', 0.2, 0.36), ('dress_long', 0.07, 0.3)):
    bod = merge(band(torso_fn, 0.016, 0.44, 0.75), band(torso_fn, 0.022, 0.73, 0.755))
    sk = skirt_bm(0.47, z_bot, waist_r(0.47) + 0.02, fl, tiers=2 if nm_ == 'dress_long' else 0)
    garment(nm_, [('body', merge(bod, sk), body, (0, 0, 0.36))])

for nm_, z_bot, fl, pl, ti in (('skirt_short', 0.3, 0.45, 0, 0), ('skirt_denim', 0.3, 0.4, 0, 0),
                               ('skirt_knee', 0.2, 0.4, 16, 0), ('skirt_long', 0.07, 0.32, 0, 3)):
    sk = merge(skirt_bm(0.46, z_bot, waist_r(0.46) + 0.024, fl, pleats=pl, tiers=ti), band(torso_fn, 0.03, 0.43, 0.47))
    garment(nm_, [('body', sk, body, (0, 0, 0.36))])


def open_front(bm, half=0.03):
    """Cut a gap down the front (jackets and coats are worn open)."""
    gone = [f for f in bm.faces if f.calc_center_median().y < -0.05 and abs(f.calc_center_median().x) < half]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    return bm


JACKET = lambda: top_parts('jacket', 0.038, 0.39, 0.785, 0.9, 0.012,
                           (collar(0.038, 0.74, 0.79, 0.016),))
garment('jacket', JACKET())
garment('jacket_denim', JACKET())
for nm_ in ('jacket', 'jacket_denim'):
    o = GARMENTS[nm_][0]
    bm = bmesh.new(); bm.from_mesh(o.data); open_front(bm, 0.025); bm.to_mesh(o.data); bm.free()

coat_skirt = skirt_bm(0.42, 0.24, waist_r(0.42) + 0.045, 0.25)
coat_parts = top_parts('coat', 0.045, 0.4, 0.79, 0.95, 0.014,
                       (collar(0.045, 0.74, 0.8, 0.02), coat_skirt, buttons((-0.09, 0.09), (0.47, 0.56, 0.65), 0.058)))
garment('coat', coat_parts)


# ── Hats ──────────────────────────────────────────────────────────────────
def crown(off, z_cut):
    d = blob(offset_fn(head_fn, off), 40, 30)
    cut(d, (0, 0, HCv.z + z_cut), (0, 0, 1))
    return d


def brim_bm(r_in, r_out, z, droop=0.0, front_only=False, ry=0.94, seg=48):
    bm = bmesh.new()
    rows = []
    for j, t in enumerate((0, 0.5, 1)):
        r = r_in + (r_out - r_in) * t
        row = []
        for i in range(seg):
            a = i / seg * 2 * math.pi
            if front_only:
                a = math.pi * 0.5 + a / 2 + math.pi * 0.25 * 0  # half circle at the front
                a = math.pi + (i / (seg - 1) - 0.5) * math.pi * 1.1
            rr = r if not front_only else r_in + (r - r_in) * (0.35 + 0.65 * math.cos((a - math.pi)) ** 2)
            row.append(bm.verts.new((math.sin(a) * rr, math.cos(a) * rr * ry, z - droop * t * t)))
        rows.append(row)
    n = seg if not front_only else seg - 1
    for j in range(2):
        for i in range(n):
            i2 = (i + 1) % seg
            bm.faces.new((rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]))
    return bm


# Explorer cap: a rounded crown and a stiff peak at the front.
cap_c = crown(0.026, 0.13)
peak = brim_bm(0.26, 0.42, HCv.z + 0.135, 0.02, front_only=True)
btn = sphere_bm(10, 6)
bmesh.ops.scale(btn, vec=(0.022, 0.022, 0.012), verts=btn.verts)
bmesh.ops.translate(btn, vec=(0, 0, HCv.z + 0.33), verts=btn.verts)
garment('cap', [('hat', merge(cap_c, peak, btn), head, HC)])

# Bucket hat: a deep soft crown and a short brim sloping down all round.
bc = sphere_bm(40, 20)
for v_ in bc.verts:
    d = v_.co.normalized()
    v_.co = Vector((d.x * 0.335, d.y * 0.31, max(d.z, 0.0) * 0.21)) + Vector((0, 0.0, HCv.z + 0.12))
cut(bc, (0, 0, HCv.z + 0.125), (0, 0, 1))
bb = brim_bm(0.325, 0.45, HCv.z + 0.13, 0.07, ry=0.93)
garment('bucket_hat', [('hat', merge(bc, bb), head, HC)])

# Sun hat: a soft low crown and a very wide, wavy brim, with a ribbon.
sc_ = sphere_bm(40, 20)
for v_ in sc_.verts:
    d = v_.co.normalized()
    v_.co = Vector((d.x * 0.26, d.y * 0.245, max(d.z, -0.1) * 0.16)) + Vector((0, 0.01, HCv.z + 0.2))
cut(sc_, (0, 0, HCv.z + 0.19), (0, 0, 1))
sb = brim_bm(0.25, 0.66, HCv.z + 0.19, 0.12, seg=64)
for v_ in sb.verts:
    a = math.atan2(v_.co.x, v_.co.y)
    r = math.hypot(v_.co.x, v_.co.y)
    v_.co.z += 0.025 * math.sin(a * 6) * max(0, r - 0.3) / 0.36
sr = sphere_bm(40, 12)
for v_ in sr.verts:
    d = v_.co.normalized()
    v_.co = Vector((d.x * 0.265, d.y * 0.25, d.z * 0.028)) + Vector((0, 0.01, HCv.z + 0.215))
garment('sun_hat', [('hat', merge(sc_, sb), head, HC)])
sun_rib = finish('sun_hat.ribbon', sr, HC, head, subd=1)
sun_rib['garment'] = 'sun_hat'
sun_rib.data.materials.append(flat_mat('ribbon_sun', '#f4a7b9', 0.7))
GARMENTS['sun_hat'].append(sun_rib)

# Flower crown: a twig ring round the head with flowers and leaves (fixed colours).
ring_pts = []
for i in range(25):
    a = i / 24 * 2 * math.pi
    d = Vector((math.sin(a), -math.cos(a), 0.5)).normalized()
    ring_pts.append(offset_fn(head_fn, 0.012)(d))
twig = tube('flower_crown.hat', ring_pts, [1.0] * 25, 0.016, head, None, res=3)
set_origin(twig, HC)
twig['garment'] = 'flower_crown'; twig['part'] = 'hat'
GARMENTS['flower_crown'] = [twig]
FLOWER_COLS = ['#ff8fb1', '#ffd166', '#ffffff', '#c39bd3']
fl_mats = [flat_mat('flower_' + str(k), c_, 0.6) for k, c_ in enumerate(FLOWER_COLS)]
leaf_mat = flat_mat('flower_leaf', '#6bb35a', 0.6)
centre_mat = flat_mat('flower_centre', '#f2b134', 0.6)
fbms, leaves, centres = {k: [] for k in range(4)}, [], []
for i in range(12):
    a = (i + 0.5) / 12 * 2 * math.pi
    d = Vector((math.sin(a), -math.cos(a), 0.5)).normalized()
    p = offset_fn(head_fn, 0.03)(d)
    n = (p - HCv).normalized()
    x = Vector((0, 0, 1)).cross(n).normalized(); y = n.cross(x)
    for k in range(5):
        b = math.radians(72 * k + i * 17)
        pb = sphere_bm(10, 6)
        bmesh.ops.scale(pb, vec=(0.024, 0.006, 0.014), verts=pb.verts)
        m = Matrix((x, n, y)).transposed()
        bmesh.ops.rotate(pb, verts=pb.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(b, 3, 'Y'))
        bmesh.ops.translate(pb, vec=(math.cos(b) * 0.022, 0, math.sin(b) * 0.022), verts=pb.verts)
        bmesh.ops.transform(pb, matrix=Matrix.Translation(p) @ m.to_4x4(), verts=pb.verts)
        fbms[i % 4].append(pb)
    cb_ = sphere_bm(8, 6)
    bmesh.ops.scale(cb_, vec=(0.011, 0.011, 0.011), verts=cb_.verts)
    bmesh.ops.translate(cb_, vec=p + n * 0.006, verts=cb_.verts)
    centres.append(cb_)
    lb = sphere_bm(8, 6)
    bmesh.ops.scale(lb, vec=(0.03, 0.012, 0.005), verts=lb.verts)
    q = offset_fn(head_fn, 0.02)(Vector((math.sin(a + 0.26), -math.cos(a + 0.26), 0.46)).normalized())
    bmesh.ops.transform(lb, matrix=Matrix.Translation(q) @ Matrix((x, y, n)).transposed().to_4x4(), verts=lb.verts)
    leaves.append(lb)
for k, lst in fbms.items():
    o = finish(f'flower_crown.flowers{k}', merge(*lst), HC, head, subd=1, mat=fl_mats[k])
    o['garment'] = 'flower_crown'; o['part'] = 'hat'; o['fixed'] = True
    GARMENTS['flower_crown'].append(o)
for nm_, lst, mt in (('leaves', leaves, leaf_mat), ('centres', centres, centre_mat)):
    o = finish('flower_crown.' + nm_, merge(*lst), HC, head, subd=1, mat=mt)
    o['garment'] = 'flower_crown'; o['part'] = 'hat'; o['fixed'] = True
    GARMENTS['flower_crown'].append(o)
twig.data.materials.append(flat_mat('flower_twig', '#8a6a44', 0.7))
twig['fixed'] = True
