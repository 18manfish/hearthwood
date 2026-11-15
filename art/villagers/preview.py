# Render preview images of the villager (EEVEE, soft daylight).
import bpy, math
from mathutils import Vector


def setup_render(res=900):
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    w = sc.world or bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.62, 0.78, 0.86, 1)
    bg.inputs['Strength'].default_value = 0.9
    for o in [o for o in bpy.data.objects if o.type in ('LIGHT', 'CAMERA')]:
        bpy.data.objects.remove(o, do_unlink=True)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(12)
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    # ground disc
    if 'ground' not in bpy.data.objects:
        bpy.ops.mesh.primitive_circle_add(vertices=64, radius=1.6, fill_type='NGON')
        g = bpy.context.active_object
        g.name = 'ground'
        m = bpy.data.materials.new('groundmat')
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.5, 0.18, 1)
        g.data.materials.append(m)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 60
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def shoot(co, path, az_deg, el_deg=12, dist=3.3, target=(0, 0, 0.66)):
    t = Vector(target)
    az, el = math.radians(az_deg), math.radians(el_deg)
    co.location = t + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    d = t - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
