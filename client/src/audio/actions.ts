// Sounds for what the player does: the swing as the action goes out, the impact once
// the server agrees (so a refused chop doesn't sound like it landed), a soft "bonk"
// when it didn't work, and the fishing line's bite, reel and splash.

import type { Action, ServerMessage } from '@hearthwood/shared';
import { play, type PlayOpts } from './engine.ts';
import type { Effect } from './synth.ts';

type Res = Extract<ServerMessage, { t: 'res' }>;

/** Rapid repeats (painting paths, terraforming a strip) shouldn't machine-gun. */
const last = new Map<string, number>();
function once(key: string, gapMs: number) {
  const now = performance.now();
  if (now - (last.get(key) ?? 0) < gapMs) return false;
  last.set(key, now);
  return true;
}
function sfx(name: Effect, o?: PlayOpts, gapMs = 70) {
  if (once(name, gapMs)) play(name, o);
}

/** Tool actions: these get a "bonk" when refused. */
const TOOL_ACTIONS = new Set<Action['k']>(['chop', 'shake', 'dig', 'hit', 'catch', 'forage', 'plant', 'cast', 'pave', 'unpave', 'terra', 'build', 'place', 'relocate', 'pickup']);

/** The action is on its way: swing the tool. */
export function actionSent(a: Action) {
  switch (a.k) {
    case 'chop': case 'dig': case 'hit':
      return sfx('swish', { gain: 0.3, vary: 0.1 });
    case 'shake':
      return sfx('swish', { gain: 0.2, rate: 0.8 });
    case 'catch':
      return sfx('swish', { gain: 0.45, rate: 0.75 });
    case 'cast':
      // The line whips out, the bobber lands a moment later.
      sfx('swish', { gain: 0.4, rate: 0.7 });
      return play('plop', { delay: 0.38, gain: 0.7 });
    case 'reel':
      return sfx('reel', { gain: 0.6 });
  }
}

/** The server answered. */
export function actionDone(a: Action, r: Res) {
  if (!r.ok) {
    if (TOOL_ACTIONS.has(a.k)) sfx('bonk', { gain: 0.5 }, 700);
    return;
  }
  const got = !!r.gained && Object.keys(r.gained).length > 0;
  switch (a.k) {
    case 'chop':
      return sfx('chop', { vary: 0.06 });
    case 'shake':
      sfx('rustle', { gain: 0.8, vary: 0.08 });
      if (got) play('thud', { delay: 0.28, gain: 0.7 }); // something fell out
      return;
    case 'dig':
      return sfx('dig');
    case 'hit':
      return sfx('clink', { vary: 0.06 });
    case 'forage':
    case 'pickup':
      return sfx('pop', { gain: 0.8, vary: 0.1 });
    case 'catch':
      return got ? sfx('jingle', { gain: 0.8 }) : undefined;
    case 'plant':
      return sfx('pat');
    case 'pave':
      return sfx('scrape', { gain: 0.7, vary: 0.12 }, 110);
    case 'unpave':
      return sfx('scrape', { gain: 0.6, rate: 0.8, vary: 0.12 }, 110);
    case 'terra':
      if (a.op === 'water') return sfx('gurgle', { gain: 0.8 }, 150);
      if (a.op === 'land') return sfx('dig', { gain: 0.8 }, 150);
      if (a.op.startsWith('stairs')) return sfx('knock', { gain: 0.8 }, 150);
      return sfx('rumble', { gain: 0.75, vary: 0.1 }, 220);
    case 'build':
    case 'relocate':
    case 'craft':
      return sfx('hammer', { gain: a.k === 'craft' ? 0.6 : 0.8 }, 300);
    case 'place':
      return sfx('knock');
  }
}

/** A fish is tugging at the bobber. */
export function fishBite() {
  play('bite', { gain: 0.8 });
}

/** Reeled in: a splash, and a little tune if something is on the line. */
export function fishResult(ok: boolean) {
  play('splash', { gain: ok ? 0.85 : 0.6 });
  if (ok) play('jingle', { delay: 0.25, gain: 0.8 });
}
