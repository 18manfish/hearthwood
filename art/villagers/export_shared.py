# Shared game assets, exported from the cat with clothes and animations
# (villager_build.py, clothes.py, cat_anim.py, anim_export.py run first):
# villager_clothes.glb + cloth.jpg, villager_props.glb (umbrella with its fold morph, gift).
import bpy, os, json
__name__ = 'shared'
exec(open(ART + r'\villagers\export_species.py', encoding='utf-8').read())
O = bpy.data.objects


def gl(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def subtree(o):
    out = [o]
    for c in o.children:
        out += subtree(c)
    return out


def unparent(objs):
    bpy.context.view_layer.update()
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw


apply_pose(CLIPS['idle'][2](0))
bpy.context.view_layer.update()

# Clothes: every piece says which villager node it hangs on and that node's rest position
# on the cat (the game subtracts it, then parents the piece to the node).
cloth_objs = [o for objs in GARMENTS.values() for o in objs]
for o in cloth_objs:
    o.hide_render = o.hide_viewport = False
    o.hide_set(False)
    part = o.get('part', 'hat')
    node = part if part in ('body', 'armL', 'armR') else 'hatSlot'
    o['attach'] = node
    o['origin'] = gl(O[node].matrix_world.translation)
    o['cut'] = o['garment']
    o['tint'] = not (o.get('fixed') or o.name.endswith('.ribbon') or o['garment'] in ('shirt_gingham', 'skirt_denim', 'jacket_denim'))
curves_to_mesh(cloth_objs)
# lighter for the web: single-sided shells (drawn double-sided in the game), decimated
for o in cloth_objs:
    for m in list(o.modifiers):
        if m.type == 'SOLIDIFY':
            o.modifiers.remove(m)
    if o.type == 'MESH' and len(o.data.vertices) > 1500:
        d = o.modifiers.new('Decimate', 'DECIMATE')
        d.ratio = 0.5
cloth_objs = [O[o.name] if isinstance(o, str) else o for o in cloth_objs]
unparent(cloth_objs)
bpy.ops.object.select_all(action='DESELECT')
for o in cloth_objs:
    o.select_set(True)
gltf(EXP + r'\villager_clothes.glb', True)
save_small('cloth_villager', EXP + r'\cloth.jpg', 1024, 90)

# Props
umb.scale = (1, 1, 1)
gift.scale = (1, 1, 1)
prop_objs = subtree(umb) + subtree(gift)
curves_to_mesh(prop_objs)
for o in (umb, gift):
    o['attach'] = o.parent.name
# shape keys only survive the export without modifiers
for m in list(O['umbCanopy'].modifiers):
    O['umbCanopy'].modifiers.remove(m)
kids = {o: o.parent for o in prop_objs if o not in (umb, gift)}
unparent(prop_objs)
for o, par in kids.items():
    parent_keep(o, par)
bpy.ops.object.select_all(action='DESELECT')
for o in subtree(umb) + subtree(gift):
    o.select_set(True)
gltf(EXP + r'\villager_props.glb', True)
result = {'clothes': sorted(GARMENTS), 'files': sorted(os.listdir(EXP))}
