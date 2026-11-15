# Export the villager clips as JSON tracks for the game (run after villager_build.py with
# the cat and cat_anim.py). Every species has the same node names and rest rotations, so
# one set of tracks drives them all. Coordinates are converted to glTF / three.js (Y up):
#   Blender (x, y, z) -> (x, z, -y).
import bpy, json

sc = bpy.context.scene
skip = {'chair', 'chairMesh'}
objs = [o for o in KEYED if o.name not in skip]


def chans(o):
    p = PATHS.get(o, set())
    out = []
    if 'location' in p:
        out.append('position')
    if 'rotation_euler' in p:
        out.append('quaternion')
    if 'scale' in p:
        out.append('scale')
    return out


def r4(v):
    return round(v, 4)


clips = {}
for name, (n, loop, fn) in CLIPS.items():
    frames = list(range(n)) + ([0] if loop else [])
    tracks = {}
    for o in objs:
        for ch in chans(o):
            tracks[o.name + '.' + ch] = []
    tracks['umbCanopy.morph'] = []
    for i, f in enumerate(frames):
        apply_pose(fn(f))
        bpy.context.view_layer.update()
        for o in objs:
            loc, rot, scl = o.matrix_local.decompose()
            for ch in chans(o):
                if ch == 'position':
                    v = (loc.x, loc.z, -loc.y)
                elif ch == 'quaternion':
                    v = (rot.x, rot.z, -rot.y, rot.w)
                else:
                    v = (scl.x, scl.z, scl.y)
                tracks[o.name + '.' + ch].extend(r4(x) for x in v)
        tracks['umbCanopy.morph'].append(r4(CANOPY_KEY.key_blocks['closed'].value))
    # drop tracks that never change (the rest pose covers them) – except face and prop
    # visibility, which must be set by every clip
    keep = {}
    for k, vals in tracks.items():
        stride = 4 if k.endswith('quaternion') else (1 if k.endswith('morph') else 3)
        first = vals[:stride]
        const = all(abs(vals[j] - first[j % stride]) < 1e-4 for j in range(len(vals)))
        if const and not k.endswith(('scale', 'morph')):
            continue
        keep[k] = vals
    clips[name] = {'fps': FPS, 'frames': len(frames), 'loop': loop, 'tracks': keep}

apply_pose(CLIPS['idle'][2](0))
bpy.context.view_layer.update()
# Rest offsets of the props relative to their parents (the client attaches the props).
props = {}
for o in (umb, gift):
    loc = o.matrix_local.to_translation()
    props[o.name] = {'parent': o.parent.name, 'position': [r4(loc.x), r4(loc.z), r4(-loc.y)]}
data = {'clips': clips, 'props': props}
path = ART + r'\villagers\export\villager_anims.json'
import os
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump(data, open(path, 'w'), separators=(',', ':'))
result = {'clips': {k: len(v['tracks']) for k, v in clips.items()}, 'bytes': os.path.getsize(path)}
