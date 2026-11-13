"""Preview: a little island of path shapes, assembled from the quarter pieces like the game does."""
import sys
import render
import paths
from kit import Kit

LAYOUT = [
    '..........',
    '.dddd..ss.',
    '.d..dgg.s.',
    '.d..ggg.s.',
    '.bbbb.wwww',
    '.b..b.w..w',
    '.bbbb.wwww',
]
KEYS = {'d': 'dirt', 'g': 'gravel', 's': 'stone', 'b': 'brick', 'w': 'wood'}

def assemble(layout):
    m = paths.build()
    out = Kit()
    rows = len(layout); cols = len(layout[0])
    at = lambda x, z: layout[z][x] if 0 <= z < rows and 0 <= x < cols else '.'
    # ground
    out.box('ground', '#7fb85a', (-0.5, -0.06, -0.5), (cols - 0.5, -0.01, rows - 0.5))
    for z in range(rows):
        for x in range(cols):
            t = at(x, z)
            if t == '.':
                continue
            # Turn the tile where the path runs east–west (planks across, brick rows along).
            turn = (at(x - 1, z) == t or at(x + 1, z) == t) and not (at(x, z - 1) == t or at(x, z + 1) == t)
            for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
                ox, oz = at(x + sx, z) != t, at(x, z + sz) != t
                if turn:
                    ox, oz = oz, ox
                piece, swap = ('full', False) if not ox and not oz else ('outer', False) if ox and oz else ('edge', oz)
                swap = swap != turn
                v = (x * 7 + z * 13 + sx * 3 + sz * 5) % 3
                src = m[f'path_{KEYS[t]}_{piece}_{v}']
                for (g, role, col, pts) in src.parts:
                    q = []
                    for (lx, ly, lz) in pts:
                        if swap:
                            lx, lz = lz, lx
                        q.append((x + sx * lx, ly, z + sz * lz))
                    out.add(role, col, q)
    return out

k = assemble(LAYOUT)
render.sheet({'paths': k}, sys.argv[1] if len(sys.argv) > 1 else '/tmp/paths_preview.png', cols=1, size=int(sys.argv[2]) if len(sys.argv) > 2 else 900, yaw=-20, pitch=55)
