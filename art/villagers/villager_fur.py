# Fur (or feather, or skin) texture for the villager species just built by
# villager_build.py, plush style like the example cat: flat colours with soft furry
# marking edges, baked contact shadow, fibre grain in a normal map, velvet sheen.
# Paints a coat for every villager of this species (villager_coats.py).
import bpy, math, sys, importlib
import numpy as np
sys.path.insert(0, ART + r'\villagers')
import furpaint
importlib.reload(furpaint)
from furpaint import *

SIZE = 1024
FEEL = SPEC.get('fur', 'plush')
objs = list(FUR_PARTS)
for o in objs:
    for m in o.modifiers:
        if m.type == 'SUBSURF':
            m.levels = 1
apply_mods(objs)
unwrap(objs)
Pm, Nm, Im, cover, names = bake_maps(objs, SIZE)
_others = [o for o in bpy.data.objects if o.type == 'MESH' and o not in objs and not o.name.startswith(('earIn', 'ground'))]
for o in _others:
    o.hide_render = True
AOm = bake_ao(objs, SIZE)
for o in _others:
    o.hide_render = False

sel = cover
P, N, ID, AO = Pm[sel], norm(Nm[sel]), Im[sel], AOm[sel]
part = np.array([''] + names)[np.clip(ID, 0, len(names))]
is_ = lambda *ns: np.isin(part, ns)
H = np.array(HC, np.float32)
OBJ = bpy.data.objects


def wpos(name):
    return np.array(OBJ[name].matrix_world.translation, np.float32)


# Fur flow
nose = np.array(NOSE_TIP, np.float32)
flow = np.zeros_like(P)
flow[:] = (0, 0, -1)
m = is_('head'); flow[m] = (P[m] - nose) + np.array([0, 0, -0.25])
ear_t = np.zeros(len(P), np.float32)  # 0 at an ear's base, 1 at its tip
for e in ('earL', 'earR'):
    m = is_(e)
    if m.any():
        d = P[m] - wpos(e)
        flow[m] = d
        L = np.linalg.norm(d, axis=1)
        ear_t[m] = L / max(1e-6, L.max())
for s, side in ((-1, 'L'), (1, 'R')):
    m = is_('arm' + side); flow[m] = np.array([ARM_B[0] - ARM_A[0], ARM_B[1] - ARM_A[1], ARM_B[2] - ARM_A[2]]) * np.array([s, 1, 1])
m = is_('legL', 'legR') & (P[:, 2] < 0.12); flow[m] = (0, -1, -0.2)
TAILM = is_('tail')
tail_s = np.zeros(int(TAILM.sum()), np.float32)
TAIL_LEN = 1.0
if TAILM.any():
    if TAIL_PTS:
        TAIL = [np.array(p, np.float32) for p in TAIL_PTS]
        tl = []
        for a, b in zip(TAIL[:-1], TAIL[1:]):
            for t in np.linspace(0, 1, 12, endpoint=False):
                tl.append(a + (b - a) * t)
        tl.append(TAIL[-1])
        TL = np.array(tl)
        TLs = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(TL, axis=0), axis=1))])
        dist = np.linalg.norm(P[TAILM][:, None, :] - TL[None, :, :], axis=-1)
        k = np.clip(dist.argmin(1), 0, len(TL) - 2)
        flow[TAILM] = TL[k + 1] - TL[k]
        tail_s = TLs[k]
        TAIL_LEN = TLs[-1]
    else:
        d = P[TAILM] - wpos('tail')
        flow[TAILM] = d + np.array([0, 0.05, 0])
        tail_s = np.linalg.norm(d, axis=1)
        TAIL_LEN = max(1e-6, tail_s.max())
if FEEL == 'feather':
    # feathers lie down the body and back along the wings
    m = is_('torso'); flow[m] = (0, 0.15, -1)

nm, _ = stroke_field(P, N, flow, size_across=45.0, size_along=9.0, seed=8)
jit = (nm - 0.5) * (0.16 if FEEL != 'skin' else 0.05)

# Fibre grain and the normal map (shared by every coat of this species)
if FEEL == 'skin':
    fib = np.zeros(len(P), np.float32)
    hgt = np.full((SIZE, SIZE), 0.5, np.float32)
    hgt[sel] = 0.5 + 0.5 * fbm(P[:, 0] * 40, P[:, 1] * 40, P[:, 2] * 40, 3, 2)
    nrm_img = height_to_normal('fur_n_' + SPECIES_NAME, hgt, cover, 0.6, ART + rf'\villagers\fur_n_{SPECIES_NAME}.png')
else:
    fa, fl = (230.0, 26.0) if FEEL == 'plush' else (120.0, 30.0)
    fib, fib2 = stroke_field(P, N, flow, size_across=fa, size_along=fl, seed=11)
    hgt = np.full((SIZE, SIZE), 0.5, np.float32)
    tuft, _ = stroke_field(P, N, flow, size_across=70.0 if FEEL == 'plush' else 40.0, size_along=10.0 if FEEL == 'plush' else 16.0, seed=21)
    hgt[sel] = 0.6 * fib + 0.25 * fib2 + 0.35 * tuft
    nrm_img = height_to_normal('fur_n_' + SPECIES_NAME, hgt, cover, 2.2 if FEEL == 'plush' else 1.6, ART + rf'\villagers\fur_n_{SPECIES_NAME}.png')

COATS = {}
COAT_COLS = {}


def finish_coat(name, col, nose='#f08c9c', inner='#f3a3b0'):
    """Shared light, shadow and fibre on top of a coat's colours; texture + material."""
    col = col * (0.95 + 0.06 * sstep(-0.6, 0.8, N[:, 2]))[:, None]
    col = col * (0.62 + 0.38 * AO ** 0.8)[:, None]
    col = col * (0.975 + 0.04 * fib)[:, None]
    col = np.clip(col, 0, 1)
    full = np.tile(col.mean(0), (SIZE, SIZE, 1)).astype(np.float32)
    full[sel] = col
    img = write_texture('fur_' + name, SIZE, cover, full, ART + r'\villagers\fur_' + name + '.png')
    if FEEL == 'skin':
        mat = plush_mat('fur_' + name, img, nrm_img, rough=0.42, sheen=0.0)
        mat.node_tree.nodes['Normal Map'].inputs['Strength'].default_value = 0.35
    elif FEEL == 'feather':
        mat = plush_mat('fur_' + name, img, nrm_img, rough=0.75, sheen=0.35)
        mat.node_tree.nodes['Normal Map'].inputs['Strength'].default_value = 0.6
    else:
        mat = plush_mat('fur_' + name, img, nrm_img)
    COATS[name] = {'fur': mat, 'nose': flat_mat('nose_' + name, nose, 0.55), 'inner': flat_mat('inner_' + name, inner, 0.6)}
    COAT_COLS[name] = (nose, inner)


def use_coat(name):
    c = COATS[name]
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(c['fur'])
    for n in ('nose', 'earInL', 'earInR'):
        o = OBJ.get(n)
        if o and o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(c['nose' if n == 'nose' else 'inner'])


exec(open(ART + r'\villagers\coat_masks.py', encoding='utf-8').read())
exec(open(ART + r'\villagers\villager_coats.py', encoding='utf-8').read())
use_coat(list(COATS)[0])
result = {'species': SPECIES_NAME, 'texels': int(sel.sum()), 'coats': list(COATS)}
