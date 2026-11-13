// Server-side validation and execution of every player action.
// Rule of thumb: never trust the client – check ownership, distance, tools,
// inventory, cooldowns and world state before mutating anything.
// Handlers live in one file per area; this file joins them and runs one.

import type { Action } from '@hearthwood/shared';
import type { Session } from '../Session.ts';
import { buildHandlers } from './build.ts';
import { type ActionResult, type Ctx, fail, type GameApi, type Handlers } from './context.ts';
import { economyHandlers } from './economy.ts';
import { fishingBirdsHandlers } from './fishing-birds.ts';
import { gatherHandlers } from './gather.ts';
import { socialHandlers } from './social.ts';
import { terraformHandlers } from './terraform.ts';
import { villagersHandlers } from './villagers.ts';

export type { ActionResult } from './context.ts';

const handlers: Handlers = {
  ...gatherHandlers,
  ...fishingBirdsHandlers,
  ...buildHandlers,
  ...terraformHandlers,
  ...economyHandlers,
  ...villagersHandlers,
  ...socialHandlers,
};

export function runAction(game: GameApi, s: Session, a: Action): ActionResult {
  const room = s.room;
  const p = s.player;
  if (!room || !p) return fail('Not in the world.');
  const ctx: Ctx = { game, s, room, p, now: Date.now() };
  const h = handlers[a.k] as (ctx: Ctx, a: Action) => ActionResult;
  return h(ctx, a);
}
