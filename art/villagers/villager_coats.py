# One coat per villager, after the real animal (runs inside villager_fur.py with the
# masks from coat_masks.py). Only the villagers of the species being built are painted.

VILLAGER_SPECIES = {
    'v_maple': 'squirrel', 'v_bruno': 'bear', 'v_pip': 'rabbit', 'v_rex': 'wolf', 'v_juno': 'cat',
    'v_biscuit': 'dog', 'v_saffron': 'fox', 'v_hoot': 'owl', 'v_fawn': 'deer', 'v_ribbit': 'frog',
    'v_waddle': 'penguin', 'v_eucy': 'koala', 'v_puddle': 'duck', 'v_nibbles': 'hamster', 'v_cinder': 'cat',
    'v_tundra': 'wolf', 'v_coco': 'rabbit', 'v_barley': 'bear',
}
LEGS_LOW = np.zeros(len(P), np.float32)
LEGS_LOW[LEGS] = sstep(0.15, 0.11, Z[LEGS])  # the feet (birds' feet are bare)


def face_disc(grow=0.0):
    """Owl facial disc: a round flat face around the eyes."""
    m = np.zeros(len(P), np.float32)
    m[HEAD] = cap(qh[HEAD], (0, -1, 0.05), 0.62 + grow, 0.78 + grow, jit[HEAD])
    return m


def coat_v_maple():
    # Eurasian red squirrel: russet with a cream belly, darker ear tufts and a fuller, deeper red tail.
    c = blank('#c4622a')
    c = put(c, back(), '#a9501f', 0.6)
    c = put(c, under(), '#f6e2c0')
    c = ear_tips(c, '#7a3414', 0.9, 0.6)
    t = np.zeros(len(P), np.float32); t[TAILM] = 1
    c = put(c, t, '#b4521f', 0.7)
    c = tail_tip(c, '#d9844a', 0.85, 0.6)
    c = blush(c, '#f2a08a', 0.45)
    finish_coat('v_maple', c, '#5a3b2e', '#f0b39a')


def coat_v_bruno():
    # Brown bear: deep brown, lighter tan muzzle, darker legs.
    c = blank('#7f5236')
    c = put(c, muzzle(grow=0.04), '#c99b72')
    c = socks(c, '#5e3b26', 0.3, 0.55, 0.7)
    finish_coat('v_bruno', c, '#2b211d', '#c99b72')


def coat_v_barley():
    # Honey (sun-bleached) bear: golden fur, cream muzzle and a pale chest crescent.
    c = blank('#c9a36b')
    c = put(c, muzzle(grow=0.05), '#fff0d4')
    c = put(c, bib(wide=0.12, tall=0.08), '#f3dcae', 0.9)
    c = blush(c, '#eba48a', 0.35)
    finish_coat('v_barley', c, '#3a2a22', '#e9c39a')


def coat_v_pip():
    # White rabbit (New Zealand white): pure white, pink ears inside, the softest grey on the ear rims.
    c = blank('#f6f3ec')
    c = ear_tips(c, '#e2ddd6', 0.5, 0.85)
    c = blush(c, '#f6b6c4', 0.6)
    finish_coat('v_pip', c, '#f2a0b0', '#f6b6c4')


def coat_v_coco():
    # Brown rabbit (Netherland agouti): chocolate brown, cream belly and muzzle, white cotton tail.
    c = blank('#6d4c3d')
    c = put(c, under(), '#f0d9c5', 0.95)
    c = ear_tips(c, '#4e3428', 0.7, 0.7)
    t = np.zeros(len(P), np.float32); t[TAILM] = 1
    c = put(c, t, '#fbf7f0')
    c = blush(c, '#e8a08c', 0.4)
    finish_coat('v_coco', c, '#a85e5a', '#e3b0a2')


