// Dev commands (only in dev mode): kits, time, weather, seasons, birds, fish, bottles…

import {
  BIOMES, type DevCommand, ITEMS, PERMITS, type Season, SEASONS_BY_MODEL, type Weather,
} from '@hearthwood/shared';
import { logger } from '../../log.ts';
import { Session } from '../Session.ts';
import * as inv from '../inventory.ts';
import type { Game } from '../Game.ts';
import { deliverBottles } from './bottles.ts';
import { progress, sendQuest } from './progress.ts';
import { homeIsland } from './travel.ts';
import { sendInv, sendSelf } from './views.ts';

const log = logger('game');

/** Developer helpers – only active with DEV_FAST=1 (validated by the protocol schema). */
export function devCommand(game: Game, s: Session, cmd: DevCommand, args: string[]) {
  const p = s.player!;
  log.info('dev command', { player: p.id, cmd, args });
  const room = s.room;
  const reply = (t: string) => s.send({ t: 'chat', from: '', name: '', text: `[dev] ${t}`, sys: true });
  const n = (i: number, d: number) => (Number.isFinite(Number(args[i])) && args[i] !== '' && args[i] !== undefined ? Number(args[i]) : d);
  switch (cmd) {
    case 'kit':
      for (const [id, q] of Object.entries({ wood: 300, stone: 200, clay: 80, iron_ore: 40, fiber: 50, sapling: 10 })) inv.add(p, id, q);
      reply('Building kit added.');
      break;
    case 'give':
      if (!args[0] || !ITEMS[args[0]]) return reply('Usage: give <item> [n]');
      inv.add(p, args[0], Math.max(1, Math.min(999, n(1, 1))));
      reply(`Gave ${args[0]}`);
      break;
    case 'coins':
      p.coins = Math.max(0, p.coins + n(0, 1000));
      break;
    case 'permits':
      p.permits = PERMITS.map((x) => x.id);
      sendSelf(game, s);
      reply('All Town Hall permits granted.');
      break;
    case 'birds': {
      // Land a few birds right around you.
      if (!room || room.interior) return reply('Go outside first.');
      const landed = room.landBirdsNear(s.x, s.z, Math.max(1, Math.min(6, n(0, 3))));
      reply(`${landed} bird(s) landed nearby.`);
      break;
    }
    case 'fish': {
      // Fish shadows in the water around you: /fish [n] [small|medium|large] [x z]
      if (!room || room.interior) return reply('Go outside first.');
      const size = (['small', 'medium', 'large'] as const).find((x) => x === args[1]);
      const at = args[2] !== undefined && args[3] !== undefined ? [Math.floor(n(2, 0)), Math.floor(n(3, 0))] as [number, number] : undefined;
      const k = room.fishNear(s.x, s.z, Math.max(1, Math.min(8, n(0, 3))), size, at);
      reply(k ? `${k} fish shadow(s) nearby.` : 'No free water nearby.');
      break;
    }
    case 'bottles':
      game.store.rushBottles();
      deliverBottles(game);
      reply('All bottles at sea have washed up.');
      break;
    case 'beach': {
      if (!room || room.kind !== 'island') return reply('Only on islands.');
      const k = room.washUp(Math.max(1, Math.min(10, n(0, 5))));
      reply(`${k} thing(s) washed up on the beach.`);
      break;
    }
    case 'clearinv':
      p.inv = {};
      p.hat = null;
      p.outfit = {};
      reply('Pockets emptied.');
      break;
    case 'day': {
      const isl = homeIsland(game, p);
      if (!isl) return;
      const d = Math.max(-365, Math.min(365, n(0, 1)));
      isl.foundedDayKey = new Date(Date.parse(isl.foundedDayKey + 'T00:00:00Z') - d * 86400000).toISOString().slice(0, 10);
      game.store.markIsland(isl.id);
      for (const r of game.rooms.values()) if (r.record === isl) r.invalidateEnv();
      reply(`Island is now on day ${progress(game, p).day}.`);
      sendQuest(game, s);
      if (room) s.send({ t: 'env', env: room.env() });
      break;
    }
    case 'finish':
      if (!room) return;
      for (const b of room.buildings.values()) {
        if (b.completeAt > Date.now()) b.completeAt = Date.now() - 1;
        if (b.upgrade && b.upgrade.at > Date.now()) b.upgrade.at = Date.now() - 1;
      }
      for (const o of room.objects.values()) if (o.growAt) o.growAt = Date.now() - 1;
      room.slowTick(Date.now());
      reply('Construction and growth finished.');
      break;
    case 'respawn':
      if (!room) return;
      for (const r of room.respawns) r.at = 0;
      for (const o of room.objects.values()) if (o.kind === 'stump') o.decayAt = 1;
      room.slowTick(Date.now());
      reply('Resources respawned.');
      break;
    case 'weather': {
      if (!room) return;
      const w = args[0] as Weather;
      const valid: Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'sandstorm', 'heatwave'];
      room.weatherOverride = valid.includes(w) ? { weather: w, until: Date.now() + 30 * 60000 } : null;
      room.invalidateEnv();
      room.broadcast({ t: 'env', env: room.env() });
      reply(room.weatherOverride ? `Weather set to ${w} for 30 minutes.` : 'Weather back to normal.');
      break;
    }
    case 'season': {
      // Applies to the island and its interiors (and is reflected in fish, weather & visuals).
      const base = room?.interior ? game.rooms.get(room.interior.parentId) : room;
      if (!room || !base) return;
      const model = BIOMES[base.biome].seasonModel;
      const want = args[0] as Season;
      const valid = SEASONS_BY_MODEL[model].includes(want);
      for (const r of game.rooms.values()) {
        if (r !== base && r.interior?.parentId !== base.id) continue;
        r.seasonOverride = valid ? want : null;
        r.invalidateEnv();
        r.broadcast({ t: 'env', env: r.env() });
      }
      reply(valid ? `Season forced to ${want}.` : `Season back to the real calendar (valid here: ${SEASONS_BY_MODEL[model].join(', ')}).`);
      break;
    }
    case 'tp': {
      if (!room) return;
      const x = n(0, s.x), z = n(1, s.z);
      if (!room.grid.walkable(x, z)) return reply('Can\u2019t stand there.');
      s.x = x;
      s.z = z;
      s.moved = true;
      s.send({ t: 'corr', x, z });
      break;
    }
  }
  game.store.markPlayer(p.id);
  sendInv(game, s);
}
