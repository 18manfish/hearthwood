import math
from kit import Kit

EYE = '#141414'

# id: (length, shape, back, belly, fins, extras)
FISH = {
    'fish_carp': (0.6, dict(depth=0.27, width=0.13, tail='fork', barbels=True), '#7a6a3a', '#d8c27a', '#8a6a3a', {}),
    'fish_perch': (0.35, dict(depth=0.28, width=0.11, tail='fork', dorsal='spiny'), '#6f8a3a', '#e8e0b0', '#e2672e', dict(bars='#2f3a1a')),
    'fish_pike': (0.9, dict(depth=0.16, width=0.1, tail='fork', snout=0.16, dorsal='back'), '#4f6a3a', '#e8e4c8', '#8a6a3a', dict(spots='#d8d49a')),
    'fish_trout': (0.5, dict(depth=0.22, width=0.11, tail='fork'), '#6a7a5a', '#f2eee6', '#9a8a6a', dict(band='#e58fa0', dots='#2a2a2a')),
    'fish_salmon': (0.8, dict(depth=0.23, width=0.11, tail='fork', jaw=True), '#3f5a6a', '#f2f0ea', '#5a6a7a', dict(band='#d9a3a8')),
    'fish_char': (0.5, dict(depth=0.22, width=0.11, tail='fork'), '#3f4f4a', '#e8572e', '#e8572e', dict(spots='#f2e6c8', fin_edge='#ffffff')),
    'fish_tilapia': (0.38, dict(depth=0.36, width=0.12, tail='round', dorsal='spiny'), '#7a8a7a', '#d8dccf', '#6a7a6a', dict(bars='#5a6a5a')),
    'fish_koi': (0.6, dict(depth=0.26, width=0.14, tail='fork', barbels=True), '#f2a62a', '#fff2d6', '#f7c96a', dict(patches='#ffffff')),
    'fish_catfish': (0.8, dict(depth=0.17, width=0.16, tail='round', flat_head=True, whiskers=True), '#4a4a3a', '#cfc7a8', '#3a3a2e', {}),
    'fish_piranha': (0.3, dict(depth=0.4, width=0.13, tail='fork', teeth=True), '#7a8590', '#e2503a', '#5a6570', dict(spots='#a8b2bc')),
    'fish_bitterling': (0.18, dict(depth=0.36, width=0.1, tail='fork'), '#8a9aa8', '#f0c8d8', '#e8607a', dict(band='#5a8ac9')),
    'fish_goldfish': (0.22, dict(depth=0.42, width=0.2, tail='double'), '#f28c1d', '#ffb75a', '#ff9f40', {}),
    'fish_frog': None,
    'fish_dace': (0.28, dict(depth=0.2, width=0.1, tail='fork'), '#7a8a96', '#eef2f4', '#c9d0d6', {}),
    'fish_eel': (0.9, dict(depth=0.06, width=0.06, tail='eel', long=True), '#4a4a2e', '#cfc790', '#3a3a24', {}),
    'fish_sweetfish': (0.32, dict(depth=0.2, width=0.1, tail='fork'), '#7a8a4a', '#eef0e0', '#c9b25a', dict(dot='#f2c230')),
    'fish_sturgeon': (1.5, dict(depth=0.13, width=0.12, tail='heter', snout=0.18, scutes=True, barbels=True), '#5a5f66', '#e6e2d8', '#4a4f56', {}),
    'fish_arowana': (0.85, dict(depth=0.2, width=0.09, tail='round', upmouth=True, barbels=True, dorsal='rear'), '#b8a26a', '#f2e8c8', '#c9a24a', dict(scales='#e0c26a')),
    'fish_sardine': (0.25, dict(depth=0.18, width=0.09, tail='fork'), '#3a6a9a', '#eef2f6', '#b8c4d0', dict(dots='#2a3a4a')),
    'fish_mackerel': (0.45, dict(depth=0.18, width=0.1, tail='lunate', finlets=True), '#3a8a7a', '#eef2f4', '#6a7a8a', dict(waves='#1a2a3a')),
    'fish_seabass': (0.6, dict(depth=0.26, width=0.11, tail='fork', dorsal='spiny'), '#6a7a8a', '#eef0f2', '#8a96a2', {}),
    'fish_cod': (0.8, dict(depth=0.22, width=0.13, tail='round', barbels=True), '#8a7a5a', '#eee8d8', '#7a6a4a', dict(spots='#5a4a32', band='#e6e0cc')),
    'fish_herring': (0.3, dict(depth=0.2, width=0.09, tail='fork'), '#3a5a8a', '#eef2f6', '#a8b4c4', {}),
    'fish_clownfish': (0.2, dict(depth=0.36, width=0.14, tail='round'), '#f2711d', '#f58a3a', '#f2711d', dict(clown=True)),
    'fish_butterfly': (0.26, dict(depth=0.62, width=0.08, tail='round', snout=0.06, disc=True), '#f6d23a', '#fae58a', '#f6d23a', dict(stripe='#1d1d1d', spot='#1d1d1d')),
    'fish_tuna': (1.2, dict(depth=0.26, width=0.17, tail='lunate', finlets=True), '#1f3a6a', '#d8dee6', '#f2c230', {}),
    'fish_mahi': (1.0, dict(depth=0.28, width=0.1, tail='fork', blunt=True, dorsal='long'), '#2a9a6a', '#f2d23a', '#3a7ac9', dict(spots='#1f6a8a')),
    'fish_seabream': (0.5, dict(depth=0.38, width=0.12, tail='fork', dorsal='spiny'), '#d8a0a8', '#f2eaea', '#e6b8bc', dict(spots='#7ab8e0')),
    'fish_oarfish': (2.2, dict(depth=0.06, width=0.03, tail='eel', long=True, crest=True), '#d8dee6', '#f2f4f6', '#e23a3a', dict(waves='#7a8a9a')),
}


