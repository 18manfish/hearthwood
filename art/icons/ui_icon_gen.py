"""Pixel-art UI icons (64×64) for every emoji the game shows.

The shapes start from Noto Color Emoji (Apache 2.0, by Google) rendered large
and reduced to a 14-px pixel grid: hard alpha, at most 9 colours per icon and a
selective dark outline, so they sit with the fish and bird icons. The grids are
then painted into Aseprite (ui_icons.ase, 16 per row, in the order of
ui_icons.json) and exported per icon to client/public/icons/ui/<name>.png.

    python3 art/icons/ui_icon_gen.py art/icons/ui_emojis.json     (the emoji list)

writes ui_icons.json and client/src/ui/emojiIcons.ts (emoji → name), the per-icon PNGs, ui_icons.png (sheet),
ui_icons_preview.png (4× sheet), ui_grids/<name>.lua (with --grids: grids for the
Aseprite MCP's paint_grid) and ui_icons_paint.lua (paints the whole sheet in Aseprite).
"""
import json
import os
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont

N = 64
COLS = 16
#: colours per icon (before the outline shades)
COLOURS = 16
#: shades closer than this (RGB distance) become one
MERGE = 12
#: outline width in pixels
OUTLINE = 2
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'client', 'public', 'icons', 'ui')
FONT = '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'


def name_of(e):
    parts = []
    for c in e:
        if c in '‍️':
            continue
        n = unicodedata.name(c, f'u{ord(c):x}').lower()
        parts.append(''.join(ch if ch.isalnum() else '_' for ch in n).strip('_'))
    s = '_'.join(parts)
    while '__' in s:
        s = s.replace('__', '_')
    return s


