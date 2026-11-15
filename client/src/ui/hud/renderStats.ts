// Rendering stats in the upper left corner, under the clock: frame rate and
// times with a little graph, draw calls and triangles, what's loaded on the
// GPU, the scene and the screen. Toggled in ⚙️ Options or with F4; the choice
// is remembered in this browser.

import { debug } from '../../game/world/common.ts';
import { h } from '../dom.ts';

const KEY = 'hearthwood.showRenderStats';
const GRAPH_W = 200, GRAPH_H = 36;

const text = h('div', { class: 'rs-text' });
const graph = h('canvas', { class: 'rs-graph', width: GRAPH_W, height: GRAPH_H }) as HTMLCanvasElement;
const el = h('div', { class: 'render-stats', style: 'display:none', title: 'Rendering stats (F4, or turn off in ⚙️ Options)' }, text, graph);
let timer = 0;
let fast = 0;

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : n.toLocaleString());
const ms = (n: number) => `${n.toFixed(1)} ms`;

function row(label: string, value: string, level?: string) {
  return h('div', { class: 'rs-row' }, h('span', {}, label), h('b', level ? { 'data-level': level } : {}, value));
}

/** Slow part: text (4× a second). */
function tick() {
  const r = debug.render;
  const info = debug.renderInfo?.();
  const fps = debug.fps;
  const lvl = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'bad';
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  text.replaceChildren(
    row('FPS', `${fps}`, lvl),
    row('Frame', `${ms(r.frameMs)} · max ${ms(r.frameMaxMs)}`, r.frameMaxMs > 50 ? 'bad' : r.frameMaxMs > 25 ? 'ok' : 'good'),
    row('CPU', ms(r.cpuMs)),
    row('Draw calls', k(r.calls)),
    row('Triangles', k(r.triangles)),
    ...(r.lines || r.points ? [row('Lines · points', `${k(r.lines)} · ${k(r.points)}`)] : []),
    ...(info ? [
      row('Geometries', k(info.geometries)),
      row('Textures', k(info.textures)),
      row('Shaders', k(info.programs)),
      row('Objects', k(info.objects)),
      row('Meshes', `${k(info.visibleMeshes)} shown / ${k(info.meshes)}`),
      row('Instances', k(info.instances)),
      row('Lights', `${info.lights} · shadows ${info.shadows ? 'on' : 'off'}`),
      row('Labels', k(info.labels)),
      row('Resolution', `${info.width}×${info.height} @${info.pixelRatio.toFixed(2)}`),
      row('Pixels', `${Math.round(info.width * info.pixelRatio)}×${Math.round(info.height * info.pixelRatio)}`),
    ] : []),
    ...(mem ? [row('JS heap', `${Math.round(mem.usedJSHeapSize / 1048576)} MB`)] : []),
    ...(info ? [h('div', { class: 'rs-gpu' }, info.gpu)] : []),
  );
  place();
}

/** Fast part: the frame-time graph (every frame while shown). */
function draw() {
  const g = graph.getContext('2d');
  if (g) {
    const hist = debug.render.history;
    g.clearRect(0, 0, GRAPH_W, GRAPH_H);
    // 16.7 ms (60 fps) and 33.3 ms (30 fps) guides; the graph tops out at 50 ms.
    const y = (v: number) => GRAPH_H - Math.min(1, v / 50) * GRAPH_H;
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, Math.round(y(16.7)), GRAPH_W, 1);
    g.fillRect(0, Math.round(y(33.3)), GRAPH_W, 1);
    const bw = GRAPH_W / 120;
    hist.forEach((v, i) => {
      g.fillStyle = v > 33.3 ? '#ff8a8a' : v > 18 ? '#ffd66b' : '#a8f08a';
      const top = y(v);
      g.fillRect(GRAPH_W - (hist.length - i) * bw, top, Math.max(1, bw - 0.3), GRAPH_H - top);
    });
  }
  fast = requestAnimationFrame(draw);
}

/** Sit just under the clock card in the upper left corner. */
function place() {
  const loc = el.parentElement?.querySelector<HTMLElement>('.loc');
  el.style.top = loc && loc.offsetParent ? `${loc.offsetTop + loc.offsetHeight + 8}px` : '14px';
}

export function renderStatsVisible(): boolean {
  return el.style.display !== 'none';
}

/** Show or hide the view (and remember the choice). */
export function setRenderStatsVisible(on: boolean, remember = true) {
  el.style.display = on ? '' : 'none';
  clearInterval(timer);
  cancelAnimationFrame(fast);
  if (on) {
    tick();
    timer = window.setInterval(tick, 250);
    fast = requestAnimationFrame(draw);
  }
  if (remember) {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch { /* private mode etc. */ }
  }
}

export function toggleRenderStats() {
  setRenderStatsVisible(!renderStatsVisible());
}

/** Add the view to the HUD, in the state the player last chose. */
export function mountRenderStats(root: HTMLElement) {
  root.append(el);
  setRenderStatsVisible(stored(), false);
}
