# The example cat's coat, plush style (after Animal Crossing: New Horizons): mostly flat
# colours with soft, slightly furry marking edges, a gentle baked shadow where parts meet,
# a fine fibre grain in the normal map, and a soft sheen on the edges (velvet).
# Run after cat_model.py.
import bpy, math, sys, importlib
import numpy as np
sys.path.insert(0, ART + r'\villagers')
import furpaint
importlib.reload(furpaint)
from furpaint import *

SIZE = 1024
FUR_PARTS = ['head', 'earL', 'earR', 'torso', 'armL', 'armR', 'legL', 'legR', 'tail']
objs = [bpy.data.objects[n] for n in FUR_PARTS]
for o in objs:
    for m in o.modifiers:
        if m.type == 'SUBSURF':
            m.levels = 1
apply_mods(objs)
unwrap(objs)
Pm, Nm, Im, cover, names = bake_maps(objs, SIZE)
# Soft shadow where parts meet; the face (eyes, nose, mouth) must not cast any, since it changes with expressions.
_others = [o for o in bpy.data.objects if o.type == 'MESH' and o not in objs and not o.name.startswith(('earIn', 'ground'))]
for o in _others:
    o.hide_render = True
AOm = bake_ao(objs, SIZE)
for o in _others:
    o.hide_render = False

TAIL = [np.array(p, np.float32) for p in TAIL_PTS]
tl = []
for a, b in zip(TAIL[:-1], TAIL[1:]):
    for t in np.linspace(0, 1, 12, endpoint=False):
        tl.append(a + (b - a) * t)
tl.append(TAIL[-1])
TL = np.array(tl)
TLs = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(TL, axis=0), axis=1))])

sel = cover
P, N, ID, AO = Pm[sel], norm(Nm[sel]), Im[sel], AOm[sel]
part = np.array([''] + names)[np.clip(ID, 0, len(names))]
is_ = lambda *ns: np.isin(part, ns)

# Fur flow (for the fibre grain and the furry edges of the markings)
H = np.array([0, 0, 0.98], np.float32)
nose = np.array([0, -0.31, 0.94], np.float32)
flow = np.zeros_like(P)
flow[:] = (0, 0, -1)
m = is_('head'); flow[m] = (P[m] - nose) + np.array([0, 0, -0.25])
m = is_('earL', 'earR'); flow[m] = (0, 0, 1)
for s, side in ((-1, 'L'), (1, 'R')):
    m = is_('arm' + side); flow[m] = np.array([ARM_B[0] - ARM_A[0], ARM_B[1] - ARM_A[1], ARM_B[2] - ARM_A[2]]) * np.array([s, 1, 1])
m = is_('legL', 'legR') & (P[:, 2] < 0.12); flow[m] = (0, -1, -0.2)
m = is_('tail')
dist = np.linalg.norm(P[m][:, None, :] - TL[None, :, :], axis=-1)
k = np.clip(dist.argmin(1), 0, len(TL) - 2)
flow[m] = TL[k + 1] - TL[k]
tail_s = TLs[k]

# Soft, slightly tufted marking edges: a mid-scale streak noise along the fur.
nm, _ = stroke_field(P, N, flow, size_across=45.0, size_along=9.0, seed=8)
jit = (nm - 0.5) * 0.16


def finish_coat(name, col, nose='#f08c9c', inner='#f3a3b0'):
    """Shared light, shadow and fibre on top of a coat's colours; texture + material."""
    col = col * (0.95 + 0.06 * sstep(-0.6, 0.8, N[:, 2]))[:, None]
    col = col * (0.62 + 0.38 * AO ** 0.8)[:, None]
    col = col * (0.975 + 0.04 * fib)[:, None]
    col = np.clip(col, 0, 1)
    full = np.tile(col.mean(0), (SIZE, SIZE, 1)).astype(np.float32)
    full[sel] = col
    img = write_texture('fur_' + name, SIZE, cover, full, ART + r'\villagers\fur_' + name + '.png')
    COATS[name] = {'fur': plush_mat('fur_' + name, img, nrm_img), 'nose': flat_mat('nose_' + name, nose, 0.55), 'inner': flat_mat('inner_' + name, inner, 0.6)}


def use_coat(name):
    c = COATS[name]
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(c['fur'])
    for n in ('nose',):
        o = bpy.data.objects[n]
        o.data.materials.clear(); o.data.materials.append(c['nose'])
    for n in ('earInL', 'earInR'):
        o = bpy.data.objects[n]
        o.data.materials.clear(); o.data.materials.append(c['inner'])


# Fine fibre grain and the normal map (shared by every coat)
fib, fib2 = stroke_field(P, N, flow, size_across=230.0, size_along=26.0, seed=11)
hgt = np.full((SIZE, SIZE), 0.5, np.float32)
tuft, _ = stroke_field(P, N, flow, size_across=70.0, size_along=10.0, seed=21)
hgt[sel] = 0.6 * fib + 0.25 * fib2 + 0.35 * tuft
nrm_img = height_to_normal('fur_n', hgt, cover, 2.2, ART + r'\villagers\fur_n.png')

COATS = {}
exec(open(ART + r'\villagers\cat_coats.py', encoding='utf-8').read())
use_coat('orange_tabby')
result = {'texels': int(sel.sum()), 'coats': list(COATS)}
