# Cat coats after real breeds and coat patterns (runs inside the fur script).
exec(open(ART + r'\villagers\coat_masks.py', encoding='utf-8').read())

# ── Coats ────────────────────────────────────────────────────────────────

# Orange (red) mackerel tabby – the classic ginger moggy.
c = blank('#ec8a45')
c = put(c, muzzle(), '#fff0dc')
c = head_stripes(c, '#c8642c')
c = ear_tips(c, '#c8642c')
c = mackerel(c, '#c8642c')
c = put(c, bib(), '#fff0dc')
c = limb_rings(c, '#c8642c')
c = put(c, paws(), '#fff0dc')
c = tail_rings(c, '#c8642c', '#b05524')
c = whisker_dots(blush(c), '#c79a7c')
finish_coat('orange_tabby', c, '#f08c9c', '#f3a3b0')

# Siamese, seal point: pale cream body, warmer on the back, dark seal-brown points.
c = blank('#f2e4cc')
back = np.zeros(len(P), np.float32); back[TORSO] = sstep(-0.05, 0.12, qt[TORSO][:, 1])
c = put(c, back, '#e2c9a2', 0.7)
c = put(c, sstep(0.0, 1.0, points()), '#4a3326')
c = put(c, points() * 0.35 * sstep(0.5, 1.0, 1 - points()), '#9c7a5c')  # soft fringe around the points
c = blush(c, '#c98f7e', 0.35)
finish_coat('siamese', c, '#3e2b22', '#7a5a4e')

# Tuxedo: black with a white bib, muzzle, blaze and paws.
c = blank('#28262b')
white = np.maximum.reduce([muzzle(grow=-0.04), blaze(), bib(wide=0.12, tall=0.26), paws(arm_z=0.52, leg_z=0.16)])
c = put(c, white, '#f7f4ee')
c = blush(c, '#e8a3a6', 0.45)
finish_coat('tuxedo', c, '#f2a0ab', '#cf9aa1')

# Calico: white with patches of orange and black (white underneath and on the paws).
c = blank('#faf6ef')
under = np.maximum.reduce([muzzle(grow=0.05), blaze(width=0.09), belly(), paws(arm_z=0.56, leg_z=0.22)])
on = 1 - under
orange = blobs(31, 3.2, 0.5, 0.56) * on
black = blobs(57, 3.6, 0.53, 0.59) * on * (1 - orange)
ear_or = np.zeros(len(P), np.float32); ear_or[is_('earL')] = 1
ear_bl = np.zeros(len(P), np.float32); ear_bl[is_('earR')] = 1
c = put(c, np.maximum(orange, ear_or), '#e98a3b')
c = put(c, np.maximum(black, ear_bl), '#2b292d')
c = blush(c, '#f2a7a4', 0.4)
finish_coat('calico', c, '#f29aa6', '#f0b2bb')

# Russian Blue: one even blue-grey with silver-tipped fur.
c = blank('#8a96a2')
tip = np.zeros(len(P), np.float32); tip[:] = sstep(0.5, 0.8, fbm(P[:, 0] * 25, P[:, 1] * 25, P[:, 2] * 25, 5, 2))
c = put(c, tip, '#a7b1bb', 0.22)
c = put(c, muzzle(grow=-0.08), '#9da8b3', 0.5)
finish_coat('russian_blue', c, '#5d6570', '#b59ea6')

# Silver classic tabby (American Shorthair): black swirls – a bullseye on each side,
# a butterfly over the shoulders, three lines down the spine.
c = blank('#bfc4c6')
m = np.zeros(len(P), np.float32)
q = qt[TORSO]; PT = P[TORSO]; jj = jit[TORSO]
for s_ in (-1, 1):
    d = np.linalg.norm((PT - np.array([0.19 * s_, 0.04, 0.53])) * np.array([1.0, 1.0, 0.85]), axis=1) + jj * 0.12
    swirl = np.maximum.reduce([sstep(0.05, 0.04, d), sstep(0.072, 0.082, d) * sstep(0.104, 0.094, d), sstep(0.124, 0.132, d) * sstep(0.152, 0.144, d) * sstep(-0.05, 0.03, q[:, 1])])
    m[TORSO] = np.maximum(m[TORSO], swirl * sstep(0.08, 0.13, np.abs(q[:, 0])))
