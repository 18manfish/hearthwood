import type { Access, BiomeId, Building, Gender, Look, WorldObject, GeoInfo } from '@hearthwood/shared';

export interface MailRecord {
  id: string;
  from: string;
  fromName: string;
  text: string;
  item?: string;
  n?: number;
  at: number;
}

export interface PlayerRecord {
  id: string;
  tokenHash: string;
  name: string;
  /** Public friend code. */
  code: string;
  createdAt: number;
  lastSeen: number;
  created: boolean; // character creation finished
  gender: Gender;
  look: Look;
  hat: string | null;
  geo: GeoInfo;
  homeIslandId: string | null;
  coins: number;
  inv: Record<string, number>;
  crafted: Record<string, number>;
  friends: string[];
  reqIn: string[];
  reqOut: string[];
  mail: MailRecord[];
  /** Highest chapter whose reward was paid. */
  chapterRewarded: number;
}

export interface Friendship {
  pts: number;
  talkDay?: string;
  giftDay?: string;
  level?: number;
}

export interface VillagerRecord {
  defId: string;
  houseId: string;
  movedInAt: number;
  friendship: Record<string, Friendship>;
}

export interface Respawn {
  kind: 'rock' | 'bush' | 'tree';
  x: number;
  z: number;
  at: number;
}

export interface IslandRecord {
  /** Generator version: 1 = flat (legacy), 2 = cliffs & ramps. */
  gen?: number;
  /** Furniture placed inside the tent / house, keyed by building id. */
  interiors?: Record<string, WorldObject[]>;
  /** Pending resource respawns. */
  respawns?: Respawn[];
  id: string;
  ownerId: string;
  name: string;
  biome: BiomeId;
  seed: number;
  map: { x: number; y: number };
  createdAt: number;
  foundedDayKey: string;
  lastDayKey: string;
  access: Access;
  inviteCode: string;
  objects: WorldObject[];
  buildings: Building[];
  villagers: VillagerRecord[];
  nextId: number;
}
