def bake(models, name, cols=6, spacing=2.5):
    import bpy, bmesh, json, struct, os, math
    from mathutils import Vector
    out_dir = os.path.join(os.path.expanduser('~'), 'hearthwood-art', name)
    os.makedirs(out_dir, exist_ok=True)
    before = (len(bpy.data.objects), len(bpy.data.meshes), len(bpy.data.materials), len(bpy.data.scenes))

    def lin(hx):
        c = [int(hx[j:j + 2], 16) / 255 for j in (1, 3, 5)]
        return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

    scene = bpy.data.scenes.new('hw_' + name)
    objs, meshes_made, mats = [], [], {}
    gl = {'nodes': [], 'meshes': [], 'materials': [], 'accessors': [], 'bufferViews': []}
    blob = bytearray()
    matidx = {}
    roots = []
    tris_total = 0

    def view(data, target):
        while len(blob) % 4:
            blob.append(0)
        gl['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        return len(gl['bufferViews']) - 1

    def material(role, color):
        key = (role, color)
        if key not in mats:
            m = bpy.data.materials.new(role)
            m.use_nodes = True
            b = m.node_tree.nodes.get('Principled BSDF')
            if b:
                b.inputs['Base Color'].default_value = (*lin(color), 1.0)
                b.inputs['Roughness'].default_value = 0.25 if role in ('glass', 'glow') else 0.9
            m.diffuse_color = (*lin(color), 1.0)
            mats[key] = m
            matidx[key] = len(gl['materials'])
            gl['materials'].append({'name': role, 'pbrMetallicRoughness': {'baseColorFactor': lin(color) + [1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.25 if role in ('glass', 'glow') else 0.9}})
        return mats[key]

    try:
        for i, (mname, kit) in enumerate(models.items()):
            ox, oz = (i % cols) * spacing, (i // cols) * spacing
            root = bpy.data.objects.new(mname, None)
            root.location = (ox, -oz, 0)
            scene.collection.objects.link(root)
            objs.append(root)
            groups = {}
            for (g, role, color, pts) in kit.parts:
                groups.setdefault(g, []).append((role, color, pts))
            children = []
            for g, parts in groups.items():
                pv = kit.pivots.get(g, (0.0, 0.0, 0.0))
                bm = bmesh.new()
                slots = []
                for (role, color, pts) in parts:
                    m = material(role, color)
                    if m not in slots:
                        slots.append(m)
                    vs = [bm.verts.new(Vector((p[0] - pv[0], -(p[2] - pv[2]), p[1] - pv[1]))) for p in pts]
                    res = bmesh.ops.convex_hull(bm, input=vs)
                    junk = [e for e in res['geom_interior'] + res['geom_unused'] if isinstance(e, bmesh.types.BMVert)]
                    if junk:
                        bmesh.ops.delete(bm, geom=junk, context='VERTS')
                    for f in res['geom']:
                        if isinstance(f, bmesh.types.BMFace):
                            f.material_index = slots.index(m)
                bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'})
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
                me = bpy.data.meshes.new(f'{mname}_{g}')
                bm.to_mesh(me)
                bm.free()
                for m in slots:
                    me.materials.append(m)
                ob = bpy.data.objects.new(f'{mname}_{g}', me)
                ob.location = (pv[0], -pv[2], pv[1])
                scene.collection.objects.link(ob)
                ob.parent = root
                objs.append(ob)
                meshes_made.append(me)
                # glTF mesh: one primitive per material.
                me.calc_loop_triangles()
                prims = []
                by_slot = {}
                for t in me.loop_triangles:
                    by_slot.setdefault(t.material_index, []).append(t)
                for si, tl in by_slot.items():
                    m = slots[si]
                    key = [k for k, v in mats.items() if v is m][0]
                    pos = []
                    for t in tl:
                        for vi in t.vertices:
                            c = me.vertices[vi].co
                            pos.append((c[0], c[2], -c[1]))
                    tris_total += len(tl)
                    pvw = view(b''.join(struct.pack('<fff', *p) for p in pos), 34962)
                    gl['accessors'].append({'bufferView': pvw, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3',
                                            'min': [min(p[j] for p in pos) for j in range(3)], 'max': [max(p[j] for p in pos) for j in range(3)]})
                    ivw = view(b''.join(struct.pack('<I', j) for j in range(len(pos))), 34963)
                    gl['accessors'].append({'bufferView': ivw, 'componentType': 5125, 'count': len(pos), 'type': 'SCALAR'})
                    prims.append({'attributes': {'POSITION': len(gl['accessors']) - 2}, 'indices': len(gl['accessors']) - 1, 'material': matidx[key]})
                gl['meshes'].append({'name': f'{mname}_{g}', 'primitives': prims})
                gl['nodes'].append({'name': f'{mname}_{g}', 'mesh': len(gl['meshes']) - 1, 'translation': list(pv)})
                children.append(len(gl['nodes']) - 1)
            gl['nodes'].append({'name': mname, 'children': children, 'translation': [ox, 0.0, oz]})
            roots.append(len(gl['nodes']) - 1)

        blend_path = os.path.join(out_dir, name + '.blend')
        bpy.data.libraries.write(blend_path, {scene}, compress=True)
        while len(blob) % 4:
            blob.append(0)
        doc = dict(asset={'version': '2.0', 'generator': 'Blender ' + bpy.app.version_string + ' (hearthwood art kit)'}, scene=0, scenes=[{'nodes': roots}],
                   buffers=[{'byteLength': len(blob)}], **gl)
        js = json.dumps(doc, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        glb = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
        glb_path = os.path.join(out_dir, name + '.glb')
        with open(glb_path, 'wb') as fh:
            fh.write(glb)
    finally:
        for ob in objs:
            bpy.data.objects.remove(ob, do_unlink=True)
        for me in meshes_made:
            bpy.data.meshes.remove(me)
        for m in mats.values():
            bpy.data.materials.remove(m)
        bpy.data.scenes.remove(scene)
    after = (len(bpy.data.objects), len(bpy.data.meshes), len(bpy.data.materials), len(bpy.data.scenes))
    return {'folder': out_dir, 'models': len(models), 'triangles': tris_total, 'blend_kb': os.path.getsize(blend_path) // 1024,
            'glb_kb': len(glb) // 1024, 'restored': before == after}
