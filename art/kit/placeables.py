import math
from kit import Kit

WOOD = '#a0703f'
DARK = '#5d4037'
IRON = '#37474f'


def bench():
    k = Kit()
    for i in range(3):
        z = -0.12 + i * 0.12
        k.box('wood', WOOD if i % 2 else '#b07c48', (-0.46, 0.3, z - 0.05), (0.46, 0.35, z + 0.05))
    for i in range(2):
        y = 0.48 + i * 0.13
        k.rbox('wood', WOOD, (0, y, -0.2 - i * 0.015), (0.92, 0.09, 0.04), r=(-0.18, 0, 0))
    for x in (-0.4, 0.4):
        k.box('iron', IRON, (x - 0.03, 0.0, -0.17), (x + 0.03, 0.3, -0.13))
        k.box('iron', IRON, (x - 0.03, 0.0, 0.13), (x + 0.03, 0.3, 0.17))
        k.box('iron', IRON, (x - 0.03, 0.26, -0.18), (x + 0.03, 0.3, 0.18))
        k.rbox('iron', IRON, (x, 0.47, -0.2), (0.05, 0.36, 0.04), r=(-0.18, 0, 0))
        k.rbox('iron', IRON, (x * 1.04, 0.43, 0.0), (0.05, 0.04, 0.34))
        k.box('iron', IRON, (x * 1.04 - 0.025, 0.3, 0.13), (x * 1.04 + 0.025, 0.43, 0.17))
    return k


def lamp():
    k = Kit()
    k.pivot('bulb', (0, 1.3, 0))
    k.cyl('iron', IRON, (0, 0), 0.0, 0.08, 0.12, 0.1, seg=8)
    k.cyl('iron', IRON, (0, 0), 0.08, 0.2, 0.06, 0.045, seg=8)
    k.cyl('iron', IRON, (0, 0), 0.2, 1.12, 0.035, 0.03, seg=8)
    k.cyl('iron', IRON, (0, 0), 1.1, 1.16, 0.07, 0.08, seg=8)
    for x, z in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        k.rod('iron', IRON, (x * 0.08, 1.16, z * 0.08), (x * 0.11, 1.42, z * 0.11), 0.012, seg=5)
    k.add('glass', '#fff3c4', [(x * 0.095, y, z * 0.095) for x in (-1, 1) for z in (-1, 1) for y in (1.17, 1.41)], g='bulb')
    k.add('iron', IRON, [(x * r, y, z * r) for x in (-1, 1) for z in (-1, 1) for (y, r) in ((1.42, 0.15), (1.47, 0.15), (1.6, 0.03))], g='bulb')
    k.ell('gold', '#d8b04a', (0, 1.63, 0), (0.03, 0.03, 0.03), seg=6, rings=3, g='bulb')
    return k


def flower_pot():
    k = Kit()
    k.cyl('pot', '#c1663f', (0, 0), 0.0, 0.26, 0.15, 0.2, seg=10)
    k.cyl('pot', '#b05a36', (0, 0), 0.24, 0.3, 0.22, 0.22, seg=10)
    k.cyl('soil', '#5a3e2b', (0, 0), 0.29, 0.305, 0.19, 0.19, seg=10)
    for i in range(6):
        a = 2 * math.pi * i / 6
        k.ell('leaf', '#4f9e3a' if i % 2 else '#5fae45', (math.cos(a) * 0.12, 0.38, math.sin(a) * 0.12), (0.09, 0.03, 0.05), r=(0, -a, 0.35), seg=6, rings=3)
    for (x, z, c, h) in ((0.06, 0.04, '#ff6f91', 0.52), (-0.07, -0.03, '#ffd166', 0.5), (0.0, -0.08, '#ffffff', 0.47), (-0.05, 0.08, '#ff6f91', 0.45)):
        k.rod('stem', '#4f9e3a', (x * 0.5, 0.3, z * 0.5), (x, h, z), 0.01, seg=4)
        for j in range(5):
            a = 2 * math.pi * j / 5
            k.ell('petal', c, (x + math.cos(a) * 0.03, h, z + math.sin(a) * 0.03), (0.028, 0.012, 0.018), r=(0, -a, 0), seg=5, rings=3)
        k.ell('centre', '#f6c445', (x, h + 0.008, z), (0.015, 0.01, 0.015), seg=5, rings=3)
    return k


def fence():
    k = Kit()
    c = '#efe4cf'
    for x in (-0.45, 0.0, 0.45):
        k.box('wood', c, (x - 0.045, 0.0, -0.045), (x + 0.045, 0.6, 0.045))
        k.add('wood', c, [(x + dx, 0.6, dz) for dx in (-0.045, 0.045) for dz in (-0.045, 0.045)] + [(x, 0.66, 0.0)])
    for y in (0.2, 0.44):
        k.box('wood', '#e2d6bf', (-0.5, y - 0.035, 0.045), (0.5, y + 0.035, 0.075))
    return k


