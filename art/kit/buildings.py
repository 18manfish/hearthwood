"""Tiered models for the island's buildings (Town Hall, the five shops, villager houses).

Every building grows with the island: tier 1 is what a young island can put up
(timber, canvas, a hand-painted sign), tier 2 a proper town building (plaster,
brick, slate, shop windows), tier 3 the pride of a thriving town (dressed stone,
two storeys, towers, gold). Villager houses have two tiers.

Each shop shows what it is from the outside: a 3D emblem on its sign (globe and
plane, T-shirt on a hanger, fork and knife under a chef's hat, crossed axe and
shovel, an armchair) and things out front (suitcases and a map, mannequins and
a clothes rack, café tables, tool barrels and logs, furniture on display).

Same part kit as art/house_build.py (convex point clouds, materials by name).
Game coordinates: 1 = one tile, y up, +z = front (door side, south), origin at
the centre of the footprint. Models are written by build_glbs.py into
client/public/models/buildings.glb as `bld_<type>_<tier>`.

Villager houses use the materials `vwall`, `vroof` and `vroof_dark`, which the
game recolours per house.
"""
import importlib.util
import math
import os

_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('house_build', os.path.join(_here, '..', 'house_build.py'))
hb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hb)

PAL = hb.PALETTE
PAL.update({
    # Shared
    'wood_light': '#c9975e', 'wood_dark': '#5d4037', 'canvas': '#f4ead2', 'cream': '#fbf3e0', 'board': '#3b2f2a', 'chalk': '#f4f4ee',
    'metal': '#8c9399', 'steel': '#5f6b73', 'rope': '#c8a96e', 'red': '#d64541', 'blue': '#3d6fb6', 'green_paint': '#3f8f5a',
    'banner_red': '#b8323a', 'banner_blue': '#2f5aa0', 'water': '#5fb7d8', 'soil': '#6b4a2e', 'bark': '#6b4a2e',
    'clock_face': '#fffbea', 'bell': '#c9962e', 'pillar': '#e9e2d0',
    # Travel agent
    'travel': '#2a9d8f', 'travel_dark': '#1f7268', 'globe_sea': '#3d8fd6', 'globe_land': '#69b34c', 'plane': '#f2f2ee', 'plane_trim': '#e4572e',
    'suitcase_a': '#c0703c', 'suitcase_b': '#2f6fa3', 'suitcase_c': '#e2b33c', 'balloon_a': '#e4572e', 'balloon_b': '#f2c14e',
    # Clothing shop
    'cloth': '#c2185b', 'cloth_dark': '#8e1244', 'cloth_pale': '#fbe3ec', 'tee': '#f2a03d', 'dress_a': '#6ec1e4', 'dress_b': '#f6c945', 'dress_c': '#7a3b69', 'mannequin': '#efe6d6',
    # Restaurant
    'resto': '#e67e22', 'resto_dark': '#b85f12', 'resto_pale': '#fff2d6', 'tablecloth': '#f7f2ea', 'check': '#d64541', 'chef': '#ffffff', 'cutlery': '#cfd6db', 'herb': '#4f9e3a', 'oven': '#8a4b35',
    # Tool store
    'tool': '#7f8c8d', 'tool_dark': '#5b6667', 'tool_pale': '#e8e8e8', 'axe_head': '#9aa3a8', 'handle': '#b07a43', 'log': '#8a5a35', 'log_end': '#d9b48f', 'anvil': '#3f4448',
    # Furniture store
    'furn': '#8e5a3c', 'furn_dark': '#6a412a', 'furn_pale': '#efe1cf', 'sofa': '#5b8c7a', 'cushion': '#e9c46a', 'lampshade': '#f4e1b0',
    # Town hall
    'hall_wall': '#f1e4c8', 'hall_roof': '#3d6fb6', 'hall_roof_dark': '#2f5590', 'hall_stone': '#d9cfb8', 'copper': '#5fa596', 'copper_dark': '#468477',
    # Villager houses (recoloured in game)
    'vwall': '#f3d9b1', 'vroof': '#6aa84f', 'vroof_dark': '#558a3f', 'vtrim': '#7a5230',
})


class B(hb.Kit):
    """House kit plus a few shop-front helpers."""

    def awning(self, x0, x1, z, y, depth, colours, drop=0.12):
        # Striped sloping awning out from a front wall at z, top edge at height y.
        n = max(2, int(round((x1 - x0) / 0.22)))
        for i in range(n):
            xa, xb = x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n
            self.add(colours[i % len(colours)], [(x, yy, zz) for x in (xa, xb) for (yy, zz) in ((y, z), (y + 0.04, z), (y - drop * 2.2, z + depth), (y - drop * 2.2 + 0.04, z + depth))])
            # Scalloped valance.
            self.add(colours[i % len(colours)], [(x, yy, zz) for x in (xa + 0.01, xb - 0.01) for yy in (y - drop * 2.2 - drop, y - drop * 2.2 + 0.02) for zz in (z + depth - 0.01, z + depth + 0.01)])

    def sign_board(self, x, y, z, w, h, face, frame='wood_dark'):
        self.box(frame, x - w / 2 - 0.04, y - h / 2 - 0.04, z, x + w / 2 + 0.04, y + h / 2 + 0.04, z + 0.05)
        self.box(face, x - w / 2, y - h / 2, z + 0.04, x + w / 2, y + h / 2, z + 0.07)

    def hanging_sign(self, x, y, z, w, h, face, side=1):
        # Iron bracket sticking out of a front corner with a board hanging under it (board faces +z).
        self.box('iron', x - 0.02, y, z - 0.02, x + 0.02 + side * 0.0, y + 0.04, z + 0.5)
        for dz in (0.1, 0.4):
            self.box('iron', x - 0.008, y - 0.08, z + dz - 0.008, x + 0.008, y, z + dz + 0.008)
        self.box('wood_dark', x - 0.03, y - 0.08 - h, z + 0.05, x + 0.03, y - 0.08, z + 0.45)
        self.box(face, x - 0.035, y - 0.06 - h + 0.02, z + 0.07, x + 0.035, y - 0.1, z + 0.43)

    def door(self, x, z, w, h, colour, frame='wood_dark', y0=0.0, glass=True):
        self.box(frame, x - w / 2 - 0.06, y0, z - 0.02, x + w / 2 + 0.06, y0 + h + 0.07, z + 0.03)
        self.box(colour, x - w / 2, y0, z, x + w / 2, y0 + h, z + 0.05)
        if glass:
            self.box('glass', x - w / 2 + 0.07, y0 + h * 0.55, z + 0.04, x + w / 2 - 0.07, y0 + h - 0.08, z + 0.065)
        self.sphere('gold', x + w / 2 - 0.07, y0 + h * 0.45, z + 0.07, 0.022, seg=6, rings=3)

    def shop_window(self, x, y0, y1, z, w, frame, panes=2):
        self.box(frame, x - w / 2 - 0.05, y0 - 0.05, z - 0.01, x + w / 2 + 0.05, y1 + 0.05, z + 0.04)
        self.box('glass', x - w / 2, y0, z + 0.03, x + w / 2, y1, z + 0.055)
        for i in range(1, panes):
            xm = x - w / 2 + w * i / panes
            self.box(frame, xm - 0.015, y0, z + 0.04, xm + 0.015, y1, z + 0.07)
        self.box(frame, x - w / 2 - 0.08, y0 - 0.1, z - 0.01, x + w / 2 + 0.08, y0 - 0.04, z + 0.1)

    def bush(self, x, z, r=0.16, flowers=None):
        self.sphere('hedge', x, r, z, r, seg=8, rings=5)
        if flowers:
            for i in range(3):
                a = i * 2.1
                self.sphere(flowers, x + math.cos(a) * r * 0.6, r * 1.4, z + math.sin(a) * r * 0.6, 0.035, seg=6, rings=3)

    def lamp_post(self, x, z, h=0.95, top='iron'):
        self.cyl('iron', x, z, 0.0, h, 0.025, seg=6)
        self.box('iron', x - 0.06, 0.0, z - 0.06, x + 0.06, 0.06, z + 0.06)
        self.box(top, x - 0.07, h, z - 0.07, x + 0.07, h + 0.2, z + 0.07)
        self.box('glass', x - 0.05, h + 0.02, z - 0.05, x + 0.05, h + 0.18, z + 0.05)
        self.cone(top, x, z, h + 0.2, 0.1, 0.09, seg=6)

    def flag(self, x, z, y0, h, colour, w=0.35):
        self.cyl('iron', x, z, y0, y0 + h, 0.018, seg=6)
        self.sphere('gold', x, y0 + h + 0.03, z, 0.035, seg=6, rings=3)
        self.add(colour, [(x + 0.02, y0 + h - 0.02, z), (x + 0.02, y0 + h - 0.24, z), (x + w, y0 + h - 0.1, z), (x + 0.02, y0 + h - 0.02, z + 0.015), (x + 0.02, y0 + h - 0.24, z + 0.015), (x + w, y0 + h - 0.1, z + 0.015)])

    def gable_wall_front(self, mat, x0, x1, z0, z1, y0, h):
        # Triangular gable end filling (front face), ridge along z axis direction is x-centred.
        xm = (x0 + x1) / 2
        self.add(mat, [(x0, y0, z) for z in (z0, z1)] + [(x1, y0, z) for z in (z0, z1)] + [(xm, y0 + h, z) for z in (z0, z1)])


