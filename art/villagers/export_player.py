# Export the player model just built (villager_build + player_build + player_paint):
# villagers/export/player_<m|f>.glb with its shade, normal and hair textures embedded.
import bpy, os
EXP = ART + r'\villagers\export'
os.makedirs(EXP, exist_ok=True)
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA') or o.name.startswith('ground'):
        bpy.data.objects.remove(o, do_unlink=True)
cs = [o for o in bpy.data.objects if o.type == 'CURVE']
if cs:
    bpy.ops.object.select_all(action='DESELECT')
    for o in cs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = cs[0]
    bpy.ops.object.convert(target='MESH')
G = SPECIES_NAME.split('_')[1]
path = EXP + f'\\player_{G}.glb'
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_animations=False,
                          export_extras=True, export_yup=True, export_image_format='JPEG', export_jpeg_quality=88)
result = {'file': path, 'bytes': os.path.getsize(path), 'objects': len(bpy.data.objects)}
