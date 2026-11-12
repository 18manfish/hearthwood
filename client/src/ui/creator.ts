// Character creation (boy / girl + looks) and choosing a starting location.

import * as THREE from 'three';
import {
  BIOMES, BIOME_IDS, CLOTH_COLORS, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, NAME_RE, SKIN_TONES, guessGeoFromTimeZone, computeEnvironment,
  type BiomeId, type Gender, type Look, type Season,
} from '@hearthwood/shared';
import { makePlayer, animateRig, type Rig } from '../game/characters.ts';
import { h, clear } from './dom.ts';
import { renderWorldMap, BIOME_ICON } from './map.ts';
import { IslandPreviewer } from './islandPreview.ts';

export interface CreatorResult {
  name: string;
  islandName: string;
  gender: Gender;
  look: Look;
  biome: BiomeId;
  geo: { lat: number; lon: number; tz: string };
}

/** A rotating 3D preview of the character. */
export class Preview {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private rig: Rig | null = null;
  private stopped = false;
  constructor(readonly el: HTMLElement) {
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#88aa66', 1.6));
    const d = new THREE.DirectionalLight('#fff4dc', 1.8);
    d.position.set(2, 4, 3);
    this.scene.add(d);
    this.camera.position.set(0, 1.0, 4.2);
    this.camera.lookAt(0, 0.7, 0);
    const clock = new THREE.Clock();
    const loop = () => {
      if (this.stopped) return;
      const w = el.clientWidth, hh = el.clientHeight;
      if (w && hh) {
        this.renderer.setSize(w, hh, false);
        this.camera.aspect = w / hh;
        this.camera.updateProjectionMatrix();
      }
      const dt = clock.getDelta();
      if (this.rig) {
        this.rig.root.rotation.y += dt * 0.6;
        animateRig(this.rig, dt, 0, 0);
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }
  set(gender: Gender, look: Look, hat: string | null = null) {
    const rot = this.rig?.root.rotation.y ?? 0.4;
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = makePlayer(gender, look, hat);
    this.rig.root.rotation.y = rot;
    this.rig.root.scale.setScalar(1.5);
    this.scene.add(this.rig.root);
  }
  dispose() {
    this.stopped = true;
    this.renderer.dispose();
  }
}

function swatches(colors: string[], current: () => string, pick: (c: string) => void) {
  const wrap = h('div', { class: 'swatches' });
  const draw = () => {
    clear(wrap);
    for (const c of colors) wrap.appendChild(h('button', { class: `swatch${current() === c ? ' sel' : ''}`, style: `background:${c}`, title: c, onclick: () => { pick(c); draw(); } }));
  };
  draw();
  return wrap;
}

/** The look editor, shared by character creation and the clothing shop makeover. */
export function lookEditor(gender: () => Gender, look: Look, onChange: () => void) {
  const root = h('div', { class: 'col' });
  const hairRow = h('div', { class: 'toggle' });
  const drawHair = () => {
    clear(hairRow);
    const styles = HAIR_STYLES[gender()] as readonly string[];
    if (!styles.includes(look.hair)) look.hair = styles[0];
    for (const s of styles) hairRow.appendChild(h('button', { class: look.hair === s ? 'sel' : '', onclick: () => { look.hair = s; drawHair(); onChange(); } }, s));
  };
  drawHair();
  const field = (label: string, el: HTMLElement) => h('div', { class: 'field' }, label, el);
  root.append(
    field('Skin', swatches(SKIN_TONES, () => look.skin, (c) => { look.skin = c; onChange(); })),
    field('Hairstyle', hairRow),
    field('Hair colour', swatches(HAIR_COLORS, () => look.hairColor, (c) => { look.hairColor = c; onChange(); })),
    field('Eyes', swatches(EYE_COLORS, () => look.eyes, (c) => { look.eyes = c; onChange(); })),
    field('Shirt', swatches(CLOTH_COLORS, () => look.shirt, (c) => { look.shirt = c; onChange(); })),
    field(gender() === 'girl' ? 'Skirt' : 'Shorts', swatches(CLOTH_COLORS, () => look.pants, (c) => { look.pants = c; onChange(); })),
    field('Shoes', swatches(CLOTH_COLORS, () => look.shoes, (c) => { look.shoes = c; onChange(); })),
  );
  return { root, refreshHair: drawHair };
}

export function showCreator(app: HTMLElement, onDone: (r: CreatorResult) => void) {
  clear(app);
  const screen = h('div', { class: 'screen' });
  app.appendChild(screen);
  let gender: Gender = Math.random() < 0.5 ? 'boy' : 'girl';
  const look: Look = {
    skin: SKIN_TONES[1], hair: HAIR_STYLES[gender][0], hairColor: HAIR_COLORS[1], eyes: EYE_COLORS[0],
    shirt: CLOTH_COLORS[5], pants: CLOTH_COLORS[8], shoes: CLOTH_COLORS[10],
  };
  let name = '';
  let islandName = '';
  let biome: BiomeId | null = null;
  let preview: Preview | null = null;

  const stepLook = () => {
    clear(screen);
    const prevEl = h('div', { class: 'preview' });
    const nameIn = h('input', { value: name, maxlength: 16, placeholder: 'Your name', oninput: (e: Event) => (name = (e.target as HTMLInputElement).value) });
    const isleIn = h('input', { value: islandName, maxlength: 20, placeholder: 'e.g. Willowbrook', oninput: (e: Event) => (islandName = (e.target as HTMLInputElement).value) });
    const err = h('div', { class: 'muted', style: 'color:#b84358' });
    const editor = lookEditor(() => gender, look, () => preview?.set(gender, look));
    const gToggle = h('div', { class: 'toggle' });
    const drawG = () => {
      clear(gToggle);
      for (const g of ['boy', 'girl'] as Gender[]) gToggle.appendChild(h('button', { class: gender === g ? 'sel' : '', onclick: () => { gender = g; drawG(); editor.refreshHair(); preview?.set(gender, look); } }, g === 'boy' ? '👦 Boy' : '👧 Girl'));
    };
    drawG();
    const card = h('div', { class: 'card creator' },
      prevEl,
      h('div', { class: 'col' },
        h('div', { class: 'title', style: 'font-size:30px' }, 'Create your villager'),
        h('div', { class: 'field' }, 'Name', nameIn),
        h('div', { class: 'field' }, 'I am a…', gToggle),
        editor.root,
        h('div', { class: 'field' }, 'Island name', isleIn),
        err,
        h('div', { class: 'row', style: 'justify-content:flex-end' },
          h('button', { class: 'btn', onclick: () => {
            if (!NAME_RE.test(name.trim())) return (err.textContent = 'Please enter a name (2–16 letters).');
            if (!NAME_RE.test(islandName.trim())) return (err.textContent = 'Please name your island (2–20 letters).');
            name = name.trim(); islandName = islandName.trim();
            preview?.dispose();
            stepMap();
          } }, 'Next: choose a location →')),
      ),
    );
    screen.appendChild(card);
    preview = new Preview(prevEl);
    preview.set(gender, look);
  };

  const stepMap = () => {
    clear(screen);
    const info = h('div', { class: 'card map-info' });
    const geoNote = h('div', { class: 'muted' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let geo = { ...guessGeoFromTimeZone(tz, -new Date().getTimezoneOffset()), tz };
    geoNote.textContent = `Sun & seasons follow your time zone (${tz}).`;
    const locBtn = h('button', { class: 'btn ghost small', onclick: () => {
      navigator.geolocation?.getCurrentPosition(
        (p) => { geo = { lat: p.coords.latitude, lon: p.coords.longitude, tz }; geoNote.textContent = '📍 Using your real location (rounded) for sunrise, sunset & seasons.'; },
        () => { geoNote.textContent = `Location not shared – using your time zone (${tz}).`; },
        { maximumAge: 3600_000, timeout: 8000 },
      );
    } }, '📍 Use my location');
    const mapHolder = h('div', { class: 'map-wrap', style: 'width:var(--pick-w)' });
    const previewer = new IslandPreviewer();
    // The season each location has right now, for the player's calendar & hemisphere.
    const seasonOf = (b: BiomeId): Season => computeEnvironment(Date.now(), b, geo, 'preview').season;
    const thumbs = h('div', { class: 'thumbs' });
    const thumbEls = new Map<BiomeId, HTMLElement>();
    for (const id of BIOME_IDS) {
      const img = h('div', { class: 'thumb-img' }, h('span', { class: 'muted' }, '…'));
      const card = h('button', { class: 'thumb', title: BIOMES[id].name, onclick: () => { biome = id; drawMap(); drawInfo(); } },
        img, h('div', { class: 'thumb-name' }, `${BIOME_ICON[id]} ${BIOMES[id].name}`));
      thumbEls.set(id, card);
      thumbs.appendChild(card);
    }
    // Render thumbnails one per frame so the page stays responsive.
    const queue = [...BIOME_IDS];
    const next = () => {
      const id = queue.shift();
      if (!id || !thumbs.isConnected) return;
      const img = thumbEls.get(id)!.querySelector('.thumb-img')!;
      clear(img);
      img.appendChild(h('img', { src: previewer.thumbnail(id, seasonOf(id)), alt: BIOMES[id].name }));
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
    const markThumbs = () => thumbEls.forEach((el, id) => el.classList.toggle('sel', id === biome));
    const drawInfo = () => {
      clear(info);
      markThumbs();
      if (!biome) {
        info.append(h('h3', {}, 'Where will you settle?'), h('p', { class: 'muted' }, 'Pick a region on the map. Each has its own trees, fish, weather and seasons. The ⭐ locations are shared by every player.'));
        return;
      }
      const b = BIOMES[biome];
      const season = seasonOf(biome);
      const live = h('div', { class: 'preview-live' });
      previewer.show(live, biome, season);
      info.append(
        live,
        h('div', { class: 'muted', style: 'margin:4px 0 6px' }, `Example island · right now it’s ${season} there`),
        h('h3', {}, `${BIOME_ICON[biome]} ${b.name}`),
        h('p', {}, b.blurb),
        h('div', { class: 'muted' }, `Seasons: ${b.seasonModel === 'tropical' ? 'wet & dry' : b.seasonModel === 'arid' ? 'hot & cool' : b.seasonModel === 'boreal' ? 'long winters' : 'four seasons'}`),
        h('div', { class: 'col', style: 'margin-top:10px' },
          h('button', { class: 'btn', onclick: () => { previewer.dispose(); onDone({ name, islandName, gender, look, biome: biome!, geo }); } }, `Settle on ${islandName}!`),
          h('button', { class: 'btn ghost small', onclick: () => { previewer.dispose(); stepLook(); } }, '← Back'),
        ),
      );
    };
    const drawMap = () => {
      clear(mapHolder);
      mapHolder.appendChild(renderWorldMap({ mode: 'choose', selected: biome, onBiome: (id) => { biome = id; drawMap(); drawInfo(); } }));
      mapHolder.appendChild(info);
    };
    drawMap();
    drawInfo();
    screen.appendChild(h('div', { class: 'col', style: 'align-items:center;margin:auto;padding:16px 0' },
      h('div', { class: 'title', style: 'font-size:30px' }, 'Choose your starting location'),
      mapHolder,
      thumbs,
      h('div', { class: 'row' }, locBtn, geoNote),
    ));
  };

  stepLook();
}
