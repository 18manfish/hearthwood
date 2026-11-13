import type { Access, Album, BiomeId, Building, Gender, Look, Outfit, WorldObject, GeoInfo } from '@hearthwood/shared';

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
  /** Login name (registered accounts); guests (dev mode only) have none. */
  username?: string;
  /** scrypt hash of the password. */
  passHash?: string;
  /** 'admin' can use the admin tool. */
  role?: 'admin' | 'player';
  /** Banned accounts can't log in. */
  banned?: { reason: string; until?: number; by?: string };
  name: string;
  /** Public friend code. */
  code: string;
  createdAt: number;
  lastSeen: number;
  created: boolean; // character creation finished
  gender: Gender;
  look: Look;
  /** Mirrors outfit.hat (older code and saves only know the hat). */
  hat: string | null;
  /** Clothes worn per slot (missing in old saves). */
  outfit?: Outfit;
  /** Character model version the looks were made for (missing = 1, see LOOK_VERSION). */
  lookVersion?: number;
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
  /** Town Hall permits owned (terraforming). */
  permits?: string[];
  /** Tools in the ten hotbar slots. */
  hotbar?: (string | null)[];
  /** Last message in a bottle sent (cooldown). */
  lastBottleAt?: number;
  /** Caught fish and birds. */
  album?: Album;
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
  /** Wide-beach migration version applied to saved terrain (4 = current, see room/beach.ts). */
  beach?: number;
  /**
   * Generator version: 1 = flat (legacy), 2 = cliffs & ramps.
   * Legacy data: islands without `gen` (or gen 1) still load flat, so the
   * `(rec.gen ?? 1) >= 2` checks stay while such saves may exist.
   */
  gen?: number;
  /** Furniture placed inside the tent / house, keyed by building id. */
  interiors?: Record<string, WorldObject[]>;
  /** Path type per tile, as digits (0 = none). */
  paths?: string;
  /** Side length in tiles; missing = 48 (islands made before the enlargement). */
  size?: number;
  /** Reshaped terrain (terraforming), encoded like `paths`. */
  terrain?: { tiles: string; levels: string; ramps: string };
  /** Messages in bottles on their way to this island's beach. */
  bottles?: { id: string; from: string; fromName: string; text: string; at: number }[];
  /** Players allowed to build here / who live here (same rights as the owner). */
  builders?: string[];
  residents?: string[];
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
