# Villager species: everything that differs between species (head shape, ears, snout,
# nose, beak, eyes, tail, arm shape, fur feel). The body is shared, so clothes fit all.
#
# Directions are on the unit sphere around the head centre (x right, -y front, z up).

SPECIES = {
    'cat': dict(R=(0.345, 0.30, 0.29), snout=(0.032, 0.16), pads=True, tufts=True,
                ears='cat', nose=('tri', '#f08c9c', 0.042), nose_d=(0, -0.97, -0.14), mouth_d=(0, -0.97, -0.30),
                tail='cat', fur='plush'),
    'dog': dict(R=(0.34, 0.30, 0.29), snout=(0.17, 0.4), snout_d=(0, -0.95, -0.32), ears='floppy',
                nose=('round', '#2b211d', 0.05), nose_d=(0, -0.92, -0.2), mouth_d=(0, -0.86, -0.5), tail='dog', fur='plush'),
    'rabbit': dict(R=(0.33, 0.30, 0.29), snout=(0.04, 0.2), pads=True, ears='long',
                   nose=('tri', '#f2a0b0', 0.032), nose_d=(0, -0.97, -0.16), mouth_d=(0, -0.96, -0.3), tail='puff', fur='plush'),
    'bear': dict(R=(0.35, 0.31, 0.3), snout=(0.13, 0.42), snout_d=(0, -0.95, -0.3), ears='round',
                 nose=('round', '#2b211d', 0.055), nose_d=(0, -0.93, -0.18), mouth_d=(0, -0.86, -0.48), tail='ball', fur='plush'),
    'fox': dict(R=(0.34, 0.29, 0.28), snout=(0.2, 0.3), snout_d=(0, -0.95, -0.32), tufts=True, ears='fox',
                nose=('round', '#2b211d', 0.042), nose_d=(0, -0.9, -0.24), mouth_d=(0, -0.84, -0.52), tail='bushy_up', fur='plush'),
    'wolf': dict(R=(0.345, 0.3, 0.29), snout=(0.19, 0.34), snout_d=(0, -0.95, -0.32), tufts=True, ears='wolf',
                 nose=('round', '#2b211d', 0.05), nose_d=(0, -0.9, -0.24), mouth_d=(0, -0.84, -0.52), tail='bushy_down', fur='plush'),
    'owl': dict(R=(0.35, 0.31, 0.3), snout=(0.0, 0.3), ears='tufts', eye_s=1.15, eye_d=(0.4, -0.86, 0.08),
                beak=('hook', '#d9a441'), nose=None, mouth=False, tail='feathers', arms='wing', fur='feather'),
    'deer': dict(R=(0.33, 0.3, 0.29), snout=(0.15, 0.34), snout_d=(0, -0.95, -0.34), ears='deer',
                 nose=('round', '#2b211d', 0.042), nose_d=(0, -0.9, -0.26), mouth_d=(0, -0.84, -0.52), tail='flat', fur='plush'),
    'frog': dict(R=(0.4, 0.31, 0.25), snout=(0.0, 0.3), ears=None, frog_eyes=True, eye_d=(0.44, -0.62, 0.62), eye_s=0.9,
                 nose=None, mouth_d=(0, -0.97, -0.22), mouth_w=1.9, tail=None, fur='skin'),
    'penguin': dict(R=(0.34, 0.31, 0.3), snout=(0.0, 0.3), ears=None, beak=('point', '#f2a03d'), nose=None, mouth=False,
                    tail='wedge', arms='wing', feet='web', fur='feather'),
    'koala': dict(R=(0.36, 0.3, 0.29), snout=(0.02, 0.3), ears='koala', nose=('koala', '#2f2a2e', 0.0), nose_d=(0, -0.97, -0.12),
                  mouth_d=(0, -0.95, -0.36), tail='tiny', fur='plush'),
    'duck': dict(R=(0.33, 0.3, 0.29), snout=(0.0, 0.3), ears=None, beak=('bill', '#f2a03d'), nose=None, mouth=False,
                 tail='duck', arms='wing', feet='web', fur='feather'),
    'hamster': dict(R=(0.35, 0.3, 0.29), snout=(0.03, 0.2), cheeks=0.07, pads=True, ears='round_small',
                    nose=('tri', '#f2a0b0', 0.03), nose_d=(0, -0.97, -0.14), mouth_d=(0, -0.96, -0.28), tail='tiny', fur='plush'),
    'squirrel': dict(R=(0.34, 0.3, 0.29), snout=(0.05, 0.22), pads=True, tufts=True, ears='squirrel',
                     nose=('tri', '#5a3b2e', 0.034), nose_d=(0, -0.97, -0.15), mouth_d=(0, -0.96, -0.3), tail='squirrel', fur='plush'),
    # Player characters: a round human head on the same body (so every clothing cut fits).
    'human_m': dict(R=(0.34, 0.31, 0.305), snout=(0.0, 0.3), ears='human', nose=None, eye_d=(0.31, -0.94, 0.06), eye_s=0.74,
                    mouth_d=(0, -0.95, -0.33), mouth_w=0.8, tail=None, arms='hand', fur='skin', human=True),
    'human_f': dict(R=(0.34, 0.31, 0.305), snout=(0.0, 0.3), ears='human', nose=None, eye_d=(0.31, -0.94, 0.06), eye_s=0.76,
                    mouth_d=(0, -0.95, -0.33), mouth_w=0.75, tail=None, arms='hand', fur='skin', human=True, lashes=True),
}

# Tail centre lines (tube tails): points and radius profile, bevel (thickness).
TAILS = {
    'cat': (((0, 0.13, 0.42), (0.07, 0.29, 0.40), (0.2, 0.38, 0.52), (0.24, 0.37, 0.72), (0.17, 0.31, 0.84)), (1.0, 0.95, 0.9, 0.85, 0.65), 0.047),
    'dog': (((0, 0.13, 0.42), (0, 0.27, 0.48), (0.03, 0.33, 0.62), (0.02, 0.3, 0.72)), (1.0, 0.95, 0.85, 0.5), 0.05),
    'bushy_up': (((0, 0.13, 0.4), (0.04, 0.32, 0.36), (0.16, 0.46, 0.46), (0.2, 0.48, 0.66), (0.14, 0.42, 0.8)), (0.55, 1.0, 1.2, 1.0, 0.35), 0.085),
    'bushy_down': (((0, 0.13, 0.42), (0, 0.3, 0.36), (0.03, 0.42, 0.24), (0.05, 0.46, 0.13)), (0.6, 1.0, 1.05, 0.45), 0.08),
    'squirrel': (((0, 0.13, 0.36), (0, 0.32, 0.36), (0, 0.42, 0.6), (0, 0.38, 0.9), (0, 0.28, 1.12), (0, 0.36, 1.26)), (0.6, 1.0, 1.25, 1.3, 1.15, 0.55), 0.1),
}
