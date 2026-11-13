// Crafting, permits, shopping and selling, clothes and hairstyles.

import {
  BUILDINGS, HAIR_STYLES, HOUSE_TIERS, houseLevel, ITEMS, PERMIT_BY_ID, RECIPES, SHOP_STOCK,
} from '@hearthwood/shared';
import { config } from '../../config.ts';
import * as inv from '../inventory.ts';
import { ownHouse } from '../services/progress.ts';
import { fail, give, type Handlers, log, nearCompleted } from './context.ts';

export const economyHandlers: Pick<Handlers, 'craft' | 'permit' | 'upgrade' | 'buy' | 'sell' | 'wear' | 'restyle'> = {
  craft(ctx, a) {
    const r = RECIPES.find((x) => x.id === a.recipe);
    if (!r) return fail('Unknown recipe.');
    const times = a.n ?? 1;
    if (r.station !== 'hand') {
      if (!ctx.room.ownsHere(ctx.p.id)) return fail(`Use your own ${BUILDINGS[r.station].name}.`);
      if (!nearCompleted(ctx, [r.station])) return fail(`Stand next to your ${BUILDINGS[r.station].name}.`);
    }
    const outDef = ITEMS[r.output];
    if (!inv.canAdd(ctx.p, r.output, r.qty * times)) return fail(outDef.stack === 1 ? `You already have a ${outDef.name}.` : 'You can’t carry more.');
    const need = inv.resolveIngredients(ctx.p, r.ingredients, times);
    if (!need) return fail('Missing ingredients.');
    inv.removeAll(ctx.p, need);
    const gained: Record<string, number> = {};
    give(ctx, gained, r.output, r.qty * times);
    ctx.p.crafted[r.output] = (ctx.p.crafted[r.output] ?? 0) + r.qty * times;
    return { ok: true, gained, msg: `Made ${outDef.name}${times * r.qty > 1 ? ` ×${times * r.qty}` : ''}!` };
  },
  upgrade(ctx) {
    if (!nearCompleted(ctx, ['town_hall'])) return fail('House upgrades are ordered at the Town Hall counter.');
    const island = ctx.room.interior ? ctx.game.rooms.get(ctx.room.interior.parentId) : ctx.room;
    if (!island || island.kind !== 'island' || !island.ownsHere(ctx.p.id)) return fail('Order upgrades at the Town Hall of the island you live on.');
    const house = ownHouse(island, ctx.p.id);
    if (!house || house.completeAt > ctx.now) return fail('Build your Starter House first.');
    if (house.upgrade && house.upgrade.at > ctx.now) return fail('The builders are already working on your house.');
    const cur = houseLevel(house, ctx.now);
    if (house.upgrade) {
      house.level = cur;
      delete house.upgrade;
    }
    const next = HOUSE_TIERS[cur];
    if (!next) return fail('Your house is as grand as it gets!');
    for (const req of next.requires) if (island.completedCount(req, ctx.now) < 1) return fail(`Requires a finished ${BUILDINGS[req].name}.`);
    const day = island.islandDay(ctx.now);
    if (!config.ignoreDayGates && day < next.minDay) return fail(`The ${next.name} unlocks on island day ${next.minDay} (today is day ${day}).`);
    if (ctx.p.coins < next.coins) return fail(`The ${next.name} costs ${next.coins.toLocaleString()} coins.`);
    if (!inv.removeAll(ctx.p, next.cost)) return fail('Not enough materials.');
    ctx.p.coins -= next.coins;
    house.upgrade = { level: next.level, at: ctx.now + (next.buildMinutes * 60000) / config.timeFactor };
    island.dirty = true;
    island.broadcast({ t: 'bAdd', b: [house] });
    ctx.game.store.markIsland(island.id);
    ctx.game.sendSelf(ctx.s);
    ctx.game.sendQuest(ctx.s);
    log.info('house upgrade ordered', { player: ctx.p.id, island: island.id, level: next.level });
    const mins = Math.round(next.buildMinutes / config.timeFactor);
    return { ok: true, msg: `🏗️ Upgrading to the ${next.name}! Ready in about ${mins >= 60 ? `${Math.round(mins / 60)}h` : `${Math.max(1, mins)} min`} – you can keep living in it meanwhile.` };
  },
  permit(ctx, a) {
    const def = PERMIT_BY_ID[a.id];
    if (!nearCompleted(ctx, ['town_hall'])) return fail('Permits are sold at the Town Hall counter.');
    if (!ctx.room.ownsHere(ctx.p.id)) return fail('Buy permits at your own Town Hall.');
    const owned = (ctx.p.permits ??= []);
    if (owned.includes(def.id)) return fail('You already have that permit.');
    if (ctx.p.coins < def.price) return fail(`The ${def.name} costs ${def.price} coins.`);
    ctx.p.coins -= def.price;
    owned.push(def.id);
    ctx.game.sendSelf(ctx.s);
    log.info('permit bought', { player: ctx.p.id, permit: def.id });
    return { ok: true, msg: `${def.icon} ${def.name} granted! Pick it in your hotbar or the Build menu.` };
  },
  buy(ctx, a) {
    const stock = SHOP_STOCK[a.shop];
    if (!stock || !stock.includes(a.item)) return fail('Not sold here.');
    if (ctx.room.kind !== 'island' && ctx.room.kind !== 'interior') return fail('No shop here.');
    if (!nearCompleted(ctx, [a.shop])) return fail(`Go to the counter inside the ${BUILDINGS[a.shop].name}.`);
    const price = ITEMS[a.item].buy!;
    if (!inv.canAdd(ctx.p, a.item, a.n)) return fail('You can’t carry that many.');
    if (ctx.p.coins < price * a.n) return fail('Not enough coins.');
    ctx.p.coins -= price * a.n;
    const gained: Record<string, number> = {};
    give(ctx, gained, a.item, a.n);
    return { ok: true, gained, msg: `Bought ${ITEMS[a.item].name} for ${price * a.n} coins.` };
  },
  sell(ctx, a) {
    if (!ctx.room.ownsHere(ctx.p.id)) return fail('Sell items at home.');
    if (!nearCompleted(ctx, ['tent', 'cabin', 'town_hall', 'chest'])) return fail('Sell at your storage chest or the Town Hall counter.');
    if (inv.count(ctx.p, a.item) < a.n) return fail('You don’t have that many.');
    if (ctx.p.hat === a.item && inv.count(ctx.p, a.item) <= a.n) ctx.p.hat = null;
    const price = ITEMS[a.item].sell * a.n;
    inv.remove(ctx.p, a.item, a.n);
    ctx.p.coins += price;
    return { ok: true, msg: `Sold for ${price} coins.` };
  },
  wear(ctx, a) {
    if (a.item !== null && (ITEMS[a.item].wear !== 'hat' || inv.count(ctx.p, a.item) < 1)) return fail('You can’t wear that.');
    ctx.p.hat = a.item;
    ctx.game.broadcastLook(ctx.s);
    return { ok: true };
  },
  restyle(ctx, a) {
    if (!nearCompleted(ctx, ['clothing_shop'])) return fail('Visit the counter in a Clothing Shop.');
    if (!(HAIR_STYLES[ctx.p.gender] as readonly string[]).includes(a.look.hair)) return fail('Invalid hairstyle.');
    const cost = 200;
    if (ctx.p.coins < cost) return fail(`A makeover costs ${cost} coins.`);
    ctx.p.coins -= cost;
    ctx.p.look = a.look;
    ctx.game.broadcastLook(ctx.s);
    return { ok: true, msg: 'Looking fresh!' };
  },
};
