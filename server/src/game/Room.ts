// A room is one simulated location: a player's island, a shared hub, a
// mystery tour or the inside of a tent / house. Only players in the same room
// receive each other's updates (interest management).

import {
  BIOMES, TREES, Grid, computeEnvironment, daysBetween, encodeTiles, generateIsland, generateInterior, findFreeSpot,
  Rng, hashMany, Tile, type BiomeId, type Building, type EnvView, type GeoInfo, type RoomView,
  type ServerMessage, type VillagerView, type WorldObject, type IslandLayout, type Weather, type InteriorStyle, type Season,
} from '@hearthwood/shared';
import type { IslandRecord, Respawn } from '../types.ts';
import type { Session } from './Session.ts';
import { config } from '../config.ts';

export type RoomKind = 'island' | 'shared' | 'tour' | 'interior';

interface VillagerRuntime {
  id: string;
  houseId: string;
  x: number;
  z: number;
  r: number;
  tx: number;
  tz: number;
  idleUntil: number;
  home: boolean;
  dirty: boolean;
}

export interface RoomOptions {
  id: string;
  kind: RoomKind;
  name: string;
  biome: BiomeId;
  ownerId: string | null;
  ownerName: string | null;
  geo: GeoInfo;
  seed: number;
  record?: IslandRecord;
  /** Cliffs & ramps. */
  elevation?: boolean;
  /** For interiors: the building we're inside and the room we came from. */
  interior?: { style: InteriorStyle; buildingId: string; parentId: string };
}

export class Room {
  readonly id: string;
  readonly kind: RoomKind;
  readonly name: string;
  readonly biome: BiomeId;
  readonly ownerId: string | null;
  ownerName: string | null;
  geo: GeoInfo;
  readonly seed: number;
  readonly record?: IslandRecord;
  readonly interior?: RoomOptions['interior'];
  readonly layout: IslandLayout;
  readonly grid: Grid;
  readonly objects = new Map<string, WorldObject>();
  readonly buildings = new Map<string, Building>();
  readonly villagers = new Map<string, VillagerRuntime>();
  readonly sessions = new Set<Session>();
  respawns: Respawn[];
  private nextId: number;
  private envCache: EnvView | null = null;
  private envAt = 0;
  private completed = new Set<string>();
  weatherOverride: { weather: Weather; until: number } | null = null;
  /** Dev tool: force a season (until cleared or the server restarts). */
  seasonOverride: Season | null = null;
  emptySince = Date.now();
  dirty = false;
  dayKey = '';
  /** Callbacks the game layer hooks into. */
  onBuildingComplete?: (room: Room, b: Building) => void;

  constructor(o: RoomOptions) {
    this.id = o.id;
    this.kind = o.kind;
    this.name = o.name;
    this.biome = o.biome;
    this.ownerId = o.ownerId;
    this.ownerName = o.ownerName;
    this.geo = o.geo;
    this.seed = o.seed;
    this.record = o.record;
    this.interior = o.interior;
    if (o.interior) {
      this.layout = generateInterior(o.interior.style);
    } else {
      const variant = o.kind === 'island' ? 'home' : o.kind === 'shared' ? 'shared' : 'tour';
      this.layout = generateIsland(o.seed, o.biome, { variant, elevation: o.elevation });
    }
    this.grid = new Grid(this.layout.size, this.layout.tiles, this.layout.levels, this.layout.ramps);

    let objs: WorldObject[];
    let blds: Building[];
    if (o.interior) {
      objs = o.record?.interiors?.[o.interior.buildingId] ?? [];
      blds = this.layout.buildings;
    } else {
      objs = o.record ? o.record.objects : this.layout.objects;
      blds = o.record ? o.record.buildings : this.layout.buildings;
    }
    for (const ob of objs) this.objects.set(ob.id, ob);
    for (const b of blds) this.buildings.set(b.id, b);
    // Ids must stay unique even if several rooms share one record.
    let maxId = o.record?.nextId ?? 100000;
    for (const ob of objs) maxId = Math.max(maxId, Number(ob.id.replace(/\D/g, '')) + 1 || 0);
    this.nextId = maxId;
    this.grid.rebuild(this.objects.values(), this.buildings.values());
    this.dayKey = o.record?.lastDayKey ?? '';
    this.respawns = o.interior ? [] : o.record ? (o.record.respawns ??= []) : [];

    if (!o.interior) for (const v of o.record?.villagers ?? []) this.spawnVillager(v.defId, v.houseId);
  }

