"""Pixel-art pieces for the book-style journal (album).

Each piece is a small grid of colours. Run:

    python3 art/journal/journal_gen.py OUT_DIR [PNG_DIR]

writes OUT_DIR/grids/*.lua (grid files for Aseprite's paint_grid, to redo or
touch up the art there), OUT_DIR/layout.json (where each piece sits on one
sheet), OUT_DIR/preview.png, and – with PNG_DIR (client/public/journal) – one
PNG per piece, which is what the game loads.
"""
import json, math, os, random, sys
from PIL import Image

INK, INK_L = '#5a3d26', '#8a6a4a'
PAPER, PAPER_D, PAPER_L, PAPER_F = '#f4e9d0', '#e9dabb', '#faf3e3', '#e3d1ad'


class G:
    def __init__(self, w, h, fill=None):
        self.w, self.h = w, h
        self.p = [[fill] * w for _ in range(h)]

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h and c:
            self.p[y][x] = c

    def get(self, x, y):
        return self.p[y][x] if 0 <= x < self.w and 0 <= y < self.h else None

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c)

    def line(self, x0, y0, x1, y1, c):
        n = max(abs(x1 - x0), abs(y1 - y0))
        for i in range(n + 1):
            t = i / max(1, n)
            self.set(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t), c)


def mix(a, b, t):
    a = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#%02x%02x%02x' % tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


# ── Cover: 9-slice leather with stitching and brass corners (48×48, slices of 16) ──
def cover():
    g = G(48, 48)
    LEA, LEA_D, LEA_L, STITCH = '#7a4528', '#5c321c', '#8e5534', '#d9b98a'
    rnd = random.Random(4)
    for y in range(48):
        for x in range(48):
            edge = min(x, y, 47 - x, 47 - y)
            c = LEA_D if edge == 0 else LEA_L if edge == 1 else LEA
            if edge > 2 and rnd.random() < 0.08:
                c = LEA_D if rnd.random() < 0.5 else LEA_L  # leather grain
            g.set(x, y, c)
    # Stitching: dashes 5 px in from the edge (the pattern repeats every 4 px, so tiling the edges keeps it).
    for i in range(48):
        if i % 4 < 2:
            for (x, y) in ((i, 5), (i, 42), (5, i), (42, i)):
                if 5 <= x <= 42 and 5 <= y <= 42:
                    g.set(x, y, STITCH)
    # Brass corner caps.
    BR, BR_D, BR_L = '#c9a24a', '#8a6a2a', '#f0d88a'
    for (cx, cy, sx, sy) in ((0, 0, 1, 1), (47, 0, -1, 1), (0, 47, 1, -1), (47, 47, -1, -1)):
        for d in range(9):
            for e in range(9 - d):
                x, y = cx + sx * d, cy + sy * e
                c = BR_D if d + e == 8 or d == 0 or e == 0 else BR_L if d + e < 3 else BR
                g.set(x, y, c)
        g.set(cx + sx * 3, cy + sy * 3, BR_D)  # rivet
    return g


