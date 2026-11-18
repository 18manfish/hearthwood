// Admin tool: the island editor's map – every tile, path, building, object and
// whoever is on the island right now, drawn on a canvas.

import { BUILDINGS, DIRS, PATHS, Tile } from '@hearthwood/shared';
import { h } from '../ui/dom.ts';
import { drawEmoji } from '../ui/emoji.ts';
import type { Editor } from './islandEditor.ts';

export const TILE_NAMES: [number, string][] = [[Tile.Sea, 'Sea'], [Tile.Shore, 'Beach'], [Tile.Ground, 'Ground'], [Tile.Pond, 'Pond'], [Tile.River, 'River'], [Tile.Dock, 'Dock'], [Tile.Ramp, 'Ramp']];
export const OBJ_COLORS: Record<string, string> = { tree: '#2f7d32', stump: '#7a5230', rock: '#8d8f93', bush: '#4f8f3a', mushroom: '#d84315', flower: '#ec6fa0', furniture: '#a0703f', decor: '#a0703f' };

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
function tileColor(ed: Editor, i: number) {
  const { d, biome, ground } = ed;
  const t = d.tiles[i] as Tile;
  const L = d.levels[i];
  switch (t) {
    case Tile.Sea: return '#4fb7d8';
    case Tile.Shore: return biome?.shore ?? '#f3e2b3';
    case Tile.Pond: return shade('#3f9cc4', 0.9 + L * 0.12);
    case Tile.River: return shade('#2f8fd0', 0.9 + L * 0.12);
    case Tile.Dock: return '#b98a5a';
    case Tile.Ramp: return shade(ground, 0.85 + L * 0.12);
    case Tile.Floor: return '#c9b27a';
    case Tile.Wall: return '#6d5a45';
    default: return shade(ground, 0.82 + L * 0.14);
  }
}

