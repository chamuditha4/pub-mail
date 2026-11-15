import type { Context } from 'hono';
import type { Repositories } from '@tmp-mail/database';
import type { HonoEnv } from '../types.js';

// Fixed-window rate limiting backed by D1 counters (CLAUDE.md §15). Simple and
// bounded; counters are pruned by the retention sweep.

export interface RateLimitOutcome {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export async function checkRateLimit(
  repos: Repositories,
  name: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
  now: number,
): Promise<RateLimitOutcome> {
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const resetAt = windowStart + windowSeconds;
  const bucket = `${name}:${identifier}:${windowStart}`;
  const { count } = await repos.rateLimits.increment(bucket, windowStart, resetAt);
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

/** Emit standard rate-limit headers (CLAUDE.md §9). */
export function setRateLimitHeaders(c: Context<HonoEnv>, o: RateLimitOutcome): void {
  c.header('X-RateLimit-Limit', String(o.limit));
  c.header('X-RateLimit-Remaining', String(o.remaining));
  c.header('X-RateLimit-Reset', String(o.resetAt));
}
