import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { AppError, validationError } from '@tmp-mail/shared';
import { credentialsSchema } from '@tmp-mail/contracts';
import type { UserRow } from '@tmp-mail/database';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import { SESSION_COOKIE, createSession, destroySession, login, signup } from '../auth/session.js';
import { audit } from '../services/audit.js';

export const authRoutes = new Hono<HonoEnv>();

function isSecure(apiBaseUrl: string): boolean {
  return apiBaseUrl.startsWith('https://');
}

// Reject cross-site cookie-setting requests (CSRF defense, CLAUDE.md §12).
// Allowed origins are APP_BASE_URL plus any configured CORS_ORIGINS. Requests
// without an Origin header (e.g. curl) are allowed.
function assertSameOrigin(c: Context<HonoEnv>): void {
  const { config } = c.get('ctx');
  const origin = c.req.header('Origin');
  if (!origin) return;
  const allowed = new Set([config.APP_BASE_URL, ...config.CORS_ORIGINS]);
  if (!allowed.has(origin)) {
    throw new AppError('forbidden', 'Cross-origin request rejected.');
  }
}

function serialize(user: UserRow) {
  return { id: user.id, username: user.username ?? '', role: user.role };
}

async function parseCredentials(
  c: Context<HonoEnv>,
): Promise<{ username: string; password: string }> {
  const body = await c.req.json().catch(() => null);
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError('Provide a valid username (3–32 chars) and password (min 8 chars).');
  }
  return { username: parsed.data.username.toLowerCase(), password: parsed.data.password };
}

async function startSession(c: Context<HonoEnv>, userId: string): Promise<void> {
  const { config, repos } = c.get('ctx');
  const session = await createSession(repos, config.TOKEN_PEPPER, userId);
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: isSecure(config.API_BASE_URL),
    sameSite: 'Lax',
    path: '/',
    maxAge: session.expiresAt - Math.floor(Date.now() / 1000),
  });
}

authRoutes.post('/v1/auth/signup', async (c) => {
  assertSameOrigin(c);
  const { config, repos } = c.get('ctx');
  const { username, password } = await parseCredentials(c);
  const user = await signup(repos, config.TOKEN_PEPPER, username, password);
  await startSession(c, user.id);
  await audit(c, { actorUserId: user.id, action: 'auth.signup' });
  return c.json({ data: serialize(user) }, 201);
});

authRoutes.post('/v1/auth/login', async (c) => {
  assertSameOrigin(c);
  const { config, repos } = c.get('ctx');
  const { username, password } = await parseCredentials(c);
  const user = await login(repos, config.TOKEN_PEPPER, username, password);
  await startSession(c, user.id);
  await audit(c, { actorUserId: user.id, action: 'auth.login' });
  return c.json({ data: serialize(user) }, 200);
});

authRoutes.post('/v1/auth/logout', async (c) => {
  assertSameOrigin(c);
  const { config, repos } = c.get('ctx');
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(repos, config.TOKEN_PEPPER, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.body(null, 204);
});

authRoutes.get('/v1/me', async (c) => {
  const { repos } = c.get('ctx');
  const caller = await resolveCaller(c);
  if (caller.kind !== 'user') throw new AppError('unauthorized', 'Not authenticated.');
  const user = await repos.users.findById(caller.userId);
  if (!user) throw new AppError('unauthorized', 'Not authenticated.');
  return c.json({
    data: { ...serialize(user), role: caller.isAdmin ? 'admin' : user.role },
  });
});