# ── Emblems (centred at c, facing +z, about `s` tall) ───────────────────────

def emblem_travel(k, c, s=0.5):
    x, y, z = c
    r = s * 0.42
    k.sphere('globe_sea', x, y, z, r, seg=12, rings=7)
    for (dx, dy, rr) in ((-0.3, 0.25, 0.42), (0.35, -0.1, 0.38), (0.0, -0.45, 0.3), (0.25, 0.45, 0.25)):
        k.sphere('globe_land', x + dx * r, y + dy * r, z + math.sqrt(max(0.0, 1 - dx * dx - dy * dy)) * r * 0.82, rr * r, seg=7, rings=4, sy=0.7)
    # Gold meridian ring and axis.
    for i in range(12):
        a0, a1 = i * math.pi / 6, (i + 1) * math.pi / 6
        k.brace('gold', x + math.cos(a0) * (r + 0.03), y + math.sin(a0) * (r + 0.03), x + math.cos(a1) * (r + 0.03), y + math.sin(a1) * (r + 0.03), z - 0.015, z + 0.015, w=0.025)
    k.box('gold', x - 0.012, y - r - 0.08, z - 0.012, x + 0.012, y + r + 0.08, z + 0.012)
    # Paper-white plane flying round it.
    px, py, pz = x + r * 0.95, y + r * 0.75, z + r * 0.55
    k.rbox('plane', (px, py, pz), (s * 0.5, s * 0.09, s * 0.09), rz=0.3)
    k.rbox('plane', (px - s * 0.02, py - s * 0.005, pz), (s * 0.1, s * 0.02, s * 0.5), rz=0.3)
    k.rbox('plane_trim', (px - s * 0.22, py - s * 0.03, pz), (s * 0.06, s * 0.16, s * 0.02), rz=0.3)
    k.rbox('plane_trim', (px + s * 0.25, py + s * 0.07, pz), (s * 0.03, s * 0.08, s * 0.08), rz=0.3)


def emblem_clothing(k, c, s=0.5, colour='tee'):
    x, y, z = c
    # Hanger hook and bar.
    k.cyl('metal', x, z, y + s * 0.3, y + s * 0.45, 0.012, seg=6)
    k.brace('metal', x - s * 0.36, y + s * 0.18, x, y + s * 0.32, z - 0.012, z + 0.012, w=0.025)
    k.brace('metal', x, y + s * 0.32, x + s * 0.36, y + s * 0.18, z - 0.012, z + 0.012, w=0.025)
    # T-shirt: body and two sleeves, collar.
    k.box(colour, x - s * 0.2, y - s * 0.32, z - 0.03, x + s * 0.2, y + s * 0.2, z + 0.03)
    for sg in (-1, 1):
        k.rbox(colour, (x + sg * s * 0.27, y + s * 0.1, z), (s * 0.2, s * 0.14, 0.06), rz=-sg * 0.6)
    k.box('cream', x - s * 0.07, y + s * 0.15, z + 0.02, x + s * 0.07, y + s * 0.2, z + 0.04)


def emblem_restaurant(k, c, s=0.5):
    x, y, z = c
    # Chef's hat over a crossed fork and knife.
    k.cyl('chef', x, z, y + s * 0.12, y + s * 0.28, s * 0.13, seg=10)
    for dx in (-0.12, 0.0, 0.12):
        k.sphere('chef', x + dx * s, y + s * 0.34, z, s * 0.12, seg=8, rings=4)
    k.rbox('cutlery', (x - s * 0.02, y - s * 0.12, z + 0.02), (s * 0.05, s * 0.45, 0.03), rz=0.6)
    k.rbox('cutlery', (x + s * 0.02, y - s * 0.12, z + 0.04), (s * 0.05, s * 0.45, 0.03), rz=-0.6)
    for i in (-1, 0, 1):
        k.rbox('cutlery', (x - s * 0.17 + i * s * 0.025, y + s * 0.03 + i * s * 0.02, z + 0.02), (s * 0.015, s * 0.12, 0.03), rz=0.6)


def emblem_tools(k, c, s=0.5):
    x, y, z = c
    # Crossed axe and shovel.
    k.rbox('handle', (x, y, z), (s * 0.06, s * 0.85, 0.05), rz=0.65)
    k.rbox('handle', (x, y, z + 0.03), (s * 0.06, s * 0.85, 0.05), rz=-0.65)
    k.rbox('axe_head', (x - s * 0.27, y + s * 0.3, z + 0.01), (s * 0.24, s * 0.16, 0.05), rz=0.65)
    k.rbox('axe_head', (x + s * 0.27, y + s * 0.31, z + 0.04), (s * 0.18, s * 0.24, 0.04), rz=-0.65)


