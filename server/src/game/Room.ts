// A room is one simulated location: a player's island, a shared hub, a
// mystery tour or the inside of a tent / house. Only players in the same room
// receive each other's updates (interest management).

import {
  TREES, Grid, generateHarbor, computeEnvironment, daysBetween, encodeTiles, decodeTiles, generateIsland, generateInterior, applyTerrainAndWater, classifyWater, type TerrainChange, Rng, type BiomeId, type Building, type EnvView, type GeoInfo, type RoomView, type ServerMessage, type VillagerView, type WorldObject, type IslandLayout, type Weather, type Season, type BoardPost, type InteriorSpec, type InteriorTheme, HOME_STYLES,
  isTransient, type FishShadow,
  outfitOf,
} from '@hearthwood/shared';
import type { IslandRecord, Respawn } from '../types.ts';
import type { Session } from './Session.ts';
import { config } from '../config.ts';
import { beachTick, washUp, widenBeaches } from './room/beach.ts';
import { birdTick, landBirdsNear } from './room/birds.ts';
import { fishNear, fishTick } from './room/fish.ts';
import { dailyRefresh, processRespawns, scheduleRespawn } from './room/growth.ts';
import { round2, spawnVillager, villagerTick, type VillagerRuntime } from './room/villagers.ts';