# ── Paper: a seamless 32×32 tile with fibres and flecks ────────────────────────
def paper():
    g = G(32, 32, PAPER)
    rnd = random.Random(11)
    for _ in range(46):
        g.set(rnd.randrange(32), rnd.randrange(32), PAPER_D if rnd.random() < 0.6 else PAPER_L)
    for _ in range(7):  # little fibres
        x, y = rnd.randrange(32), rnd.randrange(32)
        dx = rnd.choice((1, -1))
        for i in range(rnd.randint(2, 4)):
            g.set((x + i * dx) % 32, (y + (i // 2)) % 32, PAPER_D)
    for _ in range(3):
        g.set(rnd.randrange(32), rnd.randrange(32), PAPER_F)
    return g


# ── Gutter: the fold in the middle of the spread (40 wide, tiles vertically) ───
def gutter():
    """Dithered (Bayer 4×4) so the paper shows through towards the edges – no seam."""
    g = G(40, 8)
    bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    for y in range(8):
        for x in range(40):
            d = abs(x - 19.5) / 19.5  # 0 at the fold, 1 at the edges
            shade = (1 - d) ** 2.6
            if abs(x - 19.5) < 1:
                g.set(x, y, '#9c845c')
            elif shade * 17 > bayer[y % 4][x % 4] + 1:
                g.set(x, y, '#b39a70' if shade > 0.55 else '#d2bf98')
    return g


# ── Entry frame: 9-slice inked box with tape on two corners (24×24, slices of 8) ──
def slot():
    g = G(24, 24)
    INSIDE = '#efe2c3'
    g.rect(2, 2, 21, 21, INSIDE)
    rnd = random.Random(2)
    for i in range(2, 22):
        for (x, y) in ((i, 1), (i, 22), (1, i), (22, i)):
            g.set(x, y, INK)
        if rnd.random() < 0.25:  # hand-drawn wobble
            g.set(i, 2, INK_L)
    for (x, y) in ((1, 1), (22, 1), (1, 22), (22, 22)):
        g.set(x, y, INK_L)
    TAPE, TAPE_D = '#e9d59a', '#d4bc78'
    # A strip of tape across each top corner (a band along the corner's diagonal).
    for y in range(9):
        for x in range(9):
            if 4 <= x + y <= 8 and abs(x - y) <= 4:
                c = TAPE_D if x + y in (4, 8) else TAPE
                g.set(x, y, c)
                g.set(23 - x, y, c)
    return g


# ── "?" for animals not caught yet (16×16, inked) ───────────────────────────────
def question():
    g = G(16, 16)
    rows = [
        '....######......',
        '...########.....',
        '..###....###....',
        '..##......##....',
        '..........##....',
        '.........###....',
        '........###.....',
        '.......###......',
        '......###.......',
        '......##........',
        '......##........',
        '................',
        '......##........',
        '.....####.......',
        '......##........',
        '................',
    ]
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == '#':
                g.set(x + 2, y, INK)
    # Highlights and a little ink blot.
    for (x, y) in ((6, 1), (7, 1), (4, 3)):
        g.set(x, y, INK_L)
    g.set(13, 13, INK_L)
    return g


# ── Tabs sticking out of the right page (28×18): fish (blue), birds (green) ─────
def tab(color, glyph):
    g = G(28, 18)
    dark, light = mix(color, '#1a1410', 0.35), mix(color, '#ffffff', 0.3)
    for y in range(18):
        for x in range(28):
            r = 4
            inside = x < 28 - r or (x - (27 - r)) ** 2 + (min(max(y, r), 17 - r) - y) ** 2 <= r * r
            if not inside:
                continue
            edge = y in (0, 17) or x == 27 or (x >= 28 - r and (x - (27 - r)) ** 2 + (min(max(y, r), 17 - r) - y) ** 2 > (r - 1) ** 2)
            g.set(x, y, dark if edge else light if y == 1 else color)
    W = '#fffaf0'
    for (x, y) in glyph:
        g.set(x + 10, y + 4, W)
    return g


FISH_GLYPH = [(1, 4), (2, 3), (3, 3), (4, 3), (5, 3), (6, 4), (7, 3), (7, 5), (2, 5), (3, 5), (4, 5), (5, 5), (1, 4), (2, 4), (3, 4), (4, 4), (5, 4), (8, 2), (8, 6), (3, 4)]
BIRD_GLYPH = [(2, 2), (3, 2), (1, 3), (2, 3), (3, 3), (4, 3), (0, 3), (2, 4), (3, 4), (4, 4), (5, 4), (6, 4), (3, 5), (4, 5), (5, 5), (6, 5), (7, 5), (4, 6), (5, 6), (3, 7), (5, 7)]


# ── Page-turn arrows (12×10) ────────────────────────────────────────────────────
def arrow(right):
    g = G(12, 10)
    for y in range(10):
        span = 5 - abs(y - 4.5) + 0.5
        for x in range(int(span) + 1):
            xx = 6 + x if right else 5 - x
            g.set(xx if right else xx, y, INK) if x < span else None
    g.rect(0 if right else 6, 3, 6 if right else 11, 6, INK)
    for y in range(10):
        for x in range(12):
            if g.get(x, y) and (y in (3, 4) and (x < 6) == right):
                g.set(x, y, INK_L)
    return g


# ── Ribbon bookmark (10×56): hangs from the top, forked end ─────────────────────
def ribbon():
    g = G(10, 56)
    R, R_D, R_L = '#b8323a', '#8a2128', '#d8505a'
    for y in range(56):
        for x in range(1, 9):
            fork = y > 47 and abs(x - 4.5) < (y - 47) * 0.5
            if fork:
                continue
            g.set(x, y, R_D if x in (1, 8) else R_L if x == 3 else R)
    return g


# ── Corner flourish (14×14, top-left; flipped in CSS for the other corners) ────
def flourish():
    g = G(14, 14)
    for i in range(13):  # outer corner line
        g.set(i, 0, INK_L)
        g.set(0, i, INK_L)
    for i in range(2, 8):  # inner, shorter line
        g.set(i, 2, INK_L)
        g.set(2, i, INK_L)
    for (x, y) in ((4, 4), (5, 5), (6, 5), (5, 6), (7, 4), (4, 7), (8, 3), (3, 8)):  # a little leaf
        g.set(x, y, INK)
    g.set(1, 1, INK)
    for i in (10, 11):
        g.set(i, 2, INK_L)
        g.set(2, i, INK_L)
    return g


# ── Title divider (64×7): ink line with a diamond in the middle ─────────────────
def divider():
    g = G(64, 7)
    for x in range(64):
        if 4 <= x <= 59 and abs(x - 31.5) > 4:
            g.set(x, 3, INK_L if (x < 10 or x > 53) else INK)
    for d in range(4):
        for k in range(-d, d + 1):
            pass
    for y in range(7):
        w = 3 - abs(y - 3)
        for x in range(32 - w - 1, 32 + w):
            g.set(x, y, INK if abs(x - 31.5) + abs(y - 3) > w - 0.5 else '#c9a24a')
    for x in (3, 60):
        g.set(x, 3, INK)
    return g


PIECES = {
    'cover': cover(), 'paper': paper(), 'gutter': gutter(), 'slot': slot(), 'question': question(),
    'tab_fish': tab('#4f86b8', FISH_GLYPH), 'tab_birds': tab('#5f9a4f', BIRD_GLYPH),
    'arrow_left': arrow(False), 'arrow_right': arrow(True), 'ribbon': ribbon(), 'flourish': flourish(), 'divider': divider(),
}


def layout():
    """Shelf-pack the pieces onto one sheet (2 px apart). Returns {name: [x, y, w, h]}, sheet size."""
    order = sorted(PIECES, key=lambda n: -PIECES[n].h)
    W, x, y, row_h, out = 128, 0, 0, 0, {}
    for n in order:
        g = PIECES[n]
        if x + g.w > W:
            x, y, row_h = 0, y + row_h + 2, 0
        out[n] = [x, y, g.w, g.h]
        x += g.w + 2
        row_h = max(row_h, g.h)
    return out, W, y + row_h


CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!$%&*+-/:;<=>?@^_~'


def lua(g):
    pal, rows = {}, []
    for y in range(g.h):
        r = ''
        for x in range(g.w):
            c = g.p[y][x]
            if not c:
                r += '.'
                continue
            if c not in pal:
                pal[c] = CHARS[len(pal)]
            r += pal[c]
        rows.append(r)
    pal_s = ', '.join(f'["{ch}"] = "{col.upper()}"' for col, ch in pal.items())
    return 'return {\n  palette = { ' + pal_s + ' },\n  rows = {\n    ' + ',\n    '.join(f'"{r}"' for r in rows) + '\n  }\n}\n'


def hx(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(os.path.join(out, 'grids'), exist_ok=True)
    lay, W, H = layout()
    sheet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for n, g in PIECES.items():
        open(os.path.join(out, 'grids', f'journal_{n}.lua'), 'w').write(lua(g))
        x0, y0, _, _ = lay[n]
        for y in range(g.h):
            for x in range(g.w):
                if g.p[y][x]:
                    sheet.putpixel((x0 + x, y0 + y), hx(g.p[y][x]) + (255,))
    json.dump({'sheet': [W, H], 'pieces': lay}, open(os.path.join(out, 'layout.json'), 'w'), indent=1)
    bg = Image.new('RGBA', (W, H), (200, 210, 200, 255))
    bg.alpha_composite(sheet)
    bg.resize((W * 5, H * 5), Image.NEAREST).save(os.path.join(out, 'preview.png'))
    if len(sys.argv) > 2:
        os.makedirs(sys.argv[2], exist_ok=True)
        for n, g in PIECES.items():
            im = Image.new('RGBA', (g.w, g.h), (0, 0, 0, 0))
            for y in range(g.h):
                for x in range(g.w):
                    if g.p[y][x]:
                        im.putpixel((x, y), hx(g.p[y][x]) + (255,))
            im.save(os.path.join(sys.argv[2], f'{n}.png'), optimize=True)
    print('sheet', W, 'x', H, '|', len(PIECES), 'pieces')
