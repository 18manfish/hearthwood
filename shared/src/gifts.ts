// Gifts in the mailbox: letters from the game (not from another player) that carry
// items and coins. Admins send them by hand, or set up automatic gifts that go out
// on their own when something happens – a new player arrives, someone logs in during
// an event, reaches a milestone, or a set date comes round.

import { BUILDINGS, isBuildingType, type BuildingType } from './data/buildings.ts';
import { ITEMS } from './data/items.ts';

/** What a gift letter says and carries. */
export interface GiftLetter {
  /** Who it's signed by, e.g. "The Hearthwood Team" or "Mayor Tom". */
  fromName: string;
  text: string;
  items: { item: string; n: number }[];
  coins: number;
}

/** How often a login gift can come again. */
export type GiftRepeat = 'once' | 'daily' | 'weekly';

/** What makes an automatic gift go out. */
export type GiftTrigger =
  /** A new player finishes making their character. */
  | { kind: 'welcome' }
  /** Being in the game (logging in, or playing on into a new day/week) – events and daily rewards. */
  | { kind: 'login'; repeat: GiftRepeat }
  /** One moment for everyone: every player gets it then, online or not. */
  | { kind: 'scheduled'; at: number }
  /** The account is this many days old. */
  | { kind: 'accountAge'; days: number }
  /** The player has finished building this on their island. */
  | { kind: 'built'; building: BuildingType }
  /** The player's story chapter reward for this chapter (or a later one) was paid. */
  | { kind: 'chapter'; chapter: number }
  /** This many fish and bird species in the journal. */
  | { kind: 'album'; count: number }
  /** This many friends. */
  | { kind: 'friends'; count: number };

export type GiftTriggerKind = GiftTrigger['kind'];

export interface GiftRule {
  id: string;
  /** For the admin list only. */
  name: string;
  enabled: boolean;
  trigger: GiftTrigger;
  letter: GiftLetter;
  /** Only goes out from / until these times (ms; optional) – for events and holidays. */
  from?: number;
  until?: number;
  createdAt: number;
  updatedAt: number;
  author: string;
  /** How many letters it has sent. */
  sent: number;
  /** A scheduled gift that has gone out. */
  fired?: boolean;
}

export const GIFT_TRIGGERS: Record<GiftTriggerKind, { name: string; help: string }> = {
  welcome: { name: 'Welcome (new player)', help: 'When a new player finishes making their character.' },
  login: { name: 'Logging in', help: 'When a player is in the game – once, or again every day or week (their own local day). Use From/Until for an event.' },
  scheduled: { name: 'On a date', help: 'At a set moment every player gets it, online or not (offline players find it at their next login).' },
  accountAge: { name: 'Account age', help: 'When a player’s account is this many days old (an anniversary).' },
  built: { name: 'Built something', help: 'When a player has finished building this on their island (also if they had it before the gift was set up).' },
  chapter: { name: 'Story chapter', help: 'When the player completes this chapter of the story (or has already).' },
  album: { name: 'Journal entries', help: 'When the player has caught this many different fish and birds.' },
  friends: { name: 'Friends', help: 'When the player has this many friends.' },
};

export const GIFT_LIMITS = { fromName: 40, text: 1000, items: 10, n: 999, coins: 1_000_000, name: 80 } as const;

const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** A gift letter from untrusted input, or a reason it's invalid. */
export function parseGiftLetter(v: unknown): GiftLetter | string {
  if (!v || typeof v !== 'object') return 'The letter is missing.';
  const o = v as Record<string, unknown>;
  const fromName = typeof o.fromName === 'string' ? o.fromName.trim() : '';
  if (!fromName || fromName.length > GIFT_LIMITS.fromName) return `Sign the letter (up to ${GIFT_LIMITS.fromName} characters).`;
  if (typeof o.text !== 'string' || o.text.length > GIFT_LIMITS.text) return `The text can be up to ${GIFT_LIMITS.text} characters.`;
  if (!Array.isArray(o.items) || o.items.length > GIFT_LIMITS.items) return `Up to ${GIFT_LIMITS.items} different items.`;
  const items: GiftLetter['items'] = [];
  for (const it of o.items as { item?: unknown; n?: unknown }[]) {
    if (!it || typeof it.item !== 'string' || !ITEMS[it.item]) return `Unknown item ${String(it?.item)}.`;
    if (!int(it.n, 1, GIFT_LIMITS.n)) return `${ITEMS[it.item].name}: 1 to ${GIFT_LIMITS.n}.`;
    const same = items.find((x) => x.item === it.item);
    if (same) same.n = Math.min(GIFT_LIMITS.n, same.n + (it.n as number));
    else items.push({ item: it.item, n: it.n as number });
  }
  const coins = o.coins ?? 0;
  if (!int(coins, 0, GIFT_LIMITS.coins)) return `Coins: 0 to ${GIFT_LIMITS.coins}.`;
  if (!items.length && !coins && !o.text.trim()) return 'The letter is empty – write something or attach a gift.';
  return { fromName, text: o.text, items, coins: coins as number };
}

/** A trigger from untrusted input, or a reason it's invalid. */
export function parseGiftTrigger(v: unknown): GiftTrigger | string {
  if (!v || typeof v !== 'object') return 'Pick what sends the gift.';
  const o = v as Record<string, unknown>;
  switch (o.kind) {
    case 'welcome':
      return { kind: 'welcome' };
    case 'login':
      return o.repeat === 'once' || o.repeat === 'daily' || o.repeat === 'weekly' ? { kind: 'login', repeat: o.repeat } : 'Once, daily or weekly?';
    case 'scheduled':
      return int(o.at, 1, 8.64e15) ? { kind: 'scheduled', at: o.at as number } : 'Pick the date and time.';
    case 'accountAge':
      return int(o.days, 1, 3650) ? { kind: 'accountAge', days: o.days as number } : 'Days: 1 to 3650.';
    case 'built':
      return typeof o.building === 'string' && isBuildingType(o.building) ? { kind: 'built', building: o.building } : 'Pick a building.';
    case 'chapter':
      return int(o.chapter, 1, 99) ? { kind: 'chapter', chapter: o.chapter as number } : 'Chapter: 1 to 99.';
    case 'album':
      return int(o.count, 1, 999) ? { kind: 'album', count: o.count as number } : 'Species: 1 to 999.';
    case 'friends':
      return int(o.count, 1, 999) ? { kind: 'friends', count: o.count as number } : 'Friends: 1 to 999.';
  }
  return 'Unknown trigger.';
}

/** A short description of a trigger, e.g. "Every day when logging in". */
export function describeGiftTrigger(t: GiftTrigger): string {
  switch (t.kind) {
    case 'welcome': return 'New players';
    case 'login': return t.repeat === 'once' ? 'Logging in (once)' : t.repeat === 'daily' ? 'Logging in, every day' : 'Logging in, every week';
    case 'scheduled': return `On ${new Date(t.at).toLocaleString()}`;
    case 'accountAge': return `Account ${t.days} day${t.days === 1 ? '' : 's'} old`;
    case 'built': return `Built a ${BUILDINGS[t.building]?.name ?? t.building}`;
    case 'chapter': return `Finished chapter ${t.chapter}`;
    case 'album': return `${t.count} journal entries`;
    case 'friends': return `${t.count} friend${t.count === 1 ? '' : 's'}`;
  }
}
