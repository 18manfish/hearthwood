import math
from kit import Kit

LEG = '#d18b47'
EYE = '#151515'

BIRDS = [
    ('bird_sparrow', ['#8d6e4f', '#5d4330', '#d7c4a3', '#3e2f22'], 0.9, 'sparrow'),
    ('bird_robin', ['#7b6a52', '#5f513e', '#e2672e', '#2e2a24'], 0.9, 'robin'),
    ('bird_blue_tit', ['#7aa84a', '#3d7cc9', '#f2d64b', '#2b2b2b'], 0.8, 'tit'),
    ('bird_magpie', ['#1f2430', '#2f4f8f', '#f4f4f4', '#151515'], 1.3, 'magpie'),
    ('bird_crow', ['#20232a', '#2c3039', '#3a3f4a', '#111111'], 1.35, 'crow'),
    ('bird_woodpecker', ['#222222', '#f2f2f2', '#d12a2a', '#3b3b3b'], 1.1, 'woodpecker'),
    ('bird_owl', ['#8b5e3c', '#6b4429', '#c9a27a', '#e0b23a'], 1.5, 'owl'),
    ('bird_bullfinch', ['#5d6470', '#1d1d1d', '#e05a47', '#222222'], 0.95, 'bullfinch'),
    ('bird_snow_bunting', ['#f1efe9', '#8a6f52', '#ffffff', '#c58b2b'], 0.9, 'bunting'),
    ('bird_waxwing', ['#c49a7a', '#5f5f6a', '#f3c94a', '#2b2b2b'], 1.0, 'waxwing'),
    ('bird_kingfisher', ['#1f8fc9', '#21b3c9', '#e8823a', '#222222'], 0.9, 'kingfisher'),
    ('bird_pheasant', ['#d8342a', '#2a5fa8', '#f5c542', '#d7b06a'], 1.7, 'pheasant'),
    ('bird_seagull', ['#f4f4f4', '#9aa4ad', '#ffffff', '#f2c230'], 1.4, 'gull'),
    ('bird_sandpiper', ['#b39c7c', '#7c6a52', '#f2ede2', '#2b2b2b'], 0.85, 'sandpiper'),
    ('bird_parrot', ['#d9282f', '#2a6fd0', '#f4c430', '#e8e1d0'], 1.5, 'macaw'),
    ('bird_toucan', ['#161616', '#161616', '#f5f5f0', '#f28c1d'], 1.5, 'toucan'),
    ('bird_hummingbird', ['#2fa36b', '#1f7a6a', '#e74c8b', '#222222'], 0.55, 'hummingbird'),
    ('bird_lorikeet', ['#3aa84a', '#2e5fc9', '#f28c28', '#e43b3b'], 1.0, 'lorikeet'),
    ('bird_flamingo', ['#f48fb1', '#ec6f9a', '#f8bbd0', '#2b2b2b'], 2.0, 'flamingo'),
    ('bird_roadrunner', ['#8a7356', '#4f4334', '#e6d9bf', '#2b2b2b'], 1.3, 'roadrunner'),
    ('bird_lark', ['#c8a978', '#a88a5d', '#eadcc0', '#5a4a36'], 0.85, 'lark'),
    ('bird_hoopoe', ['#d9945a', '#1f1f1f', '#f2e3cf', '#2b2b2b'], 1.1, 'hoopoe'),
    ('bird_nightjar', ['#7a6450', '#5a4838', '#b8a07e', '#2b2b2b'], 1.1, 'nightjar'),
]

BASE = dict(legH=0.18, bw=0.34, bh=0.32, bl=0.5, pitch=-0.18, tail=0.42, tailw=0.2, tilt=0.3,
            hr=0.25, neck=0.28, beakL=0.2, beakR=0.065, drop=0.0, wingL=1.0, leg=LEG)