def emblem_furniture(k, c, s=0.5, colour='sofa'):
    x, y, z = c
    # Armchair seen from the front.
    k.box(colour, x - s * 0.32, y - s * 0.2, z - 0.05, x + s * 0.32, y - s * 0.02, z + 0.06)
    k.box(colour, x - s * 0.28, y - s * 0.02, z - 0.06, x + s * 0.28, y + s * 0.35, z - 0.01)
    for sg in (-1, 1):
        k.box(colour, x + sg * s * 0.32 - s * 0.07, y - s * 0.2, z - 0.06, x + sg * s * 0.32 + s * 0.07, y + s * 0.12, z + 0.07)
        k.box('wood_dark', x + sg * s * 0.26 - 0.015, y - s * 0.36, z + 0.01, x + sg * s * 0.26 + 0.015, y - s * 0.2, z + 0.04)
    k.box('cushion', x - s * 0.2, y - s * 0.02, z - 0.01, x + s * 0.2, y + s * 0.03, z + 0.06)


EMBLEMS = {'travel_agent': emblem_travel, 'clothing_shop': emblem_clothing, 'restaurant': emblem_restaurant,
           'tool_store': emblem_tools, 'furniture_store': emblem_furniture}


# ── Props out front ─────────────────────────────────────────────────────────

def suitcases(k, x, z):
    k.box('suitcase_a', x - 0.2, 0.0, z - 0.1, x + 0.2, 0.26, z + 0.1)
    k.box('suitcase_b', x - 0.15, 0.26, z - 0.08, x + 0.17, 0.46, z + 0.08)
    k.box('suitcase_c', x - 0.1, 0.46, z - 0.06, x + 0.12, 0.6, z + 0.06)
    for (y, w) in ((0.26, 0.06), (0.46, 0.05), (0.6, 0.04)):
        k.box('wood_dark', x - w, y, z - 0.012, x + w, y + 0.04, z + 0.012)


def map_board(k, x, z):
    k.brace('wood_dark', x - 0.22, 0.0, x - 0.12, 0.8, z - 0.03, z + 0.03, w=0.04)
    k.brace('wood_dark', x + 0.22, 0.0, x + 0.12, 0.8, z - 0.03, z + 0.03, w=0.04)
    k.box('canvas', x - 0.25, 0.4, z + 0.02, x + 0.25, 0.82, z + 0.05)
    for (dx, dy, r, m) in ((-0.1, 0.65, 0.07, 'globe_land'), (0.08, 0.55, 0.09, 'globe_land'), (0.0, 0.48, 0.03, 'red')):
        k.box(m, x + dx - r, dy - r * 0.6, z + 0.045, x + dx + r, dy + r * 0.6, z + 0.06)


def balloon(k, x, z, y0=1.6):
    for i in range(8):
        a = i * math.pi / 4
        k.sphere('balloon_a' if i % 2 else 'balloon_b', x + math.cos(a) * 0.12, y0 + 0.38, z + math.sin(a) * 0.12, 0.26, seg=8, rings=5)
    k.sphere('balloon_b', x, y0 + 0.42, z, 0.36, seg=12, rings=7, sy=1.15)
    for sx, sz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        k.cyl('rope', x + sx * 0.08, z + sz * 0.08, y0 - 0.32, y0 + 0.08, 0.008, seg=4)
    k.box('wood_light', x - 0.12, y0 - 0.5, z - 0.12, x + 0.12, y0 - 0.3, z + 0.12)


def mannequin(k, x, z, colour, y0=0.0, s=1.0):
    k.cyl('wood_dark', x, z, y0, y0 + 0.05 * s, 0.1 * s, seg=8)
    k.cyl('wood_dark', x, z, y0 + 0.05 * s, y0 + 0.3 * s, 0.015 * s, seg=6)
    k.cone(colour, x, z, y0 + 0.28 * s, 0.32 * s, 0.17 * s, seg=10)
    k.cyl(colour, x, z, y0 + 0.5 * s, y0 + 0.7 * s, 0.08 * s, seg=10, r_top=0.1 * s)
    k.sphere('mannequin', x, y0 + 0.8 * s, z, 0.07 * s, seg=8, rings=4)


def clothes_rack(k, x, z, w=0.7):
    for sx in (-1, 1):
        k.cyl('metal', x + sx * w / 2, z, 0.0, 0.85, 0.015, seg=6)
    k.box('metal', x - w / 2, 0.83, z - 0.012, x + w / 2, 0.86, z + 0.012)
    for i, c in enumerate(('dress_a', 'tee', 'dress_b', 'cloth', 'dress_c')):
        xx = x - w / 2 + 0.1 + i * (w - 0.2) / 4
        k.box(c, xx - 0.05, 0.42, z - 0.1, xx + 0.05, 0.82, z + 0.1)


def cafe_table(k, x, z, parasol=None):
    k.cyl('iron', x, z, 0.0, 0.45, 0.02, seg=6)
    k.cyl('tablecloth', x, z, 0.45, 0.48, 0.2, seg=10)
    k.cyl('check', x, z, 0.4, 0.46, 0.21, seg=10, r_top=0.205)
    for a in (0.0, math.pi):
        cx, cz = x + math.cos(a) * 0.3, z + math.sin(a) * 0.12
        k.box('wood_light', cx - 0.08, 0.25, cz - 0.08, cx + 0.08, 0.29, cz + 0.08)
        for ox in (-0.06, 0.06):
            k.box('iron', cx + ox - 0.01, 0.0, cz - 0.01, cx + ox + 0.01, 0.25, cz + 0.01)
        k.box('wood_light', cx + (0.07 if a else -0.09), 0.29, cz - 0.08, cx + (0.09 if a else -0.07), 0.5, cz + 0.08)
    if parasol:
        k.cyl('wood_dark', x, z, 0.48, 1.25, 0.015, seg=6)
        k.cone(parasol, x, z, 1.05, 0.25, 0.42, seg=8)


def chalkboard(k, x, z):
    k.brace('wood_dark', x - 0.14, 0.0, x - 0.1, 0.62, z - 0.12, z - 0.08, w=0.035)
    k.brace('wood_dark', x + 0.14, 0.0, x + 0.1, 0.62, z - 0.12, z - 0.08, w=0.035)
    k.add('board', [(x - 0.16, 0.12, z), (x + 0.16, 0.12, z), (x - 0.12, 0.6, z - 0.1), (x + 0.12, 0.6, z - 0.1),
                    (x - 0.16, 0.12, z + 0.025), (x + 0.16, 0.12, z + 0.025), (x - 0.12, 0.6, z - 0.075), (x + 0.12, 0.6, z - 0.075)])
    for i in range(3):
        k.box('chalk', x - 0.08, 0.25 + i * 0.1, z - 0.02 - i * 0.022, x + 0.08 - (i % 2) * 0.04, 0.27 + i * 0.1, z + 0.03 - i * 0.022)


def tool_barrel(k, x, z):
    k.cyl('log', x, z, 0.0, 0.42, 0.17, seg=10, r_top=0.15)
    for y in (0.08, 0.32):
        k.cyl('iron', x, z, y, y + 0.03, 0.175, seg=10)
    k.rbox('handle', (x - 0.05, 0.55, z), (0.035, 0.45, 0.035), rz=0.25)
    k.rbox('axe_head', (x - 0.1, 0.75, z), (0.16, 0.1, 0.03), rz=0.25)
    k.rbox('handle', (x + 0.06, 0.6, z + 0.03), (0.035, 0.5, 0.035), rz=-0.2)
    k.rbox('axe_head', (x + 0.11, 0.88, z + 0.03), (0.1, 0.13, 0.025), rz=-0.2)
    k.rbox('handle', (x, 0.55, z - 0.06), (0.03, 0.45, 0.03), rx=0.2)