  // ── Identity helpers ────────────────────────────────────────────────────
  newId(prefix: string) {
    const id = `${prefix}${this.nextId++}`;
    if (this.record && !this.interior) this.record.nextId = Math.max(this.record.nextId, this.nextId);
    return id;
  }

  isOwner(playerId: string) {
    return this.ownerId === playerId;
  }

  /** Harvesting is allowed for the owner of an island or a tour. */
  canHarvest(playerId: string) {
    return (this.kind === 'island' || this.kind === 'tour') && this.isOwner(playerId);
  }

  canBuild(playerId: string) {
    return this.kind === 'island' && this.isOwner(playerId);
  }

  canDecorate(playerId: string) {
    return (this.kind === 'island' || this.kind === 'interior') && this.isOwner(playerId);
  }

  islandDay(now = Date.now()): number {
    if (!this.record) return 1;
    return daysBetween(this.record.foundedDayKey, this.env(now).dayKey) + 1;
  }

  // ── Networking ──────────────────────────────────────────────────────────
  broadcast(msg: ServerMessage, except?: Session) {
    const data = JSON.stringify(msg);
    for (const s of this.sessions) if (s !== except && s.ws.readyState === s.ws.OPEN) s.ws.send(data);
  }

  view(viewer: Session): RoomView {
    const pid = viewer.player!.id;
    return {
      id: this.id,
      kind: this.kind,
      interior: this.interior?.style,
      name: this.name,
      biome: this.biome,
      ownerId: this.ownerId,
      ownerName: this.ownerName,
      size: this.layout.size,
      tiles: encodeTiles(this.layout.tiles),
      levels: encodeTiles(this.layout.levels),
      ramps: encodeTiles(this.layout.ramps),
      objects: [...this.objects.values()],
      buildings: [...this.buildings.values()],
      villagers: [...this.villagers.values()].map((v) => this.villagerView(v)),
      players: [...this.sessions].map((s) => this.playerView(s)),
      spawn: this.layout.spawn,
      canHarvest: this.canHarvest(pid),
      canBuild: this.canBuild(pid),
      canDecorate: this.canDecorate(pid),
    };
  }

  playerView(s: Session) {
    const p = s.player!;
    return { id: p.id, name: p.name, gender: p.gender, look: p.look, hat: p.hat, x: s.x, z: s.z, r: s.r };
  }

  villagerView(v: VillagerRuntime): VillagerView {
    return { id: v.id, houseId: v.houseId, x: v.x, z: v.z, r: v.r, home: v.home };
  }

  /** Join the room, optionally at a given position (e.g. in front of a door). */
  join(s: Session, at?: { x: number; z: number; r?: number }) {
    const sp = at && this.grid.walkable(at.x, at.z) ? at : this.layout.spawn;
    s.x = sp.x;
    s.z = sp.z;
    s.r = at?.r ?? Math.PI;
    s.room = this;
    s.lastMoveAt = Date.now();
    this.broadcast({ t: 'pAdd', p: this.playerView(s) }, s);
    this.sessions.add(s);
    s.send({ t: 'room', room: this.view(s), env: this.env() });
  }

  leave(s: Session) {
    if (!this.sessions.delete(s)) return;
    s.room = null;
    s.clearCast();
    this.broadcast({ t: 'pDel', id: s.player!.id });
    if (this.sessions.size === 0) this.emptySince = Date.now();
  }

  // ── World mutation (always broadcasts) ─────────────────────────────────
  addObject(o: WorldObject) {
    this.objects.set(o.id, o);
    this.grid.addObject(o);
    this.broadcast({ t: 'oAdd', o: [o] });
    this.touch();
  }

