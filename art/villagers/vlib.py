# Hearthwood villagers: shared modelling helpers (run inside Blender).
# Blender is Z-up; the villager faces -Y (glTF export turns that into the game's +Z).
# Proportions match the game's rig: hips 0.36, shoulders 0.69, head centre 0.98.

import bpy, bmesh, math
from mathutils import Vector, Matrix

PIV = {
    'head': Vector((0, 0, 0.98)),
    'armL': Vector((-0.235, 0, 0.69)), 'armR': Vector((0.235, 0, 0.69)),
    'legL': Vector((-0.1, 0, 0.36)), 'legR': Vector((0.1, 0, 0.36)),
}


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.images, bpy.data.lights, bpy.data.cameras):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)


def link(o):
    bpy.context.scene.collection.objects.link(o)
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    o = link(bpy.data.objects.new(name, None))
    o.empty_display_size = 0.08
    o.location = loc
    if parent:
        parent_keep(o, parent)
    return o


def parent_keep(o, parent):
    bpy.context.view_layer.update()
    mw = o.matrix_world.copy()
    o.parent = parent
    o.matrix_world = mw


def finish(name, bm, pivot=(0, 0, 0), parent=None, subd=2, mat=None):
    """bmesh in world coordinates -> object whose origin is `pivot`."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    piv = Vector(pivot)
    me.transform(Matrix.Translation(-piv))
    for p in me.polygons:
        p.use_smooth = True
    o = link(bpy.data.objects.new(name, me))
    o.location = piv
    if subd:
        m = o.modifiers.new('Subdivision', 'SUBSURF')
        m.levels = subd
        m.render_levels = subd
    if mat:
        me.materials.append(mat)
    if parent:
        parent_keep(o, parent)
    return o


def sphere_bm(u=32, v=20):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    return bm


def blob(fn, u=32, v=20):
    """Unit sphere, every vertex moved by fn(direction) -> world position."""
    bm = sphere_bm(u, v)
    for vert in bm.verts:
        vert.co = fn(vert.co.normalized())
    return bm


def gauss(d, axis, width):
    """1 at `axis`, falling off with angle (radians) over `width`."""
    a = math.acos(max(-1.0, min(1.0, d.dot(axis.normalized()))))
    return math.exp(-(a / width) ** 2)


def capsule(a, b, r0, r1, u=20, v=16):
    """Rounded limb from a to b, radius r0 at a and r1 at b."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    L = axis.length
    q = axis.normalized().to_track_quat('Z', 'Y')
    rot = q.to_matrix().to_4x4()
    bm = sphere_bm(u, v)
    for vert in bm.verts:
        d = vert.co.normalized()
        t = 0.5 + 0.5 * d.z  # 0 at a, 1 at b
        r = r0 + (r1 - r0) * t
        h = d.z
        z = (L * 0.5) * (1 if h > 0 else -1) * min(1.0, abs(h) * 2.2) ** 0.35 + h * r * 0.9
        z = max(-L * 0.5 - r, min(L * 0.5 + r, z))
        p = Vector((d.x * r, d.y * r, z + L * 0.5))
        vert.co = (rot @ p.to_4d()).to_3d() + a
    return bm


def merge(*bms):
    out = bmesh.new()
    for bm in bms:
        me = bpy.data.meshes.new('_tmp')
        bm.to_mesh(me)
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
        bm.free()
    return out


def flat_mat(name, color, rough=0.6, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    c = color_lin(color)
    bsdf.inputs['Base Color'].default_value = (*c, 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m


def color_lin(hexs):
    h = hexs.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in srgb)


def tube(name, pts, radii, bevel, parent=None, mat=None, res=6):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = bevel
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p, r in zip(sp.bezier_points, pts, radii):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
        bp.radius = r
    o = link(bpy.data.objects.new(name + '_curve', cu))
    if mat:
        cu.materials.append(mat)
    # to mesh
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.curves.remove(cu)
    for p in me.polygons:
        p.use_smooth = True
    mo = link(bpy.data.objects.new(name, me))
    if parent:
        parent_keep(mo, parent)
    return mo


def set_origin(o, pivot):
    piv = Vector(pivot)
    mw = o.matrix_world.copy()
    local = mw.inverted() @ piv
    o.data.transform(Matrix.Translation(-local))
    o.matrix_world = mw @ Matrix.Translation(local)
