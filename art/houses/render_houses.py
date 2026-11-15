# Preview renders of the houses (EEVEE): a lineup and a close-up of each.
import bpy, math, os
from mathutils import Vector
OUTR = ART + r'\houses\renders'
os.makedirs(OUTR, exist_ok=True)
sc = bpy.context.scene
try:
    sc.render.engine = 'BLENDER_EEVEE'
except TypeError:
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.view_settings.view_transform = 'Standard'
w = sc.world or bpy.data.worlds.new('World'); sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.78, 0.9, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
for o in [o for o in bpy.data.objects if o.type in ('LIGHT', 'CAMERA') or o.name == 'ground']:
    bpy.data.objects.remove(o, do_unlink=True)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.0; sun.data.angle = math.radians(8)
sun.rotation_euler = (math.radians(48), 0, math.radians(-30))
sc.collection.objects.link(sun)
bpy.ops.mesh.primitive_plane_add(size=40)
g = bpy.context.active_object; g.name = 'ground'
gm = bpy.data.materials.new('groundmat'); gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.55, 0.2, 1)
g.data.materials.append(gm)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50


def shoot(path, target, az, el, dist, res=(1200, 700)):
    sc.render.resolution_x, sc.render.resolution_y = res
    t = Vector(target)
    a, e = math.radians(az), math.radians(el)
    cam.location = t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


roots = [o for o in bpy.data.objects if o.type == 'EMPTY' and o.parent is None]
shoot(OUTR + r'\lineup.png', (0, 0, 1.0), 20, 22, 17, (1600, 600))
for r in roots:
    shoot(OUTR + f'\\{r.name}.png', r.location + Vector((0, 0, 1.0 if r.name.startswith('house') else 0.75)), 28, 20, 6.5 if r.name.startswith('house') else 4.6, (900, 750))
result = {'rendered': [r.name for r in roots]}
