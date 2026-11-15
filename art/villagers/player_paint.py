# Shading for the player model (run after player_build.py): one baked atlas for skin,
# undershirt and trousers – light from above and soft contact shadow, white so the game
# can tint each material with the player's colours – plus a normal map with a fine
# cotton weave on the clothes and smooth skin; and a tileable strand texture for hair.
import bpy, math, sys, importlib
import numpy as np
sys.path.insert(0, ART + r'\villagers')
import furpaint
importlib.reload(furpaint)
from furpaint import *

SIZE = 1024
G = SPECIES_NAME.split('_')[1]  # m / f
objs = list(FUR_PARTS)
for o in objs:
    for m in o.modifiers:
        if m.type == 'SUBSURF':
            m.levels = 1
apply_mods(objs)
unwrap(objs)
Pm, Nm, Im, cover, names = bake_maps(objs, SIZE)
_others = [o for o in bpy.data.objects if o.type == 'MESH' and o not in objs and not o.name.startswith('earIn')]
for o in _others:
    o.hide_render = True
AOm = bake_ao(objs, SIZE)
for o in _others:
    o.hide_render = False

sel = cover
P, N, ID, AO = Pm[sel], norm(Nm[sel]), Im[sel], AOm[sel]
part = np.array([''] + names)[np.clip(ID, 0, len(names))]
is_ = lambda *ns: np.isin(part, ns)
A_, B_ = np.array(ARM_A, np.float32), np.array(ARM_B, np.float32)
cloth = np.zeros(len(P), bool)
cloth |= is_('torso')
cloth |= is_('legL', 'legR') & (P[:, 2] > 0.135)
for s, side in ((-1, 'L'), (1, 'R')):
    a = A_ * np.array([s, 1, 1]); b = B_ * np.array([s, 1, 1])
    t = ((P - a) @ (b - a)) / np.dot(b - a, b - a)
    cloth |= is_('arm' + side) & (t < 0.42)

shade = (0.95 + 0.06 * sstep(-0.6, 0.8, N[:, 2])) * (0.66 + 0.34 * AO ** 0.8)
weave = 0.5 + 0.25 * np.sin(P[:, 0] * 900) * np.sin(P[:, 2] * 900) + 0.25 * np.sin((P[:, 1] + P[:, 2]) * 700)
shade = shade * np.where(cloth, 0.97 + 0.04 * weave, 1.0)
full = np.ones((SIZE, SIZE, 3), np.float32) * float(shade.mean())
full[sel] = np.clip(shade, 0, 1)[:, None]
img = write_texture(f'player_{G}_shade', SIZE, cover, full, ART + rf'\villagers\player_{G}_shade.png')
hgt = np.full((SIZE, SIZE), 0.5, np.float32)
hgt[sel] = np.where(cloth, 0.5 + 0.5 * weave, 0.5 + 0.08 * fbm(P[:, 0] * 30, P[:, 1] * 30, P[:, 2] * 30, 3, 2))
nrm = height_to_normal(f'player_{G}_n', hgt, cover, 1.2, ART + rf'\villagers\player_{G}_n.png')


def shaded(mat, rough):
    m = mat
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
            nt.nodes.remove(n)
    bsdf = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 0.7
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = rough


split_materials()
for mname, rough in (('skin', 0.55), ('shirt', 0.85), ('pants', 0.85)):
    shaded(bpy.data.materials[mname], rough)

# Hair strands: streaks running down (v), soft sheen bands, a normal map from the streaks.
HS = 512
u = (np.arange(HS, dtype=np.float32) / HS)[None, :].repeat(HS, 0)
v = (np.arange(HS, dtype=np.float32) / HS)[:, None].repeat(HS, 1)
streak = np.zeros_like(u)
for k, (f, a) in enumerate(((24, 0.5), (57, 0.3), (131, 0.2))):
    ph = np.sin(v * 2 * math.pi * (k + 1)) * 0.6
    streak += a * (0.5 + 0.5 * np.sin(u * 2 * math.pi * f + ph + k))
tone = 0.82 + 0.2 * streak
hair_rgb = np.repeat(tone[..., None], 3, -1)
himg = bpy.data.images.new(f'player_hair', HS, HS, alpha=False)
px = np.ones((HS, HS, 4), np.float32); px[..., :3] = hair_rgb
himg.pixels.foreach_set(px.ravel()); himg.filepath_raw = ART + r'\villagers\player_hair.png'; himg.file_format = 'PNG'; himg.save()
hn = height_to_normal('player_hair_n', streak, np.ones((HS, HS), bool), 3.0, ART + r'\villagers\player_hair_n.png')
hm = bpy.data.materials['hair']
hm.use_nodes = True
nt = hm.node_tree
bsdf = nt.nodes['Principled BSDF']
t = nt.nodes.new('ShaderNodeTexImage'); t.image = himg
nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = hn
nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 0.6
nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = 0.45
result = {'player': SPECIES_NAME, 'texels': int(sel.sum()), 'cloth': int(cloth.sum())}
