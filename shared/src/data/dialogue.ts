// Trigger-based villager dialogue. Rules are edited in the game creation tool
// (Dialogue table). When a player talks to a villager, the server builds a
// DialogueContext and every rule whose speaker filter and triggers match is a
// candidate; the highest priority wins. A rule can replace the generic line or
// be added before / after it.

import { hashMany } from '../rng.ts';
import type { BiomeId, Season, Weather } from './biomes.ts';
import { VILLAGERS, type Personality, type Species, type VillagerDef } from './villagers.ts';

// ── Events ──────────────────────────────────────────────────────────────────

export const DIALOGUE_EVENTS = [
  // Calendar
  { id: 'own_birthday', label: 'Speaker’s birthday', group: 'Calendar' },
  { id: 'neighbor_birthday', label: 'A neighbour’s birthday ({neighbor})', group: 'Calendar' },
  { id: 'island_anniversary', label: 'Island founding anniversary', group: 'Calendar' },
  { id: 'new_year', label: 'New Year’s Day (01-01)', group: 'Holidays' },
  { id: 'valentines', label: 'Valentine’s Day (02-14)', group: 'Holidays' },
  { id: 'april_fools', label: 'April Fools’ (04-01)', group: 'Holidays' },
  { id: 'easter', label: 'Easter Sunday', group: 'Holidays' },
  { id: 'summer_solstice', label: 'Midsummer (06-21)', group: 'Holidays' },
  { id: 'halloween', label: 'Halloween (10-31)', group: 'Holidays' },
  { id: 'christmas_eve', label: 'Christmas Eve (12-24)', group: 'Holidays' },
  { id: 'christmas', label: 'Christmas Day (12-25)', group: 'Holidays' },
  { id: 'new_years_eve', label: 'New Year’s Eve (12-31)', group: 'Holidays' },
  { id: 'full_moon', label: 'Full moon', group: 'Sky' },
  { id: 'new_moon', label: 'New moon', group: 'Sky' },
  { id: 'aurora', label: 'Aurora in the sky (at night)', group: 'Sky' },
  // Relationship with the player
  { id: 'first_meeting', label: 'First time meeting the player', group: 'Player' },
  { id: 'level_up', label: 'Friendship just levelled up', group: 'Player' },
  { id: 'gifted_today', label: 'Player already gave a gift today', group: 'Player' },
  // Island life
  { id: 'construction', label: 'Something is being built', group: 'Island' },
  { id: 'new_arrival', label: 'Speaker moved in recently (3 days)', group: 'Island' },
  { id: 'neighbor_new_arrival', label: 'A neighbour moved in recently ({neighbor})', group: 'Island' },
  { id: 'alone', label: 'Speaker is the only villager', group: 'Island' },
] as const;
export type DialogueEvent = (typeof DIALOGUE_EVENTS)[number]['id'];
export const DIALOGUE_EVENT_IDS = DIALOGUE_EVENTS.map((e) => e.id) as DialogueEvent[];

// ── Triggers ────────────────────────────────────────────────────────────────

export type DialogueTrigger = { not?: boolean } & (
  | { k: 'date'; from: string; to?: string }
  | { k: 'weekday'; days: number[] }
  | { k: 'time'; from: number; to: number }
  | { k: 'season'; seasons: Season[] }
  | { k: 'weather'; weather: Weather[] }
  | { k: 'temp'; min?: number; max?: number }
  | { k: 'event'; event: DialogueEvent }
  | { k: 'neighbor'; villager: string; where: 'island' | 'nearby' }
  | { k: 'friendship'; min?: number; max?: number }
  | { k: 'islandDay'; min?: number; max?: number }
  | { k: 'building'; building: string; state: 'built' | 'building' | 'none' }
  | { k: 'item'; item: string }
  | { k: 'hat'; item: string }
  | { k: 'player'; who: 'owner' | 'resident' | 'visitor' }
  | { k: 'place'; where: 'outdoors' | 'indoors' }
  | { k: 'biome'; biomes: BiomeId[] }
);
export type TriggerKind = DialogueTrigger['k'];