TYPES = {
    'sparrow': {}, 'robin': dict(bw=0.36, bh=0.34), 'tit': dict(bw=0.33, bh=0.31, tail=0.36, beakL=0.12),
    'bullfinch': dict(bw=0.38, bh=0.35, beakL=0.12, beakR=0.08, neck=0.2), 'bunting': {},
    'waxwing': dict(tail=0.36), 'lark': dict(legH=0.2),
    'magpie': dict(tail=1.15, tailw=0.16, tilt=0.12, beakL=0.3, beakR=0.075, legH=0.22, leg='#222222'),
    'crow': dict(tail=0.55, beakL=0.34, beakR=0.085, legH=0.22, bl=0.56, leg='#222222'),
    'woodpecker': dict(tail=0.45, tilt=-0.45, beakL=0.32, beakR=0.06, pitch=0.25, legH=0.14, leg='#555555'),
    'owl': dict(legH=0.1, bw=0.44, bh=0.52, bl=0.38, pitch=0.2, tail=0.22, tilt=-0.3, hr=0.34, neck=0.0, beakL=0.1, beakR=0.06, drop=0.05, leg='#c9a27a'),
    'kingfisher': dict(hr=0.29, beakL=0.45, beakR=0.06, tail=0.2, legH=0.1, leg='#e2672e'),
    'pheasant': dict(tail=1.6, tailw=0.14, tilt=0.15, legH=0.3, bl=0.55, beakL=0.16, leg='#9c8f7a'),
    'gull': dict(wingL=1.35, tail=0.3, beakL=0.3, beakR=0.065, legH=0.24, bl=0.55, leg='#f0a8a0'),
    'sandpiper': dict(legH=0.46, beakL=0.42, beakR=0.028, tail=0.25, leg='#4a4a4a'),
    'macaw': dict(tail=1.25, tailw=0.16, tilt=-0.15, hr=0.28, beakL=0.0, legH=0.15, pitch=0.2, leg='#555555'),
    'lorikeet': dict(tail=0.6, tailw=0.15, tilt=-0.15, beakL=0.0, legH=0.14, pitch=0.15, leg='#777777'),
    'toucan': dict(beakL=0.85, beakR=0.15, tail=0.45, tilt=-0.1, legH=0.16, hr=0.27, pitch=0.15, leg='#3a6fb0'),
    'hummingbird': dict(beakL=0.6, beakR=0.022, tail=0.3, wingL=1.2, legH=0.06, bw=0.3, leg='#222222'),
    'flamingo': dict(legH=1.1, bl=0.55, bh=0.3, neck=0.0, tail=0.22, beakL=0.0, hr=0.18, leg='#e57399'),
    'roadrunner': dict(legH=0.36, tail=1.0, tailw=0.14, tilt=0.45, beakL=0.36, bl=0.5, leg='#5a6b8a'),
    'hoopoe': dict(beakL=0.42, beakR=0.035, drop=0.1, legH=0.16, leg='#555555'),
    'nightjar': dict(legH=0.07, bw=0.42, bh=0.26, bl=0.56, pitch=-0.05, beakL=0.06, beakR=0.06, tail=0.5, tilt=0.1, hr=0.27, neck=0.12, leg='#7a6450'),
}