  /** Re-send an object after its fields changed. Blocking changes must go through replaceObject. */
  updateObject(o: WorldObject) {
    this.broadcast({ t: 'oAdd', o: [o] });
    this.touch();
  }

  replaceObject(o: WorldObject, mutate: (o: WorldObject) => void) {
    this.grid.removeObject(o);
    mutate(o);
    this.grid.addObject(o);
    this.updateObject(o);
  }

  removeObject(id: string) {
    const o = this.objects.get(id);
    if (!o) return;
    this.objects.delete(id);
    this.grid.removeObject(o);
    this.broadcast({ t: 'oDel', ids: [id] });
    this.touch();
  }

  addBuilding(b: Building) {
    this.buildings.set(b.id, b);
    this.grid.addBuilding(b);
    this.broadcast({ t: 'bAdd', b: [b] });
    this.touch();
  }

  removeBuilding(id: string) {
    const b = this.buildings.get(id);
    if (!b) return;
    this.buildings.delete(id);
    this.grid.removeBuilding(b);
    this.broadcast({ t: 'bDel', ids: [id] });
    this.touch();
  }

  completedCount(type: string, now = Date.now()) {
    let n = 0;
    for (const b of this.buildings.values()) if (b.type === type && b.completeAt <= now) n++;
    return n;
  }

  totalCount(type: string) {
    let n = 0;
    for (const b of this.buildings.values()) if (b.type === type) n++;
    return n;
  }

  private touch() {
    this.dirty = true;
  }

  /** Copy runtime state back into the persisted record. */
  syncRecord() {
    if (!this.record || !this.dirty) return false;
    if (this.interior) {
      (this.record.interiors ??= {})[this.interior.buildingId] = [...this.objects.values()];
    } else {
      this.record.objects = [...this.objects.values()];
      this.record.buildings = [...this.buildings.values()];
      this.record.nextId = Math.max(this.record.nextId, this.nextId);
      this.record.lastDayKey = this.dayKey;
      this.record.respawns = this.respawns;
    }
    this.dirty = false;
    return true;
  }

  // ── Environment ─────────────────────────────────────────────────────────
  /** Weather seed: interiors share their island's weather. */
  private envKey() {
    return this.interior ? this.interior.parentId : this.id;
  }

  env(now = Date.now()): EnvView {
    if (this.envCache && now - this.envAt < 10000 && now >= this.envAt) return this.envCache;
    const e = computeEnvironment(now, this.biome, this.geo, `${this.envKey()}:${this.seed}`, { season: this.seasonOverride ?? undefined });
    if (this.weatherOverride) {
      if (now < this.weatherOverride.until) e.weather = this.weatherOverride.weather;
      else this.weatherOverride = null;
    }
    const day = this.record ? daysBetween(this.record.foundedDayKey, e.dayKey) + 1 : 1;
    this.envCache = { ...e, islandDay: day, geo: this.geo };
    this.envAt = now;
    return this.envCache;
  }

  invalidateEnv() {
    this.envCache = null;
  }

  // ── Villagers ───────────────────────────────────────────────────────────
  spawnVillager(defId: string, houseId: string) {
    const house = this.buildings.get(houseId);
    const door = house ? { x: house.x + house.w / 2, z: house.z + house.h + 0.6 } : this.layout.spawn;
    const v: VillagerRuntime = { id: defId, houseId, x: door.x, z: door.z, r: 0, tx: door.x, tz: door.z, idleUntil: 0, home: false, dirty: true };
    this.villagers.set(defId, v);
    return v;
  }

  removeVillager(defId: string) {
    this.villagers.delete(defId);
  }

