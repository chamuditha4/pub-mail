import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AppError, nowSeconds, toRfc3339, ulid, validationError } from '@tmp-mail/shared';
import { createApiKeyRequestSchema } from '@tmp-mail/contracts';
import type { ApiKeyMetadata } from '@tmp-mail/contracts';
import type { ApiKeyRow, UserRow } from '@tmp-mail/database';
import { generateApiKey } from '@tmp-mail/security';
import type { HonoEnv } from '../types.js';
import { SESSION_COOKIE, resolveSessionUser } from '../auth/session.js';
import { audit } from '../services/audit.js';

// API-key management (CLAUDE.md §10). Dashboard-only: authenticated by session
// cookie so an API key cannot mint or revoke keys.
export const apiKeyRoutes = new Hono<HonoEnv>();

async function requireSession(c: Context<HonoEnv>): Promise<UserRow> {
  const { repos, config } = c.get('ctx');
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? await resolveSessionUser(repos, config.TOKEN_PEPPER, token) : null;
  if (!user) throw new AppError('unauthorized', 'Not authenticated.');
  return user;
}

function assertSameOrigin(c: Context<HonoEnv>): void {
  const { config } = c.get('ctx');
  const origin = c.req.header('Origin');
  if (!origin) return;
  const allowed = new Set([config.APP_BASE_URL, ...config.CORS_ORIGINS]);
  if (!allowed.has(origin)) throw new AppError('forbidden', 'Cross-origin request rejected.');
}

function toMetadata(row: ApiKeyRow): ApiKeyMetadata {
  let scopes: string[] = [];
  try {
    const parsed = JSON.parse(row.scopes_json) as unknown;
    if (Array.isArray(parsed)) scopes = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes,
    status: row.status,
    last_used_at: row.last_used_at === null ? null : toRfc3339(row.last_used_at),
    expires_at: row.expires_at === null ? null : toRfc3339(row.expires_at),
    created_at: toRfc3339(row.created_at),
  };
}

apiKeyRoutes.get('/v1/api-keys', async (c) => {
  const user = await requireSession(c);
  const { repos } = c.get('ctx');
  const rows = await repos.apiKeys.listByUser(user.id);
  return c.json({ data: rows.map(toMetadata) });
});

apiKeyRoutes.post('/v1/api-keys', async (c) => {
  assertSameOrigin(c);
  const user = await requireSession(c);
  const { repos, config } = c.get('ctx');

  const parsed = createApiKeyRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError('Provide a name and at least one scope.');

  const now = nowSeconds();
  const id = ulid();
  const { fullKey, keyPrefix, secretHash } = await generateApiKey(config.TOKEN_PEPPER);
  await repos.apiKeys.create({
    id,
    userId: user.id,
    name: parsed.data.name,
    keyPrefix,
    secretHash,
    scopesJson: JSON.stringify(parsed.data.scopes),
    expiresAt: parsed.data.expires_in ? now + parsed.data.expires_in : null,
    createdAt: now,
  });
  const row = await repos.apiKeys.findActiveByPrefix(keyPrefix);
  await audit(c, { actorUserId: user.id, action: 'api_key.create', target: id });
  // The full key is returned exactly once (CLAUDE.md §9).
  return c.json({ data: { ...toMetadata(row!), key: fullKey } }, 201);
});

apiKeyRoutes.delete('/v1/api-keys/:id', async (c) => {
  assertSameOrigin(c);
  const user = await requireSession(c);
  const { repos } = c.get('ctx');
  const changed = await repos.apiKeys.revoke(c.req.param('id'), user.id);
  if (changed === 0) throw new AppError('not_found', 'API key not found.');
  await audit(c, { actorUserId: user.id, action: 'api_key.revoke', target: c.req.param('id') });
  return c.body(null, 204);
});