def log_pile(k, x, z, n=3):
    for row in range(2):
        for i in range(n - row):
            cx = x - (n - row - 1) * 0.11 + i * 0.22
            k.rbox('log', (cx, 0.1 + row * 0.18, z), (0.18, 0.18, 0.6), ry=0)
            k.box('log_end', cx - 0.08, 0.02 + row * 0.18, z + 0.3, cx + 0.08, 0.18 + row * 0.18, z + 0.31)


def anvil(k, x, z):
    k.box('log', x - 0.12, 0.0, z - 0.12, x + 0.12, 0.28, z + 0.12)
    k.box('anvil', x - 0.08, 0.28, z - 0.06, x + 0.08, 0.36, z + 0.06)
    k.add('anvil', [(x - 0.18, 0.36, z - 0.07), (x + 0.15, 0.36, z - 0.07), (x - 0.18, 0.36, z + 0.07), (x + 0.15, 0.36, z + 0.07),
                    (x - 0.2, 0.44, z - 0.07), (x + 0.24, 0.44, z), (x - 0.2, 0.44, z + 0.07)])


def display_chair(k, x, z, colour='sofa', rot=0.0):
    c, s = math.cos(rot), math.sin(rot)
    def P(dx, dz):
        return (x + dx * c + dz * s, z - dx * s + dz * c)
    def B(m, dx0, y0, dz0, dx1, y1, dz1):
        cx, cz = P((dx0 + dx1) / 2, (dz0 + dz1) / 2)
        k.rbox(m, (cx, (y0 + y1) / 2, cz), (dx1 - dx0, y1 - y0, dz1 - dz0), ry=rot)
    B(colour, -0.2, 0.15, -0.18, 0.2, 0.28, 0.18)
    B(colour, -0.2, 0.28, -0.2, 0.2, 0.62, -0.12)
    for sx in (-1, 1):
        B(colour, sx * 0.2 - 0.05, 0.15, -0.18, sx * 0.2 + 0.05, 0.42, 0.18)
        for sz in (-1, 1):
            B('wood_dark', sx * 0.16 - 0.02, 0.0, sz * 0.14 - 0.02, sx * 0.16 + 0.02, 0.15, sz * 0.14 + 0.02)
    B('cushion', -0.14, 0.28, -0.1, 0.14, 0.33, 0.14)


def floor_lamp(k, x, z):
    k.cyl('wood_dark', x, z, 0.0, 0.04, 0.1, seg=8)
    k.cyl('gold', x, z, 0.04, 0.9, 0.015, seg=6)
    k.cyl('lampshade', x, z, 0.85, 1.05, 0.15, seg=10, r_top=0.09)


def small_table(k, x, z):
    k.cyl('wood_light', x, z, 0.42, 0.46, 0.2, seg=10)
    for a in range(3):
        aa = a * 2.09
        k.box('wood_dark', x + math.cos(aa) * 0.13 - 0.02, 0.0, z + math.sin(aa) * 0.13 - 0.02, x + math.cos(aa) * 0.13 + 0.02, 0.42, z + math.sin(aa) * 0.13 + 0.02)
    k.cyl('pot', x, z, 0.46, 0.56, 0.05, seg=8)
    k.sphere('flower', x, 0.6, z, 0.05, seg=6, rings=3)


# ── Shops ───────────────────────────────────────────────────────────────────
# Each shop has its colours (main / dark / pale) from BUILDINGS in the game data.
SHOP = {
    'travel_agent': ('travel', 'travel_dark', 'cream'),
    'clothing_shop': ('cloth', 'cloth_dark', 'cloth_pale'),
    'restaurant': ('resto', 'resto_dark', 'resto_pale'),
    'tool_store': ('tool', 'tool_dark', 'tool_pale'),
    'furniture_store': ('furn', 'furn_dark', 'furn_pale'),
}


def props(k, shop, tier):
    """Things out front that say what the shop sells (left and right of the door)."""
    L, R = -1.05, 1.08
    if shop == 'travel_agent':
        suitcases(k, L, 1.2)
        map_board(k, R, 1.2)
        if tier == 3:
            balloon(k, 1.0, -0.95, y0=3.3)
    elif shop == 'clothing_shop':
        if tier == 1:
            clothes_rack(k, L - 0.05, 1.18, w=0.55)
            mannequin(k, R, 1.2, 'dress_a')
        else:
            clothes_rack(k, L - 0.05, 1.25, w=0.55)
            mannequin(k, R + 0.05, 1.25, 'dress_b')
    elif shop == 'restaurant':
        cafe_table(k, L, 1.12, parasol='check' if tier > 1 else None)
        chalkboard(k, R, 1.3)
        if tier > 1:
            cafe_table(k, R - 0.05, 1.05 if tier == 2 else 0.98, parasol='resto')
    elif shop == 'tool_store':
        tool_barrel(k, L + 0.1, 1.2)
        log_pile(k, R - 0.05, 1.08, n=2 if tier == 1 else 3)
        if tier > 1:
            anvil(k, L - 0.25, 1.15)
    elif shop == 'furniture_store':
        display_chair(k, L, 1.15, 'sofa', rot=0.4)
        if tier == 1:
            small_table(k, R, 1.2)
        else:
            small_table(k, R - 0.15, 1.2)
            floor_lamp(k, R + 0.25, 1.2)


def shop_tier1(shop):
    """A timber market booth: counter window, striped awning, painted sign with the emblem."""
    main, dark, pale = SHOP[shop]
    k = B()
    k.box('stone', -1.15, 0.0, -0.95, 1.15, 0.12, 0.85)
    k.box('wood_light', -1.05, 0.12, -0.85, 1.05, 1.35, 0.75)
    for x in (-1.05, 1.05):
        for z in (-0.85, 0.75):
            k.box('timber', x - 0.06, 0.12, z - 0.06, x + 0.06, 1.42, z + 0.06)
    for y in (0.5, 0.95):
        for s in (-1, 1):
            k.box('wood_dark', s * 1.05 - 0.02, y, -0.85, s * 1.05 + 0.02, y + 0.03, 0.75)
    # Shed roof sloping to the back.
    k.add('timber', [(x, y, z) for x in (-1.25, 1.25) for (y, z) in ((1.55, 0.98), (1.62, 0.98), (1.25, -1.1), (1.32, -1.1))])
    k.add(main, [(x, y, z) for x in (-1.22, 1.22) for (y, z) in ((1.62, 0.95), (1.66, 0.95), (1.32, -1.07), (1.36, -1.07))])
    # Counter window with awning and the door.
    k.box('wood_dark', -1.0, 0.62, 0.74, -0.25, 0.68, 0.98)
    k.box(pale, -0.95, 0.68, 0.74, -0.3, 1.2, 0.76)
    k.awning(-1.02, -0.22, 0.78, 1.3, 0.38, (main, 'canvas'))
    k.door(0.3, 0.75, 0.42, 1.0, dark, glass=False)
    k.window(0.82, 0.7, 1.05, 0.75, 0.24, frame='timber')
    # Sign board on the roof edge with the emblem in front of it.
    k.sign_board(0.0, 1.95, 0.62, 1.35, 0.56, pale)
    for x in (-0.5, 0.5):
        k.box('timber', x - 0.03, 1.5, 0.58, x + 0.03, 1.7, 0.62)
    EMBLEMS[shop](k, (0.0, 1.95, 0.78), 0.58)
    props(k, shop, 1)
    return k


