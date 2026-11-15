import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { HonoEnv } from '../types.js';
import { anonymous, type Caller } from './caller.js';
import { resolveSessionUser, SESSION_COOKIE } from './session.js';
import { bearerToken } from './inbox-auth.js';
import { resolveApiKeyCaller } from './api-key.js';

/**
 * Resolve the request principal. A valid session cookie yields an authenticated
 * user (with all user scopes); otherwise the caller is anonymous. Inbox-scoped
 * access is additionally authorized via the inbox access token. API-key callers
 * are added in a later milestone.
 */
export async function resolveCaller(c: Context<HonoEnv>): Promise<Caller> {
  const { repos, config } = c.get('ctx');

  // Developer API key (Authorization: Bearer tm_live_...).
  const bearer = bearerToken(c.req.header('Authorization'));
  if (bearer) {
    const apiCaller = await resolveApiKeyCaller(repos, config, bearer);
    if (apiCaller) return apiCaller;
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const user = await resolveSessionUser(repos, config.TOKEN_PEPPER, token);
    if (user) {
      const isAdmin =
        user.role === 'admin' ||
        (user.username !== null && config.ADMIN_USERNAMES.includes(user.username));
      return { kind: 'user', userId: user.id, scopes: 'all', isAdmin };
    }
  }
  return anonymous;
}
