# Hand-drawn fur textures for villagers (run inside Blender).
#
# All fur parts are unwrapped into one shared texture. For every texel we bake where it
# sits on the body (world position, normal, which part), then paint in numpy: the
# species' markings, and short drawn strokes that follow the fur's flow, with thin
# ink lines along the edges of the clumps. Painting in 3D keeps the strokes continuous
# across UV seams.

import bpy, math
import numpy as np


# ── Noise ────────────────────────────────────────────────────────────────

def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = h & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFF).astype(np.float32) / 65535.0


def vnoise(x, y, z, seed=0):
    ix, iy, iz = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64), np.floor(z).astype(np.int64)
    fx, fy, fz = x - ix, y - iy, z - iz
    ux, uy, uz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (ux if dx else 1 - ux) * (uy if dy else 1 - uy) * (uz if dz else 1 - uz)
                out = out + w * _hash(ix + dx, iy + dy, iz + dz, seed)
    return out


def fbm(x, y, z, seed=0, oct=2):
    a, s, tot = 1.0, 1.0, 0.0
    out = 0
    for k in range(oct):
        out = out + a * vnoise(x * s, y * s, z * s, seed + k * 17)
        tot += a
        a *= 0.5
        s *= 2.03
    return out / tot


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


# ── Baking ───────────────────────────────────────────────────────────────

def unwrap(objs, margin=0.006):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def apply_mods(objs):
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


