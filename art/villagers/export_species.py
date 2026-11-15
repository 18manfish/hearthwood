# Export the species just built and painted (villager_build.py + villager_fur.py) for the
# game: villager_<species>.glb (no images: the game loads the coat textures itself),
# fur_<villager>.jpg per coat, fur_n_<species>.jpg, and the nose / inner-ear colours.
import bpy, os, json
EXP = ART + r'\villagers\export'
os.makedirs(EXP, exist_ok=True)
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA') or o.name.startswith('ground'):
        bpy.data.objects.remove(o, do_unlink=True)


def curves_to_mesh(objs):
    cs = [o for o in objs if o.type == 'CURVE']
    if not cs:
        return
    bpy.ops.object.select_all(action='DESELECT')
    for o in cs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = cs[0]
    bpy.ops.object.convert(target='MESH')


def save_small(img_name, path, size=512, quality=88):
    src = bpy.data.images[img_name]
    im = src.copy()
    im.scale(size, size)
    im.file_format = 'JPEG'
    im.filepath_raw = path
    try:
        im.save(filepath=path, quality=quality)
    except TypeError:
        im.save()
    bpy.data.images.remove(im)


def gltf(path, selection=False):
    kw = dict(filepath=path, export_format='GLB', use_selection=selection, export_apply=True,
              export_animations=False, export_extras=True, export_yup=True)
    for fmt in ('NONE', 'JPEG'):
        try:
            bpy.ops.export_scene.gltf(export_image_format=fmt, **kw)
            return fmt
        except TypeError:
            continue


if __name__ != 'shared':
    curves_to_mesh(list(bpy.data.objects))
    for vid in COATS:
        save_small('fur_' + vid, EXP + f'\\fur_{vid}.jpg')
    save_small('fur_n_' + SPECIES_NAME, EXP + f'\\fur_n_{SPECIES_NAME}.jpg', 512, 92)
    use_coat(list(COATS)[0])
    fmt = gltf(EXP + f'\\villager_{SPECIES_NAME}.glb')
    json.dump({vid: {'nose': n, 'inner': i} for vid, (n, i) in COAT_COLS.items()},
              open(EXP + f'\\coats_{SPECIES_NAME}.json', 'w'))
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    result = {'species': SPECIES_NAME, 'fmt': fmt, 'faces_unsubdivided': tris,
              'bytes': os.path.getsize(EXP + f'\\villager_{SPECIES_NAME}.glb')}
