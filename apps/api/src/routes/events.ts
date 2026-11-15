import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AppError } from '@tmp-mail/shared';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import { authorizeInboxAccess } from '../auth/inbox-auth.js';

// Server-Sent Events for live inbox updates (CLAUDE.md §9). The stream polls D1
// for new/changed messages and emits lightweight signals; the client refetches
// on each. A single long-lived connection replaces client-side polling. Each
// connection lives ~60s then closes; the browser's EventSource auto-reconnects.
export const eventRoutes = new Hono<HonoEnv>();

const POLL_MS = 3000;
const MAX_TICKS = 20; // ~60s per connection

async function newestMessageId(get: () => Promise<Array<{ id: string }>>): Promise<string> {
  const rows = await get();
  return rows[0]?.id ?? '';
}

// Per-inbox stream. Auth via inbox token (Authorization header or ?access_token=)
// or the authenticated owner's session.
eventRoutes.get('/v1/inboxes/:inbox_id/events', async (c) => {
  const { repos, config } = c.get('ctx');
  const caller = await resolveCaller(c);
  const inboxId = c.req.param('inbox_id');

  const queryToken = c.req.query('access_token');
  const authorization = queryToken ? `Bearer ${queryToken}` : c.req.header('Authorization');
  const inbox = await authorizeInboxAccess(repos, config, inboxId, authorization, caller);

  return streamSSE(c, async (stream) => {
    let lastId = await newestMessageId(() => repos.messages.listByInbox(inbox.id, { limit: 1 }));
    await stream.writeSSE({ event: 'open', data: 'ok' });

    for (let tick = 0; tick < MAX_TICKS; tick++) {
      await stream.sleep(POLL_MS);
      const current = await repos.inboxes.findById(inbox.id);
      if (!current || current.status !== 'active') {
        await stream.writeSSE({ event: 'closed', data: current?.status ?? 'deleted' });
        return;
      }
      const newest = await newestMessageId(() =>
        repos.messages.listByInbox(inbox.id, { limit: 1 }),
      );
      if (newest !== lastId) {
        lastId = newest;
        await stream.writeSSE({ event: 'message', data: 'new' });
      }
    }
  });
});

// Unibox stream for the authenticated user (session cookie; EventSource sends it
// with withCredentials).
eventRoutes.get('/v1/me/events', async (c) => {
  const { repos } = c.get('ctx');
  const caller = await resolveCaller(c);
  if (caller.kind !== 'user') throw new AppError('unauthorized', 'Not authenticated.');
  const userId = caller.userId;

  return streamSSE(c, async (stream) => {
    let lastId = await newestMessageId(() => repos.messages.listByUser(userId, { limit: 1 }));
    await stream.writeSSE({ event: 'open', data: 'ok' });

    for (let tick = 0; tick < MAX_TICKS; tick++) {
      await stream.sleep(POLL_MS);
      const newest = await newestMessageId(() => repos.messages.listByUser(userId, { limit: 1 }));
      if (newest !== lastId) {
        lastId = newest;
        await stream.writeSSE({ event: 'message', data: 'new' });
      }
    }
  });
});