def shop_tier2(shop):
    """A town shop: plaster on a stone base, gable roof, display windows, awning, sign over the door."""
    main, dark, pale = SHOP[shop]
    k = B()
    k.box('stone', -1.32, 0.0, -1.1, 1.32, 0.22, 0.88)
    k.box(pale, -1.22, 0.22, -1.0, 1.22, 1.75, 0.78)
    for x in (-1.22, 1.22):
        k.box('stone_dark', x - 0.08, 0.22, 0.7, x + 0.08, 1.75, 0.86)
    k.box(dark, -1.28, 1.72, -1.06, 1.28, 1.82, 0.84)
    # Roof in the shop colour, ridge along x, with a front gable over the door.
    rx0, rx1, rz0, rz1, ry, rh = -1.42, 1.42, -1.25, 1.0, 1.8, 1.0
    k.gable_x(main, rx0, rx1, rz0, rz1, ry, rh)
    k.shingles(dark, rx0, rx1, rz0, rz1, ry, rh, rows=3, t=0.03)
    k.box(dark, rx0 - 0.02, ry + rh - 0.05, (rz0 + rz1) / 2 - 0.06, rx1 + 0.02, ry + rh + 0.05, (rz0 + rz1) / 2 + 0.06)
    k.gable_wall_front(pale, -0.6, 0.6, 0.62, 0.86, 1.8, 0.65)
    k.gable_z(main, -0.72, 0.72, 0.5, 0.92, 1.8, 0.75)
    k.box('brick', 0.7, 2.2, -0.75, 1.0, 3.0, -0.45)
    # Door, display windows with awnings, emblem sign in the front gable.
    k.door(0.0, 0.78, 0.5, 1.15, dark)
    for x in (-0.78, 0.78):
        k.shop_window(x, 0.5, 1.3, 0.78, 0.68, 'wood_dark', panes=2)
        k.awning(x - 0.42, x + 0.42, 0.82, 1.62, 0.35, (main, 'canvas'))
    k.sign_board(0.0, 1.65, 0.84, 0.95, 0.24, 'cream', frame=dark)
    k.sign_board(0.0, 2.12, 0.86, 0.62, 0.5, 'cream', frame=dark)
    EMBLEMS[shop](k, (0.0, 2.12, 1.0), 0.56)
    # Things on display in the windows.
    if shop == 'clothing_shop':
        for x, c in ((-0.95, 'dress_a'), (-0.6, 'tee'), (0.62, 'dress_c'), (0.95, 'dress_b')):
            mannequin(k, x, 0.65, c, y0=0.42, s=0.95)
    elif shop == 'furniture_store':
        display_chair(k, -0.78, 0.55, 'sofa')
        floor_lamp(k, 0.95, 0.6)
    k.lamp_post(-1.35, 0.98, h=0.9)
    for s in (-1, 1):
        k.side_window(s * 1.22, 0.6, 1.3, -0.3, 0.4, s, frame='wood_dark')
    props(k, shop, 2)
    return k


def shop_tier3(shop):
    """The town's pride: two storeys of dressed stone, big glass shop front, a lit-up rooftop emblem."""
    main, dark, pale = SHOP[shop]
    k = B()
    k.box('terrace', -1.45, 0.0, -1.2, 1.45, 0.24, 0.98)
    k.box('ashlar', -1.32, 0.24, -1.1, 1.32, 1.6, 0.85)
    k.box('marble', -1.36, 1.55, -1.14, 1.36, 1.68, 0.92)
    k.box(pale, -1.28, 1.68, -1.06, 1.28, 2.85, 0.8)
    k.box('marble', -1.36, 2.82, -1.14, 1.36, 2.95, 0.92)
    for x in (-1.32, 1.32):
        for i in range(5):
            y = 0.26 + i * 0.27
            hx = 0.1 if i % 2 == 0 else 0.07
            k.box('quoin', x - hx, y, 0.85 - hx, x + hx, y + 0.24, 0.85 + hx)
    # Mansard roof in the shop colour, gold ridge.
    k.hip(main, -1.38, 1.38, -1.18, 0.96, 2.95, 0.9, inset=0.7)
    k.box('gold', -0.7, 3.82, -0.17, 0.7, 3.87, 0.0)
    for x in (-0.75, 0.75):
        k.box(pale, x - 0.22, 3.05, 0.35, x + 0.22, 3.42, 0.72)
        k.gable_z(main, x - 0.3, x + 0.3, 0.27, 0.8, 3.38, 0.28)
        k.window(x, 3.1, 3.36, 0.72, 0.24, frame='marble')
    # Rooftop emblem on a gold frame, flags.
    k.box('gold', -0.05, 3.85, -0.12, 0.05, 4.1, -0.04)
    k.box(dark, -0.62, 4.02, -0.16, 0.62, 4.06, -0.0)
    EMBLEMS[shop](k, (0.0, 4.58, -0.08), 1.0)
    k.flag(-1.2, 0.86, 2.95, 1.0, main)
    k.flag(1.2, 0.86, 2.95, 1.0, main)
    # Ground floor: arched glass shop front around double doors, canopy.
    k.box(dark, -1.25, 0.24, 0.84, 1.25, 0.34, 0.9)
    for x in (-0.82, 0.82):
        k.shop_window(x, 0.45, 1.38, 0.85, 0.75, 'gold', panes=3)
    k.door(-0.14, 0.85, 0.27, 1.2, dark, frame='marble', y0=0.24)
    k.door(0.14, 0.85, 0.27, 1.2, dark, frame='marble', y0=0.24)
    k.box(dark, -1.3, 1.44, 0.85, 1.3, 1.5, 1.25)
    k.box('gold', -1.3, 1.4, 1.22, 1.3, 1.44, 1.26)
    k.sign_board(0.0, 1.62, 0.92, 1.6, 0.2, 'cream', frame='gold')
    for x in (-1.2, 1.2):
        k.cyl('iron', x, 1.2, 0.24, 1.44, 0.025, seg=6)
    # Upper floor windows with balconettes.
    for x in (-0.85, 0.0, 0.85):
        k.window(x, 1.95, 2.6, 0.8, 0.36, frame='marble')
        k.box('iron', x - 0.27, 1.9, 0.82, x + 0.27, 2.08, 0.96)
        k.flowers(x - 0.22, x + 0.22, 2.06, 0.9, colours=('flower', 'flower_yellow'))
    for s in (-1, 1):
        for zc in (-0.55, 0.25):
            k.side_window(s * 1.32, 0.6, 1.3, zc, 0.36, s, frame='marble')
            k.side_window(s * 1.28, 1.95, 2.55, zc, 0.32, s, frame='marble')
    # Window displays.
    if shop == 'clothing_shop':
        for x, c in ((-1.05, 'dress_a'), (-0.6, 'dress_c'), (0.6, 'tee'), (1.05, 'dress_b')):
            mannequin(k, x, 0.7, c, y0=0.34, s=1.0)
    elif shop == 'furniture_store':
        display_chair(k, -0.82, 0.6, 'sofa')
        floor_lamp(k, 0.6, 0.65)
        display_chair(k, 1.0, 0.6, 'cushion')
    elif shop == 'restaurant':
        k.box('oven', -1.2, 2.85, -0.8, -0.85, 3.7, -0.45)
    k.lamp_post(-1.42, 1.38, h=0.95, top='gold')
    k.lamp_post(1.42, 1.38, h=0.95, top='gold')
    props(k, shop, 3)
    return k


