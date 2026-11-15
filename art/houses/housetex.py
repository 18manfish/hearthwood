# Tileable textures for the houses, painted with numpy (no Blender needed).
# One texture covers 1 m × 1 m; arrays are [v, u] with v = 0 at the bottom.
# Every painter returns (rgb HxWx3 in 0..1, height HxW in 0..1); `normal_map`
# turns the height into a tangent-space normal map. Bright, soft, a little
# hand-made – after the cosy houses of Animal Crossing: New Horizons.
import numpy as np

N = 512


def _grid(n=N):
    v, u = np.mgrid[0:n, 0:n].astype(np.float32) / n
    return u, v


def _hash2(ix, iy, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF).astype(np.float32) / 65535.0


def tnoise(u, v, freq, seed=0):
    """Tileable value noise (freq cells per tile)."""
    x, y = u * freq, v * freq
    ix, iy = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    def h(a, b):
        return _hash2(a % freq, b % freq, seed)
    a, b, c, d = h(ix, iy), h(ix + 1, iy), h(ix, iy + 1), h(ix + 1, iy + 1)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(u, v, freq, seed=0, oct=3):
    s, a, t = 0.0, 1.0, 0.0
    for o in range(oct):
        s = s + a * tnoise(u, v, freq * 2 ** o, seed + o)
        t += a
        a *= 0.5
    return s / t


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def colorize(base, tone):
    """base colour (hex) × tone (HxW) → rgb."""
    return np.clip(hexrgb(base)[None, None, :] * tone[..., None], 0, 1)


