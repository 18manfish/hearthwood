# Export the houses for the game (run after houses_build.py):
#   export/house.glb            house_1..3 (Starter House tiers)
#   export/villager_houses.glb  vhouse_1..2 (tinted per villager in the game)
#   export/tex_<kind>.jpg (+ _n)  white, tileable wall / roof textures the game swaps
#                                 onto villager houses for each villager's style
import bpy, os
import numpy as np
EXP = ART + r'\houses\export'
os.makedirs(EXP, exist_ok=True)
roots = {o.name: o for o in bpy.data.objects if o.type == 'EMPTY' and o.parent is None}
for o in roots.values():
    o.location = (0, 0, 0)
for o in [o for o in bpy.data.objects if o.type in ('LIGHT', 'CAMERA') or o.name == 'ground']:
    bpy.data.objects.remove(o, do_unlink=True)


def export(names, path):
    bpy.ops.object.select_all(action='DESELECT')
    for n in names:
        roots[n].select_set(True)
        for c in roots[n].children:
            c.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_animations=False, export_image_format='JPEG', export_jpeg_quality=88, export_yup=True)
    return os.path.getsize(path)


sizes = {
    'house.glb': export(['house_1', 'house_2', 'house_3'], EXP + r'\house.glb'),
    'villager_houses.glb': export(['vhouse_1', 'vhouse_2'], EXP + r'\villager_houses.glb'),
}
# the swappable textures for villager houses
for kind in ('siding', 'stucco', 'brick', 'logs', 'stone', 'tiles', 'shingles', 'thatch'):
    rgb, h = housetex.paint(TEX_OF[kind])
    for suffix, arr, cs in (('', rgb, 'sRGB'), ('_n', housetex.normal_map(h, 2.0), 'Non-Color')):
        img = bpy.data.images.new('_x', housetex.N, housetex.N, alpha=False)
        img.colorspace_settings.name = cs
        a = np.ones((housetex.N, housetex.N, 4), np.float32)
        a[..., :3] = arr
        img.pixels.foreach_set(a.ravel())
        path = EXP + f'\\tex_{kind}{suffix}.jpg'
        img.file_format = 'JPEG'
        img.filepath_raw = path
        try:
            img.save(filepath=path, quality=88)
        except TypeError:
            img.save()
        bpy.data.images.remove(img)
        sizes[f'tex_{kind}{suffix}.jpg'] = os.path.getsize(path)
result = sizes