/** Editor metadata for every trigger kind (label, group, a fresh instance). */
export const TRIGGER_KINDS: { k: TriggerKind; label: string; icon: string; group: string; blank: () => DialogueTrigger }[] = [
  { k: 'date', label: 'Date', icon: '📅', group: 'When', blank: () => ({ k: 'date', from: '12-01', to: '12-31' }) },
  { k: 'weekday', label: 'Day of week', icon: '🗓️', group: 'When', blank: () => ({ k: 'weekday', days: [0, 6] }) },
  { k: 'time', label: 'Time of day', icon: '🕒', group: 'When', blank: () => ({ k: 'time', from: 6, to: 11 }) },
  { k: 'season', label: 'Season', icon: '🍂', group: 'When', blank: () => ({ k: 'season', seasons: ['autumn'] }) },
  { k: 'event', label: 'Event', icon: '🎉', group: 'When', blank: () => ({ k: 'event', event: 'halloween' }) },
  { k: 'weather', label: 'Weather', icon: '🌦️', group: 'Weather', blank: () => ({ k: 'weather', weather: ['rain'] }) },
  { k: 'temp', label: 'Temperature', icon: '🌡️', group: 'Weather', blank: () => ({ k: 'temp', max: 0 }) },
  { k: 'neighbor', label: 'Neighbour', icon: '🏡', group: 'Who', blank: () => ({ k: 'neighbor', villager: 'any', where: 'island' }) },
  { k: 'friendship', label: 'Friendship level', icon: '💗', group: 'Who', blank: () => ({ k: 'friendship', min: 2 }) },
  { k: 'player', label: 'Player is…', icon: '🧑', group: 'Who', blank: () => ({ k: 'player', who: 'visitor' }) },
  { k: 'item', label: 'Player carries item', icon: '🎒', group: 'Who', blank: () => ({ k: 'item', item: 'apple' }) },
  { k: 'hat', label: 'Player wears hat', icon: '👒', group: 'Who', blank: () => ({ k: 'hat', item: 'straw_hat' }) },
  { k: 'islandDay', label: 'Island day', icon: '📆', group: 'Where', blank: () => ({ k: 'islandDay', min: 1, max: 7 }) },
  { k: 'building', label: 'Building', icon: '🏠', group: 'Where', blank: () => ({ k: 'building', building: 'restaurant', state: 'built' }) },
  { k: 'place', label: 'Indoors / outdoors', icon: '🚪', group: 'Where', blank: () => ({ k: 'place', where: 'indoors' }) },
  { k: 'biome', label: 'Biome', icon: '🗺️', group: 'Where', blank: () => ({ k: 'biome', biomes: ['nordic'] as BiomeId[] }) },
];

// ── Rules ───────────────────────────────────────────────────────────────────

export interface DialogueReply {
  /** What the player can say. */
  text: string;
  /** The villager's answer. */
  answer: string;
}

export interface DialogueRule {
  id: string;
  /** Editor-only description. */
  note?: string;
  disabled?: boolean;
  /** Who can say it. Empty / missing = no restriction. All given filters must match. */
  villagers?: string[];
  personalities?: Personality[];
  species?: Species[];
  /** 'all' (default): every trigger must match; 'any': one is enough. */
  match?: 'all' | 'any';
  when: DialogueTrigger[];
  /** Variants (one is picked). A newline inside a variant starts a new page. */
  lines: string[];
  /** Optional answers the player can pick after the last page. */
  replies?: DialogueReply[];
  /** Higher wins. The generic personality lines count as 0. */
  priority: number;
  /** Percent chance (1–100) to be eligible on a given day. Default 100. */
  chance?: number;
  /** Replace the generic line (default), or add before / after it. */
  mode?: 'replace' | 'before' | 'after';
}