def coat_v_rex():
    # Grey wolf: grey with a darker saddle, pale mask, throat and belly, dark ear backs and tail tip.
    c = blank('#858d98')
    c = put(c, back(-0.08, 0.1), '#5b626c', 0.8)
    c = put(c, under(), '#e1e4e8')
    c = ear_backs(c, '#4a4f57')
    c = tail_tip(c, '#33363c', 0.8)
    m = np.zeros(len(P), np.float32)  # dark "eyebrow" mask above the eyes
    m[HEAD] = cap(qh[HEAD], (0, -0.75, 0.6), 0.28, 0.4, jit[HEAD]) * 0.5
    c = put(c, m, '#6a717b')
    finish_coat('v_rex', c, '#2b211d', '#c9b8b8')


def coat_v_tundra():
    # Arctic wolf: snow white with a faint blue-grey saddle.
    c = blank('#eef2f6')
    c = put(c, back(-0.02, 0.14), '#cfd9e3', 0.7)
    c = ear_backs(c, '#d5dde6', 0.6)
    c = blush(c, '#f2c2c8', 0.4)
    finish_coat('v_tundra', c, '#3b3a40', '#e8c9cf')


def coat_v_juno():
    # Bombay (black) cat: glossy jet black with a slightly lighter, cooler muzzle.
    c = blank('#2c2b35')
    c = put(c, muzzle(grow=-0.06), '#3d3b48', 0.6)
    c = ear_tips(c, '#232229', 0.6)
    c = blush(c, '#b07a8c', 0.3)
    finish_coat('v_juno', c, '#3a2f36', '#9a7f8f')


def coat_v_cinder():
    # Orange mackerel tabby – the example cat.
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
    finish_coat('v_cinder', c, '#f08c9c', '#f3a3b0')


def coat_v_biscuit():
    # Golden retriever: warm gold, paler muzzle and chest, deeper gold ears.
    c = blank('#d9a35b')
    c = put(c, muzzle(grow=0.02), '#f1cf96')
    c = put(c, bib(wide=0.12, tall=0.2), '#efc98a', 0.9)
    e = np.zeros(len(P), np.float32); e[EARS] = 1
    c = put(c, e, '#bf8640', 0.8)
    c = blush(c, '#eba48a', 0.35)
    finish_coat('v_biscuit', c, '#2b211d', '#bf8640')


def coat_v_saffron():
    # Red fox: orange with a white muzzle, chest and tail tip, black socks and ear backs.
    c = blank('#e46b2e')
    c = put(c, under(), '#fff7ee')
    c = socks(c, '#2a211e', 0.24, 0.56)
    c = ear_backs(c, '#2a211e')
    c = tail_tip(c, '#fff7ee', 0.8)
    c = blush(c, '#f2a08a', 0.4)
    finish_coat('v_saffron', c, '#2b211d', '#fbe3cf')


def coat_v_hoot():
    # Tawny owl: brown with a pale facial disc rimmed darker, pale streaked chest, barred wings.
    c = blank('#8c6a4a')
    rim = face_disc(0.06) - face_disc()
    c = put(c, np.clip(rim, 0, 1), '#5e4430')
    c = put(c, face_disc(), '#d9b88a')
    ch = belly()
    c = put(c, ch, '#efe0c4')
    streak = np.zeros(len(P), np.float32)
    q = qt[TORSO]
    streak[TORSO] = sstep(0.75, 0.92, np.cos(q[:, 0] * 90 + jit[TORSO] * 6)) * sstep(0.6, 0.9, np.cos(q[:, 2] * 60 + jit[TORSO] * 4))
    c = put(c, streak * ch, '#8c6a4a', 0.8)
    bars = np.zeros(len(P), np.float32)
    bars[ARMS] = sstep(0.6, 0.85, np.cos(Z[ARMS] * 70 + jit[ARMS] * 4))
    c = put(c, bars, '#6a4e36', 0.8)
    c = put(c, LEGS_LOW, '#d6a24a')
    finish_coat('v_hoot', c, '#d9a441', '#6a4e36')


