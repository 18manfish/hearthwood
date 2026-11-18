// Admin tool: the boxes beside the island editor's map – the island's details, what
// is selected on the map, the villagers who live there, and the dangerous buttons.

import { BIOMES, BIOME_IDS, BUILDINGS, SPECIES_ICON, VILLAGERS, villagerDef } from '@hearthwood/shared';
import { h } from '../ui/dom.ts';
import type { Editor, IslandView } from './islandEditor.ts';
import { call, field, input, parseJson, select, textarea, toast } from './ui.ts';

export function detailsBox(ed: Editor) {
  const { rec } = ed;
  const name = input(rec.name, { maxlength: 20 });
  const access = select([['private', '🔒 Nobody'], ['friends', '💌 Friends'], ['invite', '🎟️ Friends + code'], ['public', '🌍 Everyone']], rec.access);
  const code = input(rec.inviteCode, { maxlength: 12 });
  const biomeSel = select(BIOME_IDS.map((b) => [b, BIOMES[b].name]), rec.biome);
  const seed = input(rec.seed, { type: 'number' });
  const founded = input(rec.foundedDayKey, { type: 'date' });
  const mx = input(rec.map.x, { type: 'number', min: 0, max: 1000 }), my = input(rec.map.y, { type: 'number', min: 0, max: 560 });
  return h('div', { class: 'box' }, h('h3', {}, '📋 Details'),
    h('div', { class: 'form' },
      field('Name', name), field('Visitors', access), field('Invite code', code), field('Biome', biomeSel, 'Changes colours, trees, fish & weather'),
      field('Seed', seed, 'The generated base terrain – use “Regenerate” to rebuild from it'), field('Founded', founded, 'Moves the island’s day count'),
      field('World map', h('div', { class: 'row' }, mx, my))),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn small', onclick: async () => {
      const patch: Record<string, unknown> = { name: name.value, access: access.value, biome: biomeSel.value, seed: Number(seed.value), foundedDayKey: founded.value, map: { x: Number(mx.value), y: Number(my.value) } };
      if (code.value.toUpperCase() !== rec.inviteCode) patch.inviteCode = code.value;
      const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, patch);
      if (r) { toast('Details saved'); ed.reopen(r.island); }
    } }, 'Save details')));
}

export function selectionBox(ed: Editor) {
  const { rec, d, dirty } = ed;
  const box = h('div', { class: 'box' }, h('h3', {}, '🔎 Selection'));
  if (!ed.sel) return box.append(h('p', { class: 'muted' }, 'Pick the 👆 Select tool and click a building or object on the map.')), box;
  if (ed.sel.kind === 'object') {
    const o = ed.sel.o;
    const json = textarea(o, 8);
    box.append(h('div', { class: 'muted' }, `${o.kind} at ${o.x},${o.z}`), json,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn small', onclick: () => {
          try {
            const next = parseJson(json, 'Object');
            Object.assign(o, next);
            dirty.add('objects');
            ed.draw();
            toast('Applied – remember to save the island');
          } catch (e) { toast((e as Error).message, false); }
        } }, 'Apply'),
        h('button', { class: 'btn warn small', onclick: () => { d.objects.splice(d.objects.indexOf(o), 1); ed.sel = null; dirty.add('objects'); ed.drawSide(); ed.draw(); } }, 'Delete')));
  } else {
    const b = ed.sel.b;
    const def = BUILDINGS[b.type];
    const x = input(b.x, { type: 'number' }), z = input(b.z, { type: 'number' });
    const done = h('input', { type: 'checkbox', checked: b.completeAt <= Date.now() }) as HTMLInputElement;
    const vill = select([['', '– none –'], ...VILLAGERS.map((vd) => [vd.id, `${vd.name} (${vd.species})`] as [string, string])], b.villagerId ?? '');
    box.append(h('div', {}, h('b', {}, `${def.icon} ${def.name}`), h('span', { class: 'muted' }, ` · ${b.id} · ${b.w}×${b.h}`)),
      h('div', { class: 'form', style: 'margin-top:8px' }, field('Position', h('div', { class: 'row' }, x, z)), field('Finished', done),
        b.type === 'villager_house' ? field('Villager', vill, 'Also add / remove them under Villagers') : null,
        b.type === 'villager_house' && b.villagerId && d.villagers.some((x) => x.defId === b.villagerId)
          ? field('', h('a', { class: 'btn ghost small', href: `#villager/${rec.id}/${b.villagerId}` }, `Open ${villagerDef(b.villagerId)?.name ?? b.villagerId}’s page ›`)) : null),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn small', onclick: () => {
          b.x = Number(x.value);
          b.z = Number(z.value);
          b.completeAt = done.checked ? Math.min(b.completeAt, 0) : Math.max(b.completeAt, Date.now() + 3600_000);
          if (b.type === 'villager_house') b.villagerId = vill.value || undefined;
          dirty.add('buildings');
          ed.draw();
          toast('Applied – remember to save the island');
        } }, 'Apply'),
        b.type !== 'dock' ? h('button', { class: 'btn warn small', onclick: () => { d.buildings.splice(d.buildings.indexOf(b), 1); ed.sel = null; dirty.add('buildings'); ed.drawSide(); ed.draw(); } }, 'Delete') : null));
  }
  return box;
}