export const DIALOGUE_PLACEHOLDERS = [
  ['{name}', 'Speaker’s name'],
  ['{cp}', 'Catchphrase'],
  ['{player}', 'Player’s name'],
  ['{neighbor}', 'Matched neighbour (or a random one)'],
  ['{island}', 'Island name'],
  ['{weather}', 'Weather'],
  ['{season}', 'Season'],
  ['{temp}', 'Temperature (°C)'],
  ['{weekday}', 'Day of the week'],
  ['{day}', 'Island day number'],
] as const;

export const DIALOGUE: DialogueRule[] = [
  {
    id: 'dlg_first_meeting', note: 'First meeting', when: [{ k: 'event', event: 'first_meeting' }], priority: 90,
    lines: ['Oh! A new face! I’m {name}.\nWelcome to {island}, {player}. I hope you’ll like it here, {cp}!'],
    replies: [{ text: 'Nice to meet you!', answer: 'Likewise! Come chat any time, {cp}.' }, { text: 'Who are you again?', answer: '{name}! Don’t forget it, {cp}!' }],
  },
  {
    id: 'dlg_level_up', note: 'Friendship levelled up', when: [{ k: 'event', event: 'level_up' }], priority: 85,
    lines: ['You know, {player}... I feel like we’re getting really close.\nThanks for always stopping by, {cp}.'],
  },
  {
    id: 'dlg_neighbor_birthday', note: 'Neighbour birthday reminder', when: [{ k: 'event', event: 'neighbor_birthday' }], priority: 60, mode: 'after',
    lines: ['Psst – it’s {neighbor}’s birthday today! Have you said hi?', 'Did you know today is {neighbor}’s birthday? I baked something!'],
  },
  {
    id: 'dlg_new_neighbor', note: 'Gossip about a new neighbour', when: [{ k: 'event', event: 'neighbor_new_arrival' }], priority: 40,
    lines: ['Have you met {neighbor} yet? They just moved in!', 'A new neighbour! {neighbor} seems nice, {cp}.'],
  },
  {
    id: 'dlg_halloween', note: 'Halloween', when: [{ k: 'event', event: 'halloween' }], priority: 70,
    lines: ['Boo! Ha, did I scare you, {player}? Happy Halloween, {cp}!', 'Trick or treat! ...I’ll take the treat, {cp}.'],
  },
  {
    id: 'dlg_christmas', note: 'Christmas Day', when: [{ k: 'event', event: 'christmas' }], priority: 70,
    lines: ['Merry Christmas, {player}! I hope you got something cozy, {cp}.'],
  },
  {
    id: 'dlg_new_year', note: 'New Year (eve and day)', match: 'any', when: [{ k: 'event', event: 'new_year' }, { k: 'event', event: 'new_years_eve' }], priority: 70,
    lines: ['A whole new year on {island}! What’s your resolution, {player}?'],
    replies: [{ text: 'Catch every fish!', answer: 'Ambitious! I’ll cheer you on, {cp}.' }, { text: 'More naps.', answer: 'A person of culture, {cp}.' }],
  },
  {
    id: 'dlg_full_moon_wolves', note: 'Wolves howl at the full moon', species: ['wolf'], when: [{ k: 'event', event: 'full_moon' }, { k: 'time', from: 19, to: 5 }], priority: 65,
    lines: ['The moon is full tonight... AWOOOO! ...Ahem. You didn’t hear that.'],
  },
  {
    id: 'dlg_shy_storm', note: 'Shy villagers are scared of storms', personalities: ['shy'], when: [{ k: 'weather', weather: ['storm'] }], priority: 30,
    lines: ['Th-the thunder is so loud...\nCould you stay and chat a little longer, {player}?'],
  },
  {
    id: 'dlg_cold_snap', note: 'Complaining about the cold', when: [{ k: 'temp', max: -5 }, { k: 'place', where: 'outdoors' }], priority: 20, mode: 'after', chance: 50,
    lines: ['Brr, it’s {temp} out here!', 'My whiskers are frozen solid!'],
  },
  {
    id: 'dlg_maple_bruno', note: 'Maple plans a picnic for Bruno', villagers: ['v_maple'], when: [{ k: 'neighbor', villager: 'v_bruno', where: 'nearby' }], priority: 25,
    lines: ['Shh! {neighbor} is right over there. I’m planning a surprise picnic for him, {cp}!'],
  },
  {
    id: 'dlg_weekend_sporty', note: 'Sporty weekend workouts', personalities: ['sporty'], when: [{ k: 'weekday', days: [0, 6] }, { k: 'time', from: 6, to: 10 }], priority: 15,
    lines: ['Weekend morning workout! Twenty laps around {island}, {cp}!'],
  },
  {
    id: 'dlg_visitor', note: 'Greeting visitors', when: [{ k: 'player', who: 'visitor' }], priority: 10, mode: 'before', chance: 60,
    lines: ['Oh, a visitor!', 'Welcome to {island}!'],
  },
];

