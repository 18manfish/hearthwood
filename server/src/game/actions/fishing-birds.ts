// Fishing (cast and reel) and catching birds.

import { BIRD_BY_ID, birdCatchChance, distToTile, isWaterTile, ITEMS } from '@hearthwood/shared';
import type { Session } from '../Session.ts';
import { config } from '../../config.ts';
import { spotAt, spotPool } from '../room/fish.ts';
import * as inv from '../inventory.ts';
import { fail, give, type Handlers, HARVEST_COOLDOWN_MS, log, near, recordCatch, rngFor } from './context.ts';

export const fishingBirdsHandlers: Pick<Handlers, 'cast' | 'reel' | 'catch'> = {
  cast(ctx, a) {
    if (!inv.toolPower(ctx.p, 'rod')) return fail('You need a fishing rod.');
    const t = ctx.room.grid.tile(a.x, a.z);
    if (!isWaterTile(t)) return fail('That’s not water.');
    if (distToTile(ctx.s.x, ctx.s.z, a.x, a.z) > config.castReach) return fail('Too far to cast.');
    const spot = spotAt(ctx.room, a.x, a.z);
    if (!spot) return fail('No fish there – cast next to a fish shadow.');
    ctx.s.clearCast();
    const env = ctx.room.env(ctx.now);
    const pool = spotPool(ctx.room, spot, env);
    const rng = rngFor(ctx);
    // Rain makes fish hungrier.
    const fish = rng.weighted(pool, (f) => f.rarity * (env.weather === 'rain' && f.rarity < 3 ? 2 : 1))?.id ?? null;
    const power = inv.toolPower(ctx.p, 'rod');
    const cast = {
      id: ctx.room.newId('c'),
      biteAt: ctx.now + rng.range(config.biteMinMs, config.biteMaxMs),
      window: config.biteWindowMs + (power - 1) * 400,
      fish,
      spot: spot.id,
      bitten: false,
    } as NonNullable<Session['cast']>;
    ctx.s.cast = cast;
    if (fish) {
      cast.timer = setTimeout(() => {
        if (ctx.s.cast !== cast) return;
        cast.bitten = true;
        cast.biteAt = Date.now(); // measure the window from the real send time
        ctx.s.send({ t: 'bite', castId: cast.id, window: cast.window });
        cast.timer = setTimeout(() => {
          if (ctx.s.cast === cast) {
            ctx.s.cast = null;
            ctx.s.send({ t: 'fish', castId: cast.id, ok: false, msg: 'It got away…' });
          }
        }, cast.window + config.netGraceMs + 1500);
      }, cast.biteAt - ctx.now);
    }
    return { ok: true, msg: fish ? undefined : 'Nothing seems to be biting here right now.' };
  },
  reel(ctx, a) {
    const c = ctx.s.cast;
    if (!c || c.id !== a.castId) return fail('You’re not fishing.');
    ctx.s.clearCast();
    if (!c.bitten || ctx.now < c.biteAt) return { ok: true, msg: 'Too early – the fish swam off.' };
    if (ctx.now > c.biteAt + c.window + config.netGraceMs) return { ok: true, msg: 'Too slow – it got away.' };
    const gained: Record<string, number> = {};
    if (!give(ctx, gained, c.fish!, 1)) return fail('Your pockets are full of those.');
    // The fish is out of the water: its shadow is gone.
    if (c.spot) ctx.room.removeObject(c.spot);
    const first = recordCatch(ctx, 'fish', c.fish!);
    ctx.s.send({ t: 'fish', castId: c.id, ok: true, item: c.fish!, msg: `You caught a ${ITEMS[c.fish!].name}!${first ? ' 📖 New album entry!' : ''}` });
    return { ok: true, gained };
  },
  catch(ctx, a) {
    const o = ctx.room.objects.get(a.id);
    if (!o || o.kind !== 'bird' || !o.bird) return fail('It flew away.');
    if (!near(ctx, o, config.reach + 0.4)) return fail('Too far away.');
    const net = inv.toolPower(ctx.p, 'net');
    if (!net) return fail('You need a bird net.');
    if (ctx.now - ctx.s.lastActAt < HARVEST_COOLDOWN_MS) return fail('Slow down!');
    ctx.s.lastActAt = ctx.now;
    const def = BIRD_BY_ID[o.bird];
    if (!def) return fail('It flew away.');
    if (!inv.canAdd(ctx.p, def.id, 1)) return fail('Your pockets are full of those.');
    const rng = rngFor(ctx);
    if (!rng.chance(birdCatchChance(def, net))) {
      ctx.room.removeObject(o.id, 'fly');
      return { ok: true, msg: `The ${def.name} flew off!` };
    }
    ctx.room.removeObject(o.id);
    const gained: Record<string, number> = {};
    give(ctx, gained, def.id, 1);
    const first = recordCatch(ctx, 'birds', def.id);
    log.debug('bird caught', { player: ctx.p.id, bird: def.id });
    return { ok: true, gained, msg: `You caught a ${def.name}!${first ? ' 📖 New album entry!' : ''}` };
  },
};