export function villagersBox(ed: Editor) {
  const { rec, d, dirty, v } = ed;
  const box = h('div', { class: 'box' }, h('h3', {}, `🦊 Villagers on this island (${d.villagers.length})`));
  if (!d.villagers.length) box.append(h('p', { class: 'muted', style: 'margin:0' }, 'Nobody has moved in yet.'));
  const list = h('div', { class: 'vlist' });
  for (const vr of d.villagers) {
    const def = villagerDef(vr.defId);
    const live = v.villagers.find((x) => x.id === vr.defId);
    const where = !v.loaded ? '💤 island asleep' : !live ? '–' : live.home ? '🏠 at home' : `🚶 out at ${Math.floor(live.x)},${Math.floor(live.z)}`;
    const friends = Object.keys(vr.friendship ?? {}).length;
    const house = d.buildings.find((b) => b.id === vr.houseId);
    list.append(h('div', { class: 'vrow' },
      h('a', { class: 'vname', href: `#villager/${rec.id}/${vr.defId}`, title: 'Open this villager’s admin page' },
        h('span', { class: 'vface', style: `background:${def?.color ?? '#ccc'};border-color:${def?.accent ?? '#fff'}` }, SPECIES_ICON[def?.species ?? ''] ?? '🐾'),
        h('span', { class: 'col', style: 'gap:0' }, h('b', {}, def?.name ?? vr.defId), h('span', { class: 'muted small' }, `${def?.species ?? '?'} · ${def?.personality ?? '?'}`))),
      h('span', { class: 'muted small', style: 'flex:1;text-align:right' }, where, h('br'), `${friends} friend${friends === 1 ? '' : 's'}`),
      house ? h('button', { class: 'btn ghost small', title: 'Select their house on the map', onclick: () => { ed.sel = { kind: 'building', b: house }; ed.drawSide(); ed.draw(); } }, '📍') : null,
      h('a', { class: 'btn small', href: `#villager/${rec.id}/${vr.defId}` }, 'Open ›'),
      h('button', { class: 'btn ghost small', title: 'Move out (saved with the island)', onclick: () => {
        d.villagers.splice(d.villagers.indexOf(vr), 1);
        if (house) { house.villagerId = undefined; dirty.add('buildings'); }
        dirty.add('villagers');
        ed.drawSide();
        ed.draw();
      } }, '✕')));
  }
  box.append(list);
  const freeHouses = d.buildings.filter((b) => b.type === 'villager_house' && !d.villagers.some((x) => x.houseId === b.id));
  const who = select(VILLAGERS.filter((vd) => !d.villagers.some((x) => x.defId === vd.id)).map((vd) => [vd.id, `${vd.name} (${vd.species})`]), '');
  const house = select(freeHouses.map((b) => [b.id, `${b.id} at ${b.x},${b.z}`]), '');
  box.append(h('div', { class: 'row', style: 'margin-top:10px' }, who, house, h('button', { class: 'btn small', disabled: !freeHouses.length, onclick: () => {
    if (!who.value || !house.value) return;
    d.villagers.push({ defId: who.value, houseId: house.value, movedInAt: Date.now(), friendship: {} });
    const b = d.buildings.find((x) => x.id === house.value);
    if (b) b.villagerId = who.value;
    dirty.add('villagers');
    dirty.add('buildings');
    ed.drawSide();
    ed.draw();
  } }, 'Move in')));
  if (!freeHouses.length) box.append(h('div', { class: 'muted' }, 'Add a villager house (🏠 Add building) to move someone in.'));
  return box;
}

export function dangerBox(ed: Editor) {
  const { rec } = ed;
  return h('div', { class: 'box' }, h('h3', {}, '⚠️ Danger zone'),
    h('div', { class: 'col' },
      h('button', { class: 'btn ghost small', onclick: async () => {
        if (!confirm('Reset all terraforming to the generated terrain?')) return;
        const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, { terrain: null });
        if (r) { toast('Terrain reset'); ed.reopen(r.island); }
      } }, 'Reset terraforming'),
      h('button', { class: 'btn ghost small', onclick: async () => {
        const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, { clearRespawns: true });
        if (r) toast('Pending respawns cleared');
      } }, 'Clear pending respawns'),
      h('button', { class: 'btn warn small', onclick: async () => {
        if (!confirm('Regenerate the island from its seed? All buildings, villagers, furniture and terraforming are removed.')) return;
        const r = await call<{ island: IslandView }>('PATCH', `/api/admin/islands/${rec.id}`, { regenerate: true });
        if (r) { toast('Island regenerated'); ed.reopen(r.island); }
      } }, 'Regenerate island')));
}
