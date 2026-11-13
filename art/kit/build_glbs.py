"""Builds the game's creature, plant and furniture models into client/public/models/.

    python3 art/kit/build_glbs.py            (needs numpy + scipy, no Blender)

The same kit files were baked in Blender for the .blend sources (blender_bake.py);
this writer produces identical geometry straight from the point clouds.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ambient_fish  # noqa: E402
import birds  # noqa: E402
import buildings  # noqa: E402
import paths  # noqa: E402
import boho  # noqa: E402
import cottage  # noqa: E402
import fish  # noqa: E402
import placeables  # noqa: E402
import plants  # noqa: E402
import school  # noqa: E402
from glb import Writer, export  # noqa: E402

OUT = os.path.join(HERE, '..', '..', 'client', 'public', 'models')
SWIM = ['swim_a', 'swim_b', 'fins']


def swimmer(kit, S):
    """Morph targets for the ambient fish: travelling body wave (two targets) + pectoral flap."""
    L = S['L']
    nose = 0.44 * L
    kk = 2 * math.pi / 1.15
    root = {}
    for (g, role, c, pts) in kit.parts:
        if role == 'pfin':
            for p in pts:
                s = 1 if p[0] > 0 else -1
                root[s] = min(root.get(s, 9.0), abs(p[0]))

    def morph(group, role, p):
        u = (nose - p[2]) / L
        A = S['amp'] * L * (0.06 + 0.94 * max(0.0, u) ** 2)
        out = {'swim_a': (A * math.cos(kk * u), 0.0, 0.0), 'swim_b': (A * math.sin(kk * u), 0.0, 0.0)}
        if role == 'pfin':
            s = 1 if p[0] > 0 else -1
            r = abs(p[0]) - root[s]
            a = 0.7
            out['fins'] = (-s * r * (1 - math.cos(a)), r * math.sin(a), 0.0)
        return out

    kit.targets = SWIM
    kit.morph = morph
    return kit


def build_birds():
    m = birds.build()
    for k in m.values():
        k.wrap = 'hop'
    return m


def build_ambient():
    m = ambient_fish.build()
    for n, k in m.items():
        swimmer(k, ambient_fish.FISH[n])
        k.merge = 'shadow'
    return m


def build_school(path):
    S = ambient_fish.FISH['ambient_fish_small']
    kit = swimmer(ambient_fish.build_one(S), S)
    kit.merge = 'shadow'  # one primitive: each fish node is a single mesh the weights track can find
    w = Writer()
    groups = {}
    for (g, role, color, pts) in kit.parts:
        groups.setdefault(g, []).append((role, color, pts))
    mesh = w.mesh('school_fish', groups['main'], (0.0, 0.0, 0.0), kit, 'main')
    keys = school.frames(24)
    kids, channels = [], []
    times = [f / school.FPS for f in range(school.NF + 1)]
    for i, fk in enumerate(keys):
        name = f'school_fish_{i:02d}'
        p, q, _ = fk[0]
        kids.append(w.node(name=name, mesh=mesh, translation=list(p), rotation=[q[1], q[2], q[3], q[0]]))
        channels.append((name, 'translation', times, [c for (p, q, wt) in fk for c in p]))
        channels.append((name, 'rotation', times, [c for (p, q, wt) in fk for c in (q[1], q[2], q[3], q[0])]))
        channels.append((name, 'weights', times, [c for (p, q, wt) in fk for c in wt]))
    root = w.node(name='fish_school', children=kids)
    size = w.write(path, [root], [{'name': 'school_swim', 'channels': channels}])
    return {'path': path, 'models': 24, 'triangles': w.tris, 'kb': size // 1024}


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = {
        'birds': build_birds(),
        'fish': fish.build(),
        'plants': plants.build(),
        'placeables': placeables.build(),
        'ambient_fish': build_ambient(),
        'furniture_boho': boho.build(),
        'buildings': buildings.build(),
        'paths': paths.build(),
        'furniture_cottage': cottage.build(),
    }
    for name, models in jobs.items():
        print(export(models, os.path.join(OUT, name + '.glb')))
    print(build_school(os.path.join(OUT, 'fish_school.glb')))


if __name__ == '__main__':
    main()
