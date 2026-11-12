import type { WebSocket } from 'ws';
import type { ServerMessage } from '@hearthwood/shared';
import type { PlayerRecord } from '../types.ts';
import type { Room } from './Room.ts';
import { config } from '../config.ts';

export interface PendingCast {
  id: string;
  biteAt: number;
  window: number;
  fish: string | null;
  timer?: NodeJS.Timeout;
  bitten: boolean;
}

/** One connected client. Holds transient, server-side state for that player. */
export class Session {
  player: PlayerRecord | null = null;
  room: Room | null = null;
  x = 0;
  z = 0;
  r = 0;
  moved = false;
  lastMoveAt = 0;
  lastActAt = 0;
  lastPaveAt = 0;
  cast: PendingCast | null = null;
  alive = true;
  /** Islands this session may enter via an invite code. */
  inviteGrants = new Set<string>();

  private tokens = config.msgBurst;
  private lastRefill = Date.now();
  private chatTimes: number[] = [];
  private strikes = 0;

  constructor(readonly ws: WebSocket, readonly ip: string) {}

  send(msg: ServerMessage) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Token-bucket rate limiter. Returns false if the message must be dropped. */
  allowMessage(): boolean {
    const now = Date.now();
    this.tokens = Math.min(config.msgBurst, this.tokens + ((now - this.lastRefill) / 1000) * config.msgRatePerSec);
    this.lastRefill = now;
    if (this.tokens < 1) {
      this.strike();
      return false;
    }
    this.tokens -= 1;
    return true;
  }

  allowChat(): boolean {
    const now = Date.now();
    this.chatTimes = this.chatTimes.filter((t) => now - t < 60000);
    if (this.chatTimes.length >= config.chatPerMin) return false;
    this.chatTimes.push(now);
    return true;
  }

  /** Repeated protocol abuse disconnects the client. */
  strike() {
    this.strikes++;
    if (this.strikes > 50) this.ws.close(4008, 'Too many invalid or excessive messages');
  }

  clearCast() {
    if (this.cast?.timer) clearTimeout(this.cast.timer);
    this.cast = null;
  }
}
