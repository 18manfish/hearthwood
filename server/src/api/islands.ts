// HTTP API (admin): looking up and editing islands and their villagers.

import {
  ACCESS_LEVELS, BIOME_IDS, BUILDINGS, ITEMS, OBJ_KINDS, VILLAGERS, FRIENDSHIP_MAX, decodeTiles, encodeTiles, generateIsland, isBiome, isBuildingType, isTransient, villagerDef, type Access, type Building, type WorldObject,
} from '@hearthwood/shared';
import { HttpError, readJson } from '../http.ts';
import { logger } from '../log.ts';
import type { Store } from '../store.ts';
import type { IslandRecord, VillagerRecord } from '../types.ts';
import { type Api, int, str } from './context.ts';

const log = logger('api');

export function islandRoutes(api: Api) {
  const { r, game, store, admin, actor } = api;
  const findIsland = (id: string) => {
    const i = store.islands.get(id);
    if (!i) throw new HttpError(404, 'No such island.');
    return i;
  };

  r.on('GET', '/api/admin/islands', ({ req, url }) => {
    admin(req);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const list = [...store.islands.values()]
      .filter((i) => !q || [i.id, i.name, store.players.get(i.ownerId)?.name ?? ''].some((s) => s.toLowerCase().includes(q)))
      .slice(0, 500)
      .map((i) => ({
        id: i.id, name: i.name, biome: i.biome, owner: { id: i.ownerId, name: store.players.get(i.ownerId)?.name ?? '?' }, access: i.access,
        size: i.size ?? 48, buildings: i.buildings.length, villagers: i.villagers.length, villagerIds: i.villagers.map((v) => v.defId), loaded: game.rooms.has(i.id),
        visitors: game.rooms.get(i.id)?.sessions.size ?? 0, createdAt: i.createdAt,
      }));
    return { total: store.islands.size, islands: list };
  });

  r.on('GET', '/api/admin/islands/:id', ({ req, params }) => {
    admin(req);
    const rec = findIsland(params.id);
    return game.adminIslandView(rec);
  });

  /** One villager on an island, with the names of the players they know. */
  r.on('GET', '/api/admin/islands/:id/villagers/:vid', ({ req, params }) => {
    admin(req);
    const rec = findIsland(params.id);
    const view = game.adminIslandView(rec);
    const v = rec.villagers.find((x) => x.defId === params.vid);
    if (!v) throw new HttpError(404, 'That villager doesn’t live on this island.');
    const houses = view.record.buildings.filter((b) => b.type === 'villager_house').map((b) => ({ id: b.id, x: b.x, z: b.z, villagerId: b.villagerId ?? null }));
    const live = view.villagers.find((x) => x.id === v.defId) ?? null;
    const friends = Object.entries(v.friendship).map(([pid, f]) => {
      const pl = store.players.get(pid);
      return { id: pid, name: pl?.name ?? null, username: pl?.username ?? null, online: game.online.has(pid), ...f };
    }).sort((a, b) => b.pts - a.pts);
    return {
      island: { id: rec.id, name: rec.name, biome: rec.biome, loaded: view.loaded },
      owner: view.owner, villager: v, live, houses, friends,
      others: rec.villagers.filter((x) => x.defId !== v.defId).map((x) => x.defId),
    };
  });

  r.on('PATCH', '/api/admin/islands/:id', async ({ req, params }) => {
    const me = admin(req);
    const rec = findIsland(params.id);
    const body = await readJson(req);
    game.syncIsland(rec.id); // pull live state into the record first
    const changed = applyIslandPatch(store, rec, body);
    store.markIsland(rec.id);
    game.reloadIsland(rec.id);
    store.audit(actor(me), 'island.edit', rec.id, { fields: changed });
    log.info('admin edited island', { admin: actor(me), island: rec.id, fields: changed });
    return { ok: true, changed, island: game.adminIslandView(rec) };
  });
}

