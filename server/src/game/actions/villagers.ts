// Talking to villagers and giving them gifts; what dialogue rules can react to.

import {
  composeDialogue, DIALOGUE, type DialogueContext, type DialogueEvent, FRIENDSHIP_BIRTHDAY_BONUS, FRIENDSHIP_GIFT_DISLIKE, FRIENDSHIP_GIFT_LIKE, FRIENDSHIP_GIFT_LOVE, FRIENDSHIP_GIFT_NEUTRAL, FRIENDSHIP_MAX, FRIENDSHIP_TALK, friendshipLevel, hashMany, ITEMS, type TalkView, villagerDef, villagerLine,
} from '@hearthwood/shared';
import { config } from '../../config.ts';
import * as inv from '../inventory.ts';
import { type Ctx, fail, type Handlers } from './context.ts';

export const villagersHandlers: Pick<Handlers, 'talk' | 'gift'> = {
  talk(ctx, a) {
    const v = ctx.room.villagers.get(a.vid);
    const rec = ctx.room.record?.villagers.find((x) => x.defId === a.vid);
    const def = villagerDef(a.vid);
    if (!v || !rec || !def) return fail('Nobody here by that name.');
    if (v.home) return fail(`${def.name} is asleep at home.`);
    if (Math.hypot(v.x - ctx.s.x, v.z - ctx.s.z) > config.reach + 0.6) return fail('Get a little closer.');
    const env = ctx.room.env(ctx.now);
    const firstMeeting = !rec.friendship[ctx.p.id];
    const f = (rec.friendship[ctx.p.id] ??= { pts: 0 });
    const birthday = env.dayKey.slice(5) === def.birthday;
    if (f.talkDay !== env.dayKey) {
      f.talkDay = env.dayKey;
      f.pts = Math.min(FRIENDSHIP_MAX, f.pts + FRIENDSHIP_TALK);
    }
    // Villagers pause to chat.
    v.tx = v.x;
    v.tz = v.z;
    v.idleUntil = ctx.now + 8000;
    v.r = Math.atan2(ctx.s.x - v.x, ctx.s.z - v.z);
    v.dirty = true;
    const lvl = friendshipLevel(f.pts);
    const seed = hashMany(env.dayKey, ctx.p.id, a.vid);
    const base = villagerLine(def, lvl.level, { player: ctx.p.name, weather: env.weather, hour: env.hour, seed, birthday });
    const flags: DialogueEvent[] = [];
    if (firstMeeting) flags.push('first_meeting');
    if (lvl.level > (f.level ?? 0)) flags.push('level_up');
    if (f.giftDay === env.dayKey) flags.push('gifted_today');
    const dlg = composeDialogue(DIALOGUE, dialogueContext(ctx, rec.defId, lvl.level, seed, flags), base);
    ctx.game.levelUpCheck(ctx.s, ctx.room, rec.defId, f);
    ctx.game.store.markIsland(ctx.room.id);
    sendTalk(ctx, a.vid, dlg.line, f, undefined, dlg.replies);
    return { ok: true };
  },
  gift(ctx, a) {
    const v = ctx.room.villagers.get(a.vid);
    const rec = ctx.room.record?.villagers.find((x) => x.defId === a.vid);
    const def = villagerDef(a.vid);
    if (!v || !rec || !def) return fail('Nobody here by that name.');
    if (v.home) return fail(`${def.name} is asleep.`);
    if (Math.hypot(v.x - ctx.s.x, v.z - ctx.s.z) > config.reach + 0.6) return fail('Get a little closer.');
    if (inv.count(ctx.p, a.item) < 1) return fail('You don’t have that.');
    const env = ctx.room.env(ctx.now);
    const f = (rec.friendship[ctx.p.id] ??= { pts: 0 });
    if (f.giftDay === env.dayKey) return fail(`${def.name} already got a gift from you today.`);
    const it = ITEMS[a.item];
    let delta = FRIENDSHIP_GIFT_NEUTRAL;
    let reaction: TalkView['reaction'] = 'neutral';
    let line = `Oh, a ${it.name}. Thanks, ${ctx.p.name}.`;
    if (def.loves.includes(a.item)) {
      delta = FRIENDSHIP_GIFT_LOVE; reaction = 'love';
      line = `A ${it.name}?! I LOVE these! You’re the best, ${def.catchphrase}!`;
    } else if (it.tags.some((t) => def.likes.includes(t))) {
      delta = FRIENDSHIP_GIFT_LIKE; reaction = 'like';
      line = `Ooh, a ${it.name}! That’s really thoughtful, ${def.catchphrase}.`;
    } else if (it.tags.some((t) => def.dislikes.includes(t))) {
      delta = FRIENDSHIP_GIFT_DISLIKE; reaction = 'dislike';
      line = `Um... a ${it.name}. I’m not really into those, ${def.catchphrase}.`;
    }
    if (env.dayKey.slice(5) === def.birthday && delta > 0) {
      delta += FRIENDSHIP_BIRTHDAY_BONUS;
      line += ' And on my birthday, too!';
    }
    inv.remove(ctx.p, a.item, 1);
    f.giftDay = env.dayKey;
    f.pts = Math.max(0, Math.min(FRIENDSHIP_MAX, f.pts + delta));
    ctx.game.levelUpCheck(ctx.s, ctx.room, rec.defId, f);
    ctx.game.store.markIsland(ctx.room.id);
    sendTalk(ctx, a.vid, line, f, reaction);
    return { ok: true };
  },
};

