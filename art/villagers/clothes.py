# Villager clothes: pieces fitted to the shared villager body, one object per rig part
# (a shirt is a torso piece plus a sleeve on each arm), so they move with the body and
# can be swapped. Fabric textures are near-white and drawn, tinted by the item colour.
# Run inside Blender after the villager model (needs torso_fn, head_fn, HC from it).

import bpy, bmesh, math, sys, importlib
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, ART + r'\villagers')
import vlib, furpaint
importlib.reload(vlib)
importlib.reload(furpaint)
from vlib import *
from furpaint import *

body = bpy.data.objects['body']
head = bpy.data.objects['head']
arms = {s: bpy.data.objects['arm' + s] for s in 'LR'}
GARMENTS = {}  # name -> list of objects


def offset_fn(fn, off):
    """Surface function pushed out along its normal."""
    def g(d):
        p = fn(d)
        e = 1e-3
        a = fn((d + Vector((e, 0, 0))).normalized()) - p
        b = fn((d + Vector((0, e, 0))).normalized()) - p
        c = fn((d + Vector((0, 0, e))).normalized()) - p
        n = a.cross(c) if a.cross(c).length > 1e-9 else a.cross(b)
        n.normalize()
        if n.dot(d) < 0:
            n = -n
        return p + n * off
    return g