export type RoomKind = 'island' | 'shared' | 'tour' | 'interior';

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
  /** Island side length (defaults to the current ISLAND_SIZE). */
  size?: number;
  /** For interiors: the building we're inside and the room we came from. */
  interior?: { spec: InteriorSpec; buildingId: string; parentId: string; houseOwnerId?: string };
  /** Hand-designed shared locations. */
  design?: 'harbor' | 'aurora';
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
  readonly design?: RoomOptions['design'];
  /** Interior colours. */
  theme?: InteriorTheme;
  /** Billboard notes (shared with the store, so they persist). */
  board: BoardPost[] | null = null;
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
  /** Terrain was reshaped since load (so it gets saved). */
  terraformed = false;
  dayKey = '';
  /** Callbacks the game layer hooks into. */
  onBuildingComplete?: (room: Room, b: Building) => void;
  onHouseUpgraded?: (room: Room, b: Building) => void;

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
    this.design = o.design;
    if (o.interior) {
      const il = generateInterior(o.interior.spec);
      this.theme = il.theme;
      this.layout = il;
    } else if (o.design === 'harbor') {
      this.layout = generateHarbor();
    } else {
      const variant = o.kind === 'island' ? 'home' : o.kind === 'shared' ? 'shared' : 'tour';
      this.layout = generateIsland(o.seed, o.biome, { variant, elevation: o.elevation, size: o.size });
      // Terraformed islands keep their reshaped terrain.
      const t = o.record?.terrain;
      const n = this.layout.size * this.layout.size;
      if (t && t.tiles.length === n && t.levels.length === n && t.ramps.length === n) {
        this.layout.tiles.set(decodeTiles(t.tiles));
        this.layout.levels.set(decodeTiles(t.levels));
        this.layout.ramps.set(decodeTiles(t.ramps));
        classifyWater(this.layout.size, this.layout.tiles); // saves from before rivers existed
      }
    }
    const paths = !o.interior && o.record?.paths && o.record.paths.length === this.layout.size * this.layout.size ? decodeTiles(o.record.paths) : this.layout.paths;
    if (!o.interior && o.record && this.layout.beachBand) widenBeaches(this, o.record, this.layout.beachBand);
    this.grid = new Grid(this.layout.size, this.layout.tiles, this.layout.levels, this.layout.ramps, paths);

    let objs: WorldObject[];
    let blds: Building[];
    if (o.interior) {
      // Generated decor, plus (in your own tent / house) the furniture you placed.
      const saved = this.isHome() ? o.record?.interiors?.[o.interior.buildingId] ?? [] : [];
      objs = [...this.layout.objects, ...saved.filter((x) => x.kind !== 'decor')];
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

  /** Lives here: same rights as the owner (except managing visitors and roles). */
  isResident(playerId: string) {
    return !!this.record?.residents?.includes(playerId);
  }

  /** May build and decorate here (granted by the owner). */
  isBuilder(playerId: string) {
    return !!this.record?.builders?.includes(playerId);
  }

  /** 'owner' | 'resident' | 'builder' | 'visitor' – for the client. */
  roleOf(playerId: string) {
    return this.isOwner(playerId) ? 'owner' : this.isResident(playerId) ? 'resident' : this.isBuilder(playerId) ? 'builder' : 'visitor';
  }

  /** Harvesting is allowed for the owner (and residents) of an island, or a tour's owner. */
  canHarvest(playerId: string) {
    return (this.kind === 'island' && (this.isOwner(playerId) || this.isResident(playerId))) || (this.kind === 'tour' && this.isOwner(playerId));
  }

  canBuild(playerId: string) {
    return this.kind === 'island' && (this.isOwner(playerId) || this.isResident(playerId) || this.isBuilder(playerId));
  }

  /** Send someone a fresh view of this room (e.g. their rights changed). */
  resendView(s: Session) {
    s.send({ t: 'room', room: this.view(s), env: this.env() });
  }

  /** Your own tent / starter house: furniture can be rearranged and is saved. */
  isHome() {
    return !!this.interior && HOME_STYLES.includes(this.interior.spec.style);
  }

  canDecorate(playerId: string) {
    if (this.kind === 'island') return this.canBuild(playerId);
    // Homes: the island owner, residents and whoever owns the house.
    return this.isHome() && (this.isOwner(playerId) || this.isResident(playerId) || this.interior?.houseOwnerId === playerId);
  }

  /** Owner-only services (selling, cooking…) are available on the island and inside its buildings. */
  ownsHere(playerId: string) {
    return (this.kind === 'island' || (this.kind === 'interior' && !this.interior!.parentId.startsWith('shared_'))) && (this.isOwner(playerId) || this.isResident(playerId));
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
      interior: this.interior?.spec.style,
      theme: this.theme,
      name: this.name,
      biome: this.biome,
      ownerId: this.ownerId,
      ownerName: this.ownerName,
      size: this.layout.size,
      tiles: encodeTiles(this.layout.tiles),
      levels: encodeTiles(this.layout.levels),
      ramps: encodeTiles(this.layout.ramps),
      paths: encodeTiles(this.grid.paths),
      objects: [...this.objects.values()],
      buildings: [...this.buildings.values()],
      villagers: [...this.villagers.values()].map((v) => this.villagerView(v)),
      players: [...this.sessions].map((s) => this.playerView(s)),
      spawn: this.layout.spawn,
      canHarvest: this.canHarvest(pid),
      canBuild: this.canBuild(pid),
      canDecorate: this.canDecorate(pid),
      role: this.roleOf(pid),
      board: this.board ?? undefined,
    };
  }

  playerView(s: Session) {
    const p = s.player!;
    return { id: p.id, name: p.name, gender: p.gender, look: p.look, hat: p.hat, outfit: outfitOf(p), x: s.x, z: s.z, r: s.r };
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

  removeObject(id: string, fx?: 'fly') {
    const o = this.objects.get(id);
    if (!o) return;
    this.objects.delete(id);
    this.grid.removeObject(o);
    this.broadcast(fx ? { t: 'oDel', ids: [id], fx } : { t: 'oDel', ids: [id] });
    this.touch();
  }

  addBuilding(b: Building) {
    this.buildings.set(b.id, b);
    this.grid.addBuilding(b);
    this.broadcast({ t: 'bAdd', b: [b] });
    this.touch();
  }

  /** Move a building to a new spot (already validated) and tell everyone. */
  moveBuilding(b: Building, x: number, z: number) {
    this.grid.removeBuilding(b);
    b.x = x;
    b.z = z;
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

  /** Lay (type > 0) or remove (0) a path tile and tell everyone in the room. */
  setPath(x: number, z: number, type: number) {
    this.grid.paths[z * this.grid.size + x] = type;
    this.broadcast({ t: 'paths', l: [[x, z, type]] });
    this.touch();
  }

  /** Reshape terrain (already validated) and tell everyone in the room. */
  setTerrain(changes: TerrainChange[]) {
    const all = applyTerrainAndWater(this.grid, changes);
    this.terraformed = true;
    this.broadcast({ t: 'terrain', l: all });
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
  syncRecord(force = false) {
    if (!this.record || (!this.dirty && !force)) return false;
    if (this.interior) {
      if (this.isHome()) (this.record.interiors ??= {})[this.interior.buildingId] = [...this.objects.values()].filter((x) => x.kind !== 'decor');
    } else {
      this.record.objects = [...this.objects.values()].filter((o) => !isTransient(o));
      this.record.buildings = [...this.buildings.values()];
      this.record.nextId = Math.max(this.record.nextId, this.nextId);
      this.record.lastDayKey = this.dayKey;
      this.record.respawns = this.respawns;
      this.record.paths = encodeTiles(this.grid.paths);
      if (this.terraformed || this.record.terrain) {
        this.record.terrain = { tiles: encodeTiles(this.grid.tiles), levels: encodeTiles(this.grid.levels), ramps: encodeTiles(this.grid.ramps) };
      }
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
    if (this.design === 'aurora') {
      // The lookout is famous for its clear, starry nights – and the northern lights.
      e.aurora = true;
      if (e.hour >= 15 || e.hour < 8) e.weather = 'clear';
    }
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
    birdTick(this, now, env);
    fishTick(this, now, env);
    if (this.kind === 'shared') return;
    beachTick(this, now);

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
      // House upgrades.
      if (b.upgrade && b.upgrade.at <= now) {
        b.level = b.upgrade.level;
        delete b.upgrade;
        this.broadcast({ t: 'bAdd', b: [b] });
        this.touch();
        this.onHouseUpgraded?.(this, b);
      }
    }
  }

  // ── Villagers (room/villagers.ts) ───────────────────────────────────────
  spawnVillager(defId: string, houseId: string) {
    return spawnVillager(this, defId, houseId);
  }

  removeVillager(defId: string) {
    this.villagers.delete(defId);
  }

  villagerTick(dt: number, now: number) {
    villagerTick(this, dt, now);
  }

  // ── Beach & birds (room/beach.ts, room/birds.ts) ────────────────────────
  /** Randomness for birds and beachcombing (not seeded: they're never saved). */
  readonly birdRng = new Rng(Math.floor(Math.random() * 2 ** 31));

  /** Dev helper: wash things up right now. */
  washUp(count: number) {
    return washUp(this, count);
  }

  /** Dev helper: land birds within a few tiles of a point. */
  landBirdsNear(px: number, pz: number, count: number) {
    return landBirdsNear(this, px, pz, count);
  }

  /** Dev helper: put fish shadows in the water near a point. */
  fishNear(px: number, pz: number, count: number, size?: FishShadow, at?: [number, number]) {
    return fishNear(this, px, pz, count, size, at);
  }

  // ── Depletion & respawning (room/growth.ts) ─────────────────────────────
  scheduleRespawn(kind: Respawn['kind'], x: number, z: number, now = Date.now()) {
    scheduleRespawn(this, kind, x, z, now);
  }

  processRespawns(now: number) {
    processRespawns(this, now);
  }

  dailyRefresh(dayKey: string, now: number) {
    dailyRefresh(this, dayKey, now);
  }
}
