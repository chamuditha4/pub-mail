import { Hono } from 'hono';
import type { Context } from 'hono';
import { AppError, toRfc3339 } from '@tmp-mail/shared';
import type { InboxRow, MessageRow } from '@tmp-mail/database';
import type { UniboxMessage, OwnedInbox } from '@tmp-mail/contracts';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import type { UserCaller } from '../auth/caller.js';
import { clampLimit } from '../services/message-service.js';
import { decodeCursor, encodeCursor } from '../http/cursor.js';

// The unibox: an authenticated user's view of every message received at any
// address they created — retained even after individual inboxes expire or are
// deleted (denormalized messages.user_id, see migration 0003).
export const meRoutes = new Hono<HonoEnv>();

async function requireUser(c: Context<HonoEnv>): Promise<UserCaller> {
  const caller = await resolveCaller(c);
  if (caller.kind !== 'user') throw new AppError('unauthorized', 'Not authenticated.');
  return caller;
}

function domainFromAddress(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : '';
}

function toUniboxMessage(row: MessageRow): UniboxMessage {
  return {
    id: row.id,
    sender_address: row.sender_address,
    sender_name: row.sender_name,
    subject: row.subject,
    snippet: row.snippet,
    received_at: toRfc3339(row.received_at),
    status: row.status,
    has_attachments: row.has_attachments === 1,
    size_bytes: row.size_bytes,
    recipient_address: row.recipient_address,
    inbox_id: row.inbox_id,
  };
}

function toOwnedInbox(row: InboxRow): OwnedInbox {
  return {
    id: row.id,
    address: row.address,
    domain: domainFromAddress(row.address),
    status: row.status,
    expires_at: toRfc3339(row.expires_at),
    created_at: toRfc3339(row.created_at),
    last_message_at: row.last_message_at === null ? null : toRfc3339(row.last_message_at),
  };
}

// All addresses the user has generated (including expired/deleted).
meRoutes.get('/v1/me/inboxes', async (c) => {
  const caller = await requireUser(c);
  const { repos } = c.get('ctx');
  const rows = await repos.inboxes.listByUser(caller.userId, 200);
  return c.json({ data: rows.map(toOwnedInbox) });
});

// The unified inbox: every message across the user's addresses, newest first.
meRoutes.get('/v1/me/messages', async (c) => {
  const caller = await requireUser(c);
  const { repos } = c.get('ctx');
  const cursorParam = c.req.query('cursor');
  const limit = clampLimit(Number(c.req.query('limit')));

  const beforeId = cursorParam ? (decodeCursor(cursorParam) ?? undefined) : undefined;
  const rows = await repos.messages.listByUser(caller.userId, { beforeId, limit: limit + 1 });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.id) : null;

  return c.json({ data: page.map(toUniboxMessage), next_cursor: nextCursor });
});