def cut(bm, co, no):
    """Keep the side of the plane the normal points to."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=-Vector(no), clear_outer=True)
    return bm


def band(fn, off, zlo, zhi, u=40, v=30):
    bm = blob(offset_fn(fn, off), u, v)
    cut(bm, (0, 0, zlo), (0, 0, 1))
    cut(bm, (0, 0, zhi), (0, 0, -1))
    return bm


def arm_shell(side, off, t_end, cuff=0.0):
    """A sleeve around an arm, from the shoulder down to t_end (0..1 along the arm)."""
    s = -1 if side == 'L' else 1
    a, b = Vector((ARM_A[0] * s, ARM_A[1], ARM_A[2])), Vector((ARM_B[0] * s, ARM_B[1], ARM_B[2]))
    bm = capsule(a, b, ARM_R0 + off, ARM_R1 + off, 28, 20)
    axis = (b - a).normalized()
    cut(bm, a + (b - a) * t_end, -axis)
    if cuff:
        cb = capsule(a, b, ARM_R0 + off + cuff, ARM_R1 + off + cuff, 28, 20)
        cut(cb, a + (b - a) * t_end, -axis)
        cut(cb, a + (b - a) * (t_end - 0.09), axis)
        bm = merge(bm, cb)
    return bm


def solid(o, t=0.008):
    m = o.modifiers.new('Solidify', 'SOLIDIFY')
    m.thickness = t
    m.offset = 1
    return o


def cloth_mat(name, color, tex=None, rough=0.92):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = rough
    try:
        bsdf.inputs['Specular IOR Level'].default_value = 0.15
    except KeyError:
        pass
    mixn = nt.nodes.get('tint') or nt.nodes.new('ShaderNodeMix')
    mixn.name = 'tint'
    mixn.data_type = 'RGBA'
    mixn.blend_type = 'MULTIPLY'
    mixn.inputs['Factor'].default_value = 1.0
    mixn.inputs[7].default_value = (*color_lin(color), 1)
    nt.links.new(mixn.outputs[2], bsdf.inputs['Base Color'])
    if tex:
        t = nt.nodes.get('ctex') or nt.nodes.new('ShaderNodeTexImage')
        t.name = 'ctex'
        t.image = tex
        nt.links.new(t.outputs['Color'], mixn.inputs[6])
    m['tint'] = color
    return m


def garment(name, parts):
    objs = []
    for part_name, bm, parent, pivot in parts:
        o = finish(f'{name}.{part_name}', bm, pivot, parent, subd=1)
        solid(o)
        o['garment'] = name
        o['part'] = part_name
        objs.append(o)
    GARMENTS[name] = objs
    return objs


TC = Vector((0, 0, 0.55))
HCv = Vector(HC)

# T-shirt: body from the hips to the neck, short sleeves, rolled hem and collar.
tee = garment('tshirt', [
    ('body', merge(band(torso_fn, 0.016, 0.42, 0.765), band(torso_fn, 0.026, 0.42, 0.445), band(torso_fn, 0.024, 0.735, 0.765)), body, (0, 0, 0.36)),
    ('armL', arm_shell('L', 0.016, 0.52, 0.008), arms['L'], arms['L'].matrix_world.translation.copy()),
    ('armR', arm_shell('R', 0.016, 0.52, 0.008), arms['R'], arms['R'].matrix_world.translation.copy()),
])
# Pullover: longer, long sleeves with ribbed cuffs, ribbed waistband and a roll neck.
pull = garment('pullover', [
    ('body', merge(band(torso_fn, 0.022, 0.38, 0.775), band(torso_fn, 0.034, 0.38, 0.43), band(torso_fn, 0.036, 0.735, 0.785)), body, (0, 0, 0.36)),
    ('armL', arm_shell('L', 0.02, 0.93, 0.012), arms['L'], arms['L'].matrix_world.translation.copy()),
    ('armR', arm_shell('R', 0.02, 0.93, 0.012), arms['R'], arms['R'].matrix_world.translation.copy()),
])


# Beanie: a knitted dome with a folded cuff and a pompom.
def beanie_bm():
    dome = blob(offset_fn(head_fn, 0.03), 40, 30)
    cut(dome, (0, 0, HCv.z + 0.1), (0, 0, 1))
    cuffb = blob(offset_fn(head_fn, 0.05), 40, 30)
    cut(cuffb, (0, 0, HCv.z + 0.1), (0, 0, 1))
    cut(cuffb, (0, 0, HCv.z + 0.17), (0, 0, -1))
    pom = sphere_bm(20, 14)
    bmesh.ops.scale(pom, vec=(0.075, 0.075, 0.07), verts=pom.verts)
    bmesh.ops.translate(pom, vec=(0, 0.02, HCv.z + 0.34), verts=pom.verts)
    return merge(dome, cuffb), pom


bdome, bpom = beanie_bm()
beanie = garment('beanie', [('hat', bdome, head, HC)])
pom = finish('beanie.pom', bpom, HC, head, subd=1)
pom['garment'] = 'beanie'
GARMENTS['beanie'].append(pom)


# Straw hat: a low crown and a wide, slightly drooping brim with a ribbon.
def straw_bm():
    crown = sphere_bm(40, 20)
    for v in crown.verts:
        d = v.co.normalized()
        v.co = Vector((d.x * 0.27, d.y * 0.25, max(d.z, -0.1) * 0.17)) + Vector((0, 0.01, HCv.z + 0.2))
    cut(crown, (0, 0, HCv.z + 0.19), (0, 0, 1))
    brim = bmesh.new()
    bmesh.ops.create_circle(brim, cap_ends=True, segments=48, radius=1.0)
    bmesh.ops.subdivide_edges(brim, edges=brim.edges[:], cuts=3, use_grid_fill=True)
    for v in brim.verts:
        r = math.hypot(v.co.x, v.co.y)
        v.co = Vector((v.co.x * 0.52, v.co.y * 0.5, HCv.z + 0.19 - 0.07 * max(0, r - 0.45) ** 2))
    rib = sphere_bm(40, 12)
    for v in rib.verts:
        d = v.co.normalized()
        v.co = Vector((d.x * 0.275, d.y * 0.255, d.z * 0.03)) + Vector((0, 0.01, HCv.z + 0.22))
    return merge(crown, brim), rib


sbm, rbm = straw_bm()
straw = garment('straw_hat', [('hat', sbm, head, HC)])
ribbon = finish('straw_hat.ribbon', rbm, HC, head, subd=1)
ribbon['garment'] = 'straw_hat'
ribbon.data.materials.append(flat_mat('ribbon', '#c0392b', 0.7))
GARMENTS['straw_hat'].append(ribbon)


exec(open(ART + r'\villagers\clothes_more.py', encoding='utf-8').read())

# ── Fabric textures (one shared atlas) ────────────────────────────────────
SIZE = 1024
cloth = [o for objs in GARMENTS.values() for o in objs if not o.name.endswith('.ribbon') and not o.get('fixed')]
for o in cloth:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        if m.type == 'SUBSURF':
            bpy.ops.object.modifier_apply(modifier=m.name)
unwrap(cloth, 0.008)
Pm, Nm, Im, cover, names = bake_maps(cloth, SIZE)
P, N, ID = Pm[cover], norm(Nm[cover]), Im[cover]
part = np.array([''] + names)[np.clip(ID, 0, len(names))]
gar = np.array([n.split('.')[0] for n in part])
col = np.ones((len(P), 3), np.float32)

# knit (pullover, beanie): vertical ribs and little V stitches
knit = np.isin(gar, ('pullover', 'beanie'))
th = np.arctan2(P[:, 0], P[:, 1] + 0.001)
rib_u = np.where(np.isin(part, ('pullover.body', 'beanie.hat')), th * 0.25 / (2 * np.pi) * 2 * np.pi / 0.025, 0)
# sleeves: around the arm axis
for s, sgn in (('L', -1), ('R', 1)):
    m = part == f'pullover.arm{s}'
    a = np.array([ARM_A[0] * sgn, ARM_A[1], ARM_A[2]]); b = np.array([ARM_B[0] * sgn, ARM_B[1], ARM_B[2]])
    ax = (b - a) / np.linalg.norm(b - a)
    q = P[m] - a
    side = np.cross(ax, [0, 1.0, 0]); side /= np.linalg.norm(side)
    up = np.cross(side, ax)
    rib_u[m] = np.arctan2(q @ side, q @ up) * 0.075 / 0.025
v_row = P[:, 2] / 0.022
ribs = 0.5 + 0.5 * np.cos(rib_u * 2 * np.pi)
vst = np.abs(((v_row + np.abs((rib_u % 1) - 0.5) * 1.2) % 1) - 0.5)
k = 1 - 0.1 * sstep(0.35, 0.95, ribs) - 0.06 * sstep(0.18, 0.05, vst)
col[knit] *= k[knit][:, None]
# ribbed bands: stronger ribs
bandz = (np.isin(part, ('pullover.body',)) & ((P[:, 2] < 0.43) | (P[:, 2] > 0.735))) | (part == 'beanie.hat') & (P[:, 2] < HCv.z + 0.175)
col[bandz] *= (1 - 0.12 * sstep(0.3, 0.9, ribs[bandz]))[:, None]

# cotton (t-shirt): soft folds and stitched hems
COTTON = ('tshirt', 'shirt', 'shirt_gingham', 'dress_short', 'dress_knee', 'dress_long', 'skirt_short', 'skirt_knee', 'skirt_long', 'cap', 'bucket_hat')
tee_m = np.isin(gar, COTTON)
nz = fbm(P[:, 0] * 9, P[:, 1] * 9, P[:, 2] * 3, 7, 2)
fold = np.floor(nz * 3) / 2
col[tee_m] *= (0.93 + 0.07 * np.clip(fold[tee_m], 0, 1))[:, None]
edge = np.abs((nz * 3) % 1 - 0.5)
inkline = sstep(0.5, 0.46, edge) * sstep(0.45, 0.65, vnoise(P[:, 0] * 14, P[:, 1] * 14, P[:, 2] * 5, 3))
col[tee_m] *= (1 - 0.22 * inkline[tee_m])[:, None]
# stitches: dashed lines just inside the hems
dash = sstep(0.0, 0.2, np.sin(th * 70))
hem = tee_m & (part == 'tshirt.body') & (np.abs(P[:, 2] - 0.45) < 0.0035)
col[hem] *= (1 - 0.3 * dash[hem])[:, None]
col_hem2 = tee_m & (part == 'tshirt.body') & (np.abs(P[:, 2] - 0.73) < 0.0035)
col[col_hem2] *= (1 - 0.3 * dash[col_hem2])[:, None]

# straw: woven
st = np.isin(gar, ('straw_hat', 'sun_hat'))
r = np.hypot(P[:, 0], P[:, 1])
w1 = np.cos(th * 60) * np.cos(r * 160 + P[:, 2] * 160)
weave = 0.9 + 0.1 * sstep(-0.3, 0.6, w1)
col[st] *= weave[st][:, None]
col[st] *= (1 - 0.18 * sstep(0.92, 1.0, np.abs(np.cos(r[st] * 80 + P[st][:, 2] * 80))))[:, None]

# pompom: fluffy strokes radiating out
pm = part == 'beanie.pom'
if pm.any():
    c0 = np.array([0, 0.02, HCv.z + 0.34], np.float32)
    pc, _ = strokes(P[pm], N[pm], P[pm] - c0, col[pm], np.full(pm.sum(), 0.03, np.float32), np.full(pm.sum(), 0.0045, np.float32), seed=4)
    col[pm] = pc

# gingham: woven checks (white / mid / full tint)
gm = gar == 'shirt_gingham'
k = 95.0
cx = sstep(-0.15, 0.15, np.sin(P[:, 0] * k + 0.5 * np.sin(P[:, 1] * k)))
cz = sstep(-0.15, 0.15, np.sin(P[:, 2] * k))
check = 0.4 + 0.3 * cx + 0.3 * cz
# pattern cuts are painted in their real colours (the game does not tint them)
red = np.array([0.85, 0.33, 0.31])
wv = (0.5 * cx + 0.5 * cz)[gm]
col[gm] = col[gm] * ((1 - wv)[:, None] * np.array([1, 1, 1]) + wv[:, None] * red * (0.75 + 0.25 * wv[:, None]))
# denim: diagonal twill, mottled fades and orange-ish top stitching
dn = np.isin(gar, ('skirt_denim', 'jacket_denim'))
tw = 0.5 + 0.5 * np.sin((P[:, 0] + P[:, 2]) * 520 + P[:, 1] * 300)
fade = fbm(P[:, 0] * 14, P[:, 1] * 14, P[:, 2] * 14, 17, 3)
col[dn] *= np.array([0.36, 0.5, 0.72]) * (0.86 + 0.08 * tw[dn] + 0.25 * (fade[dn] - 0.5))[:, None]
seam = (np.abs(((P[:, 2] - 0.39) % 0.09) - 0.002) < 0.0025) & dn
col[seam] = col[seam] * 0.3 + np.array([0.95, 0.75, 0.45]) * 0.7 * sstep(0.0, 0.3, np.sin(th[seam] * 90))[:, None]
# wool coat: felted
wl = gar == 'coat'
felt = fbm(P[:, 0] * 60, P[:, 1] * 60, P[:, 2] * 60, 23, 3)
col[wl] *= (0.9 + 0.12 * felt[wl])[:, None]
# rain jacket: smooth, with a few seam lines
rj = gar == 'jacket'
rs = (np.abs(P[:, 2] - 0.6) < 0.003) & rj
col[rs] *= 0.8
# skirts and dresses: soft vertical folds
sk = np.isin(gar, ('dress_short', 'dress_knee', 'dress_long', 'skirt_short', 'skirt_knee', 'skirt_long', 'skirt_denim', 'coat')) & (P[:, 2] < 0.47)
col[sk] *= (0.92 + 0.08 * (0.5 + 0.5 * np.cos(th[sk] * 9 + 2 * fbm(P[sk][:, 0] * 4, P[sk][:, 1] * 4, P[sk][:, 2] * 4, 5, 1))))[:, None]

full = np.ones((SIZE, SIZE, 3), np.float32)
full[cover] = col
ctex = write_texture('cloth_villager', SIZE, cover, full, ART + r'\villagers\cloth_villager.png')
COLORS = {'tshirt': '#6ec1e4', 'pullover': '#f1e6d0', 'beanie': '#c0392b', 'straw_hat': '#e8c872'}
for o in cloth:
    gname = o['garment']
    o.data.materials.clear()
    o.data.materials.append(cloth_mat('cloth_' + gname, COLORS.get(gname, '#ffffff'), ctex))


def wear(*names):
    """Show only these garments (and hide the cat's ears under a beanie? no – ears poke through)."""
    for gname, objs in GARMENTS.items():
        for o in objs:
            o.hide_render = o.hide_viewport = gname not in names


wear('tshirt', 'beanie')
result = {'garments': {k: [o.name for o in v] for k, v in GARMENTS.items()}}
