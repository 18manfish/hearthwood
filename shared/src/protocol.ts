// Wire protocol. Clients only ever send *intents*; the server validates each
// one against authoritative state and answers with results + state deltas.

import { s, type Parser } from './schema.ts';
import { isBiome, type BiomeId, type Season, type Weather } from './data/biomes.ts';
import { isItem } from './data/items.ts';
import { isBuildingType, type BuildingType } from './data/buildings.ts';
import type { Building, WorldObject } from './world.ts';
import type { InteriorStyle, InteriorTheme } from './interiors.ts';

export const PROTOCOL_VERSION = 7;

// ── Character ─────────────────────────────────────────────────────────────
export type Gender = 'boy' | 'girl';
export const HAIR_STYLES = {
  boy: ['short', 'spiky', 'curly', 'buzz'],
  girl: ['long', 'ponytail', 'bob', 'pigtails'],
} as const;
export type HairStyle = (typeof HAIR_STYLES)[Gender][number];
export const ALL_HAIR: readonly string[] = [...HAIR_STYLES.boy, ...HAIR_STYLES.girl];

export const SKIN_TONES = ['#fde0c8', '#f1c27d', '#d39b6a', '#a8714a', '#7a4a2a', '#5a3620'];
export const HAIR_COLORS = ['#2b1d14', '#5a3a1e', '#a0522d', '#e0b04a', '#f2e2b5', '#c23b22', '#3b5bdb', '#e86fae', '#7c7c7c'];
export const EYE_COLORS = ['#2b1d14', '#3b6db3', '#3f8f4a', '#8a5a2b', '#6b4fa0'];
export const CLOTH_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ecf0f1', '#34495e', '#ff8fb1', '#8d6e63'];

export interface Look {
  skin: string;
  hair: string;
  hairColor: string;
  eyes: string;
  shirt: string;
  pants: string;
  shoes: string;
}

export type Access = 'private' | 'friends' | 'invite' | 'public';

export const DEV_COMMANDS = ['kit', 'give', 'coins', 'day', 'finish', 'respawn', 'weather', 'season', 'tp', 'clearinv'] as const;
export type DevCommand = (typeof DEV_COMMANDS)[number];
export const ACCESS_LEVELS: Access[] = ['private', 'friends', 'invite', 'public'];

