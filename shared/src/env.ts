// Real-world-driven environment: local time, sun position, season and weather.
// Sun and calendar come from the island owner's real location and time zone;
// the climate (which seasons exist, what weather is likely, temperature) comes
// from the biome the island was founded in.

import { BIOMES, type BiomeId, type Season, type Weather, type SeasonModel } from './data/biomes.ts';
import { hashMany, Rng } from './rng.ts';

export interface GeoInfo {
  lat: number;
  lon: number;
  tz: string;
}

export interface LocalTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  dayKey: string; // YYYY-MM-DD
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localTime(ms: number, tz: string): LocalTime {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: isValidTimeZone(tz) ? tz : 'UTC',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    });
    fmtCache.set(tz, fmt);
  }
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    year: parts.year, month: parts.month, day: parts.day, hour, minute: parts.minute,
    dayKey: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
  };
}

/** Whole days between two YYYY-MM-DD keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((tb - ta) / 86400000);
}

// ── Sun ────────────────────────────────────────────────────────────────────
export interface SunPosition {
  /** Degrees above the horizon (negative = below). */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

const RAD = Math.PI / 180;

/** Low-precision solar position (accurate to well under a degree). */
export function sunPosition(ms: number, lat: number, lon: number): SunPosition {
  const d = ms / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const lst = (gmst * 15 + lon) * RAD;
  const ha = lst - ra;
  const phi = lat * RAD;
  const elev = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { elevation: elev / RAD, azimuth: ((az / RAD) + 360) % 360 };
}

/** 0 = deep night, 1 = full day. Smooth through twilight. */
export function daylight(elevation: number): number {
  const t = (elevation + 8) / 14; // -8° → 0, +6° → 1
  return Math.max(0, Math.min(1, t));
}

// ── Season ─────────────────────────────────────────────────────────────────
export function seasonFor(model: SeasonModel, month: number, lat: number): Season {
  // Shift months by 6 in the southern hemisphere.
  const m = lat < 0 ? ((month + 5) % 12) + 1 : month;
  switch (model) {
    case 'temperate':
      if (m >= 3 && m <= 5) return 'spring';
      if (m >= 6 && m <= 8) return 'summer';
      if (m >= 9 && m <= 11) return 'autumn';
      return 'winter';
    case 'boreal':
      if (m === 4 || m === 5) return 'spring';
      if (m >= 6 && m <= 8) return 'summer';
      if (m === 9 || m === 10) return 'autumn';
      return 'winter';
    case 'tropical':
      return m >= 5 && m <= 10 ? 'wet' : 'dry';
    case 'arid':
      return m >= 4 && m <= 10 ? 'hot' : 'cool';
  }
}

/** Collapse a season into the four-season palette used for visuals. */
export function visualSeason(season: Season): 'spring' | 'summer' | 'autumn' | 'winter' {
  switch (season) {
    case 'wet':
    case 'hot':
      return 'summer';
    case 'dry':
      return 'summer';
    case 'cool':
      return 'autumn';
    default:
      return season;
  }
}

// ── Weather & temperature ─────────────────────────────────────────────────
function rawWeather(biome: BiomeId, season: Season, seedKey: string, dayKey: string, block: number): Weather {
  const table = BIOMES[biome].weather[season] ?? { clear: 1 };
  const rng = new Rng(hashMany('weather', seedKey, dayKey, block));
  const entries = Object.entries(table) as [Weather, number][];
  return rng.weighted(entries, (e) => e[1])?.[0] ?? 'clear';
}

export interface Environment {
  season: Season;
  weather: Weather;
  tempC: number;
  dayKey: string;
  hour: number;
  minute: number;
  month: number;
  /** Visual intensity of the weather 0..1. */
  intensity: number;
  /** Aurora visible (high latitude / boreal winter nights). */
  aurora: boolean;
}

/**
 * Compute the environment for a location. Deterministic: every observer of the
 * same island at the same moment gets the same weather.
 */
