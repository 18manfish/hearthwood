// The world map: biome regions (starting locations), shared hubs and islands.

import { BIOMES, BIOME_IDS, SHARED_LOCATIONS, hashString, type BiomeId, type MapIsland } from '@hearthwood/shared';
import { svg } from './dom.ts';
import { emojiIconUrl } from './emoji.ts';

/** An emoji's pixel icon in the SVG map, centred at (x, y); the emoji as text without one. */
function svgIcon(emoji: string, x: number, y: number, size: number) {
  const url = emojiIconUrl(emoji);
  if (!url) {
    const t = svg('text', { x, y: y + size * 0.35, 'text-anchor': 'middle', 'font-size': size });
    t.textContent = emoji;
    return t;
  }
  return svg('image', { href: url, x: x - size / 2, y: y - size / 2, width: size, height: size, style: 'image-rendering:pixelated' });
}

const ICON: Record<BiomeId, string> = {
  grassland: '🌾', tropical: '🏝️', nordic: '🌲', forest_edge: '🍄', oasis: '🌴', jungle: '🦜', desert: '🌵',
};
export const BIOME_ICON = ICON;

function blob(cx: number, cy: number, r: number, seed: number) {
  const pts: string[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.78 + ((hashString(`${seed}:${i}`) % 1000) / 1000) * 0.38;
    pts.push(`${(cx + Math.cos(a) * r * k).toFixed(1)},${(cy + Math.sin(a) * r * k * 0.82).toFixed(1)}`);
  }
  // Smooth closed curve via quadratic midpoints.
  const P = pts.map((p) => p.split(',').map(Number));
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    d += i === 0 ? `M${m[0]},${m[1]}` : '';
    const nb = P[(i + 1) % n], nn = P[(i + 2) % n];
    const m2 = [(nb[0] + nn[0]) / 2, (nb[1] + nn[1]) / 2];
    d += ` Q${nb[0]},${nb[1]} ${m2[0]},${m2[1]}`;
  }
  return d + ' Z';
}

export interface MapOptions {
  mode: 'choose' | 'travel';
  selected?: BiomeId | null;
  islands?: MapIsland[];
  onBiome?: (b: BiomeId) => void;
  onShared?: (id: string) => void;
  onIsland?: (i: MapIsland) => void;
}

export function renderWorldMap(o: MapOptions): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 1000 560', class: 'map-svg' }) as SVGSVGElement;
  const defs = svg('defs');
  const pat = svg('pattern', { id: 'waves', width: 40, height: 20, patternUnits: 'userSpaceOnUse' },
    svg('path', { d: 'M0 10 Q10 4 20 10 T40 10', fill: 'none', stroke: '#9fd8ee', 'stroke-width': 2, opacity: 0.6 }));
  defs.appendChild(pat);
  root.appendChild(defs);
  root.appendChild(svg('rect', { x: 0, y: 0, width: 1000, height: 560, fill: '#7cc7e6' }));
  root.appendChild(svg('rect', { x: 0, y: 0, width: 1000, height: 560, fill: 'url(#waves)' }));
  // A continent backdrop joining the regions.
  root.appendChild(svg('path', { d: blob(560, 270, 360, 7), fill: '#f3e7c0', opacity: 0.85 }));

  for (const id of BIOME_IDS) {
    const b = BIOMES[id];
    const g = svg('g', { class: `region${o.selected === id ? ' sel' : ''}` });
    g.appendChild(svg('path', { d: blob(b.map.x, b.map.y, b.map.r + 8, hashString(id) + 1), fill: '#fff8e1', opacity: 0.85 }));
    g.appendChild(svg('path', { d: blob(b.map.x, b.map.y, b.map.r, hashString(id)), fill: b.map.color, stroke: o.selected === id ? '#fff' : 'none', 'stroke-width': 5 }));
    g.appendChild(svgIcon(ICON[id], b.map.x, b.map.y - 8, 32));
    const label = svg('text', { x: b.map.x, y: b.map.y + b.map.r * 0.62, 'text-anchor': 'middle', 'font-size': 15, fill: '#3b2f25', stroke: '#fff8e1', 'stroke-width': 4, 'paint-order': 'stroke' });
    label.textContent = b.name;
    g.appendChild(label);
    if (o.onBiome) g.addEventListener('click', () => o.onBiome!(id));
    root.appendChild(g);
  }

  for (const isl of o.islands ?? []) {
    const g = svg('g', { class: 'marker' });
    const col = isl.mine ? '#f6c445' : isl.friend ? '#e8607a' : '#ffffff';
    g.appendChild(svg('circle', { cx: isl.x, cy: isl.y, r: isl.mine ? 9 : 7, fill: col, stroke: '#3b2f25', 'stroke-width': 2 }));
    if (isl.online) g.appendChild(svg('circle', { cx: isl.x + 6, cy: isl.y - 6, r: 3, fill: '#5fae4a', stroke: '#fff', 'stroke-width': 1 }));
    const t = svg('title');
    t.textContent = `${isl.name} (${isl.owner})${isl.mine ? ' – home' : ''}`;
    g.appendChild(t);
    if (o.onIsland) g.addEventListener('click', (e) => { e.stopPropagation(); o.onIsland!(isl); });
    root.appendChild(g);
  }

  for (const s of SHARED_LOCATIONS) {
    const g = svg('g', { class: 'marker' });
    g.appendChild(svg('circle', { cx: s.map.x, cy: s.map.y, r: 15, fill: '#3b2f25', opacity: 0.85 }));
    g.appendChild(svgIcon('⭐', s.map.x, s.map.y, 20));
    const lbl = svg('text', { x: s.map.x, y: s.map.y + 30, 'text-anchor': 'middle', 'font-size': 13, fill: '#fff', stroke: '#3b2f25', 'stroke-width': 4, 'paint-order': 'stroke' });
    lbl.textContent = s.name;
    g.appendChild(lbl);
    if (o.onShared) g.addEventListener('click', (e) => { e.stopPropagation(); o.onShared!(s.id); });
    if (o.mode === 'choose') g.setAttribute('opacity', '0.75');
    root.appendChild(g);
  }
  return root;
}