def bake_maps(objs, size):
    """World position, world normal and part index of every texel (float arrays, H x W x 3)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.cycles.device = 'CPU'
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    mat = bpy.data.materials.new('_bake')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    info = nt.nodes.new('ShaderNodeObjectInfo')
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    nt.nodes.active = tex
    saved = {o.name: [s.material for s in o.material_slots] for o in objs}
    for i, o in enumerate(objs):
        o.pass_index = i + 1
        o.data.materials.clear()
        o.data.materials.append(mat)
    res = {}
    for key, sock in (('pos', geo.outputs['Position']), ('nrm', geo.outputs['Normal']), ('id', info.outputs['Object Index'])):
        img = bpy.data.images.new('_bake_' + key, size, size, alpha=True, float_buffer=True)
        img.generated_color = (0, 0, 0, 0)
        tex.image = img
        for l in list(nt.links):
            if l.to_node == em:
                nt.links.remove(l)
        nt.links.new(sock, em.inputs['Color'])
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type='EMIT')
        a = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(a)
        res[key] = a.reshape(size, size, 4)
        bpy.data.images.remove(img)
    for o in objs:
        o.data.materials.clear()
        for m in saved[o.name]:
            o.data.materials.append(m)
    bpy.data.materials.remove(mat)
    names = [o.name for o in objs]
    return res['pos'][..., :3], res['nrm'][..., :3], np.rint(res['id'][..., 0]).astype(np.int32), res['pos'][..., 3] > 0.5, names


# ── Painting ─────────────────────────────────────────────────────────────

def norm(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)


def stroke_field(P, N, flow, size_across=34.0, size_along=6.5, seed=3):
    """Stroke noise along the fur: n (0..1, streaky), n2 (breaks it up)."""
    T = flow - N * np.sum(flow * N, -1, keepdims=True)
    bad = np.linalg.norm(T, axis=-1) < 1e-4
    T[bad] = np.cross(N[bad], np.array([1.0, 0, 0], np.float32))
    T = norm(T)
    S = norm(np.cross(N, T))
    u = np.sum(P * S, -1) * size_across
    v = np.sum(P * T, -1) * size_along
    w = np.sum(P * N, -1) * 6.0
    n = fbm(u, v, w, seed, 2)
    n2 = vnoise(u * 0.5 + 11, v * 0.6, w, seed + 5)
    return n, n2


def paint(base, n, n2, ink=0.6, ink_amount=0.6):
    """Drawn fur over `base` colours (N x 3, sRGB 0..1)."""
    # clumps: a few soft tone bands (painterly), lighter tips, darker roots
    k = 3.0
    frac = n * k - np.floor(n * k)
    band = np.floor(n * k) / (k - 1) + (1 / (k - 1)) * sstep(0.82, 1.0, frac)
    tone = 0.86 + 0.2 * np.clip(band, 0, 1)
    col = base * tone[:, None]
    # ink lines along the edges of some clumps
    edge = np.abs(frac - 0.5)
    line = sstep(0.5, 0.44, edge) * sstep(0.35, 0.6, n2)
    col = col * (1 - line[:, None] * (1 - ink) * ink_amount)
    # a few light highlight strokes
    hi = sstep(0.8, 0.9, n) * sstep(0.55, 0.75, n2)
    col = col + (1 - col) * (hi * 0.22)[:, None]
    return np.clip(col, 0, 1)


def cap(q, d, a0, a1, jit=0.0):
    """1 within angle a0 of direction d (seen from the origin of q), 0 beyond a1."""
    d = np.asarray(d, np.float32)
    d = d / np.linalg.norm(d)
    ang = np.arccos(np.clip(np.sum(norm(q) * d, -1), -1, 1)) + jit
    return sstep(a1, a0, ang)


def mix(col, c, m):
    return col * (1 - m[:, None]) + np.asarray(c, np.float32) * m[:, None]


def write_texture(name, size, cover, rgb_full, path):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = np.ones((size, size, 4), np.float32)
    px[..., :3] = rgb_full
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def textured_mat(name, img, rough=0.9):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    t = nt.nodes.get('furtex') or nt.nodes.new('ShaderNodeTexImage')
    t.name = 'furtex'
    t.image = img
    t.interpolation = 'Linear'
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    try:
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
    except KeyError:
        pass
    return m


def tangent_frame(N, flow):
    T = flow - N * np.sum(flow * N, -1, keepdims=True)
    bad = np.linalg.norm(T, axis=-1) < 1e-4
    T[bad] = np.cross(N[bad], np.array([1.0, 0, 0], np.float32))
    T = norm(T)
    return T, norm(np.cross(N, T))


def strokes(P, N, flow, base, length, width, coverage=3.2, seed=1, ink=0.74, ink_share=0.35, tone_var=0.07, K=8):
    """
    Paint short tapered brush strokes along the fur.
    P, N, flow: per texel (n x 3); base: marking colour per texel (n x 3, sRGB);
    length, width: stroke size per texel (n,), world units (width = half width).
    Each stroke takes the marking colour where it starts, so markings get furry edges.
    Returns the painted colours (n x 3).
    """
    rng = np.random.default_rng(seed)
    T, S = tangent_frame(N, flow)
    # how many strokes: cover the surface `coverage` times (texels ~ area)
    lo, hi = P.min(0), P.max(0)
    texel_area = 1.0
    approx_area = len(P)  # in texels
    stroke_area_texels = None
    # estimate texel size from neighbouring texels is awkward here; use the stroke size in texels instead:
    # area per texel ~ (surface area) / n; surface area ~ sum over a sample of 1 / density ... keep it simple:
    # place strokes so that each texel is covered `coverage` times on average.
    mean_len, mean_w = float(np.mean(length)), float(np.mean(width))
    # surface area estimate via the bounding boxes of parts is unreliable; use a probe grid instead
    cell = mean_len * 0.6
    keys = np.floor((P - lo) / cell).astype(np.int64)
    dims = keys.max(0) + 1
    flat = (keys[:, 0] * dims[1] + keys[:, 1]) * dims[2] + keys[:, 2]
    occupied = len(np.unique(flat))
    area = occupied * cell * cell * 1.15  # surface crossing each occupied cell ~ one cell face
    n_strokes = int(area * coverage / (mean_len * mean_w * 2 * 0.67))
    idx = rng.choice(len(P), n_strokes, replace=True)
    C, CN, CT, CS = P[idx], N[idx], T[idx], S[idx]
    Ls = length[idx] * rng.uniform(0.75, 1.25, n_strokes)
    Ws = width[idx] * rng.uniform(0.8, 1.2, n_strokes)
    curve = rng.uniform(-1, 1, n_strokes) * 4.0
    tone = 1 + rng.uniform(-tone_var, tone_var, n_strokes)
    depth = rng.random(n_strokes)
    outlined = rng.random(n_strokes) < ink_share
    col0 = base[idx]
    # strokes into cells (up to K per cell)
    ck = np.floor((C - lo) / cell).astype(np.int64)
    ck = np.clip(ck, 0, dims - 1)
    cflat = (ck[:, 0] * dims[1] + ck[:, 1]) * dims[2] + ck[:, 2]
    order = np.argsort(cflat, kind='stable')
    sc = cflat[order]
    first = np.searchsorted(sc, sc, side='left')
    rank = np.arange(len(sc)) - first
    keep = rank < K
    table = -np.ones((int(np.prod(dims)), K), np.int64)
    table[sc[keep], rank[keep]] = order[keep]
    best_z = -np.ones(len(P), np.float32)
    best_s = -np.ones(len(P), np.int64)
    best_e = np.zeros(len(P), np.float32)
    best_a = np.zeros(len(P), np.float32)
    reach = int(np.ceil((Ls.max() * 0.5) / cell))
    rng_off = range(-reach, reach + 1)
    for ox in rng_off:
        for oy in rng_off:
            for oz in rng_off:
                k2 = keys + np.array([ox, oy, oz])
                ok = np.all((k2 >= 0) & (k2 < dims), axis=1)
                f2 = (k2[:, 0] * dims[1] + k2[:, 1]) * dims[2] + k2[:, 2]
                f2 = np.where(ok, f2, 0)
                for k in range(K):
                    s = table[f2, k]
                    v = ok & (s >= 0)
                    if not v.any():
                        continue
                    vi = np.nonzero(v)[0]
                    si = s[vi]
                    d = P[vi] - C[si]
                    a = np.sum(d * CT[si], 1)
                    h = np.sum(d * CN[si], 1)
                    b = np.sum(d * CS[si], 1) - curve[si] * a * a
                    L2 = Ls[si] * 0.5
                    # teardrop: round at the root (a = -L2), drawn out to a point at the tip (a = +L2)
                    u = np.clip((a / L2 + 1) * 0.5, 0, 1)
                    wdt = Ws[si] * np.sqrt(np.clip(4 * u * (1 - u), 0, 1)) * (1.15 - 0.75 * u)
                    inside = (np.abs(a) < L2) & (np.abs(b) < wdt) & (np.abs(h) < 0.02) & (np.sum(N[vi] * CN[si], 1) > 0.4)
                    z = depth[si]
                    upd = inside & (z > best_z[vi])
                    ui = vi[upd]
                    best_z[ui] = z[upd]
                    best_s[ui] = si[upd]
                    best_e[ui] = (b[upd] / np.maximum(wdt[upd], 1e-6))
                    best_a[ui] = (a[upd] / L2[upd])
    out = base * 0.86  # gaps between strokes read as shadow
    hit = best_s >= 0
    s = best_s[hit]
    c = col0[s] * tone[s][:, None] * (1 + 0.07 * best_a[hit])[:, None]
    # an ink line down one side of some strokes, fading in towards the tip
    line = outlined[s] & (best_e[hit] > 0.45) & (best_a[hit] > -0.6)
    c[line] *= ink
    out[hit] = c
    return np.clip(out, 0, 1), {'strokes': n_strokes, 'covered': float(hit.mean())}


def bake_ao(objs, size, samples=24):
    """Ambient occlusion per texel (0..1), with every visible object casting."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.render.bake.margin = 6
    imgs = []
    img = bpy.data.images.new('_bake_ao', size, size, alpha=True, float_buffer=True)
    img.generated_color = (1, 1, 1, 0)
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            nt = m.node_tree
            t = nt.nodes.get('_aotex') or nt.nodes.new('ShaderNodeTexImage')
            t.name = '_aotex'
            t.image = img
            nt.nodes.active = t
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO')
    a = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(a)
    for o in objs:
        for slot in o.material_slots:
            nt = slot.material.node_tree
            t = nt.nodes.get('_aotex')
            if t:
                nt.nodes.remove(t)
    bpy.data.images.remove(img)
    return a.reshape(size, size, 4)[..., 0]