spine = sstep(0.55, 0.85, np.cos(q[:, 0] * 75 + jj * 3)) * sstep(0.11, 0.0, np.abs(q[:, 0])) * sstep(0.03, 0.1, q[:, 1])
fly = sstep(0.6, 0.85, np.cos(np.hypot(q[:, 0] * 1.4, q[:, 2] - 0.2) * 75 + jj * 3)) * sstep(0.1, 0.18, q[:, 2]) * sstep(0.0, 0.08, q[:, 1])
m[TORSO] = np.maximum.reduce([m[TORSO], spine, fly]) * (1 - bib()[TORSO])
c = put(c, m, '#2b2d2f', 0.92)
c = put(c, muzzle(grow=-0.04), '#ebe8e1', 0.85)
c = head_stripes(c, '#2b2d2f')
c = ear_tips(c, '#3a3c3e', 0.5)
c = limb_rings(c, '#2b2d2f', 0.9)
c = tail_rings(c, '#2b2d2f', '#2b2d2f', 0.9, freq=34)
c = put(c, bib(), '#e4e4e0', 0.6)
finish_coat('silver_tabby', c, '#b97a70', '#d3a9ad')

# Bengal: golden coat with brown rosettes, cream belly and muzzle.
c = blank('#d99f55')
c = put(c, belly(), '#f2e1c2', 0.85)
c = put(c, muzzle(grow=0.02), '#f6e8d0', 0.9)
d, v = worley(17.0, 71)
r_in, r_out = 0.018 + 0.008 * v, 0.031 + 0.009 * v
ros = sstep(r_out, r_out - 0.006, d) * sstep(r_in - 0.006, r_in, d)
fill = sstep(r_in, r_in - 0.005, d) * (v > 0.3)
ds, vs = worley(26.0, 83)
spot = sstep(0.016 + 0.006 * vs, 0.01, ds)
body_ok = (TORSO | TAILM).astype(np.float32) * (1 - belly() * 0.85)
small_ok = (HEAD | ARMS | LEGS).astype(np.float32) * (1 - muzzle(grow=0.06)) * (1 - paws(arm_z=0.52, leg_z=0.15) * 0.7)
small_ok[HEAD] *= sstep(-0.12, 0.02, qh[HEAD][:, 1] + 0.6 * qh[HEAD][:, 2])  # only on top and back of the head
c = put(c, fill * body_ok, '#a8662c', 0.8)
c = put(c, ros * body_ok, '#3b2618', 0.9)
c = put(c, spot * small_ok, '#4a2f1c', 0.85)
c = head_stripes(c, '#5a3a22', 0.75)
c = tail_rings(c, '#3b2618', '#2a1b12', 0.8)
c = ear_tips(c, '#5a3a22', 0.6)
finish_coat('bengal', c, '#b5604c', '#d79c90')

# Tortoiseshell: black and red mottled together, a few lighter flecks.
c = blank('#2a2628')
mott = sstep(0.45, 0.62, fbm(P[:, 0] * 7 + jit * 4, P[:, 1] * 7, P[:, 2] * 7, 91, 3))
c = put(c, mott, '#b8561f')
fleck = sstep(0.78, 0.9, fbm(P[:, 0] * 18, P[:, 1] * 18, P[:, 2] * 18, 93, 2))
c = put(c, fleck * mott, '#e08a43', 0.7)
c = put(c, blaze(width=0.05) * 0.9, '#d26f2a')
finish_coat('tortoiseshell', c, '#5a4040', '#a8868a')