/** Draw the island as the editor has it now. `redraw` is called again when an emoji picture arrives. */
export function drawMap(canvas: HTMLCanvasElement, ed: Editor, redraw: () => void) {
  const { size, cell, d, v, sel } = ed;
  const idx = (x: number, z: number) => z * size + x;
  canvas.width = size * cell;
  canvas.height = size * cell;
  const g = canvas.getContext('2d')!;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const i = idx(x, z);
      g.fillStyle = tileColor(ed, i);
      g.fillRect(x * cell, z * cell, cell, cell);
      const p = d.paths[i];
      if (p) {
        g.fillStyle = PATHS[p - 1]?.color ?? '#999';
        g.fillRect(x * cell + cell * 0.15, z * cell + cell * 0.15, cell * 0.7, cell * 0.7);
      }
      // Cliff edges: dark line where the level drops.
      const L = d.levels[i];
      g.fillStyle = 'rgba(60,40,20,0.55)';
      if (z + 1 < size && d.levels[idx(x, z + 1)] < L && d.tiles[idx(x, z + 1)] !== Tile.Ramp) g.fillRect(x * cell, (z + 1) * cell - 2, cell, 2);
      if (x + 1 < size && d.levels[idx(x + 1, z)] < L && d.tiles[idx(x + 1, z)] !== Tile.Ramp) g.fillRect((x + 1) * cell - 2, z * cell, 2, cell);
      if (z > 0 && d.levels[idx(x, z - 1)] < L && d.tiles[idx(x, z - 1)] !== Tile.Ramp) g.fillRect(x * cell, z * cell, cell, 2);
      if (x > 0 && d.levels[idx(x - 1, z)] < L && d.tiles[idx(x - 1, z)] !== Tile.Ramp) g.fillRect(x * cell, z * cell, 2, cell);
      // Ramp arrows (uphill).
      const r = d.ramps[i];
      if (r) {
        const [dx, dz] = DIRS[(r - 1) & 3];
        const cx = x * cell + cell / 2, cz = z * cell + cell / 2;
        g.strokeStyle = '#3b2f25';
        g.lineWidth = Math.max(1, cell / 8);
        g.beginPath();
        g.moveTo(cx - dx * cell * 0.3, cz - dz * cell * 0.3);
        g.lineTo(cx + dx * cell * 0.3, cz + dz * cell * 0.3);
        g.stroke();
      }
    }
  g.font = `${Math.max(9, cell)}px system-ui`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const b of d.buildings) {
    const def = BUILDINGS[b.type];
    const isSel = sel?.kind === 'building' && sel.b === b;
    g.fillStyle = def?.color ?? '#d9b48f';
    g.globalAlpha = b.completeAt > Date.now() ? 0.5 : 0.92;
    g.fillRect(b.x * cell + 1, b.z * cell + 1, b.w * cell - 2, b.h * cell - 2);
    g.globalAlpha = 1;
    g.strokeStyle = isSel ? '#ff3b30' : '#3b2f25';
    g.lineWidth = isSel ? 3 : 1;
    g.strokeRect(b.x * cell + 1, b.z * cell + 1, b.w * cell - 2, b.h * cell - 2);
    drawEmoji(g, def?.icon ?? '🏠', (b.x + b.w / 2) * cell, (b.z + b.h / 2) * cell, Math.max(12, cell * 1.1), redraw);
  }
  for (const o of d.objects) {
    const isSel = sel?.kind === 'object' && sel.o === o;
    const cx = (o.x + 0.5) * cell, cz = (o.z + 0.5) * cell;
    g.fillStyle = OBJ_COLORS[o.kind] ?? '#555';
    g.beginPath();
    g.arc(cx, cz, cell * (o.kind === 'tree' ? 0.42 : 0.3) * (o.kind === 'tree' && (o.stage ?? 2) < 2 ? 0.6 : 1), 0, Math.PI * 2);
    g.fill();
    if (isSel) {
      g.strokeStyle = '#ff3b30';
      g.lineWidth = 3;
      g.stroke();
    }
  }
  for (const b of v.birds) {
    g.fillStyle = '#ffd166';
    g.fillRect((b.x + 0.35) * cell, (b.z + 0.35) * cell, cell * 0.3, cell * 0.3);
  }
  for (const vl of v.villagers) {
    if (vl.home) continue;
    drawEmoji(g, '🐾', vl.x * cell, vl.z * cell, Math.max(12, cell * 1.1), redraw);
  }
  g.font = `bold ${Math.max(10, cell)}px system-ui`;
  for (const pl of v.players) {
    g.fillStyle = '#e8607a';
    g.beginPath();
    g.arc(pl.x * cell, pl.z * cell, Math.max(4, cell * 0.45), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.strokeStyle = '#3b2f25';
    g.lineWidth = 3;
    g.strokeText(pl.name, pl.x * cell, pl.z * cell - cell);
    g.fillText(pl.name, pl.x * cell, pl.z * cell - cell);
  }
  drawEmoji(g, '⚓', v.spawn.x * cell, v.spawn.z * cell, Math.max(12, cell * 1.1), redraw);
}

export function mapLegend(ed: Editor) {
  const { biome, ground } = ed;
  return h('div', { class: 'legend' },
    [['Sea', '#4fb7d8'], ['Beach', biome?.shore ?? '#f3e2b3'], ['Ground (lighter = higher)', ground], ['Pond', '#3f9cc4'], ['River', '#2f8fd0'], ['Dock', '#b98a5a'],
      ['Tree', OBJ_COLORS.tree], ['Rock', OBJ_COLORS.rock], ['Bush', OBJ_COLORS.bush], ['Flower', OBJ_COLORS.flower], ['Furniture', OBJ_COLORS.furniture], ['Bird', '#ffd166'], ['Player', '#e8607a']]
      .map(([n, c]) => h('span', { style: `--c:${c}` }, n)),
    h('span', { class: 'muted' }, 'Dark edges = cliffs, lines on ramps point uphill, 🐾 villager, ⚓ arrival'));
}
