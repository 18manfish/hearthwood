declare module 'ws' {
  import { EventEmitter } from 'events';
  import type { IncomingMessage } from 'http';
  import type { Duplex } from 'stream';
  export type RawData = Buffer | ArrayBuffer | Buffer[];
  export class WebSocket extends EventEmitter {
    constructor(url: string, opts?: any);
    readonly OPEN: 1; readyState: number;
    send(data: string): void; close(code?: number, reason?: string): void; terminate(): void; ping(): void;
    on(ev: 'message', cb: (data: RawData, isBinary: boolean) => void): this;
    on(ev: string, cb: (...a: any[]) => void): this;
  }
  export class WebSocketServer extends EventEmitter {
    constructor(opts: { noServer?: boolean; maxPayload?: number });
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket) => void): void;
    close(): void;
  }
  export default WebSocket;
}
