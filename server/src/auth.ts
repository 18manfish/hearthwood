// Passwords (scrypt) and login tokens (random, stored as SHA-256 hashes).

import crypto from 'node:crypto';

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

const N = 16384, R = 8, P = 1, LEN = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [kind, n, saltB64, hashB64] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), want.length, { N: Number(n), r: R, p: P });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Why a username / password can't be used (null = fine). */
export function credentialError(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return 'Usernames are 3–20 letters, digits or _.';
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return 'That password is too long.';
  return null;
}
