import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export const DEV_FAST = process.env.DEV_FAST === '1';

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.resolve(here, '../data'),
  clientDist: process.env.CLIENT_DIST ?? path.resolve(here, '../../client/dist'),
  production: process.env.NODE_ENV === 'production',
  /** Comma separated list of allowed Origins for WebSocket upgrades (empty = allow all). */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),

  devFast: DEV_FAST,
  /** Usernames (comma separated, case-insensitive) that are always admins. */
  adminUsers: (process.env.ADMIN_USERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  /** Guests (no username/password) may play – only in dev mode. */
  allowGuests: DEV_FAST,
  /** Construction & tree growth run this many times faster in dev mode. */
  timeFactor: DEV_FAST ? 60 : 1,
  /** Ignore the "minimum island day" pacing rules in dev mode. */
  ignoreDayGates: DEV_FAST,

  tickHz: 10,
  villagerHz: 4,
  saveIntervalMs: 5000,

  // Movement validation
  playerSpeed: 4.2, // units / s (client uses the same)
  moveTolerance: 1.35,

  // Interaction reach (world units)
  reach: 2.0,
  buildingReach: 2.2,
  castReach: 4.5,

  // Trees grow sapling → young → mature, one stage per this many minutes.
  treeStageMinutes: 12 * 60,

  // Depleted resources disappear and come back after this long.
  respawnMinutes: { rock: 24 * 60, bush: 12 * 60, tree: 48 * 60 },
  /** Undug stumps rot away and sprout a sapling after this long. */
  stumpDecayMinutes: 48 * 60,
  /** Shovel hits a rock can take before it crumbles (stone shovel / iron shovel). */
  rockHits: [6, 8],

  // Fishing
  biteMinMs: 2000,
  biteMaxMs: 6500,
  biteWindowMs: 900,
  netGraceMs: 250,

  // Abuse protection
  maxMessageBytes: 8 * 1024,
  msgRatePerSec: 30,
  msgBurst: 60,
  chatPerMin: 20,
  registerPerHourPerIp: 20,
  helloTimeoutMs: 5000,
  heartbeatMs: 20000,
};

export type Config = typeof config;