// ── Context & evaluation ────────────────────────────────────────────────────

export interface DialogueNeighbor {
  id: string;
  /** Distance to the speaker in tiles (undefined when not in the same place). */
  dist?: number;
  birthday?: boolean;
  newArrival?: boolean;
}

export interface DialogueContext {
  speaker: VillagerDef;
  /** Friendship level 0..4 with the player. */
  level: number;
  player: string;
  island: string;
  /** Local date YYYY-MM-DD. */
  dayKey: string;
  hour: number;
  weather: Weather;
  season: Season;
  tempC: number;
  aurora: boolean;
  biome: BiomeId;
  islandDay: number;
  /** YYYY-MM-DD the island was founded. */
  foundedDayKey?: string;
  /** Other villagers living on the island. */
  neighbors: DialogueNeighbor[];
  /** Building type → state. Missing = none on the island. */
  buildings: Record<string, 'built' | 'building'>;
  inventory: Record<string, number>;
  hat: string | null;
  role: 'owner' | 'resident' | 'visitor';
  place: 'outdoors' | 'indoors';
  /** State-based events the caller knows about (first_meeting, level_up, gifted_today, construction, new_arrival). */
  flags: DialogueEvent[];
  /** Deterministic per player/villager/day. */
  seed: number;
  /** Changes with every chat, so repeated chats can pick other variants. */
  nonce?: number;
}

export const NEARBY_TILES = 8;
const FIXED_HOLIDAYS: Record<string, DialogueEvent> = {
  '01-01': 'new_year', '02-14': 'valentines', '04-01': 'april_fools', '06-21': 'summer_solstice',
  '10-31': 'halloween', '12-24': 'christmas_eve', '12-25': 'christmas', '12-31': 'new_years_eve',
};