def profile(f, peak=0.55, blunt=0.25):
    # Body radius factor along the length (0 = tail root, 1 = nose).
    p = math.log(0.5) / math.log(peak)
    r = math.sin(math.pi * (f ** p)) ** 0.75
    return max(r, blunt * (1 - (1 - f) ** 3)) if f > 0.5 else max(r, 0.22 * (1 - f))


def fish(L, S, back, belly, fins, X):
    k = Kit(scale=L)
    D, W = S['depth'], S['width']
    n = 14 if S.get('long') else 9
    peak = 0.6 if S.get('blunt') else 0.55
    blunt = 0.55 if S.get('blunt') else (0.35 if S.get('disc') else 0.22)
    fs = [i / (n - 1) for i in range(n)]
    zs = [-0.42 + f * 0.86 for f in fs]
    rings = []
    for f, z in zip(fs, zs):
        r = profile(f, peak, blunt)
        if S.get('long'):
            r = max(0.55, min(1.0, math.sin(math.pi * min(1, f * 1.05)) * 3)) if f < 0.97 else 0.5
        rings.append((z, max(0.006, W / 2 * r), max(0.008, D / 2 * r), 0.0))
    # Back (upper) and belly (lower) halves: belly is a slightly smaller, lower loft.
    k.pivot('body', (0, 0, 0))
    k.loft('body', back, rings, seg=10, g='body')
    k.loft('belly', belly, [(z, w * 1.03, h * 0.62, -h * 0.42) for (z, w, h, _) in rings], seg=10, g='body', only=range(1, n - 2))
    nose = zs[-1]
    hr = rings[-2][2]
    # Snout (pike, sturgeon, butterflyfish).
    if S.get('snout'):
        sl = S['snout']
        k.rod('snout', back, (0, 0.0, nose - 0.04), (0, -0.005 if not S.get('scutes') else 0.01, nose + sl), rings[-2][1] * 0.8, 0.004, seg=8, g='body')
        if S.get('scutes'):
            pass
    if S.get('flat_head'):
        k.ell('head', back, (0, -0.005, nose - 0.08), (W * 0.62, D * 0.32, 0.12), g='body')
        k.ell('mouth', '#e6dcc0', (0, -D * 0.12, nose - 0.02), (W * 0.42, D * 0.06, 0.05), g='body')
    if S.get('blunt'):
        k.ell('forehead', back, (0, D * 0.12, nose - 0.05), (W * 0.5, D * 0.45, 0.07), g='body')
    if S.get('upmouth'):
        k.rbox('mouth', '#e6d8b0', (0, D * 0.12, nose + 0.005), (W * 0.45, 0.015, 0.06), r=(-0.7, 0, 0), g='body')
    if S.get('jaw'):
        k.rod('jaw', back, (0, -D * 0.12, nose - 0.04), (0, -D * 0.02, nose + 0.035), 0.018, 0.008, seg=6, g='body')
    if S.get('teeth'):
        for i in range(4):
            x = (i - 1.5) * W * 0.18
            k.rod('teeth', '#ffffff', (x, -D * 0.12, nose - 0.005), (x, -D * 0.04, nose + 0.005), 0.008, 0.0, seg=5, g='body')
    # Eyes.
    ez = nose - (0.07 if not S.get('snout') else 0.04) - (0.03 if S.get('flat_head') else 0)
    ey = D * (0.1 if not S.get('flat_head') else 0.06)
    ew = rings[-3][1]
    er = max(0.014, D * 0.09) if not S.get('long') else 0.012
    for s in (-1, 1):
        k.ell('eye_white', '#e8e8e0', (s * ew * 0.92, ey, ez), (0.008, er * 1.25, er * 1.25), g='body')
        k.ell('eye', EYE, (s * (ew * 0.92 + 0.006), ey, ez), (0.008, er, er), g='body')
    # Barbels / whiskers.
    if S.get('barbels') or S.get('whiskers'):
        lw = 0.16 if S.get('whiskers') else 0.05
        for s in (-1, 1):
            k.rod('barbel', fins, (s * W * 0.2, -D * 0.1, nose - 0.01), (s * (W * 0.2 + lw * 0.8), -D * 0.1 - lw * 0.4, nose - lw * 0.2), 0.006, 0.002, seg=5, g='body')
            if S.get('whiskers'):
                k.rod('barbel', fins, (s * W * 0.15, -D * 0.2, nose - 0.02), (s * (W * 0.15 + 0.05), -D * 0.2 - 0.07, nose - 0.04), 0.005, 0.002, seg=5, g='body')
    # Dorsal fin.
    top = lambda z: max(h for (zz, w, h, _) in rings if abs(zz - z) < 0.12) * 0.95
    dorsal = S.get('dorsal', 'normal')
    if dorsal == 'normal':
        k.fin('fin', fins, [(0, top(0.05), 0.12), (0, top(-0.15), -0.12), (0, top(0.0) + D * 0.35, -0.08)], t=0.012, g='body')
    elif dorsal == 'spiny':
        k.fin('fin', fins, [(0, top(0.15), 0.18), (0, top(-0.05), -0.05), (0, top(0.1) + D * 0.42, 0.05), (0, top(0.15) + D * 0.3, 0.16)], t=0.012, g='body')
        k.fin('fin', fins, [(0, top(-0.05), -0.04), (0, top(-0.25), -0.25), (0, top(-0.15) + D * 0.3, -0.2)], t=0.012, g='body')
    elif dorsal == 'back':
        k.fin('fin', fins, [(0, top(-0.2), -0.18), (0, top(-0.33), -0.34), (0, top(-0.25) + D * 0.5, -0.32)], t=0.012, g='body')
    elif dorsal == 'rear':
        k.fin('fin', fins, [(0, top(-0.05), 0.0), (0, top(-0.35), -0.36), (0, top(-0.3) + D * 0.35, -0.38)], t=0.012, g='body')
    elif dorsal == 'long':
        k.fin('fin', fins, [(0, top(0.35), 0.36), (0, top(-0.32), -0.34), (0, top(-0.2) + D * 0.3, -0.3), (0, top(0.3) + D * 0.45, 0.3)], t=0.012, g='body')
    if S.get('disc'):
        k.fin('fin', fins, [(0, D * 0.3, 0.15), (0, D * 0.3, -0.25), (0, D * 0.52, -0.2), (0, D * 0.55, 0.05)], t=0.012, g='body')
        k.fin('fin', fins, [(0, -D * 0.3, 0.05), (0, -D * 0.3, -0.25), (0, -D * 0.5, -0.2), (0, -D * 0.5, -0.02)], t=0.012, g='body')
    if S.get('crest'):
        for i in range(10):
            z = 0.4 - i * 0.085
            k.fin('crest', fins, [(0, D * 0.4, z + 0.02), (0, D * 0.4, z - 0.05), (0, D * (0.9 if i > 1 else 2.2), z - 0.02)], t=0.006, g='body')
    if S.get('long') and not S.get('crest'):
        k.fin('fin', fins, [(0, D * 0.45, 0.25), (0, D * 0.45, -0.42), (0, D * 0.75, -0.3)], t=0.006, g='body')
        k.fin('fin', fins, [(0, -D * 0.45, 0.0), (0, -D * 0.45, -0.42), (0, -D * 0.75, -0.3)], t=0.006, g='body')
    # Pectoral and pelvic fins.
    if not S.get('long'):
        for s in (-1, 1):
            px = rings[n // 2 + 1][1]
            k.fin('fin', fins, [(s * px * 0.9, -D * 0.12, nose - 0.18), (s * px * 0.9, -D * 0.2, nose - 0.22), (s * (px + 0.06), -D * 0.3, nose - 0.3)], t=0.008, g='body')
        k.fin('fin', fins, [(0, -top(-0.1) * 0.9, -0.05), (0, -top(-0.25) * 0.9, -0.24), (0, -top(-0.2) - D * 0.2, -0.22)], t=0.01, g='body')
    if S.get('finlets'):
        for i in range(4):
            z = -0.2 - i * 0.05
            for y in (top(z), -top(z)):
                k.fin('finlet', fins, [(0, y, z), (0, y, z - 0.035), (0, y + math.copysign(0.025, y), z - 0.035)], t=0.008, g='body')
    if S.get('scutes'):
        for i in range(8):
            z = 0.32 - i * 0.09
            k.rod('scute', '#d8d4c8', (0, top(z) * 0.95, z), (0, top(z) * 0.95 + 0.025, z - 0.01), 0.014, 0.0, seg=5, g='body')
    # Tail (pivot at its root).
    tz = zs[0]
    th = rings[1][2]
    k.pivot('tail', (0, 0, tz + 0.02))
    tail = S['tail']
    if tail == 'fork':
        k.fin('tail', fins, [(0, th * 0.6, tz + 0.03), (0, D * 0.55, tz - 0.17), (0, D * 0.12, tz - 0.1), (0, 0, tz - 0.06)], t=0.012, g='tail')
        k.fin('tail', fins, [(0, -th * 0.6, tz + 0.03), (0, -D * 0.55, tz - 0.17), (0, -D * 0.12, tz - 0.1), (0, 0, tz - 0.06)], t=0.012, g='tail')
    elif tail == 'round':
        k.fin('tail', fins, [(0, th * 0.6, tz + 0.03), (0, D * 0.42, tz - 0.12), (0, D * 0.2, tz - 0.17), (0, -D * 0.2, tz - 0.17), (0, -D * 0.42, tz - 0.12), (0, -th * 0.6, tz + 0.03)], t=0.012, g='tail')
    elif tail == 'lunate':
        for s in (1, -1):
            k.fin('tail', fins, [(0, s * th * 0.5, tz + 0.02), (0, s * D * 0.75, tz - 0.16), (0, s * D * 0.55, tz - 0.12), (0, 0, tz - 0.04)], t=0.012, g='tail')
    elif tail == 'double':
        for x in (-0.05, 0.05):
            k.add('tail', fins, [(x + dx, y, z) for dx in (-0.006, 0.006) for (y, z) in ((th * 0.5, tz + 0.03), (D * 0.62, tz - 0.3), (0, tz - 0.22), (-D * 0.62, tz - 0.3), (-th * 0.5, tz + 0.03))], g='tail')
    elif tail == 'heter':
        k.fin('tail', fins, [(0, th * 0.6, tz + 0.03), (0, D * 0.8, tz - 0.18), (0, D * 0.2, tz - 0.1), (0, 0, tz - 0.05)], t=0.012, g='tail')
        k.fin('tail', fins, [(0, -th * 0.6, tz + 0.03), (0, -D * 0.35, tz - 0.1), (0, 0, tz - 0.05)], t=0.012, g='tail')
    elif tail == 'eel':
        k.fin('tail', fins, [(0, th * 1.2, tz + 0.04), (0, 0, tz - 0.06), (0, -th * 1.2, tz + 0.04)], t=0.008, g='tail')
    if X.get('fin_edge'):
        k.fin('fin_edge', X['fin_edge'], [(0, -D * 0.5, tz - 0.155), (0, -D * 0.56, tz - 0.17), (0, -D * 0.4, tz - 0.12)], t=0.016, g='tail')

    # Markings: thin shells slightly outside the body (lofts of scaled rings).
    def band(z0, z1, color, top_only=False, grow=1.04, role='mark'):
        rs = [(z, w * grow, h * grow, yc) for (z, w, h, yc) in rings if z0 - 0.07 <= z <= z1 + 0.07]
        if len(rs) < 2:
            return
        rs = [r for r in rs]
        z_lo, z_hi = max(z0, rs[0][0]), min(z1, rs[-1][0])
        def at(z):
            for a, b in zip(rs, rs[1:]):
                if a[0] <= z <= b[0]:
                    t = (z - a[0]) / ((b[0] - a[0]) or 1)
                    return (z, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 0.0)
            return rs[0] if z < rs[0][0] else rs[-1]
        r0, r1 = at(z_lo), at(z_hi)
        if top_only:
            k.loft(role, color, [(r0[0], r0[1], r0[2] * 0.5, r0[2] * 0.55), (r1[0], r1[1], r1[2] * 0.5, r1[2] * 0.55)], seg=8, g='body')
        else:
            k.loft(role, color, [r0, r1], seg=10, g='body')
    if X.get('clown'):
        for zc, wdt in ((0.24, 0.05), (0.0, 0.06), (-0.27, 0.04)):
            band(zc - wdt - 0.015, zc + wdt + 0.015, '#1d1d1d', grow=1.04, role='stripe_edge')
            band(zc - wdt, zc + wdt, '#ffffff', grow=1.07, role='stripe')
    if X.get('stripe'):
        band(0.2, 0.26, X['stripe'], grow=1.05, role='stripe')
    if X.get('spot'):
        k.ell('spot', X['spot'], (W / 2 * 0.95, D * 0.12, -0.2), (0.012, D * 0.09, 0.05), g='body')
        k.ell('spot', X['spot'], (-W / 2 * 0.95, D * 0.12, -0.2), (0.012, D * 0.09, 0.05), g='body')
    if X.get('bars'):
        for zc in (0.15, 0.02, -0.11, -0.24):
            band(zc - 0.025, zc + 0.025, X['bars'], top_only=True, grow=1.05, role='bar')
    if X.get('band'):
        for s in (-1, 1):
            for zc in (0.2, 0.05, -0.1, -0.25):
                rr = [r for r in rings if abs(r[0] - zc) < 0.1][0]
                k.ell('band', X['band'], (s * rr[1] * 0.96, 0.0, zc), (0.01, D * 0.07, 0.085), g='body')
    for key, rad in (('dots', 0.011), ('spots', 0.014)):
        if X.get(key):
            pts = ((0.22, 0.6), (0.1, 0.75), (0.0, 0.5), (-0.1, 0.7), (-0.2, 0.55), (0.15, 0.35), (-0.05, 0.3), (-0.25, 0.25))
            for s in (-1, 1):
                for (zc, yf) in pts:
                    rr = min(rings, key=lambda r: abs(r[0] - zc))
                    ang = math.asin(min(0.95, yf * 0.8))
                    k.ell(key, X[key], (s * rr[1] * math.cos(ang) * 1.0, rr[2] * math.sin(ang), zc), (0.008, D * rad * 3.2, D * rad * 3.0), g='body')
    if X.get('patches'):
        for (zc, s, sz) in ((0.18, 1, 0.07), (-0.02, -1, 0.09), (-0.2, 1, 0.06)):
            rr = min(rings, key=lambda r: abs(r[0] - zc))
            k.ell('patch', X['patches'], (s * rr[1] * 0.4, rr[2] * 0.75, zc), (rr[1] * 0.7, rr[2] * 0.35, sz), g='body')
    if X.get('waves'):
        for i in range(6):
            zc = 0.25 - i * 0.1
            rr = min(rings, key=lambda r: abs(r[0] - zc))
            k.ell('wave', X['waves'], (0, rr[2] * 0.8, zc), (rr[1] * 0.88, rr[2] * 0.28, 0.014), g='body')
    if X.get('dot'):
        for s in (-1, 1):
            rr = min(rings, key=lambda r: abs(r[0] - 0.12))
            k.ell('dot', X['dot'], (s * rr[1] * 0.97, rr[2] * 0.2, 0.12), (0.01, D * 0.08, 0.04), g='body')
    if X.get('scales'):
        for i in range(5):
            for j in range(2):
                zc = 0.2 - i * 0.11
                rr = min(rings, key=lambda r: abs(r[0] - zc))
                for s in (-1, 1):
                    k.ell('scale', X['scales'], (s * rr[1] * 0.96, (j - 0.5) * rr[2] * 0.6, zc), (0.01, rr[2] * 0.22, 0.04), g='body')
    return k


def frog():
    # Pond frog, sitting; origin at the ground under its middle, facing +z.
    k = Kit(scale=1.0)
    g, gl, b = '#5fae4a', '#8cc96a', '#e8f5c8'
    k.pivot('body', (0, 0.06, 0))
    k.ell('body', g, (0, 0.07, -0.01), (0.075, 0.055, 0.09), r=(-0.35, 0, 0), g='body')
    k.ell('belly', b, (0, 0.055, 0.02), (0.06, 0.04, 0.065), r=(-0.35, 0, 0), g='body')
    k.ell('head', g, (0, 0.1, 0.07), (0.07, 0.04, 0.055), g='body')
    for s in (-1, 1):
        k.ell('eye_bump', gl, (s * 0.042, 0.135, 0.075), (0.022, 0.022, 0.022), g='body')
        k.ell('eye', EYE, (s * 0.05, 0.14, 0.08), (0.013, 0.015, 0.015), g='body')
        k.ell('spot', '#3d7a2e', (s * 0.03, 0.11, -0.04), (0.018, 0.01, 0.022), g='body')
        k.ell('thigh', g, (s * 0.07, 0.04, -0.05), (0.03, 0.03, 0.055), r=(0.4, 0, 0), g='body')
        k.ell('foot', gl, (s * 0.085, 0.006, -0.0), (0.022, 0.006, 0.045), g='body')
        k.rod('arm', g, (s * 0.04, 0.06, 0.06), (s * 0.05, 0.008, 0.085), 0.012, 0.01, seg=6, g='body')
        k.ell('hand', gl, (s * 0.052, 0.005, 0.095), (0.016, 0.005, 0.016), g='body')
    k.ell('mouth', '#3d7a2e', (0, 0.088, 0.105), (0.05, 0.004, 0.02), g='body')
    return k


def build():
    out = {}
    for fid, spec in FISH.items():
        out[fid] = frog() if spec is None else fish(spec[0], spec[1], spec[2], spec[3], spec[4], spec[5])
    return out
