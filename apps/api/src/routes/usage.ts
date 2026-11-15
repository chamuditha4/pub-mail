import { Hono } from 'hono';
import { AppError } from '@tmp-mail/shared';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import { assertScope } from '../auth/caller.js';

// Current quota usage for the authenticated user (CLAUDE.md §9).
export const usageRoutes = new Hono<HonoEnv>();

usageRoutes.get('/v1/usage', async (c) => {
  const caller = await resolveCaller(c);
  if (caller.kind !== 'user') throw new AppError('unauthorized', 'Not authenticated.');
  assertScope(caller, 'usage:read');

  const { repos, config } = c.get('ctx');
  const inboxes = await repos.inboxes.listByUser(caller.userId, 1000);
  const apiKeys = await repos.apiKeys.listByUser(caller.userId);

  return c.json({
    data: {
      active_inboxes: inboxes.filter((i) => i.status === 'active').length,
      active_api_keys: apiKeys.length,
      limits: {
        anon_inbox_creations_per_hour: config.ANON_INBOX_CREATIONS_PER_HOUR,
        api_requests_per_minute: config.API_REQUESTS_PER_MINUTE,
      },
    },
  });
});