def raster(e, font):
    txt = e if ord(e[0]) >= 0x1F000 or '\u200d' in e else e + '\ufe0f'
    im = Image.new('RGBA', (300, 140), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((0, 0), txt, font=font, embedded_color=True)
    im = im.crop(im.getbbox())
    w, h = im.size
    s = max(w, h)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - w) // 2, (s - h) // 2))
    m = N - 2 * OUTLINE
    small = sq.resize((m, m), Image.LANCZOS)
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    out.paste(small, (OUTLINE, OUTLINE))
    px = out.load()
    solid = [[px[x, y][3] > 110 for x in range(N)] for y in range(N)]
    # Colours: quantise the opaque pixels.
    rgb = Image.new('RGB', (N, N))
    rp = rgb.load()
    for y in range(N):
        for x in range(N):
            r, g, b, a = px[x, y]
            rp[x, y] = (r, g, b) if solid[y][x] else (0, 0, 0)
    q = rgb.quantize(colors=COLOURS, method=Image.MEDIANCUT).convert('RGB').load()
    grid = [[(q[x, y] if solid[y][x] else None) for x in range(N)] for y in range(N)]
    # Selective outline, OUTLINE pixels wide: a dark shade of the neighbouring colour.
    for _ in range(OUTLINE):
        base = [row[:] for row in grid]
        for y in range(N):
            for x in range(N):
                if base[y][x]:
                    continue
                nb = [base[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= x + dx < N and 0 <= y + dy < N and base[y + dy][x + dx]]
                if nb:
                    r, g, b = nb[0]
                    grid[y][x] = (int(r * 0.32 + 12), int(g * 0.3 + 10), int(b * 0.32 + 14)) if max(nb[0]) > 70 else nb[0]
    # One palette for the whole icon (fill and outline shades together).
    im = Image.new('RGB', (N, N))
    ip = im.load()
    for y in range(N):
        for x in range(N):
            ip[x, y] = grid[y][x] or (255, 0, 255)
    qq = im.quantize(colors=COLOURS + 2, method=Image.MEDIANCUT).convert('RGB').load()
    out = [[(qq[x, y] if grid[y][x] else None) for x in range(N)] for y in range(N)]
    # Merge shades too close to tell apart (most common one wins).
    count = {}
    for row in out:
        for c in row:
            if c:
                count[c] = count.get(c, 0) + 1
    reps, to = [], {}
    for c in sorted(count, key=lambda k: -count[k]):
        near = next((r for r in reps if sum((a - b) ** 2 for a, b in zip(c, r)) < MERGE ** 2), None)
        to[c] = near or c
        if not near:
            reps.append(c)
    return [[(to[c] if c else None) for c in row] for row in out]


def to_image(grid):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    p = im.load()
    for y in range(N):
        for x in range(N):
            if grid[y][x]:
                p[x, y] = (*grid[y][x], 255)
    return im


def runs(grid, ox=0, oy=0):
    """Horizontal runs of one colour: [x, y, length, '#rrggbb']."""
    out = []
    for y in range(N):
        x = 0
        while x < N:
            c = grid[y][x]
            if not c:
                x += 1
                continue
            x0 = x
            while x < N and grid[y][x] == c:
                x += 1
            out.append([ox + x0, oy + y, x - x0, '#%02x%02x%02x' % c])
    return out


def main():
    emojis = json.load(open(sys.argv[1], encoding='utf8'))
    font = ImageFont.truetype(FONT, 109)
    os.makedirs(OUT, exist_ok=True)
    index, cells, used = {}, [], set()
    for e in emojis:
        name = name_of(e)
        while name in used:
            name += '_2'
        used.add(name)
        g = raster(e, font)
        index[e] = name
        cells.append((name, g))
        to_image(g).save(os.path.join(OUT, f'{name}.png'))
    rows = (len(cells) + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * N, rows * N), (0, 0, 0, 0))
    grid_runs = []
    for i, (name, g) in enumerate(cells):
        ox, oy = (i % COLS) * N, (i // COLS) * N
        sheet.paste(to_image(g), (ox, oy))
        grid_runs.append({'name': name, 'x': ox, 'y': oy, 'runs': runs(g, ox, oy)})
    sheet.save(os.path.join(HERE, 'ui_icons.png'))
    json.dump(index, open(os.path.join(HERE, 'ui_icons.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    ts = os.path.join(HERE, '..', '..', 'client', 'src', 'ui', 'emojiIcons.ts')
    with open(ts, 'w', encoding='utf8') as fh:
        fh.write('// Generated by art/icons/ui_icon_gen.py – emoji → pixel icon (client/public/icons/ui/<name>.png).\n')
        fh.write('// Keys have no variation selector (U+FE0F).\n\n')
        fh.write('export const EMOJI_ICONS: Record<string, string> = {\n')
        for e, n in index.items():
            fh.write(f"  {json.dumps(e, ensure_ascii=False)}: '{n}',\n")
        fh.write('};\n')
    # Grids for Aseprite: one Lua grid per icon (palette + rows, for the MCP's paint_grid)
    # and one script that paints the whole sheet (Aseprite: File › Scripts › Open Scripts Folder).
    gdir = os.path.join(HERE, 'ui_grids')
    grids = '--grids' in sys.argv
    if grids:
        os.makedirs(gdir, exist_ok=True)
    chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    lua_cells = []
    for i, (name, g) in enumerate(cells):
        pal, rows = {}, []
        for y in range(N):
            r = ''
            for x in range(N):
                c = g[y][x]
                if not c:
                    r += '.'
                    continue
                hexc = '#%02X%02X%02X' % c
                if hexc not in pal:
                    pal[hexc] = chars[len(pal)]
                r += pal[hexc]
            rows.append(r)
        pal_s = ', '.join(f'["{ch}"] = "{col}"' for col, ch in pal.items())
        rows_s = ',\n    '.join(f'"{r}"' for r in rows)
        body = f'{{\n  name = "{name}", x = {(i % COLS) * N}, y = {(i // COLS) * N},\n  palette = {{ {pal_s} }},\n  rows = {{\n    {rows_s}\n  }}\n}}'
        if grids:
            with open(os.path.join(gdir, f'{name}.lua'), 'w') as fh:
                fh.write('return ' + body + '\n')
        lua_cells.append(body)
    with open(os.path.join(HERE, 'ui_icons_paint.lua'), 'w', encoding='utf8') as fh:
        fh.write('-- Paints every UI icon into one sheet (ui_icons.ase): run it in Aseprite.\n')
        fh.write('-- Generated by ui_icon_gen.py; order and names as in ui_icons.json.\n')
        fh.write(f'local W, H = {sheet.width}, {sheet.height}\n')
        fh.write('local ICONS = {\n' + ',\n'.join(lua_cells) + '\n}\n')
        fh.write('''local spr = Sprite(W, H, ColorMode.RGB)
spr.layers[1].name = "icons"
local img = spr.cels[1].image
app.transaction("Paint UI icons", function()
  for _, ic in ipairs(ICONS) do
    for y, row in ipairs(ic.rows) do
      for x = 1, #row do
        local ch = row:sub(x, x)
        if ch ~= "." then
          local hex = ic.palette[ch]
          local c = Color{ r = tonumber(hex:sub(2, 3), 16), g = tonumber(hex:sub(4, 5), 16), b = tonumber(hex:sub(6, 7), 16), a = 255 }
          img:drawPixel(ic.x + x - 1, ic.y + y - 1, c)
        end
      end
    end
  end
end)
spr:saveAs(app.fs.joinPath(app.fs.filePath(debug.getinfo(1, "S").source:sub(2)), "ui_icons.ase"))
''')
    print(len(cells), 'icons,', sum(len(c['runs']) for c in grid_runs), 'runs, sheet', sheet.size)


if __name__ == '__main__':
    main()
