import type { MiddlewareHandler } from 'hono';
import { AppError, nowSeconds } from '@tmp-mail/shared';
import { looksLikeApiKey, parseApiKey } from '@tmp-mail/security';
import { bearerToken } from '../auth/inbox-auth.js';
import { checkRateLimit, setRateLimitHeaders } from '../services/rate-limit.js';
import type { HonoEnv } from '../types.js';

// Per-API-key request rate limit (CLAUDE.md §15). Applied to all /v1 requests
// that present an API key; identified by the public key prefix. Anonymous inbox
// creation is limited separately, per IP, in the inbox route.
export const rateLimitMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const token = bearerToken(c.req.header('Authorization'));
  if (!token || !looksLikeApiKey(token)) {
    await next();
    return;
  }
  const parsed = parseApiKey(token);
  if (!parsed) {
    await next();
    return;
  }

  const { repos, config } = c.get('ctx');
  const outcome = await checkRateLimit(
    repos,
    'api',
    parsed.keyPrefix,
    config.API_REQUESTS_PER_MINUTE,
    60,
    nowSeconds(),
  );
  setRateLimitHeaders(c, outcome);
  if (!outcome.allowed) {
    throw new AppError('rate_limit_exceeded', 'API request rate limit exceeded.');
  }
  await next();
};
