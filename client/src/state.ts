// Client-side mirror of what the server has told us. Never authoritative.

import type { Album, EnvView, FriendView, MailView, MapIsland, QuestView, RoomView, SelfView } from '@hearthwood/shared';

export interface ClientState {
  self: SelfView | null;
  inv: Record<string, number>;
  coins: number;
  friends: FriendView[];
  incoming: FriendView[];
  outgoing: FriendView[];
  mail: MailView[];
  quest: QuestView | null;
  map: MapIsland[];
  room: RoomView | null;
  env: EnvView | null;
  dev: boolean;
  album: Album;
}

type Key = keyof ClientState;
const listeners = new Map<Key | '*', Set<() => void>>();

export const state: ClientState = {
  self: null, inv: {}, coins: 0, friends: [], incoming: [], outgoing: [], mail: [], quest: null, map: [], room: null, env: null, dev: false, album: { fish: {}, birds: {} },
};

export function set<K extends Key>(key: K, value: ClientState[K]) {
  state[key] = value;
  listeners.get(key)?.forEach((f) => f());
  listeners.get('*')?.forEach((f) => f());
}

export function watch(keys: (Key | '*')[], fn: () => void) {
  for (const k of keys) {
    if (!listeners.has(k)) listeners.set(k, new Set());
    listeners.get(k)!.add(fn);
  }
  return () => keys.forEach((k) => listeners.get(k)?.delete(fn));
}