# ── Town hall (4 × 3) ───────────────────────────────────────────────────────

def clock(k, x, y, z, r):
    k.add('clock_face', [(x + math.cos(a) * r, y + math.sin(a) * r, zz) for a in [i * math.pi / 8 for i in range(16)] for zz in (z, z + 0.04)])
    k.add('gold', [(x + math.cos(a) * (r + 0.04), y + math.sin(a) * (r + 0.04), zz) for a in [i * math.pi / 8 for i in range(16)] for zz in (z - 0.01, z + 0.02)])
    k.rbox('board', (x, y + r * 0.3, z + 0.05), (0.03, r * 0.6, 0.015))
    k.rbox('board', (x + r * 0.2, y, z + 0.055), (r * 0.45, 0.03, 0.015))


def town_hall_1():
    """Village Hall: a long timber hall with a bell turret, a notice board and one flag."""
    k = B()
    k.box('stone', -1.85, 0.0, -1.15, 1.85, 0.2, 0.95)
    k.box('wood_light', -1.75, 0.2, -1.05, 1.75, 1.45, 0.85)
    for x in (-1.75, -0.6, 0.6, 1.75):
        k.box('timber', x - 0.06, 0.2, 0.8, x + 0.06, 1.5, 0.9)
    k.box('timber', -1.8, 1.42, -1.1, 1.8, 1.52, 0.92)
    rx0, rx1, rz0, rz1, ry, rh = -1.95, 1.95, -1.3, 1.1, 1.5, 0.95
    k.gable_x('hall_roof', rx0, rx1, rz0, rz1, ry, rh)
    k.shingles('hall_roof_dark', rx0, rx1, rz0, rz1, ry, rh, rows=3)
    # Bell turret.
    k.box('wood_light', -0.28, 2.1, -0.38, 0.28, 2.7, 0.18)
    for x in (-0.28, 0.28):
        for z in (-0.38, 0.18):
            k.box('timber', x - 0.04, 2.1, z - 0.04, x + 0.04, 2.95, z + 0.04)
    k.box('wood_light', -0.28, 2.7, -0.38, 0.28, 2.72, 0.18)
    k.sphere('bell', 0.0, 2.83, -0.1, 0.11, seg=8, rings=4, sy=1.1)
    k.hip('hall_roof', -0.42, 0.42, -0.52, 0.32, 2.95, 0.45, inset=0.42)
    # Door, porch, windows, notice board, flag.
    k.door(0.0, 0.85, 0.6, 1.1, 'door', glass=False)
    k.box('stone', -0.6, 0.0, 0.9, 0.6, 0.15, 1.25)
    k.gable_z('hall_roof', -0.6, 0.6, 0.8, 1.32, 1.3, 0.35)
    for x in (-1.2, 1.2):
        k.window(x, 0.65, 1.15, 0.85, 0.48, sill='timber')
    k.sign_board(0.0, 1.62, 0.92, 1.0, 0.2, 'cream', frame='timber')
    clock(k, 0.0, 2.43, 0.19, 0.13)
    # Notice board on posts with pinned notes.
    for x in (1.35, 1.85):
        k.box('timber', x - 0.03, 0.0, 1.25, x + 0.03, 0.95, 1.31)
    k.box('wood_dark', 1.3, 0.5, 1.28, 1.9, 0.95, 1.33)
    for i, c in enumerate(('cream', 'canvas', 'chalk', 'cream')):
        k.box(c, 1.36 + i * 0.13, 0.58 + (i % 2) * 0.12, 1.33, 1.46 + i * 0.13, 0.72 + (i % 2) * 0.12, 1.35)
    k.flag(-1.75, 1.3, 0.0, 2.1, 'banner_blue')
    k.bush(-1.15, 1.15, 0.15, flowers='flower')
    return k


def town_hall_2():
    """Town Hall: brick with stone dressings, a clock gable over the door, a proper bell tower, two flags."""
    k = B()
    k.box('stone', -1.95, 0.0, -1.25, 1.95, 0.25, 1.0)
    k.box('brick', -1.85, 0.25, -1.15, 1.85, 2.0, 0.9)
    for x in (-1.85, 1.85):
        for i in range(6):
            y = 0.27 + i * 0.29
            hx = 0.1 if i % 2 == 0 else 0.07
            k.box('hall_stone', x - hx, y, 0.9 - hx, x + hx, y + 0.26, 0.9 + hx)
    k.box('hall_stone', -1.9, 1.05, -1.2, 1.9, 1.13, 0.95)
    k.box('hall_stone', -1.92, 1.95, -1.22, 1.92, 2.07, 0.97)
    rx0, rx1, rz0, rz1, ry, rh = -2.0, 2.0, -1.4, 1.12, 2.05, 1.0
    k.gable_x('slate', rx0, rx1, rz0, rz1, ry, rh)
    k.shingles('slate_dark', rx0, rx1, rz0, rz1, ry, rh, rows=3, t=0.03)
    # Central clock gable.
    k.box('hall_stone', -0.7, 0.25, 0.85, 0.7, 2.6, 1.12)
    k.gable_wall_front('hall_stone', -0.7, 0.7, 0.85, 1.12, 2.6, 0.7)
    k.gable_z('slate', -0.85, 0.85, 0.75, 1.25, 2.6, 0.8)
    clock(k, 0.0, 2.55, 1.12, 0.22)
    # Bell tower at the back.
    k.box('hall_stone', -0.45, 2.4, -0.75, 0.45, 3.5, 0.0)
    for x in (-0.45, 0.45):
        for z in (-0.75, 0.0):
            k.box('hall_stone', x - 0.06, 3.5, z - 0.06, x + 0.06, 4.05, z + 0.06)
    k.box('hall_stone', -0.5, 3.48, -0.8, 0.5, 3.55, 0.05)
    k.sphere('bell', 0.0, 3.82, -0.38, 0.17, seg=10, rings=5, sy=1.1)
    k.hip('slate', -0.58, 0.58, -0.93, 0.18, 4.05, 0.85, inset=0.57)
    k.cyl('gold', 0.0, -0.38, 4.85, 5.15, 0.015, seg=6)
    k.sphere('gold', 0.0, 4.92, -0.38, 0.05, seg=6, rings=3)
    # Doors, steps, windows.
    k.box('hall_stone', -0.75, 0.0, 1.1, 0.75, 0.12, 1.42)
    k.box('hall_stone', -0.6, 0.12, 1.1, 0.6, 0.24, 1.28)
    k.door(-0.17, 1.12, 0.3, 1.25, 'door_green', frame='hall_stone', y0=0.24)
    k.door(0.17, 1.12, 0.3, 1.25, 'door_green', frame='hall_stone', y0=0.24)
    k.window(0.0, 1.72, 2.0, 1.12, 0.5, frame='hall_stone', bars=False)
    for x in (-1.3, 1.3):
        k.window(x, 0.5, 0.95, 0.9, 0.5, frame='hall_stone')
        k.window(x, 1.35, 1.8, 0.9, 0.5, frame='hall_stone')
        k.flowers(x - 0.28, x + 0.28, 0.42, 0.98, colours=('flower', 'flower_yellow'))
    for s in (-1, 1):
        k.side_window(s * 1.85, 0.5, 0.95, -0.2, 0.45, s, frame='hall_stone')
        k.side_window(s * 1.85, 1.35, 1.8, -0.2, 0.45, s, frame='hall_stone')
    k.flag(-1.85, 1.35, 0.0, 2.6, 'banner_blue')
    k.flag(1.55, 1.35, 0.0, 2.6, 'banner_red')
    for x in (-0.95, 0.95):
        k.lamp_post(x, 1.35, h=0.9)
    return k