const color = s.str(4, 9, /^#[0-9a-fA-F]{3,8}$/);
export const NAME_RE = /^[\p{L}\p{N} _.'-]{2,16}$/u;

export const lookParser: Parser<Look> = s.obj({
  skin: color, hair: s.oneOf(ALL_HAIR as string[]), hairColor: color, eyes: color, shirt: color, pants: color, shoes: color,
});

// ── Actions ───────────────────────────────────────────────────────────────
const id = s.str(1, 40, /^[A-Za-z0-9_\-]+$/);
const tileCoord = s.int(0, 255);
const itemId = s.guard(isItem, 'item');
const qty = s.int(1, 999);

export const actionParser = s.union('k', {
  chop: s.obj({ k: s.lit('chop'), id }),
  dig: s.obj({ k: s.lit('dig'), id }),
  hit: s.obj({ k: s.lit('hit'), id }),
  forage: s.obj({ k: s.lit('forage'), id }),
  shake: s.obj({ k: s.lit('shake'), id }),
  plant: s.obj({ k: s.lit('plant'), x: tileCoord, z: tileCoord }),
  cast: s.obj({ k: s.lit('cast'), x: tileCoord, z: tileCoord }),
  reel: s.obj({ k: s.lit('reel'), castId: id }),
  craft: s.obj({ k: s.lit('craft'), recipe: id, n: s.opt(s.int(1, 20)) }),
  build: s.obj({ k: s.lit('build'), type: s.guard(isBuildingType, 'building'), x: tileCoord, z: tileCoord }),
  demolish: s.obj({ k: s.lit('demolish'), id }),
  place: s.obj({ k: s.lit('place'), item: itemId, x: tileCoord, z: tileCoord, rot: s.int(0, 3) }),
  pickup: s.obj({ k: s.lit('pickup'), id }),
  talk: s.obj({ k: s.lit('talk'), vid: id }),
  gift: s.obj({ k: s.lit('gift'), vid: id, item: itemId }),
  buy: s.obj({ k: s.lit('buy'), shop: s.guard(isBuildingType, 'building'), item: itemId, n: s.int(1, 99) }),
  sell: s.obj({ k: s.lit('sell'), item: itemId, n: qty }),
  wear: s.obj({ k: s.lit('wear'), item: s.nullable(itemId) }),
  restyle: s.obj({ k: s.lit('restyle'), look: lookParser }),
  mail: s.obj({ k: s.lit('mail'), to: id, text: s.str(0, 280), item: s.opt(itemId), n: s.opt(qty) }),
  takeMail: s.obj({ k: s.lit('takeMail'), mailId: id }),
  pave: s.obj({ k: s.lit('pave'), x: tileCoord, z: tileCoord, path: s.int(1, 5) }),
  unpave: s.obj({ k: s.lit('unpave'), x: tileCoord, z: tileCoord }),
});
export type Action = ReturnType<typeof actionParser>;
export type ActionKind = Action['k'];

// ── Client → Server ────────────────────────────────────────────────────────
const travelTarget = s.union('kind', {
  home: s.obj({ kind: s.lit('home') }),
  shared: s.obj({ kind: s.lit('shared'), id }),
  island: s.obj({ kind: s.lit('island'), id }),
  code: s.obj({ kind: s.lit('code'), code: s.str(4, 12, /^[A-Za-z0-9]+$/) }),
  tour: s.obj({ kind: s.lit('tour') }),
  enter: s.obj({ kind: s.lit('enter'), id }),
  exit: s.obj({ kind: s.lit('exit') }),
});
export type TravelTarget = ReturnType<typeof travelTarget>;

export const clientMessageParser = s.union('t', {
  hello: s.obj({ t: s.lit('hello'), token: s.str(16, 128, /^[A-Za-z0-9_\-]+$/), v: s.int(0, 1000) }),
  create: s.obj({
    t: s.lit('create'),
    name: s.str(2, 16, NAME_RE),
    islandName: s.str(2, 20, NAME_RE),
    gender: s.oneOf(['boy', 'girl'] as const),
    look: lookParser,
    biome: s.guard(isBiome, 'biome'),
    geo: s.obj({ lat: s.num(-90, 90), lon: s.num(-180, 180), tz: s.str(1, 64, /^[A-Za-z0-9_+\-/]+$/) }),
  }),
  move: s.obj({ t: s.lit('move'), seq: s.int(0), x: s.num(-10, 300), z: s.num(-10, 300), r: s.num(-1e6, 1e6) }),
  act: s.obj({ t: s.lit('act'), seq: s.int(0), a: actionParser }),
  travel: s.obj({ t: s.lit('travel'), to: travelTarget }),
  chat: s.obj({ t: s.lit('chat'), text: s.str(1, 140) }),
  friend: s.obj({
    t: s.lit('friend'),
    op: s.oneOf(['request', 'accept', 'decline', 'remove', 'cancel'] as const),
    code: s.opt(s.str(4, 12, /^[A-Za-z0-9]+$/)),
    id: s.opt(id),
  }),
  access: s.obj({ t: s.lit('access'), access: s.oneOf(ACCESS_LEVELS) }),
  newInvite: s.obj({ t: s.lit('newInvite') }),
  kick: s.obj({ t: s.lit('kick'), id }),
  map: s.obj({ t: s.lit('map') }),
  ping: s.obj({ t: s.lit('ping'), ct: s.num() }),
  /** Billboard: pin a note / take down one of your own. */
  board: s.obj({ t: s.lit('board'), op: s.oneOf(['post', 'delete'] as const), text: s.opt(s.str(1, 140)), id: s.opt(id) }),
  /** Developer commands – rejected unless the server runs with DEV_FAST=1. */
  dev: s.obj({ t: s.lit('dev'), cmd: s.oneOf(DEV_COMMANDS), args: s.arr(s.str(0, 40, /^[A-Za-z0-9_.\-]*$/), 4) }),
});
export type ClientMessage = ReturnType<typeof clientMessageParser>;

// ── Server → Client ────────────────────────────────────────────────────────
export interface PlayerView {
  id: string;
  name: string;
  gender: Gender;
  look: Look;
  hat: string | null;
  x: number;
  z: number;
  r: number;
}

export interface VillagerView {
  id: string; // villager def id
  houseId: string;
  x: number;
  z: number;
  r: number;
  home: boolean; // indoors (night)
}

export interface EnvView {
  season: Season;
  weather: Weather;
  tempC: number;
  hour: number;
  minute: number;
  dayKey: string;
  islandDay: number;
  intensity: number;
  aurora: boolean;
  geo: { lat: number; lon: number; tz: string };
}

export interface RoomView {
  id: string;
  kind: 'island' | 'shared' | 'tour' | 'interior';
  /** For interiors: which style, and its colours. */
  interior?: InteriorStyle;
  theme?: InteriorTheme;
  name: string;
  biome: BiomeId;
  ownerId: string | null;
  ownerName: string | null;
  size: number;
  tiles: string;
  /** Cliff level per tile (digits). */
  levels: string;
  /** Ramp direction + 1 per tile (digits, 0 = none). */
  ramps: string;
  /** Path type per tile (digits, 0 = none). */
  paths: string;
  objects: WorldObject[];
  buildings: Building[];
  villagers: VillagerView[];
  players: PlayerView[];
  spawn: { x: number; z: number };
  /** What the viewer is allowed to do here. */
  canHarvest: boolean;
  canBuild: boolean;
  /** Place / pick up furniture (own island and its interiors). */
  canDecorate: boolean;
  /** Notes pinned to this location's billboard (if it has one), newest first. */
  board?: BoardPost[];
}

export interface BoardPost {
  id: string;
  by: string;
  name: string;
  text: string;
  at: number;
}

export interface MailView {
  id: string;
  from: string;
  fromName: string;
  text: string;
  item?: string;
  n?: number;
  at: number;
}

export interface FriendView {
  id: string;
  name: string;
  code: string;
  online: boolean;
  islandId: string | null;
}

export interface SelfView {
  id: string;
  name: string;
  code: string;
  gender: Gender;
  look: Look;
  hat: string | null;
  homeIslandId: string | null;
  islandName: string | null;
  biome: BiomeId | null;
  access: Access;
  inviteCode: string | null;
  coins: number;
  inv: Record<string, number>;
}

export interface QuestView {
  chapter: number; // 1-based, CHAPTERS.length + 1 = all done
  done: boolean[];
  islandDay: number;
  villagers: number;
}

export interface MapIsland {
  id: string;
  name: string;
  owner: string;
  biome: BiomeId;
  x: number;
  y: number;
  access: Access;
  friend: boolean;
  mine: boolean;
  online: boolean;
  visitors: number;
}

export interface TalkView {
  vid: string;
  line: string;
  points: number;
  level: number;
  levelName: string;
  next?: number;
  talkedToday: boolean;
  giftedToday: boolean;
  reaction?: 'love' | 'like' | 'neutral' | 'dislike';
}

export type ServerMessage =
  | { t: 'welcome'; you: SelfView | null; serverTime: number; dev: boolean }
  | { t: 'err'; code: string; msg: string }
  | { t: 'room'; room: RoomView; env: EnvView }
  | { t: 'env'; env: EnvView }
  | { t: 'pAdd'; p: PlayerView }
  | { t: 'pDel'; id: string }
  | { t: 'pLook'; id: string; look: Look; hat: string | null }
  | { t: 'ps'; l: [string, number, number, number][] }
  | { t: 'vs'; l: [string, number, number, number, 0 | 1][] }
  | { t: 'oAdd'; o: WorldObject[] }
  | { t: 'oDel'; ids: string[] }
  | { t: 'bAdd'; b: Building[] }
  | { t: 'bDel'; ids: string[] }
  | { t: 'vAdd'; v: VillagerView[] }
  | { t: 'paths'; l: [number, number, number][] }
  | { t: 'board'; posts: BoardPost[] }
  | { t: 'self'; you: SelfView }
  | { t: 'inv'; inv: Record<string, number>; coins: number }
  | { t: 'res'; seq: number; ok: boolean; err?: string; msg?: string; gained?: Record<string, number> }
  | { t: 'corr'; x: number; z: number }
  | { t: 'bite'; castId: string; window: number }
  | { t: 'fish'; castId: string; ok: boolean; item?: string; msg: string }
  | { t: 'chat'; from: string; name: string; text: string; sys?: boolean }
  | { t: 'friends'; list: FriendView[]; incoming: FriendView[]; outgoing: FriendView[] }
  | { t: 'map'; islands: MapIsland[] }
  | { t: 'quest'; q: QuestView }
  | { t: 'talk'; v: TalkView }
  | { t: 'mail'; list: MailView[] }
  | { t: 'toast'; text: string; kind?: 'info' | 'good' | 'warn' }
  | { t: 'pong'; ct: number; st: number };

export type { BuildingType };