def coat_v_fawn():
    # Fawn (young white-tailed deer): warm brown, white spots along the back, cream belly and muzzle.
    c = blank('#b07a4f')
    c = put(c, under(), '#f6e6d2')
    c = put(c, spots(26.0, 41, 0.022, back(0.02, 0.1) * (1 - under())), '#fbf2e4', 0.95)
    hs = np.zeros(len(P), np.float32); hs[HEAD] = sstep(0.0, 0.1, qh[HEAD][:, 1] + 0.3 * qh[HEAD][:, 2])
    c = put(c, spots(34.0, 43, 0.014, hs * (1 - muzzle(grow=0.1))), '#f3e2cc', 0.7)
    t = np.zeros(len(P), np.float32); t[TAILM] = sstep(0.0, -0.02, N[TAILM][:, 2] * -1 + 0.2)
    c = put(c, t, '#fbf2e4')
    c = ear_tips(c, '#5a3b28', 0.5, 0.85)
    c = blush(c, '#eba48a', 0.4)
    finish_coat('v_fawn', c, '#2b211d', '#f1c9b4')


def coat_v_ribbit():
    # Green frog: leaf green, pale yellow-green throat and belly, darker spots on the back and legs.
    c = blank('#5fae4a')
    c = put(c, under(), '#e8f5c8')
    reg = (1 - under()) * (TORSO | LEGS | HEAD).astype(np.float32)
    reg[HEAD] *= sstep(-0.05, 0.05, qh[HEAD][:, 2])
    c = put(c, spots(20.0, 61, 0.03, reg), '#3d7a31', 0.85)
    c = blush(c, '#f2a08a', 0.5)
    finish_coat('v_ribbit', c, '#3d7a31', '#e8f5c8')


def coat_v_waddle():
    # Penguin (Adélie): blue-black head, back and flippers, white front and eye rings, orange feet.
    c = blank('#25303e')
    fr = np.zeros(len(P), np.float32)
    fr[TORSO] = sstep(0.02, -0.06, qt[TORSO][:, 1] + jit[TORSO] * 0.3)
    c = put(c, fr, '#fbfbf8')
    for s in (-1, 1):
        q = _face_pt((EYE_D.x * s, EYE_D.y, EYE_D.z))
        d = np.linalg.norm(P - q, axis=1)
        ring = sstep(0.12, 0.105, d) * sstep(0.085, 0.1, d) * HEAD
        c = put(c, ring, '#fbfbf8')
    c = put(c, LEGS_LOW, '#f2a03d')
    c = blush(c, '#e88f9a', 0.35)
    finish_coat('v_waddle', c, '#f2a03d', '#f2a03d')


def coat_v_eucy():
    # Koala: soft grey, white chest and chin, white ear fluff, faint darker grey back.
    c = blank('#9aa3a8')
    c = put(c, back(), '#878f94', 0.6)
    c = put(c, bib(wide=0.13, tall=0.22), '#eef1f2')
    c = put(c, muzzle(grow=-0.12), '#d9dee0', 0.7)
    c = ear_tips(c, '#f2f4f5', 0.95, 0.62)
    finish_coat('v_eucy', c, '#2f2a2e', '#f2f4f5')


def coat_v_puddle():
    # Pekin duck: creamy white, a faint yellow wash on the head, orange feet.
    c = blank('#f7f2e3')
    h = np.zeros(len(P), np.float32); h[HEAD] = 0.35
    c = put(c, h, '#f8e8b0')
    c = put(c, LEGS_LOW, '#f2a03d')
    c = blush(c, '#f6b0a0', 0.5)
    finish_coat('v_puddle', c, '#f2a03d', '#f2a03d')


def coat_v_nibbles():
    # Golden (Syrian) hamster: golden orange, white muzzle, cheeks and belly.
    c = blank('#e3a868')
    c = put(c, under(), '#fff4e0')
    ck = np.zeros(len(P), np.float32)
    for s in (-1, 1):
        ck[HEAD] = np.maximum(ck[HEAD], cap(qh[HEAD], (0.72 * s, -0.5, -0.45), 0.28, 0.38, jit[HEAD]))
    c = put(c, ck, '#fff4e0')
    c = ear_tips(c, '#c98a50', 0.5, 0.6)
    c = blush(c, '#f6a99a', 0.55)
    finish_coat('v_nibbles', c, '#f2a0b0', '#f3b0b8')


for vid, sp in VILLAGER_SPECIES.items():
    if sp == SPECIES_NAME:
        globals()['coat_' + vid]()