def height_to_normal(name, h, cover, strength, path):
    """Tangent-space normal map (OpenGL, +Y up as glTF wants) from a height field in UV space."""
    size = h.shape[0]
    gx = np.zeros_like(h); gy = np.zeros_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    # no slopes across island borders
    edge = ~cover
    for sh in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        edge = edge | ~np.roll(cover, sh, axis=(0, 1))
    gx[edge] = 0; gy[edge] = 0
    n = np.stack([-gx * strength, -gy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((size, size, 4), np.float32)
    px[..., :3] = n * 0.5 + 0.5
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def plush_mat(name, img, nrm, rough=0.8, sheen=0.55):
    """Soft plush: matte, a fine fibre normal map and a velvet sheen on the edges."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
            nt.nodes.remove(n)
    bsdf = nt.nodes.get('Principled BSDF')
    t = nt.nodes.new('ShaderNodeTexImage')
    t.name = 'furtex'
    t.image = img
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.name = 'furnrm'
    tn.image = nrm
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 0.8
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = rough
    for key, val in (('Specular IOR Level', 0.3), ('Sheen Weight', sheen), ('Sheen Roughness', 0.45)):
        try:
            bsdf.inputs[key].default_value = val
        except KeyError:
            pass
    try:
        bsdf.inputs['Sheen Tint'].default_value = (1, 0.97, 0.93, 1)
    except KeyError:
        pass
    return m
