import { looksLikeApiKey, parseApiKey, verifySecret } from '@tmp-mail/security';
import type { AppConfig } from '@tmp-mail/shared';
import { nowSeconds } from '@tmp-mail/shared';
import type { Repositories } from '@tmp-mail/database';
import type { Scope, UserCaller } from './caller.js';

const KNOWN_SCOPES: ReadonlySet<string> = new Set<Scope>([
  'domains:read',
  'private_domains:read',
  'inboxes:read',
  'inboxes:write',
  'messages:read',
  'messages:delete',
  'webhooks:read',
  'webhooks:write',
  'usage:read',
]);

function parseScopes(json: string): Set<Scope> {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const scopes = new Set<Scope>();
    for (const s of parsed) {
      if (typeof s === 'string' && KNOWN_SCOPES.has(s)) scopes.add(s as Scope);
    }
    return scopes;
  } catch {
    return new Set();
  }
}

/**
 * Resolve an API-key Bearer token to a user caller, or null if not an API key /
 * invalid. Verification fetches exactly one row by the public prefix, then
 * constant-time compares the secret hash.
 */
export async function resolveApiKeyCaller(
  repos: Repositories,
  config: AppConfig,
  token: string,
): Promise<UserCaller | null> {
  if (!looksLikeApiKey(token)) return null;
  const parsed = parseApiKey(token);
  if (!parsed) return null;

  const row = await repos.apiKeys.findActiveByPrefix(parsed.keyPrefix);
  if (!row) return null;

  const now = nowSeconds();
  if (row.expires_at !== null && row.expires_at <= now) return null;

  const ok = await verifySecret(parsed.secret, row.secret_hash, config.TOKEN_PEPPER);
  if (!ok) return null;

  // Best-effort last-used timestamp (throttled to once per minute).
  if (row.last_used_at === null || now - row.last_used_at > 60) {
    await repos.apiKeys.touchLastUsed(row.id, now).catch(() => undefined);
  }

  // API keys are never admin (CLAUDE.md §10).
  return {
    kind: 'user',
    userId: row.user_id,
    scopes: parseScopes(row.scopes_json),
    isAdmin: false,
  };
}
