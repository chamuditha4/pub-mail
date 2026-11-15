import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const BASE = 'http://localhost';

function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return SELF.fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

describe('username/password auth', () => {
  it('signs up, sets a session cookie, and authenticates /v1/me', async () => {
    const res = await post('/v1/auth/signup', { username: 'carol', password: 'hunter2hunter2' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { username: string } };
    expect(json.data.username).toBe('carol');

    const cookie = sessionCookie(res);
    expect(cookie).toContain('tm_session=');

    const me = await SELF.fetch(`${BASE}/v1/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
  });

  it('rejects a duplicate username', async () => {
    await post('/v1/auth/signup', { username: 'dupe', password: 'password123' });
    const again = await post('/v1/auth/signup', { username: 'dupe', password: 'password123' });
    expect(again.status).toBe(409);
  });

  it('rejects weak passwords and bad usernames', async () => {
    expect((await post('/v1/auth/signup', { username: 'ok', password: 'short' })).status).toBe(400);
    expect(
      (await post('/v1/auth/signup', { username: 'BadUpper', password: 'password123' })).status,
    ).toBe(400);
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await post('/v1/auth/signup', { username: 'erin', password: 'correct-password' });

    const good = await post('/v1/auth/login', { username: 'erin', password: 'correct-password' });
    expect(good.status).toBe(200);
    expect(sessionCookie(good)).toContain('tm_session=');

    const bad = await post('/v1/auth/login', { username: 'erin', password: 'wrong-password' });
    expect(bad.status).toBe(401);

    // Unknown user is indistinguishable from a wrong password.
    const unknown = await post('/v1/auth/login', { username: 'nobody', password: 'whatever12' });
    expect(unknown.status).toBe(401);
  });

  it('logs out and invalidates the session', async () => {
    const signup = await post('/v1/auth/signup', { username: 'frank', password: 'password123' });
    const cookie = sessionCookie(signup);

    const logout = await post('/v1/auth/logout', {}, cookie);
    expect(logout.status).toBe(204);

    const me = await SELF.fetch(`${BASE}/v1/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(401);
  });
});
