"""Z-buffered preview renderer + contact sheets for kit models (local only)."""
import math
import numpy as np
from scipy.spatial import ConvexHull
from PIL import Image, ImageDraw, ImageFont


def rgb(hx):
    return np.array([int(hx[j:j + 2], 16) / 255 for j in (1, 3, 5)])


def render(kit, size=260, yaw=-35, pitch=28, bg=(0.95, 0.96, 0.92), ground=True, fit=None):
    ya, pa = math.radians(yaw), math.radians(pitch)
    Ry = np.array([[math.cos(ya), 0, math.sin(ya)], [0, 1, 0], [-math.sin(ya), 0, math.cos(ya)]])
    Rx = np.array([[1, 0, 0], [0, math.cos(pa), -math.sin(pa)], [0, math.sin(pa), math.cos(pa)]])
    R = Rx @ Ry
    light = np.array([0.45, 0.85, 0.55]); light /= np.linalg.norm(light)
    allp = np.array([p for *_, pts in kit.parts for p in pts])
    Q = allp @ R.T
    lo, hi = Q.min(0), Q.max(0)
    span = max(hi[0] - lo[0], hi[1] - lo[1]) * 1.15 if fit is None else fit
    sc = size / span
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    W = H = size
    zb = np.full((H, W), np.inf)
    img = np.ones((H, W, 3)) * np.array(bg)
    parts = [(rgb(c), pts) for (_, _, c, pts) in kit.parts]
    if ground:
        gx = max(abs(allp[:, 0]).max(), abs(allp[:, 2]).max()) * 1.2
        y0 = allp[:, 1].min()
        parts = [(np.array([0.78, 0.85, 0.72]), [(x, y, z) for x in (-gx, gx) for y in (y0 - 0.002 * gx - 0.001, y0 - 0.0005) for z in (-gx, gx)])] + parts
    for col, pts in parts:
        P = np.array(pts)
        try:
            hull = ConvexHull(P, qhull_options='QJ')
        except Exception:
            continue
        Qp = P @ R.T
        for simplex, eq in zip(hull.simplices, hull.equations):
            shade = 0.5 + 0.5 * max(0.0, float(eq[:3] @ light))
            t = Qp[simplex]
            xs = W / 2 + (t[:, 0] - cx) * sc
            ys = H / 2 - (t[:, 1] - cy) * sc
            zs = -t[:, 2]
            x0, x1 = int(max(0, np.floor(xs.min()))), int(min(W - 1, np.ceil(xs.max())))
            y0_, y1 = int(max(0, np.floor(ys.min()))), int(min(H - 1, np.ceil(ys.max())))
            if x1 < x0 or y1 < y0_:
                continue
            gx_, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0_, y1 + 1) + 0.5)
            d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
            if abs(d) < 1e-12:
                continue
            l1 = ((ys[1] - ys[2]) * (gx_ - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d
            l2 = ((ys[2] - ys[0]) * (gx_ - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d
            l3 = 1 - l1 - l2
            m = (l1 >= -1e-4) & (l2 >= -1e-4) & (l3 >= -1e-4)
            z = l1 * zs[0] + l2 * zs[1] + l3 * zs[2]
            sub = zb[y0_:y1 + 1, x0:x1 + 1]
            upd = m & (z < sub)
            sub[upd] = z[upd]
            img[y0_:y1 + 1, x0:x1 + 1][upd] = np.clip(col * shade, 0, 1)
    return Image.fromarray((img * 255).astype(np.uint8))


def sheet(models, path, cols=6, size=240, **kw):
    names = list(models)
    rows = math.ceil(len(names) / cols)
    out = Image.new('RGB', (cols * size, rows * (size + 22)), (255, 255, 255))
    d = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    except Exception:
        font = ImageFont.load_default()
    for i, n in enumerate(names):
        im = render(models[n], size=size, **kw)
        x, y = (i % cols) * size, (i // cols) * (size + 22)
        out.paste(im, (x, y))
        d.text((x + 6, y + size + 3), n, fill=(60, 50, 40), font=font)
    out.save(path)
    return path
