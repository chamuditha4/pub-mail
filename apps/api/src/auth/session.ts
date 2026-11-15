import { hashSecret, generateSessionToken, hashPassword, verifyPassword } from '@tmp-mail/security';
import { AppError, conflict, nowSeconds, ulid } from '@tmp-mail/shared';
import type { Repositories, UserRow } from '@tmp-mail/database';

// Session lifecycle. The cookie holds a high-entropy token; only its keyed hash
// is stored (CLAUDE.md §12). Cookies are HTTP-only, Secure, SameSite=Lax.

export const SESSION_COOKIE = 'tm_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface CreatedSession {
  token: string;
  expiresAt: number;
}

export async function createSession(
  repos: Repositories,
  pepper: string,
  userId: string,
): Promise<CreatedSession> {
  const { plaintext, hash } = await generateSessionToken(pepper);
  const now = nowSeconds();
  const expiresAt = now + SESSION_TTL_SECONDS;
  await repos.sessions.create({ id: hash, userId, createdAt: now, expiresAt });
  return { token: plaintext, expiresAt };
}

/** Resolve the user for a session cookie token, or null if invalid/expired. */
export async function resolveSessionUser(
  repos: Repositories,
  pepper: string,
  token: string,
): Promise<UserRow | null> {
  const id = await hashSecret(token, pepper);
  const session = await repos.sessions.findValid(id, nowSeconds());
  if (!session) return null;
  const user = await repos.users.findById(session.user_id);
  if (!user || user.status !== 'active') return null;
  return user;
}

export async function destroySession(
  repos: Repositories,
  pepper: string,
  token: string,
): Promise<void> {
  const id = await hashSecret(token, pepper);
  await repos.sessions.delete(id);
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  const attrs = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

// Generic credentials error — never reveals whether the username exists
// (CLAUDE.md §9, §12). Signup surfaces `conflict` on a taken username instead.
const invalidCredentials = (): AppError =>
  new AppError('unauthorized', 'Invalid username or password.');

/** Create a new username/password user and return the user row. */
export async function signup(
  repos: Repositories,
  pepper: string,
  username: string,
  password: string,
): Promise<UserRow> {
  if (await repos.users.findByUsername(username)) {
    throw conflict('That username is taken.');
  }
  const { salt, hash } = await hashPassword(password, pepper);
  const id = ulid();
  await repos.users.createWithPassword({
    id,
    username,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: nowSeconds(),
  });
  const user = await repos.users.findById(id);
  if (!user) throw new Error('user vanished after insert');
  return user;
}

/** Verify username/password credentials, returning the user row. */
export async function login(
  repos: Repositories,
  pepper: string,
  username: string,
  password: string,
): Promise<UserRow> {
  const user = await repos.users.findByUsername(username);
  if (!user || !user.password_hash || !user.password_salt || user.status !== 'active') {
    // Still run a hash to keep timing roughly uniform against enumeration.
    await hashPassword(password, pepper);
    throw invalidCredentials();
  }
  const ok = await verifyPassword(
    password,
    { salt: user.password_salt, hash: user.password_hash },
    pepper,
  );
  if (!ok) throw invalidCredentials();
  return user;
}