function sendTalk(ctx: Ctx, vid: string, line: string, f: { pts: number; talkDay?: string; giftDay?: string }, reaction?: TalkView['reaction'], replies?: TalkView['replies']) {
  const env = ctx.room.env(ctx.now);
  const lvl = friendshipLevel(f.pts);
  ctx.s.send({
    t: 'talk',
    v: { vid, line, points: f.pts, level: lvl.level, levelName: lvl.name, next: lvl.next, talkedToday: f.talkDay === env.dayKey, giftedToday: f.giftDay === env.dayKey, reaction, replies },
  });
}

const NEW_ARRIVAL_MS = 3 * 86400000;

/** Everything the dialogue rules can react to when the player talks to `vid`. */
function dialogueContext(ctx: Ctx, vid: string, level: number, seed: number, flags: DialogueEvent[]): DialogueContext {
  const env = ctx.room.env(ctx.now);
  const rec = ctx.room.record;
  const me = ctx.room.villagers.get(vid);
  const md = env.dayKey.slice(5);
  const neighbors = (rec?.villagers ?? []).filter((v) => v.defId !== vid).map((v) => {
    const rt = ctx.room.villagers.get(v.defId);
    return {
      id: v.defId,
      dist: rt && me && !rt.home ? Math.hypot(rt.x - me.x, rt.z - me.z) : undefined,
      birthday: villagerDef(v.defId)?.birthday === md,
      newArrival: ctx.now - v.movedInAt < NEW_ARRIVAL_MS,
    };
  });
  const buildings: DialogueContext['buildings'] = {};
  for (const b of rec?.buildings ?? []) {
    const state = b.completeAt > ctx.now ? 'building' : 'built';
    if (buildings[b.type] !== 'built') buildings[b.type] = state;
    if (state === 'building' && !flags.includes('construction')) flags.push('construction');
  }
  const mine = rec?.villagers.find((v) => v.defId === vid);
  if (mine && ctx.now - mine.movedInAt < NEW_ARRIVAL_MS) flags.push('new_arrival');
  return {
    speaker: villagerDef(vid)!,
    level,
    player: ctx.p.name,
    island: rec?.name ?? ctx.room.name,
    dayKey: env.dayKey,
    hour: env.hour,
    weather: env.weather,
    season: env.season,
    tempC: env.tempC,
    aurora: env.aurora,
    biome: ctx.room.biome,
    islandDay: env.islandDay,
    foundedDayKey: rec?.foundedDayKey,
    neighbors,
    buildings,
    inventory: ctx.p.inv,
    hat: ctx.p.hat,
    role: ctx.room.isOwner(ctx.p.id) ? 'owner' : ctx.room.isResident(ctx.p.id) ? 'resident' : 'visitor',
    place: ctx.room.kind === 'interior' ? 'indoors' : 'outdoors',
    flags,
    seed,
    nonce: ctx.s.talkCount++,
  };
}