def normal_map(h, strength=2.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength * N / 64
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength * N / 64
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


# ── Walls ────────────────────────────────────────────────────────────────

def siding(colour='#ffffff', rows=7, seed=1):
    """Horizontal clapboards: each board overlaps the one below (a soft shadow line)."""
    u, v = _grid()
    y = v * rows
    k = np.floor(y)
    f = y - k
    grain = fbm(u * 1.0, v, 24, seed, 2) * 0.5 + tnoise(u, v * 0.0 + (k / rows), 64, seed + 3) * 0.5
    plank = 0.94 + 0.06 * _hash2(k.astype(np.int64), k.astype(np.int64) * 0, seed + 7)
    tone = plank * (0.93 + 0.07 * grain)
    tone *= 0.72 + 0.28 * sstep(0.0, 0.12, f)  # shadow under the board above
    tone *= 1 - 0.06 * sstep(0.85, 1.0, f)
    height = f * 0.8 + 0.2 * sstep(0.0, 0.08, f)
    return colorize(colour, tone), height


def stucco(colour='#ffffff', seed=2):
    u, v = _grid()
    n = fbm(u, v, 8, seed, 4)
    speck = sstep(0.72, 0.8, tnoise(u, v, 96, seed + 5))
    tone = 0.94 + 0.08 * n - 0.04 * speck
    return colorize(colour, tone), 0.5 * n + 0.2 * speck


def brick(colour='#ffffff', mortar=0.86, rows=12, cols=4, seed=3):
    u, v = _grid()
    y = v * rows
    r = np.floor(y)
    x = u * cols + 0.5 * (r % 2)
    c = np.floor(x)
    fx, fy = x - c, y - r
    edge = np.minimum(np.minimum(fx, 1 - fx) * 3.0 / rows * cols, np.minimum(fy, 1 - fy))
    m = sstep(0.04, 0.09, edge)  # 0 in the mortar, 1 on the brick
    var = 0.86 + 0.16 * _hash2((c % cols).astype(np.int64), (r % rows).astype(np.int64), seed)
    n = fbm(u, v, 16, seed + 1, 2)
    tone = m * var * (0.92 + 0.1 * n) + (1 - m) * mortar
    rgb = colorize(colour, tone)
    rgb = rgb * m[..., None] + (1 - m[..., None]) * np.array([0.93, 0.9, 0.86]) * mortar
    return rgb, m * (0.8 + 0.2 * n)


def logs(colour='#ffffff', rows=5, seed=4):
    """Round logs stacked horizontally (cabin style)."""
    u, v = _grid()
    y = v * rows
    k = np.floor(y)
    f = y - k
    prof = np.sqrt(np.clip(1 - (2 * f - 1) ** 2, 0, 1))
    grain = fbm(u, v * 0.2 + k / rows, 18, seed, 3)
    tone = (0.62 + 0.38 * prof) * (0.9 + 0.12 * grain) * (0.95 + 0.06 * _hash2(k.astype(np.int64), k.astype(np.int64), seed + 2))
    return colorize(colour, tone), prof


def _worley2(u, v, cells, seed):
    """Tileable distance to the nearest and second nearest feature point."""
    x, y = u * cells, v * cells
    ix, iy = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    d1 = np.full(x.shape, 9.0, np.float32)
    d2 = np.full(x.shape, 9.0, np.float32)
    idv = np.zeros(x.shape, np.float32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cx, cy = ix + dx, iy + dy
            px = cx + 0.15 + 0.7 * _hash2(cx % cells, cy % cells, seed)
            py = cy + 0.15 + 0.7 * _hash2(cx % cells, cy % cells, seed + 1)
            d = np.hypot(x - px, y - py)
            closer = d < d1
            d2 = np.where(closer, d1, np.minimum(d2, d))
            idv = np.where(closer, _hash2(cx % cells, cy % cells, seed + 2), idv)
            d1 = np.where(closer, d, d1)
    return d1, d2, idv


def stone(colour='#ffffff', cells=5, seed=5, mortar=0.7):
    """Rounded field stones in mortar."""
    u, v = _grid()
    d1, d2, idv = _worley2(u, v * 1.0, cells, seed)
    e = d2 - d1
    m = sstep(0.06, 0.22, e)
    n = fbm(u, v, 20, seed + 3, 2)
    tone = m * (0.78 + 0.26 * idv) * (0.92 + 0.1 * n) + (1 - m) * mortar
    return colorize(colour, tone), m * (0.6 + 0.4 * sstep(0.0, 0.5, e))


# ── Roofs ────────────────────────────────────────────────────────────────

def roof_tiles(colour='#ffffff', rows=6, cols=7, seed=6):
    """Rows of rounded tiles; each row overlaps the one below with a scalloped edge."""
    u, v = _grid()
    y = v * rows
    r = np.floor(y)
    x = u * cols + 0.5 * (r % 2)
    fx = x - np.floor(x)
    fy = y - r
    # bottom edge of each tile is round: the visible part starts above a circle
    edge = 0.22 * (1 - np.sqrt(np.clip(1 - (2 * fx - 1) ** 2, 0, 1)))
    inside = sstep(edge, edge + 0.06, fy)
    var = 0.9 + 0.12 * _hash2((np.floor(x) % cols).astype(np.int64), (r % rows).astype(np.int64), seed)
    bulge = np.sqrt(np.clip(1 - (2 * fx - 1) ** 2, 0, 1))
    tone = var * (0.78 + 0.22 * bulge) * (0.7 + 0.3 * inside) * (1 - 0.12 * fy)
    tone *= 0.95 + 0.08 * fbm(u, v, 20, seed + 1, 2)
    height = inside * (0.5 + 0.5 * bulge) * (1 - 0.6 * fy)
    return colorize(colour, tone), height


def shingles(colour='#ffffff', rows=8, cols=6, seed=7):
    """Flat wooden shingles, staggered."""
    u, v = _grid()
    y = v * rows
    r = np.floor(y)
    x = u * cols + 0.37 * (r % 3)
    c = np.floor(x)
    fx, fy = x - c, y - r
    gap = sstep(0.0, 0.05, np.minimum(fx, 1 - fx))
    var = 0.86 + 0.16 * _hash2((c % cols).astype(np.int64), (r % rows).astype(np.int64), seed)
    grain = tnoise(u * 1.0, v, 40, seed + 1)
    tone = var * (0.9 + 0.1 * grain) * (0.75 + 0.25 * sstep(0.0, 0.15, fy)) * (0.8 + 0.2 * gap)
    return colorize(colour, tone), fy * 0.7 * gap


# ── Wood & trim ──────────────────────────────────────────────────────────

def planks(colour='#ffffff', cols=6, seed=8):
    """Vertical boards (doors, porches, decks)."""
    u, v = _grid()
    x = u * cols
    c = np.floor(x)
    fx = x - c
    gap = sstep(0.0, 0.06, np.minimum(fx, 1 - fx))
    grain = fbm(u * 0.3 + c, v, 30, seed, 2)
    var = 0.88 + 0.12 * _hash2((c % cols).astype(np.int64), c.astype(np.int64) * 0, seed + 1)
    tone = var * (0.88 + 0.14 * grain) * (0.7 + 0.3 * gap)
    return colorize(colour, tone), gap * (0.8 + 0.2 * grain)


def painted(colour='#ffffff', seed=9):
    """Smooth painted wood (trim, frames): faint brush grain."""
    u, v = _grid()
    n = tnoise(u * 1.0, v, 48, seed) * 0.6 + fbm(u, v, 6, seed + 1, 2) * 0.4
    return colorize(colour, 0.95 + 0.06 * n), 0.5 * n


def thatch(colour='#ffffff', seed=10):
    u, v = _grid()
    s = tnoise(u * 1.0, v, 80, seed) * 0.6 + fbm(u, v, 12, seed + 1, 3) * 0.4
    rows = 0.85 + 0.15 * sstep(0.0, 0.3, (v * 4) % 1)
    return colorize(colour, (0.8 + 0.25 * s) * rows), s


# name → (painter, kwargs). White ones are tinted in the game (villager houses).
TEXTURES = {
    'siding_white': (siding, {}),
    'stucco_white': (stucco, {}),
    'brick_white': (brick, {}),
    'logs_white': (logs, {}),
    'stone_white': (stone, {}),
    'tiles_white': (roof_tiles, {}),
    'shingles_white': (shingles, {}),
    'planks_white': (planks, {}),
    'paint_white': (painted, {}),
    'thatch_white': (thatch, {}),
}


def paint(name):
    fn, kw = TEXTURES[name]
    return fn(**kw)


if __name__ == '__main__':
    # Preview sheet (needs Pillow): python3 housetex.py out.png
    import sys
    from PIL import Image
    names = list(TEXTURES)
    sheet = Image.new('RGB', (256 * len(names), 512))
    for i, n in enumerate(names):
        rgb, h = paint(n)
        a = (np.clip(rgb[::-1], 0, 1) * 255).astype(np.uint8)
        b = (normal_map(h)[::-1] * 255).astype(np.uint8)
        sheet.paste(Image.fromarray(a).resize((256, 256)), (256 * i, 0))
        sheet.paste(Image.fromarray(b).resize((256, 256)), (256 * i, 256))
    sheet.save(sys.argv[1] if len(sys.argv) > 1 else 'housetex.png')