def picnic_table():
    k = Kit()
    for i in range(4):
        x = -0.35 + i * 0.235
        k.box('table', '#c0392b' if i % 2 == 0 else '#f2ece0', (x - 0.11, 0.48, -0.32), (x + 0.11, 0.53, 0.32))
    for x in (-0.38, 0.38):
        for s in (-1, 1):
            k.rbox('wood', WOOD, (x, 0.24, s * 0.2), (0.05, 0.6, 0.05), r=(s * 0.55, 0, 0))
        k.box('wood', WOOD, (x - 0.025, 0.25, -0.5), (x + 0.025, 0.29, 0.5))
    for z in (-0.44, 0.44):
        k.box('wood', '#b07c48', (-0.47, 0.29, z - 0.08), (0.47, 0.33, z + 0.08))
    k.cyl('basket', '#c49a62', (0.12, 0.05), 0.53, 0.66, 0.1, 0.12, seg=8)
    k.rod('basket', '#8b6338', (0.02, 0.66, 0.05), (0.22, 0.66, 0.05), 0.012, seg=5)
    k.rod('basket', '#8b6338', (0.02, 0.66, 0.05), (0.12, 0.76, 0.05), 0.012, seg=5)
    k.rod('basket', '#8b6338', (0.12, 0.76, 0.05), (0.22, 0.66, 0.05), 0.012, seg=5)
    return k


def gnome():
    k = Kit()
    k.cyl('base', '#8d8f93', (0, 0), 0.0, 0.05, 0.17, 0.16, seg=9)
    for s in (-1, 1):
        k.ell('boot', '#3e2723', (s * 0.06, 0.08, 0.03), (0.05, 0.04, 0.07), seg=7, rings=4)
    k.cyl('coat', '#1e88e5', (0, 0), 0.1, 0.36, 0.15, 0.11, seg=10)
    k.cyl('belt', '#3e2723', (0, 0), 0.2, 0.24, 0.137, 0.132, seg=10)
    k.box('gold', '#f6c445', (-0.03, 0.197, 0.125), (0.03, 0.243, 0.145))
    for s in (-1, 1):
        k.rod('coat', '#1e88e5', (s * 0.11, 0.33, 0.0), (s * 0.15, 0.22, 0.06), 0.04, 0.035, seg=6)
        k.ell('skin', '#fde0c8', (s * 0.15, 0.2, 0.07), (0.035, 0.035, 0.035), seg=6, rings=4)
    k.ell('skin', '#fde0c8', (0, 0.43, 0.0), (0.1, 0.1, 0.1), seg=9, rings=5)
    k.ell('nose', '#f4a582', (0, 0.42, 0.1), (0.032, 0.032, 0.032), seg=6, rings=4)
    k.add('beard', '#ffffff', [(0, 0.24, 0.1), (0.09, 0.42, 0.07), (-0.09, 0.42, 0.07), (0.07, 0.37, 0.0), (-0.07, 0.37, 0.0), (0, 0.4, 0.11)])
    for s in (-1, 1):
        k.ell('eye', '#1d1d1d', (s * 0.035, 0.46, 0.09), (0.012, 0.014, 0.01), seg=5, rings=3)
    k.cyl('hat', '#e53935', (0, -0.01), 0.48, 0.82, 0.11, 0.0, seg=10)
    return k


def signpost():
    k = Kit()
    k.cyl('post', WOOD, (0, 0), 0.0, 1.0, 0.045, 0.04, seg=7)
    k.add('post', WOOD, [(math.cos(a) * 0.04, 1.0, math.sin(a) * 0.04) for a in [i * 0.9 for i in range(7)]] + [(0, 1.06, 0)])
    k.add('sign', '#d7b98e', [(x, y, z) for (x, y) in ((-0.12, 0.66), (-0.12, 0.88), (0.42, 0.88), (0.52, 0.77), (0.42, 0.66)) for z in (0.04, 0.075)])
    k.add('sign', '#c9a878', [(x, y, z) for (x, y) in ((0.12, 0.42), (0.12, 0.6), (-0.38, 0.6), (-0.46, 0.51), (-0.38, 0.42)) for z in (-0.075, -0.04)])
    for y in (0.73, 0.81):
        k.box('ink', '#5d4037', (0.0, y - 0.008, 0.075), (0.32, y + 0.008, 0.08))
    k.box('ink', '#5d4037', (-0.3, 0.502, -0.08), (0.02, 0.518, -0.075))
    return k


