// What every action handler gets (the player, their session and room, the time) and
// the small helpers they share: distance checks, guards, giving items, the album.

import {
  type Action, type Building, type BuildingType, distToTile, hashMany, nearBuilding, Rng, SHOP_TYPES, type WorldObject,
} from '@hearthwood/shared';
import type { Game } from '../Game.ts';
import type { PlayerRecord } from '../../types.ts';
import type { Room } from '../Room.ts';
import type { Session } from '../Session.ts';
import { albumOf } from '../Game.ts';
import { config } from '../../config.ts';
import * as inv from '../inventory.ts';
import { logger } from '../../log.ts';

export const log = logger('action');

export interface ActionResult {
  ok: boolean;
  err?: string;
  msg?: string;
  gained?: Record<string, number>;
}

/** The parts of the game the action handlers may use (narrower than all of Game). */
export type GameApi = Pick<Game, 'store' | 'sanitize' | 'levelUpCheck' | 'broadcastLook' | 'sendSelf' | 'notifyMail' | 'rooms' | 'sendQuest'>;

export interface Ctx {
  game: GameApi;
  s: Session;
  room: Room;
  p: PlayerRecord;
  now: number;
}

export const fail = (err: string): ActionResult => ({ ok: false, err });

export const HARVEST_COOLDOWN_MS = 280;

export function near(ctx: Ctx, o: { x: number; z: number }, reach = config.reach) {
  return distToTile(ctx.s.x, ctx.s.z, o.x, o.z) <= reach;
}

export function getObj(ctx: Ctx, id: string, kind?: WorldObject['kind'] | WorldObject['kind'][]): WorldObject | ActionResult {
  const o = ctx.room.objects.get(id);
  if (!o) return fail('That isn’t there any more.');
  if (kind && !(Array.isArray(kind) ? kind.includes(o.kind) : o.kind === kind)) return fail('You can’t do that to this.');
  if (!near(ctx, o)) return fail('Too far away.');
  return o;
}

export function isResult(v: unknown): v is ActionResult {
  return typeof v === 'object' && v !== null && 'ok' in v;
}

export function harvestGuard(ctx: Ctx): ActionResult | null {
  if (!ctx.room.canHarvest(ctx.p.id)) return fail('Only the island owner can gather resources here.');
  if (ctx.now - ctx.s.lastActAt < HARVEST_COOLDOWN_MS) return fail('Slow down!');
  ctx.s.lastActAt = ctx.now;
  return null;
}

export function give(ctx: Ctx, gained: Record<string, number>, id: string, n: number) {
  const k = inv.add(ctx.p, id, n);
  if (k > 0) gained[id] = (gained[id] ?? 0) + k;
  return k;
}

/** A finished building of one of these types nearby – or, indoors, a counter offering that service. */
export function nearCompleted(ctx: Ctx, types: BuildingType[]): Building | undefined {
  for (const b of ctx.room.buildings.values()) {
    // Shops and the Town Hall serve you at the counter inside, not through the wall.
    const servedInside = SHOP_TYPES.includes(b.type) || b.type === 'town_hall';
    const matches = (types.includes(b.type) && !servedInside) || (b.type === 'counter' && !!b.role && types.includes(b.role));
    if (matches && b.completeAt <= ctx.now && nearBuilding(b, ctx.s.x, ctx.s.z, config.buildingReach)) return b;
  }
  return undefined;
}

export function rngFor(ctx: Ctx) {
  return new Rng(hashMany(ctx.room.id, ctx.p.id, ctx.now, Math.random()));
}

/** Add a catch to the album; returns true if it's a new entry. */
export function recordCatch(ctx: Ctx, kind: 'fish' | 'birds', id: string): boolean {
  const album = albumOf(ctx.p);
  const e = album[kind][id];
  if (e) e.n++;
  else album[kind][id] = { n: 1, first: ctx.now, biome: ctx.room.biome };
  ctx.game.store.markPlayer(ctx.p.id);
  ctx.s.send({ t: 'album', album });
  return !e;
}

/** One handler per action kind; a missing one is a compile error in index.ts. */
export type Handlers = { [K in Action['k']]: (ctx: Ctx, a: Extract<Action, { k: K }>) => ActionResult };