export function computeEnvironment(ms: number, biome: BiomeId, geo: GeoInfo, seedKey: string): Environment {
  const lt = localTime(ms, geo.tz);
  const def = BIOMES[biome];
  const season = seasonFor(def.seasonModel, lt.month, geo.lat);
  const block = Math.floor(lt.hour / 3);
  // Weather persists: 55% chance to carry over the previous block.
  const keep = new Rng(hashMany('keep', seedKey, lt.dayKey, block)).chance(0.55);
  let weather = keep && block > 0
    ? rawWeather(biome, season, seedKey, lt.dayKey, block - 1)
    : rawWeather(biome, season, seedKey, lt.dayKey, block);

  const base = def.temp[season] ?? 15;
  // Warmest ~15:00, coldest ~04:00.
  const hourF = lt.hour + lt.minute / 60;
  const diurnal = -Math.cos(((hourF - 3) / 24) * 2 * Math.PI);
  let tempC = base + diurnal * def.dayNightSwing * 0.5;
  if (weather === 'rain' || weather === 'storm' || weather === 'snow') tempC -= 2;
  if (weather === 'heatwave') tempC += 5;
  const jitter = new Rng(hashMany('temp', seedKey, lt.dayKey)).range(-2, 2);
  tempC = Math.round((tempC + jitter) * 10) / 10;

  // Physical consistency: no snow when warm, rain turns to snow when freezing.
  if (weather === 'snow' && tempC > 3) weather = 'rain';
  if ((weather === 'rain' || weather === 'storm') && tempC < 0) weather = 'snow';

  const intensity = new Rng(hashMany('int', seedKey, lt.dayKey, block)).range(0.4, 1);
  const aurora = (def.seasonModel === 'boreal' && (season === 'winter' || season === 'autumn')) || Math.abs(geo.lat) > 62;
  return { season, weather, tempC, dayKey: lt.dayKey, hour: lt.hour, minute: lt.minute, month: lt.month, intensity, aurora };
}

/** Rough coordinates from a time zone, used when the player declines geolocation. */
const TZ_COORDS: Record<string, [number, number]> = {
  'Europe/Zurich': [47.4, 8.5], 'Europe/Berlin': [52.5, 13.4], 'Europe/London': [51.5, -0.1], 'Europe/Paris': [48.9, 2.4],
  'Europe/Madrid': [40.4, -3.7], 'Europe/Rome': [41.9, 12.5], 'Europe/Vienna': [48.2, 16.4], 'Europe/Amsterdam': [52.4, 4.9],
  'Europe/Stockholm': [59.3, 18.1], 'Europe/Oslo': [59.9, 10.8], 'Europe/Helsinki': [60.2, 24.9], 'Europe/Moscow': [55.8, 37.6],
  'America/New_York': [40.7, -74.0], 'America/Chicago': [41.9, -87.6], 'America/Denver': [39.7, -105.0], 'America/Los_Angeles': [34.1, -118.2],
  'America/Toronto': [43.7, -79.4], 'America/Mexico_City': [19.4, -99.1], 'America/Sao_Paulo': [-23.6, -46.6], 'America/Buenos_Aires': [-34.6, -58.4],
  'Asia/Tokyo': [35.7, 139.7], 'Asia/Seoul': [37.6, 127.0], 'Asia/Shanghai': [31.2, 121.5], 'Asia/Singapore': [1.35, 103.8],
  'Asia/Kolkata': [28.6, 77.2], 'Asia/Dubai': [25.2, 55.3], 'Australia/Sydney': [-33.9, 151.2], 'Pacific/Auckland': [-36.8, 174.8],
  'Africa/Cairo': [30.0, 31.2], 'Africa/Johannesburg': [-26.2, 28.0], 'Africa/Lagos': [6.5, 3.4],
};

export function guessGeoFromTimeZone(tz: string, utcOffsetMinutes: number): { lat: number; lon: number } {
  const known = TZ_COORDS[tz];
  if (known) return { lat: known[0], lon: known[1] };
  // Longitude ≈ offset × 15°. Latitude unknown – assume mid-northern latitudes.
  return { lat: 40, lon: Math.max(-180, Math.min(180, (utcOffsetMinutes / 60) * 15)) };
}
