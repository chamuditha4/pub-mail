import type { MiddlewareHandler } from 'hono';
import { loadAppConfig, ulid } from '@tmp-mail/shared';
import { createRepositories } from '@tmp-mail/database';
import type { HonoEnv } from '../types.js';

// Builds the per-request context: a request id, validated config, and
// repositories bound to this request's D1 handle. Every response carries
// X-Request-Id (CLAUDE.md §9).
export const contextMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const requestId = `req_${ulid()}`;
  const config = loadAppConfig(c.env as unknown as Record<string, unknown>);
  const repos = createRepositories(c.env.DB);

  c.set('ctx', { requestId, config, repos });
  c.header('X-Request-Id', requestId);
  // API responses are per-caller and must never be cached by the browser or a
  // CDN — caching a response defeats CORS (a stale response can lack the right
  // Access-Control-Allow-Origin) and could leak per-user data.
  c.header('Cache-Control', 'no-store');
  await next();
};