/** Easter Sunday (Gregorian, anonymous algorithm) as MM-DD. */
export function easterDate(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Moon age in days (0 = new, ~14.8 = full) at local noon of a day. */
export function moonAge(dayKey: string): number {
  const ms = Date.parse(`${dayKey}T12:00:00Z`);
  const ref = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
  const syn = 29.530588853;
  return ((((ms - ref) / 86400000) % syn) + syn) % syn;
}

export function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00Z`).getUTCDay();
}
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Every event active in this context, with the neighbour each refers to. */
export function activeEvents(ctx: DialogueContext): Map<DialogueEvent, string | undefined> {
  const out = new Map<DialogueEvent, string | undefined>();
  const md = ctx.dayKey.slice(5);
  if (md === ctx.speaker.birthday) out.set('own_birthday', undefined);
  const bday = ctx.neighbors.filter((n) => n.birthday);
  if (bday.length) out.set('neighbor_birthday', bday[ctx.seed % bday.length].id);
  const fresh = ctx.neighbors.filter((n) => n.newArrival);
  if (fresh.length) out.set('neighbor_new_arrival', fresh[ctx.seed % fresh.length].id);
  if (!ctx.neighbors.length) out.set('alone', undefined);
  if (FIXED_HOLIDAYS[md]) out.set(FIXED_HOLIDAYS[md], undefined);
  if (md === easterDate(Number(ctx.dayKey.slice(0, 4)))) out.set('easter', undefined);
  if (ctx.foundedDayKey && ctx.foundedDayKey.slice(5) === md && ctx.foundedDayKey < ctx.dayKey) out.set('island_anniversary', undefined);
  const age = moonAge(ctx.dayKey);
  if (Math.abs(age - 14.77) <= 1) out.set('full_moon', undefined);
  if (age <= 1 || age >= 28.5) out.set('new_moon', undefined);
  if (ctx.aurora && (ctx.hour >= 19 || ctx.hour < 6)) out.set('aurora', undefined);
  for (const f of ctx.flags) if (!out.has(f)) out.set(f, undefined);
  return out;
}

const inHours = (h: number, from: number, to: number) => (from <= to ? h >= from && h < to : h >= from || h < to);
const inDates = (md: string, from: string, to = from) => (from <= to ? md >= from && md <= to : md >= from || md <= to);
const inRange = (v: number, min?: number, max?: number) => (min === undefined || v >= min) && (max === undefined || v <= max);

/** Does one trigger hold? Sets `hit.neighbor` when it refers to a neighbour. */
export function triggerHolds(t: DialogueTrigger, ctx: DialogueContext, events: Map<DialogueEvent, string | undefined>, hit: { neighbor?: string }): boolean {
  const res = ((): boolean => {
    switch (t.k) {
      case 'date': return inDates(ctx.dayKey.slice(5), t.from, t.to);
      case 'weekday': return t.days.includes(weekdayOf(ctx.dayKey));
      case 'time': return inHours(ctx.hour, t.from, t.to);
      case 'season': return t.seasons.includes(ctx.season);
      case 'weather': return t.weather.includes(ctx.weather);
      case 'temp': return inRange(ctx.tempC, t.min, t.max);
      case 'event': {
        if (!events.has(t.event)) return false;
        const n = events.get(t.event);
        if (n && !t.not) hit.neighbor ??= n;
        return true;
      }
      case 'neighbor': {
        const pool = ctx.neighbors.filter((n) => (t.villager === 'any' || n.id === t.villager) && (t.where === 'island' || (n.dist !== undefined && n.dist <= NEARBY_TILES)));
        if (!pool.length) return false;
        if (!t.not) hit.neighbor ??= pool[ctx.seed % pool.length].id;
        return true;
      }
      case 'friendship': return inRange(ctx.level, t.min, t.max);
      case 'islandDay': return inRange(ctx.islandDay, t.min, t.max);
      case 'building': return t.state === 'none' ? !ctx.buildings[t.building] : ctx.buildings[t.building] === t.state;
      case 'item': return (ctx.inventory[t.item] ?? 0) > 0;
      case 'hat': return ctx.hat === t.item;
      case 'player': return ctx.role === t.who;
      case 'place': return ctx.place === t.where;
      case 'biome': return t.biomes.includes(ctx.biome);
    }
  })();
  return t.not ? !res : res;
}

export function speakerMatches(r: DialogueRule, v: VillagerDef): boolean {
  if (r.villagers?.length && !r.villagers.includes(v.id)) return false;
  if (r.personalities?.length && !r.personalities.includes(v.personality)) return false;
  if (r.species?.length && !r.species.includes(v.species)) return false;
  return true;
}

export interface RuleCheck {
  rule: DialogueRule;
  ok: boolean;
  /** Why it didn't match (for the editor's simulator). */
  why?: string;
  neighbor?: string;
}

/** Check every rule against a context (used by the server and the editor). */
export function checkRules(rules: DialogueRule[], ctx: DialogueContext): RuleCheck[] {
  const events = activeEvents(ctx);
  return rules.map((rule): RuleCheck => {
    if (rule.disabled) return { rule, ok: false, why: 'disabled' };
    if (!speakerMatches(rule, ctx.speaker)) return { rule, ok: false, why: 'not this villager' };
    if (!rule.lines.some((l) => l.trim())) return { rule, ok: false, why: 'no lines' };
    const hit: { neighbor?: string } = {};
    const results = rule.when.map((t) => triggerHolds(t, ctx, events, hit));
    const pass = rule.when.length === 0 || (rule.match === 'any' ? results.some(Boolean) : results.every(Boolean));
    if (!pass) {
      const failed = rule.when.filter((_, i) => !results[i]).map((t) => TRIGGER_KINDS.find((x) => x.k === t.k)?.label ?? t.k);
      return { rule, ok: false, why: `trigger: ${failed.join(', ')}` };
    }
    const chance = rule.chance ?? 100;
    if (chance < 100 && hashMany(ctx.seed, rule.id) % 100 >= chance) return { rule, ok: false, why: `chance (${chance}%) missed today` };
    return { rule, ok: true, neighbor: hit.neighbor };
  });
}

export interface DialogueResult {
  line: string;
  replies?: DialogueReply[];
  /** Rules used (main, extra). */
  used: string[];
}

function pick<T>(list: T[], n: number): T {
  return list[Math.abs(n) % list.length];
}

function best(list: RuleCheck[], seed: number): RuleCheck | undefined {
  if (!list.length) return undefined;
  const top = Math.max(...list.map((c) => c.rule.priority));
  return pick(list.filter((c) => c.rule.priority === top), seed);
}

/** Fill {placeholders} in a line. */
export function fillDialogue(text: string, ctx: DialogueContext, neighbor?: string): string {
  const nId = neighbor ?? (ctx.neighbors.length ? pick(ctx.neighbors, ctx.seed).id : undefined);
  const nName = nId ? VILLAGERS.find((v) => v.id === nId)?.name ?? 'a friend' : 'a friend';
  const vars: Record<string, string> = {
    name: ctx.speaker.name, cp: ctx.speaker.catchphrase, player: ctx.player, neighbor: nName, island: ctx.island,
    weather: ctx.weather, season: ctx.season, temp: `${Math.round(ctx.tempC)}°C`, weekday: WEEKDAYS[weekdayOf(ctx.dayKey)], day: String(ctx.islandDay),
  };
  // Tidy doubled punctuation from catchphrases like "yip!" ("yip!!" → "yip!").
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m).replace(/([!?])[.!]+/g, '$1');
}

/**
 * Pick the dialogue for a chat. `base` is the generic personality line; it is
 * used when no rule replaces it.
 */
export function composeDialogue(rules: DialogueRule[], ctx: DialogueContext, base: string): DialogueResult {
  const ok = checkRules(rules, ctx).filter((c) => c.ok);
  const vary = ctx.seed + (ctx.nonce ?? 0);
  const main = best(ok.filter((c) => (c.rule.mode ?? 'replace') === 'replace'), ctx.seed);
  const extra = best(ok.filter((c) => c.rule.mode === 'before' || c.rule.mode === 'after'), ctx.seed >>> 3);
  const lineOf = (c: RuleCheck) => fillDialogue(pick(c.rule.lines.filter((l) => l.trim()), vary), ctx, c.neighbor);
  let line = main ? lineOf(main) : base;
  if (extra) line = extra.rule.mode === 'before' ? `${lineOf(extra)}\n${line}` : `${line}\n${lineOf(extra)}`;
  const src = main?.rule.replies?.length ? main : extra?.rule.replies?.length ? extra : undefined;
  const replies = src?.rule.replies?.map((r) => ({ text: fillDialogue(r.text, ctx, src.neighbor), answer: fillDialogue(r.answer, ctx, src.neighbor) }));
  return { line, replies, used: [main?.rule.id, extra?.rule.id].filter((x): x is string => !!x) };
}