def barrel():
    k = Kit()
    rings = [(0.0, 0.22), (0.12, 0.26), (0.31, 0.285), (0.5, 0.26), (0.62, 0.22)]
    for (y0, r0), (y1, r1) in zip(rings, rings[1:]):
        k.cyl('wood', '#9a6a3c', (0, 0), y0, y1, r0, r1, seg=12)
    for y in (0.08, 0.54):
        r = 0.255 if y < 0.3 else 0.25
        k.cyl('hoop', '#4a4a4a', (0, 0), y - 0.025, y + 0.025, r + 0.012, r + 0.012, seg=12)
    k.cyl('hoop', '#4a4a4a', (0, 0), 0.29, 0.33, 0.297, 0.297, seg=12)
    k.cyl('lid', '#7a5230', (0, 0), 0.61, 0.625, 0.205, 0.205, seg=12)
    return k


def crate():
    k = Kit()
    k.box('wood', '#c49a62', (-0.29, 0.0, -0.29), (0.29, 0.55, 0.29))
    trim = '#8b6338'
    for y in (0.0, 0.5):
        for z in (-0.3, 0.3):
            k.box('trim', trim, (-0.31, y, z - 0.02), (0.31, y + 0.06, z + 0.02))
        for x in (-0.3, 0.3):
            k.box('trim', trim, (x - 0.02, y, -0.31), (x + 0.02, y + 0.06, 0.31))
    for x in (-0.3, 0.3):
        for z in (-0.3, 0.3):
            k.box('trim', trim, (x - 0.025, 0.0, z - 0.025), (x + 0.025, 0.56, z + 0.025))
    for s in (1, -1):
        k.rbox('trim', trim, (0, 0.28, s * 0.305), (0.7, 0.05, 0.02), r=(0, 0, s * 0.72))
        k.rbox('trim', trim, (s * 0.305, 0.28, 0), (0.02, 0.05, 0.7), r=(s * 0.72, 0, 0))
    return k


def rowboat():
    k = Kit()
    k.pivot('boat', (0, 0, 0))
    hull, trim, inside = '#f5ecd7', '#e8604c', '#c49a62'
    sections = [(-0.62, 0.26, 0.2), (-0.35, 0.32, 0.24), (0.0, 0.33, 0.25), (0.35, 0.3, 0.24), (0.62, 0.18, 0.2), (0.82, 0.02, 0.18)]
    for (z0, w0, d0), (z1, w1, d1) in zip(sections, sections[1:]):
        pts = []
        for z, w, d in ((z0, w0, d0), (z1, w1, d1)):
            pts += [(w, 0.28, z), (-w, 0.28, z), (w * 0.7, 0.28 - d * 0.75, z), (-w * 0.7, 0.28 - d * 0.75, z), (w * 0.25, 0.28 - d, z), (-w * 0.25, 0.28 - d, z)]
        k.add('hull', hull, pts, g='boat')
    for (z0, w0, _), (z1, w1, _) in zip(sections, sections[1:]):
        for s in (-1, 1):
            k.add('trim', trim, [(s * w * f, y, z) for (z, w) in ((z0, w0), (z1, w1)) for f in (1.02, 0.9) for y in (0.26, 0.31)], g='boat')
    for (z0, w0, _), (z1, w1, _) in zip(sections[:-1], sections[1:-1]):
        k.add('deck', inside, [(s * w * 0.88, y, z) for (z, w) in ((z0, w0), (z1, w1)) for s in (-1, 1) for y in (0.279, 0.285)], g='boat')
    for z in (-0.25, 0.25):
        k.box('seat', '#8b6338', (-0.29, 0.285, z - 0.08), (0.29, 0.32, z + 0.08), g='boat')
    for s in (-1, 1):
        k.rod('oar', WOOD, (s * 0.28, 0.3, -0.05), (s * 0.55, 0.22, -0.75), 0.018, seg=6, g='boat')
        k.add('oar', WOOD, [(s * 0.55 + dx, 0.22 + dy, -0.75 + dz) for dx in (-0.05, 0.05) for dy in (-0.01, 0.01) for dz in (0.0, -0.22)], g='boat')
        k.ell('oarlock', '#4a4a4a', (s * 0.32, 0.32, -0.05), (0.02, 0.02, 0.02), seg=5, rings=3, g='boat')
    return k


def build():
    return {'bench': bench(), 'lamp': lamp(), 'flower_pot': flower_pot(), 'fence': fence(), 'picnic_table': picnic_table(),
            'gnome': gnome(), 'signpost': signpost(), 'barrel': barrel(), 'crate': crate(), 'rowboat': rowboat()}
