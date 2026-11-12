// Small structured logger.
//
//   LOG_LEVEL  = debug | info | warn | error   (default: info, debug with DEV_FAST)
//   LOG_FORMAT = pretty | json                 (default: pretty in a terminal, json otherwise)
//   LOG_FILE   = path to also append JSON lines to (optional)
//
// Usage: const log = logger('game'); log.info('player joined', { player: id });
// Never pass secrets (tokens, token hashes) as fields.

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLOR: Record<LogLevel, string> = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

const envLevel = (process.env.LOG_LEVEL ?? '').toLowerCase() as LogLevel;
const minLevel: LogLevel = ORDER[envLevel] ? envLevel : process.env.DEV_FAST === '1' ? 'debug' : 'info';
const format = process.env.LOG_FORMAT === 'json' || process.env.LOG_FORMAT === 'pretty'
  ? process.env.LOG_FORMAT
  : process.stdout.isTTY ? 'pretty' : 'json';

let file: fs.WriteStream | null = null;
if (process.env.LOG_FILE) {
  try {
    fs.mkdirSync(path.dirname(path.resolve(process.env.LOG_FILE)), { recursive: true });
    file = fs.createWriteStream(process.env.LOG_FILE, { flags: 'a' });
  } catch (e) {
    process.stderr.write(`[log] cannot open LOG_FILE: ${(e as Error).message}\n`);
  }
}

export type Fields = Record<string, unknown>;

function serialise(v: unknown): unknown {
  if (v instanceof Error) return { message: v.message, stack: v.stack };
  return v;
}

function write(level: LogLevel, scope: string, msg: string, fields?: Fields) {
  if (ORDER[level] < ORDER[minLevel]) return;
  const time = new Date().toISOString();
  const clean: Fields = {};
  if (fields) for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = serialise(v);
  const json = JSON.stringify({ time, level, scope, msg, ...clean });
  file?.write(json + '\n');
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (format === 'json') {
    out.write(json + '\n');
    return;
  }
  const extra = Object.entries(clean)
    .map(([k, v]) => {
      if (v && typeof v === 'object' && 'stack' in (v as object)) return `\n${(v as { stack: string }).stack}`;
      return ` ${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`;
    })
    .join('');
  out.write(`\x1b[90m${time.slice(11, 23)}\x1b[0m ${COLOR[level]}${level.toUpperCase().padEnd(5)}\x1b[0m \x1b[35m${scope}\x1b[0m ${msg}${extra}\n`);
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(scope: string): Logger;
}

export function logger(scope: string): Logger {
  return {
    debug: (m, f) => write('debug', scope, m, f),
    info: (m, f) => write('info', scope, m, f),
    warn: (m, f) => write('warn', scope, m, f),
    error: (m, f) => write('error', scope, m, f),
    child: (s) => logger(`${scope}:${s}`),
  };
}

export const logLevel = minLevel;
