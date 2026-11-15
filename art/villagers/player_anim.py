# Clips the player needs on top of the villagers' (exec'd after cat_anim.py, before
# anim_export.py, so they end up in the shared villager_anims.json):
#   chop      axe: wind up over the shoulder, swing down, recover
#   dig       shovel: push in, lever, toss
#   net       sweep the bird net from up-right to down-left
#   cast      rod: back over the shoulder and flick forward
#   fish      holding the rod out, the float bobbing (loop)
#   pickup    crouch and reach (shaking trees, picking things up)
# A tool sits in the right paw, so the right arm leads.


def chop(f, n=26):
    p = idle(0)
    up = sm(f / 9)
    down = sm((f - 9) / 4)
    back = sm((f - 17) / 9)
    rx = lerp(lerp(0.0, -2.6, up), -0.75, down)
    rx = lerp(rx, 0.0, back)
    p['armR.rx'] = rx
    p['armR.ry'] = 0.25 * up * (1 - back)
    p['armL.rx'] = 0.6 * rx * (1 - back) * 0.5
    add(p, body__ry=lerp(-0.25 * up, 0.2, down) * (1 - back), body__rx=0.16 * down * (1 - back) - 0.06 * up * (1 - down),
        body__lz=-0.02 * down * (1 - back), head__rx=0.1 * down * (1 - back))
    p['face'] = 'excited' if 8 <= f < 18 else 'normal'
    return p


def dig(f, n=32):
    p = idle(0)
    push = win(f, 0, 8, 12, 16)
    lever = win(f, 12, 16, 20, 24)
    toss = win(f, 18, 22, 26, 31)
    sym_arms(p, -0.8 * push - 1.15 * lever - 0.9 * toss, 0.25 * (push + lever))
    add(p, body__rx=0.32 * push + 0.12 * lever - 0.05 * toss, body__lz=-0.05 * push, body__ry=0.35 * toss, head__rx=0.15 * push)
    p['legL.rx'] = -0.25 * push
    return p


def net_swing(f, n=22):
    p = idle(0)
    up = sm(f / 7)
    sweep = sm((f - 7) / 6)
    back = sm((f - 15) / 7)
    p['armR.rx'] = lerp(lerp(0, -2.2, up), -0.7, sweep) * (1 - back)
    p['armR.ry'] = lerp(lerp(0, 0.6, up), -0.55, sweep) * (1 - back)
    p['armL.rx'] = -0.3 * up * (1 - back)
    add(p, body__ry=lerp(0.25 * up, -0.35, sweep) * (1 - back), body__rx=0.1 * sweep * (1 - back))
    p['face'] = 'excited' if 6 <= f < 16 else 'normal'
    return p


FISH_ARM = -0.95


def cast(f, n=28):
    p = idle(0)
    back = sm(f / 10)
    flick = sm((f - 10) / 5)
    settle = sm((f - 15) / 10)
    p['armR.rx'] = lerp(lerp(0, -2.75, back), -1.35, flick)
    p['armR.rx'] = lerp(p['armR.rx'], FISH_ARM, settle)
    p['armL.rx'] = lerp(-0.2 * back, -0.55, settle)
    p['armL.ry'] = -0.2 * settle
    add(p, body__rx=-0.08 * back * (1 - flick) + 0.1 * flick * (1 - settle), body__ry=-0.2 * back * (1 - flick))
    return p


def fish(f, n=72):
    ph = f / n * 2 * PI
    p = idle(f)
    p['armR.rx'] = FISH_ARM + 0.04 * math.sin(ph * 2) - 0.12 * win(f, 40, 42, 44, 48)
    p['armL.rx'] = -0.55
    p['armL.ry'] = -0.2
    add(p, head__rx=0.08)
    return p


def pickup(f, n=22):
    p = idle(0)
    c = win(f, 0, 7, 13, 21)
    sym_arms(p, -1.1 * c, 0.3 * c)
    add(p, body__rx=0.4 * c, body__lz=-0.07 * c, head__rx=0.15 * c)
    p['legL.rx'] = -0.3 * c; p['legR.rx'] = -0.3 * c
    p['face'] = 'happy' if 6 <= f < 16 else 'normal'
    return p


CLIPS.update({
    'chop': (26, False, chop),
    'dig': (32, False, dig),
    'net': (22, False, net_swing),
    'cast': (28, False, cast),
    'fish': (72, True, fish),
    'pickup': (22, False, pickup),
})


# The player's own walk and run: livelier than the villagers' stroll (bigger arm swing,
# a bounce on every step, a little sway) so the gait reads from the high game camera.
def pwalk(f, n=16):
    ph = f / n * 2 * PI
    s, c = math.sin(ph), math.cos(ph)
    p = pose()
    add(p, legL__rx=-0.75 * s, legR__rx=0.75 * s, armL__rx=0.85 * s, armR__rx=-0.85 * s,
        body__lz=0.045 * abs(c) - 0.012, body__ry=0.08 * s, body__rz=0.07 * s, body__rx=0.07,
        head__rz=-0.06 * s, head__ry=-0.05 * s, head__rx=-0.04 * abs(c))
    sym_arms(p, 0.0, -0.1)
    return p


def prun(f, n=12):
    ph = f / n * 2 * PI
    s, c = math.sin(ph), math.cos(ph)
    p = pose(face='excited')
    add(p, legL__rx=-1.05 * s, legR__rx=1.05 * s, armL__rx=1.1 * s - 0.35, armR__rx=-1.1 * s - 0.35,
        body__lz=0.07 * abs(c) - 0.01, body__rx=0.2, body__rz=0.08 * s, body__ry=0.1 * s,
        head__rx=-0.14, head__rz=-0.06 * s)
    sym_arms(p, 0.0, -0.14)
    return p


CLIPS.update({'pwalk': (16, True, pwalk), 'prun': (12, True, prun)})
