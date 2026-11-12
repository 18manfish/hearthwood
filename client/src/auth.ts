// Login token storage and small API helpers (shared by the game and the tools).

import { applyGameData, type GameData } from '@hearthwood/shared';

const TOKEN_KEY = 'hearthwood.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* private mode – token lives for this page only */
  }
  memToken = t;
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  memToken = null;
}

let memToken: string | null = null;
export function token() {
  return getToken() ?? memToken;
}

/** JSON request with the login token; throws Error(message) on failure. */
export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const t = token();
  const r = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw Object.assign(new Error(data.error ?? `${r.status} ${r.statusText}`), { status: r.status });
  return data;
}

export interface Health {
  ok: boolean;
  protocol: number;
  online: number;
  guests: boolean;
  dev: boolean;
}

export function health(): Promise<Health> {
  return api<Health>('GET', '/api/health');
}

/** Fetch the server's game-data overrides and apply them (before the game starts). */
export async function loadGameData() {
  const d = await api<Partial<GameData>>('GET', '/api/gamedata');
  applyGameData(d);
  return d;
}

export async function logout() {
  await api('POST', '/api/logout').catch(() => null);
  clearToken();
}