def town_hall_3():
    """Grand Town Hall: a columned portico, a copper dome with a gilded clock lantern, banners and a fountain."""
    k = B()
    k.box('terrace', -2.0, 0.0, -1.35, 2.0, 0.3, 1.05)
    k.box('ashlar', -1.88, 0.3, -1.22, 1.88, 2.35, 0.7)
    k.box('marble', -1.92, 1.25, -1.26, 1.92, 1.35, 0.74)
    k.box('marble', -1.95, 2.3, -1.29, 1.95, 2.48, 0.77)
    k.box('gold', -1.95, 2.28, 0.76, 1.95, 2.31, 0.78)
    k.hip('slate', -1.95, 1.95, -1.3, 0.78, 2.48, 0.75, inset=0.9)
    # Wings' windows.
    for x in (-1.55, -1.1, 1.1, 1.55):
        k.window(x, 0.55, 1.1, 0.7, 0.28, frame='marble', glass='sea_glass')
        k.window(x, 1.55, 2.1, 0.7, 0.28, frame='marble', glass='sea_glass')
        k.box('gold', x - 0.04, 2.14, 0.71, x + 0.04, 2.21, 0.75)
    for s in (-1, 1):
        for zc in (-0.75, -0.1):
            k.side_window(s * 1.88, 0.55, 1.1, zc, 0.3, s, frame='marble', glass='sea_glass')
            k.side_window(s * 1.88, 1.55, 2.1, zc, 0.3, s, frame='marble', glass='sea_glass')
    # Portico: steps, six columns, pediment with gold trim.
    k.box('marble', -0.95, 0.0, 0.7, 0.95, 0.42, 1.2)
    for i, z in enumerate((1.2, 1.32, 1.44)):
        k.box('marble', -0.95 + i * 0.05, 0.0, 1.15, 0.95 - i * 0.05, 0.42 - (i + 1) * 0.12, z)
    for x in (-0.82, -0.49, -0.16, 0.16, 0.49, 0.82):
        k.cyl('marble', x, 1.05, 0.42, 1.95, 0.07, seg=10, r_top=0.06)
        k.box('marble', x - 0.09, 1.95, 0.96, x + 0.09, 2.02, 1.14)
    k.box('marble', -1.0, 2.02, 0.7, 1.0, 2.2, 1.18)
    k.gable_wall_front('marble', -1.0, 1.0, 0.95, 1.18, 2.2, 0.55)
    k.gable_z('slate', -1.08, 1.08, 0.65, 1.24, 2.2, 0.62)
    k.box('gold', -1.0, 2.17, 1.18, 1.0, 2.2, 1.2)
    k.sphere('gold', 0.0, 2.48, 1.2, 0.08, seg=8, rings=4)
    k.door(-0.16, 0.7, 0.3, 1.35, 'door_wine', frame='marble', y0=0.42)
    k.door(0.16, 0.7, 0.3, 1.35, 'door_wine', frame='marble', y0=0.42)
    # Drum, copper dome, clock lantern, flag.
    k.cyl('ashlar', 0.0, -0.3, 2.48, 3.3, 0.75, seg=20)
    k.cyl('marble', 0.0, -0.3, 3.25, 3.36, 0.8, seg=20)
    for i in range(10):
        a = i * 2 * math.pi / 10
        k.box('marble', math.cos(a) * 0.72 - 0.035, 2.5, -0.3 + math.sin(a) * 0.72 - 0.035, math.cos(a) * 0.72 + 0.035, 3.25, -0.3 + math.sin(a) * 0.72 + 0.035)
    clock(k, 0.0, 2.9, 0.47, 0.22)
    k.sphere('copper', 0.0, 3.36, -0.3, 0.78, seg=20, rings=10, sy=0.85)
    for (y, rr) in ((3.62, 0.74), (3.86, 0.6)):
        k.cyl('copper_dark', 0.0, -0.3, y, y + 0.04, rr, seg=20)
    k.cyl('marble', 0.0, -0.3, 4.0, 4.4, 0.18, seg=10)
    k.cone('gold', 0.0, -0.3, 4.4, 0.35, 0.22, seg=10)
    k.flag(0.0, -0.3, 4.75, 0.7, 'banner_blue', w=0.45)
    # Banners on the facade.
    for x in (-1.32, 1.32):
        k.box('gold', x - 0.18, 2.12, 0.72, x + 0.18, 2.16, 0.78)
        k.add('banner_red', [(x - 0.15, 2.12, 0.76), (x + 0.15, 2.12, 0.76), (x - 0.15, 1.5, 0.76), (x + 0.15, 1.5, 0.76), (x, 1.38, 0.76),
                             (x - 0.15, 2.12, 0.78), (x + 0.15, 2.12, 0.78), (x - 0.15, 1.5, 0.78), (x + 0.15, 1.5, 0.78), (x, 1.38, 0.78)])
        k.sphere('gold', x, 1.8, 0.79, 0.05, seg=6, rings=3)
    # Fountain and lanterns in front.
    k.cyl('marble', -1.45, 1.12, 0.0, 0.22, 0.32, seg=14)
    k.cyl('water', -1.45, 1.12, 0.2, 0.23, 0.27, seg=14)
    k.cyl('marble', -1.45, 1.12, 0.2, 0.6, 0.05, seg=8)
    k.cyl('marble', -1.45, 1.12, 0.58, 0.64, 0.14, seg=10)
    k.cone('water', -1.45, 1.12, 0.64, 0.12, 0.05, seg=8)
    for x in (-1.02, 1.02):
        k.lamp_post(x, 1.3, h=0.95, top='gold')
    k.bush(1.5, 1.2, 0.18, flowers='flower_yellow')
    k.bush(1.75, 0.85, 0.14, flowers='flower')
    return k


# ── Villager houses (2 × 2, two tiers) ──────────────────────────────────────