def bird(colors, size, t):
    body, wing, belly, beak = colors
    P = dict(BASE)
    P.update(TYPES[t])
    k = Kit(scale=0.32 * size)
    legH, bw, bh, bl, pitch = P['legH'], P['bw'], P['bh'], P['bl'], P['pitch']
    by = legH + bh * 0.92

    # Legs and toes.
    k.pivot('legs', (0, 0, 0))
    for x in (-0.11, 0.11):
        k.rod('leg', P['leg'], (x, 0.0, 0.0), (x, legH + 0.12, 0.0), 0.024, seg=6, g='legs')
        k.rbox('leg', P['leg'], (x, 0.012, 0.07), (0.05, 0.024, 0.16), g='legs')

    # Body and belly.
    k.pivot('body', (0, by, 0))
    k.ell('body', body, (0, by, 0), (bw, bh, bl), r=(pitch, 0, 0), g='body')
    k.ell('belly', belly, (0, by - 0.07, 0.1), (bw * 0.86, bh * 0.8, bl * 0.72), r=(pitch, 0, 0), g='body')

    # Wings (pivot at the shoulder).
    for side, g in ((-1, 'wingL'), (1, 'wingR')):
        px = side * bw * 0.86
        k.pivot(g, (px, by + 0.1, 0.12))
        wl = bl * 0.72 * P['wingL']
        wc = body if t == 'woodpecker' else wing
        k.ell('wing', wc, (px + side * 0.02, by + 0.03, 0.1 - wl * 0.72), (0.06, bh * 0.6, wl), r=(pitch - 0.06, 0, side * 0.1), g=g)

    # Tail (pivot at its root).
    tz = -bl * 0.8
    ty = by + 0.04 - math.sin(pitch) * bl * 0.3
    k.pivot('tail', (0, ty, tz))
    tl, tw, tilt = P['tail'], P['tailw'], P['tilt']
    ey, ez = ty + math.sin(tilt) * tl, tz - math.cos(tilt) * tl
    tc = belly if t == 'waxwing' else wing
    k.add('tail', tc if t != 'waxwing' else wing, [(s * tw * 0.45, ty + dy, tz + 0.06) for s in (-1, 1) for dy in (0.03, -0.03)] +
          [(s * tw, ey + dy, ez) for s in (-1, 1) for dy in (0.025, -0.025)], g='tail')
    if t == 'waxwing':
        k.add('tail_tip', belly, [(s * tw * 1.02, ey + dy, ez + dz) for s in (-1, 1) for dy in (0.03, -0.03) for dz in (0.0, 0.08)], g='tail')

    # Head.
    hr, neck = P['hr'], P['neck']
    hz = bl * 0.72 + (0.1 if t == 'owl' else 0)
    hy = by + bh * 0.62 + neck * 0.35
    if t == 'flamingo':
        hz, hy = bl * 0.75, by + 1.05
    if t == 'owl':
        hz, hy = bl * 0.25, by + bh * 0.85
    k.pivot('head', (0, hy - hr * 0.6, hz - hr * 0.3))
    hc = wing if t in ('lorikeet',) else body
    k.ell('head', hc, (0, hy, hz), (hr, hr * 0.95, hr), g='head')
    ex = hr * (0.42 if t in ('owl',) else 0.62)
    for s in (-1, 1):
        eye_c = (s * ex, hy + hr * 0.18, hz + hr * (0.78 if t == 'owl' else 0.6))
        if t in ('owl', 'nightjar'):
            k.ell('eye_ring', '#e0b23a' if t == 'owl' else '#3a3a3a', eye_c, (0.09, 0.09, 0.03), g='head')
            k.ell('eye', EYE, (eye_c[0], eye_c[1], eye_c[2] + 0.02), (0.055, 0.055, 0.025), g='head')
        else:
            k.ell('eye', EYE, eye_c, (0.042, 0.048, 0.03), g='head')
    bz = hz + hr * 0.82
    byk = hy - 0.03
    if P['beakL'] > 0:
        k.rod('beak', beak, (0, byk, bz - 0.04), (0, byk - P['drop'], bz + P['beakL']), P['beakR'], 0.0, seg=7, g='head')

    # Species details.
    if t == 'robin':
        k.ell('breast', belly, (0, hy - 0.05, hz + 0.08), (hr * 0.85, hr * 0.75, hr * 0.7), g='head')
    if t == 'sparrow':
        k.ell('cap', '#7d7f80', (0, hy + hr * 0.45, hz - 0.02), (hr * 0.8, hr * 0.5, hr * 0.85), g='head')
        k.ell('bib', '#2a2a2a', (0, hy - hr * 0.55, hz + hr * 0.35), (hr * 0.4, hr * 0.35, hr * 0.4), g='head')
    if t == 'tit':
        k.ell('cap', wing, (0, hy + hr * 0.45, hz - 0.02), (hr * 0.85, hr * 0.5, hr * 0.88), g='head')
        k.ell('cheek', '#ffffff', (0, hy - 0.02, hz + 0.02), (hr * 1.04, hr * 0.5, hr * 0.7), g='head')
        k.ell('mask', '#1d2a44', (0, hy + 0.06, hz + 0.02), (hr * 1.06, hr * 0.12, hr * 0.62), g='head')
    if t == 'bullfinch':
        k.ell('cap', wing, (0, hy + hr * 0.4, hz + 0.03), (hr * 0.9, hr * 0.6, hr * 0.92), g='head')
        k.ell('cheek', belly, (0, hy - 0.08, hz + 0.05), (hr * 0.95, hr * 0.6, hr * 0.7), g='head')
    if t == 'bunting':
        for s in (-1, 1):
            k.rod('wingtip', '#2a2a2a', (s * (bw * 0.86 + 0.02), by + 0.0, -0.2), (s * (bw * 0.8 + 0.02), by + 0.02, -0.5), 0.055, 0.015, seg=6, g='wingL' if s < 0 else 'wingR')
    if t == 'waxwing':
        k.rod('crest', body, (0, hy + hr * 0.7, hz), (0, hy + hr * 1.15, hz - hr * 1.1), 0.09, 0.0, seg=6, g='head')
        k.ell('mask', '#1a1a1a', (0, hy + 0.04, hz + 0.06), (hr * 1.04, hr * 0.15, hr * 0.6), g='head')
        for s in (-1, 1):
            k.ell('wax', '#d8342a', (s * (bw * 0.86 + 0.06), by + 0.04, -0.2), (0.03, 0.03, 0.06), g='wingL' if s < 0 else 'wingR')
    if t == 'lark':
        k.rod('crest', wing, (0, hy + hr * 0.75, hz), (0, hy + hr * 1.2, hz - hr * 0.7), 0.07, 0.0, seg=6, g='head')
    if t == 'magpie':
        for s, g in ((-1, 'wingL'), (1, 'wingR')):
            k.ell('patch', belly, (s * (bw * 0.86 + 0.05), by + 0.04, -0.02), (0.04, bh * 0.36, bl * 0.32), r=(pitch, 0, 0), g=g)
    if t == 'crow':
        pass
    if t == 'woodpecker':
        k.ell('nape', belly, (0, hy + hr * 0.15, hz - hr * 0.6), (hr * 0.6, hr * 0.55, hr * 0.45), g='head')
        k.ell('vent', belly, (0, by - bh * 0.5, -bl * 0.45), (bw * 0.6, bh * 0.4, bl * 0.35), g='body')
        k.ell('cheek', '#ffffff', (0, hy - 0.02, hz + 0.03), (hr * 1.04, hr * 0.45, hr * 0.6), g='head')
        for s, g in ((-1, 'wingL'), (1, 'wingR')):
            k.ell('patch', wing, (s * (bw * 0.86 + 0.06), by + 0.1, 0.02), (0.04, bh * 0.3, bl * 0.25), r=(pitch, 0, 0), g=g)
            for j in range(3):
                k.ell('spot', wing, (s * (bw * 0.86 + 0.07), by - 0.02 - j * 0.02, -0.18 - j * 0.12), (0.03, 0.03, 0.035), g=g)
    if t == 'owl':
        k.ell('face', belly, (0, hy - 0.02, hz + hr * 0.45), (hr * 0.85, hr * 0.85, hr * 0.6), g='head')
        for s in (-1, 1):
            k.rod('tuft', wing, (s * hr * 0.55, hy + hr * 0.6, hz), (s * hr * 0.75, hy + hr * 1.25, hz - 0.05), 0.07, 0.0, seg=6, g='head')
        for i in range(3):
            k.ell('spot', '#5a3a22', (0, by + 0.1 - i * 0.16, bl * 0.25 + 0.27 - abs(i - 1) * 0.04), (0.09, 0.03, 0.04), g='body')
    if t == 'kingfisher':
        k.ell('cheek', belly, (0, hy - 0.06, hz + 0.02), (hr * 1.03, hr * 0.4, hr * 0.7), g='head')
        k.ell('stripe', '#2fd0e8', (0, by + bh * 0.85, -0.05), (0.06, 0.05, bl * 0.8), r=(pitch, 0, 0), g='body')
    if t == 'pheasant':
        k.rod('crest', belly, (0, hy + hr * 0.6, hz + hr * 0.2), (0, hy + hr * 0.5, hz - hr * 2.2), 0.12, 0.02, seg=6, g='head')
        k.ell('ruff', '#f28c1d', (0, hy - hr * 0.7, hz - 0.05), (hr * 1.15, hr * 0.55, hr * 0.9), g='head')
        k.ell('rump', '#f5c542', (0, by + bh * 0.6, -bl * 0.5), (bw * 0.7, bh * 0.35, bl * 0.4), g='body')
    if t == 'gull':
        for s, g in ((-1, 'wingL'), (1, 'wingR')):
            k.rod('wingtip', '#1d1d1d', (s * (bw * 0.86 + 0.02), by + 0.0, -bl * 0.8), (s * (bw * 0.8 + 0.02), by + 0.03, -bl * 1.3), 0.06, 0.015, seg=6, g=g)
        k.ell('beak_spot', '#d8342a', (0, byk - 0.05, bz + P['beakL'] * 0.7), (0.035, 0.03, 0.03), g='head')
    if t in ('macaw', 'lorikeet'):
        k.rod('beak', beak, (0, byk + 0.04, bz - 0.06), (0, byk - 0.04, bz + 0.12), 0.09, 0.05, seg=7, g='head')
        k.rod('beak', beak, (0, byk - 0.04, bz + 0.12), (0, byk - 0.16, bz + 0.1), 0.05, 0.0, seg=7, g='head')
        k.rod('beak_low', '#2a2a2a', (0, byk - 0.07, bz - 0.04), (0, byk - 0.09, bz + 0.05), 0.05, 0.02, seg=6, g='head')
        if t == 'macaw':
            k.ell('face', beak, (0, hy, hz + hr * 0.35), (hr * 1.0, hr * 0.5, hr * 0.7), g='head')
            for s, g in ((-1, 'wingL'), (1, 'wingR')):
                k.ell('band', belly, (s * (bw * 0.86 + 0.05), by + 0.08, -0.02), (0.04, bh * 0.28, bl * 0.3), r=(pitch, 0, 0), g=g)
        else:
            k.ell('breast', belly, (0, by + 0.05, bl * 0.55), (bw * 0.75, bh * 0.45, bl * 0.35), g='body')
    if t == 'toucan':
        k.ell('throat', belly, (0, hy - 0.06, hz + 0.08), (hr * 0.9, hr * 0.7, hr * 0.75), g='head')
        k.rod('beak_tip', '#1d1d1d', (0, byk - 0.01, bz + P['beakL'] - 0.12), (0, byk - 0.03, bz + P['beakL'] + 0.04), 0.06, 0.0, seg=7, g='head')
        k.ell('eye_ring', '#4aa3df', (hr * 0.62, hy + hr * 0.18, hz + hr * 0.55), (0.08, 0.08, 0.04), g='head')
        k.ell('eye_ring', '#4aa3df', (-hr * 0.62, hy + hr * 0.18, hz + hr * 0.55), (0.08, 0.08, 0.04), g='head')
    if t == 'hummingbird':
        k.ell('throat', belly, (0, hy - 0.08, hz + 0.06), (hr * 0.9, hr * 0.55, hr * 0.7), g='head')
    if t == 'flamingo':
        for i in range(4):
            a = i / 4
            b = (i + 1) / 4
            def pt(f):
                return (0, by + 0.15 + f * 0.95, bl * 0.55 + math.sin(f * math.pi * 1.4) * 0.22 - f * 0.05)
            k.rod('neck', body, pt(a), pt(b), 0.07, 0.065, seg=7, g='body')
        k.rod('beak', '#f8f2e8', (0, hy - 0.02, hz + hr * 0.7), (0, hy - 0.1, hz + hr * 0.7 + 0.22), 0.06, 0.04, seg=6, g='head')
        k.rod('beak_tip', beak, (0, hy - 0.1, hz + hr * 0.7 + 0.22), (0, hy - 0.24, hz + hr * 0.7 + 0.24), 0.04, 0.0, seg=6, g='head')
    if t == 'roadrunner':
        for i in range(3):
            k.rod('crest', wing, (0, hy + hr * 0.6, hz - i * 0.05), (0, hy + hr * 1.3 - i * 0.08, hz - hr * 0.6 - i * 0.1), 0.05, 0.0, seg=5, g='head')
        for i in range(4):
            k.ell('streak', wing, (0, by - 0.05 + i * 0.03, bl * 0.4 - i * 0.18), (bw * 1.01, 0.03, 0.05), r=(pitch, 0, 0), g='body')
    if t == 'hoopoe':
        for i, a in enumerate((-0.9, -0.45, 0.0, 0.45)):
            base = (0, hy + hr * 0.65, hz + 0.1 - i * 0.12)
            tip = (0, base[1] + 0.32 * math.cos(a * 0.6), base[2] + 0.32 * math.sin(a) - 0.05)
            k.fin('crest', body, [base, (0, base[1] + 0.02, base[2] - 0.09), tip], t=0.03, g='head')
            k.rod('crest_tip', '#1f1f1f', tip, (0, tip[1] + 0.06, tip[2] - 0.02), 0.025, 0.0, seg=5, g='head')
        for s, g in ((-1, 'wingL'), (1, 'wingR')):
            for j in range(3):
                k.ell('bar', '#ffffff', (s * (bw * 0.86 + 0.045), by + 0.03, -0.05 - j * 0.13), (0.04, bh * 0.5, 0.035), r=(pitch, 0, 0), g=g)
    if t == 'nightjar':
        for i, (x, z) in enumerate(((-0.2, 0.1), (0.15, -0.1), (0.0, 0.25), (-0.1, -0.3), (0.22, 0.2))):
            k.ell('mottle', belly, (x, by + bh * 0.8, z), (0.08, 0.04, 0.06), g='body')
    return k


def build():
    return {bid: bird(c, s, t) for bid, c, s, t in BIRDS}