// Everything an admin may change about an island, validated field by field.
function applyIslandPatch(store: Store, rec: IslandRecord, b: Record<string, unknown>): string[] {
  const changed: string[] = [];
  const size = rec.size ?? 48;
  const set = (k: string, fn: () => void) => {
    if (k in b) {
      fn();
      changed.push(k);
    }
  };
  const inside = (x: unknown, z: unknown, what: string) => {
    int(x, 0, size - 1, `${what} x`);
    int(z, 0, size - 1, `${what} z`);
  };
  set('name', () => (rec.name = str(b.name, 2, 20, 'Island name')));
  set('access', () => {
    if (!(ACCESS_LEVELS as readonly unknown[]).includes(b.access)) throw new HttpError(400, 'Unknown access level.');
    rec.access = b.access as Access;
  });
  set('inviteCode', () => {
    const c = str(b.inviteCode, 4, 12, 'Invite code').toUpperCase();
    if (!/^[A-Z0-9]+$/.test(c)) throw new HttpError(400, 'Invite codes are letters and digits.');
    if (c !== rec.inviteCode && store.codeTaken(c)) throw new HttpError(409, 'That code is taken.');
    store.setInviteCode(rec, c);
  });
  set('biome', () => {
    if (!isBiome(b.biome)) throw new HttpError(400, `Biome must be one of ${BIOME_IDS.join(', ')}.`);
    rec.biome = b.biome;
  });
  set('seed', () => (rec.seed = int(b.seed, 0, 2 ** 31 - 1, 'Seed')));
  set('foundedDayKey', () => {
    if (typeof b.foundedDayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.foundedDayKey)) throw new HttpError(400, 'Founding day must be YYYY-MM-DD.');
    rec.foundedDayKey = b.foundedDayKey;
  });
  set('map', () => {
    const m = b.map as { x?: unknown; y?: unknown };
    rec.map = { x: int(m?.x, 0, 1000, 'Map x'), y: int(m?.y, 0, 560, 'Map y') };
  });
  set('objects', () => {
    if (!Array.isArray(b.objects)) throw new HttpError(400, 'Objects must be a list.');
    const ids = new Set<string>();
    const list = b.objects as WorldObject[];
    for (const o of list) {
      if (typeof o?.id !== 'string' || ids.has(o.id)) throw new HttpError(400, 'Every object needs a unique id.');
      ids.add(o.id);
      if (!OBJ_KINDS.includes(o.kind) || isTransient(o)) throw new HttpError(400, `Object ${o.id}: unknown kind.`);
      inside(o.x, o.z, `Object ${o.id}`);
      if ((o.kind === 'furniture' || o.kind === 'decor') && (typeof o.item !== 'string' || (o.kind === 'furniture' && !ITEMS[o.item]))) throw new HttpError(400, `Object ${o.id}: unknown item.`);
    }
    rec.objects = list;
  });
  set('buildings', () => {
    if (!Array.isArray(b.buildings)) throw new HttpError(400, 'Buildings must be a list.');
    const ids = new Set<string>();
    const list = b.buildings as Building[];
    for (const bd of list) {
      if (typeof bd?.id !== 'string' || ids.has(bd.id)) throw new HttpError(400, 'Every building needs a unique id.');
      ids.add(bd.id);
      if (!isBuildingType(bd.type)) throw new HttpError(400, `Building ${bd.id}: unknown type.`);
      inside(bd.x, bd.z, `Building ${bd.id}`);
      bd.w = BUILDINGS[bd.type].w;
      bd.h = BUILDINGS[bd.type].h;
      if (typeof bd.completeAt !== 'number') bd.completeAt = 0;
      if (bd.villagerId !== undefined && !villagerDef(bd.villagerId)) throw new HttpError(400, `Building ${bd.id}: unknown villager.`);
    }
    if (!list.some((x) => x.type === 'dock')) throw new HttpError(400, 'An island needs its dock.');
    rec.buildings = list;
  });
  set('villagers', () => {
    if (!Array.isArray(b.villagers)) throw new HttpError(400, 'Villagers must be a list.');
    const list = b.villagers as VillagerRecord[];
    const seen = new Set<string>();
    for (const v of list) {
      if (!VILLAGERS.some((d) => d.id === v?.defId) || seen.has(v.defId)) throw new HttpError(400, `Unknown or duplicate villager "${v?.defId}".`);
      seen.add(v.defId);
      if (typeof v.houseId !== 'string') throw new HttpError(400, `Villager ${v.defId} needs a house id.`);
      v.friendship ??= {};
      if (typeof v.friendship !== 'object' || Array.isArray(v.friendship)) throw new HttpError(400, `Villager ${v.defId}: friendship must be an object.`);
      for (const [pid, f] of Object.entries(v.friendship)) {
        if (!f || typeof f.pts !== 'number' || !Number.isFinite(f.pts)) throw new HttpError(400, `Villager ${v.defId}: friendship with ${pid} needs points.`);
        f.pts = Math.max(0, Math.min(FRIENDSHIP_MAX, Math.round(f.pts)));
      }
      v.movedInAt ??= Date.now();
    }
    rec.villagers = list;
  });
  // Terrain: tile / level / ramp arrays as digit strings (same encoding as the game).
  set('terrain', () => {
    if (b.terrain === null) return void delete rec.terrain;
    const t = b.terrain as { tiles?: unknown; levels?: unknown; ramps?: unknown };
    const n = size * size;
    for (const k of ['tiles', 'levels', 'ramps'] as const) if (typeof t?.[k] !== 'string' || (t[k] as string).length !== n || !/^[0-9]+$/.test(t[k] as string)) throw new HttpError(400, `terrain.${k} must be ${n} digits.`);
    const tiles = decodeTiles(t.tiles as string), levels = decodeTiles(t.levels as string), ramps = decodeTiles(t.ramps as string);
    if (tiles.some((v) => v > 8) || levels.some((v) => v > 3) || ramps.some((v) => v > 4)) throw new HttpError(400, 'Terrain values out of range.');
    rec.terrain = { tiles: encodeTiles(tiles), levels: encodeTiles(levels), ramps: encodeTiles(ramps) };
  });
  set('paths', () => {
    if (typeof b.paths !== 'string' || b.paths.length !== size * size || !/^[0-5]+$/.test(b.paths)) throw new HttpError(400, `paths must be ${size * size} digits 0–5.`);
    rec.paths = b.paths;
  });
  set('clearRespawns', () => (rec.respawns = []));
  // Start over: fresh terrain and resources from the (possibly new) seed / biome. Villagers move out.
  set('regenerate', () => {
    if (b.regenerate !== true) return;
    const L = generateIsland(rec.seed, rec.biome, { variant: 'home', elevation: (rec.gen ?? 1) >= 2, size });
    rec.objects = L.objects;
    rec.buildings = L.buildings;
    rec.villagers = [];
    rec.interiors = {};
    rec.respawns = [];
    delete rec.terrain;
    delete rec.paths;
  });
  return changed;
}