def villager_1():
    """Cosy cottage: plaster walls in the villager's colour, a coloured roof, flower pots."""
    k = B()
    k.box('stone', -0.88, 0.0, -0.78, 0.88, 0.12, 0.75)
    k.box('vwall', -0.8, 0.12, -0.7, 0.8, 1.05, 0.66)
    for x in (-0.8, 0.8):
        for z in (-0.7, 0.66):
            k.box('vtrim', x - 0.05, 0.12, z - 0.05, x + 0.05, 1.08, z + 0.05)
    rx0, rx1, rz0, rz1, ry, rh = -0.98, 0.98, -0.95, 0.92, 1.05, 0.75
    k.gable_x('vroof', rx0, rx1, rz0, rz1, ry, rh)
    k.shingles('vroof_dark', rx0, rx1, rz0, rz1, ry, rh, rows=2, t=0.03)
    k.box('vroof_dark', rx0, ry + rh - 0.04, -0.07, rx1, ry + rh + 0.04, 0.05)
    k.box('stone_dark', 0.35, 1.2, -0.45, 0.58, 2.05, -0.22)
    k.door(0.0, 0.66, 0.36, 0.78, 'door', glass=False, y0=0.12)
    k.box('stone', -0.3, 0.0, 0.7, 0.3, 0.1, 0.92)
    for x in (-0.5, 0.5):
        k.window(x, 0.45, 0.8, 0.66, 0.26, frame='vtrim', sill='vtrim')
    for s in (-1, 1):
        k.side_window(s * 0.8, 0.45, 0.8, 0.0, 0.3, s, frame='vtrim')
    for x in (-0.6, 0.6):
        k.cyl('pot', x, 0.86, 0.0, 0.14, 0.08, seg=8, r_top=0.1)
        k.sphere('leaf', x, 0.22, 0.86, 0.1, seg=7, rings=4)
        k.sphere('flower', x + 0.03, 0.29, 0.88, 0.035, seg=6, rings=3)
    return k


def villager_2():
    """Two-storey cottage: a stone ground floor, upper floor in the villager's colour, porch, dormer, garden."""
    k = B()
    k.box('stone', -0.94, 0.0, -0.85, 0.94, 0.15, 0.68)
    k.box('stone', -0.86, 0.15, -0.77, 0.86, 0.95, 0.6)
    k.box('vtrim', -0.9, 0.92, -0.81, 0.9, 1.0, 0.64)
    k.box('vwall', -0.86, 1.0, -0.77, 0.86, 1.75, 0.6)
    for x in (-0.86, 0.0, 0.86):
        k.box('vtrim', x - 0.04, 1.0, 0.58, x + 0.04, 1.75, 0.64)
    k.brace('vtrim', -0.86, 1.05, 0.0, 1.7, 0.58, 0.63, w=0.05)
    k.brace('vtrim', 0.86, 1.05, 0.0, 1.7, 0.58, 0.63, w=0.05)
    rx0, rx1, rz0, rz1, ry, rh = -1.0, 1.0, -1.0, 0.82, 1.75, 0.95
    k.gable_x('vroof', rx0, rx1, rz0, rz1, ry, rh)
    k.shingles('vroof_dark', rx0, rx1, rz0, rz1, ry, rh, rows=3, t=0.03)
    k.box('vroof_dark', rx0, ry + rh - 0.04, -0.15, rx1, ry + rh + 0.04, -0.03)
    k.box('vwall', -0.22, 1.85, 0.1, 0.22, 2.2, 0.5)
    k.gable_z('vroof', -0.3, 0.3, 0.05, 0.6, 2.15, 0.28)
    k.window(0.0, 1.9, 2.12, 0.5, 0.22, frame='vtrim', bars=False)
    k.box('brick', -0.65, 1.7, -0.6, -0.42, 2.85, -0.37)
    # Porch with posts and a little roof.
    k.box('deck', -0.55, 0.0, 0.6, 0.55, 0.15, 0.98)
    for x in (-0.5, 0.5):
        k.box('vtrim', x - 0.035, 0.15, 0.9, x + 0.035, 0.9, 0.96)
    k.add('vroof', [(x, y, z) for x in (-0.62, 0.62) for (y, z) in ((1.0, 0.58), (1.06, 0.58), (0.86, 1.04), (0.92, 1.04))])
    k.door(0.0, 0.6, 0.34, 0.75, 'door_green', y0=0.15)
    for x in (-0.6, 0.6):
        k.window(x, 0.4, 0.75, 0.6, 0.24, frame='vtrim')
        k.window(x * 0.85, 1.2, 1.55, 0.6, 0.24, frame='vtrim', bars=False)
        k.box('timber', x * 0.85 - 0.17, 1.08, 0.6, x * 0.85 + 0.17, 1.16, 0.7)
        k.flowers(x * 0.85 - 0.15, x * 0.85 + 0.15, 1.14, 0.65, colours=('flower', 'flower_yellow'))
    for s in (-1, 1):
        k.side_window(s * 0.86, 0.4, 0.75, -0.1, 0.28, s, frame='vtrim')
        k.side_window(s * 0.86, 1.2, 1.55, -0.1, 0.28, s, frame='vtrim')
    # Picket fence corners and a small garden bed.
    for x in (-0.95, -0.82, 0.82, 0.95):
        k.box('cream', x - 0.025, 0.0, 0.93, x + 0.025, 0.3, 0.97)
    k.box('cream', -0.98, 0.18, 0.94, -0.78, 0.22, 0.96)
    k.box('cream', 0.78, 0.18, 0.94, 0.98, 0.22, 0.96)
    k.box('soil', 0.62, 0.0, 0.66, 0.92, 0.06, 0.9)
    for i in range(3):
        k.sphere('leaf', 0.67 + i * 0.1, 0.12, 0.78, 0.06, seg=6, rings=3)
        k.sphere('flower_yellow' if i % 2 else 'flower', 0.67 + i * 0.1, 0.18, 0.79, 0.03, seg=6, rings=3)
    return k


# ── Catalogue ───────────────────────────────────────────────────────────────

FOOTPRINT = {'town_hall': (4, 3), 'villager_house': (2, 2)}
MODELS = {
    ('town_hall', 1): town_hall_1, ('town_hall', 2): town_hall_2, ('town_hall', 3): town_hall_3,
    ('villager_house', 1): villager_1, ('villager_house', 2): villager_2,
}
for _shop in SHOP:
    for _t, _f in ((1, shop_tier1), (2, shop_tier2), (3, shop_tier3)):
        MODELS[(_shop, _t)] = (lambda f, s: (lambda: f(s)))(_f, _shop)


def check(k, name, w, h):
    for mat, pts in k.parts:
        for (x, y, z) in pts:
            if abs(x) > w / 2 + 0.06 or abs(z) > h / 2 + 0.06 or y < -0.03:
                raise ValueError(f'{name}: {mat} point {(round(x, 3), round(y, 3), round(z, 3))} outside the {w}×{h} footprint')


class _Adapter:
    """Turns a house-kit model into the art kit's format for glb.py."""

    def __init__(self, k):
        self.pivots = {'main': (0.0, 0.0, 0.0)}
        self.parts = [('main', mat, PAL[mat], [(x, max(0.0, y), z) for (x, y, z) in pts]) for mat, pts in k.parts if len(pts) >= 4]


def build():
    out = {}
    for (typ, tier), make in MODELS.items():
        k = make()
        w, h = FOOTPRINT.get(typ, (3, 3))
        check(k, f'{typ}_{tier}', w, h)
        out[f'bld_{typ}_{tier}'] = _Adapter(k)
    return out