  villagerTick(dt: number, now: number) {
    if (this.sessions.size === 0 || this.villagers.size === 0) return;
    const env = this.env(now);
    const night = env.hour >= 22 || env.hour < 6;
    const updates: [string, number, number, number, 0 | 1][] = [];
    const rng = Math.random;
    for (const v of this.villagers.values()) {
      const house = this.buildings.get(v.houseId);
      if (!house) continue;
      const doorX = house.x + house.w / 2;
      const doorZ = house.z + house.h + 0.6;
      if (night !== v.home) {
        v.home = night;
        if (night) {
          v.x = doorX;
          v.z = doorZ;
        }
        v.dirty = true;
      }
      if (!v.home && now >= v.idleUntil) {
        const dx = v.tx - v.x;
        const dz = v.tz - v.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.1) {
          v.idleUntil = now + 2000 + rng() * 6000;
          for (let i = 0; i < 8; i++) {
            const tx = doorX + (rng() - 0.5) * 14;
            const tz = doorZ + (rng() - 0.5) * 14;
            // Stay on the same cliff level as the house.
            if (this.grid.walkable(tx, tz, 0.3) && this.grid.level(Math.floor(tx), Math.floor(tz)) === this.grid.level(house.x, house.z)) {
              v.tx = tx;
              v.tz = tz;
              break;
            }
          }
        } else {
          const step = Math.min(d, 1.3 * dt);
          const nx = v.x + (dx / d) * step;
          const nz = v.z + (dz / d) * step;
          if (this.grid.canMove(v.x, v.z, nx, nz, 0.25) || !this.grid.walkable(v.x, v.z, 0.25)) {
            v.x = nx;
            v.z = nz;
            v.r = Math.atan2(dx, dz);
          } else {
            v.tx = v.x;
            v.tz = v.z;
          }
          v.dirty = true;
        }
      }
      if (v.dirty) {
        v.dirty = false;
        updates.push([v.id, round2(v.x), round2(v.z), round2(v.r), v.home ? 1 : 0]);
      }
    }
    if (updates.length) this.broadcast({ t: 'vs', l: updates });
  }

  // ── Movement broadcast ─────────────────────────────────────────────────
  positionTick() {
    const l: [string, number, number, number][] = [];
    for (const s of this.sessions)
      if (s.moved) {
        s.moved = false;
        l.push([s.player!.id, round2(s.x), round2(s.z), round2(s.r)]);
      }
    if (l.length) this.broadcast({ t: 'ps', l });
  }

  // ── Slow simulation: growth, construction, respawns, daily refresh ─────
  slowTick(now: number) {
    const prev = this.envCache;
    const env = this.env(now);
    if (prev && prev !== env && (prev.weather !== env.weather || prev.season !== env.season || prev.hour !== env.hour || prev.dayKey !== env.dayKey)) {
      this.broadcast({ t: 'env', env });
    }
    if (this.interior) return;
    if (env.dayKey !== this.dayKey) this.dailyRefresh(env.dayKey, now);
    if (this.kind === 'shared') return;

    for (const o of [...this.objects.values()]) {
      // Tree growth.
      if (o.kind === 'tree' && (o.stage ?? 2) < 2 && o.growAt && o.growAt <= now) {
        this.replaceObject(o, (t) => {
          t.stage = (t.stage ?? 0) + 1;
          t.growAt = t.stage < 2 ? now + (config.treeStageMinutes * 60000) / config.timeFactor : undefined;
          if (t.stage === 2) t.fruit = TREES[t.species!].fruit ? 1 : 0;
        });
      }
      // Old stumps rot away; a wild sapling sprouts nearby.
      if (o.kind === 'stump' && o.decayAt && o.decayAt <= now) {
        this.removeObject(o.id);
        this.respawns.push({ kind: 'tree', x: o.x, z: o.z, at: now });
      }
    }
    this.processRespawns(now);
    // Construction.
    for (const b of this.buildings.values()) {
      if (!this.completed.has(b.id) && b.completeAt <= now) {
        this.completed.add(b.id);
        if (b.completeAt > 0) this.onBuildingComplete?.(this, b); // must be idempotent (also runs after a restart)
      }
    }
  }

  // ── Depletion & respawning ─────────────────────────────────────────────
  scheduleRespawn(kind: Respawn['kind'], x: number, z: number, now = Date.now()) {
    const minutes = config.respawnMinutes[kind];
    this.respawns.push({ kind, x, z, at: now + (minutes * 60000) / config.timeFactor });
    this.dirty = true;
  }

  /** Bring back due resources at their old spot, or the nearest free one on the lot. */
  processRespawns(now: number) {
    if (!this.respawns.length) return;
    const due = this.respawns.filter((r) => r.at <= now);
    if (!due.length) return;
    this.respawns = this.respawns.filter((r) => r.at > now);
    const rng = new Rng(hashMany(this.id, now));
    const def = BIOMES[this.biome];
    for (const r of due) {
      const ok = (x: number, z: number) => {
        if (this.grid.tile(x, z) !== Tile.Ground || !this.grid.canPlace(x, z)) return false;
        for (const s of this.sessions) if (Math.floor(s.x) === x && Math.floor(s.z) === z) return false;
        if (r.kind === 'tree' || r.kind === 'rock') {
          // Keep breathing room around trees and rocks.
          for (const o of this.objects.values()) if ((o.kind === 'tree' || o.kind === 'stump' || o.kind === 'rock') && Math.abs(o.x - x) <= 1 && Math.abs(o.z - z) <= 1) return false;
        }
        return true;
      };
      const spot = findFreeSpot(this.grid, r.x, r.z, ok, () => rng.float());
      if (!spot) {
        this.respawns.push({ ...r, at: now + 3600_000 / config.timeFactor }); // try again later
        continue;
      }
      if (r.kind === 'rock') this.addObject({ id: this.newId('r'), kind: 'rock', x: spot.x, z: spot.z, hits: 0 });
      else if (r.kind === 'bush') this.addObject({ id: this.newId('k'), kind: 'bush', x: spot.x, z: spot.z, ripe: true });
      else {
        const species = rng.weighted(def.trees, (t) => t.weight)!.species;
        this.addObject({ id: this.newId('t'), kind: 'tree', x: spot.x, z: spot.z, species, stage: 0, hits: 0, fruit: 0, growAt: now + (config.treeStageMinutes * 60000) / config.timeFactor });
      }
    }
    this.dirty = true;
  }

  /** New day: fruit regrows, loose stones refill, mushrooms & flowers spawn. */
  dailyRefresh(dayKey: string, _now: number) {
    const first = this.dayKey === '';
    this.dayKey = dayKey;
    this.dirty = true;
    if (first && this.kind !== 'island') return;
    const def = BIOMES[this.biome];
    const rng = new Rng(hashMany(this.id, dayKey));
    let mushrooms = 0;
    let flowers = 0;
    for (const o of this.objects.values()) {
      if (o.kind === 'mushroom') mushrooms++;
      if (o.kind === 'flower') flowers++;
    }
    const trees: WorldObject[] = [];
    for (const o of [...this.objects.values()]) {
      if (o.kind === 'rock' && o.hits && o.hits <= 2) {
        // Hand-gathered stones come back; shovel damage stays until it crumbles.
        o.hits = 0;
        this.updateObject(o);
      } else if (o.kind === 'tree' && o.stage === 2) {
        trees.push(o);
        const fruit = TREES[o.species!].fruit ? 3 : 0;
        if ((o.fruit ?? 0) < fruit || o.shook) {
          o.fruit = fruit;
          delete o.shook;
          this.updateObject(o);
        }
      }
    }
    const freeNear = (x: number, z: number) => {
      const dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]);
      for (const [dx, dz] of dirs) if (this.grid.canPlace(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      return null;
    };
    for (const t of trees) {
      if (mushrooms >= 10) break;
      if (!rng.chance(def.mushroomChance * 2)) continue;
      const p = freeNear(t.x, t.z);
      if (!p) continue;
      this.addObject({ id: this.newId('m'), kind: 'mushroom', x: p.x, z: p.z, rare: rng.chance(def.rareMushroomChance) });
      mushrooms++;
    }
    for (let i = 0; i < 4 && flowers < 12; i++) {
      const x = rng.int(1, this.layout.size - 2);
      const z = rng.int(1, this.layout.size - 2);
      if (this.grid.tile(x, z) === Tile.Ground && this.grid.canPlace(x, z)) {
        this.addObject({ id: this.newId('f'), kind: 'flower', x, z });
        flowers++;
      }
    }
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
