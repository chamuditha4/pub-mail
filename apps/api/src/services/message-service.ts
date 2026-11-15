import type { MessageDetail, MessageSummary } from '@tmp-mail/contracts';
import type { AttachmentRow, MessageRow, Repositories } from '@tmp-mail/database';
import { toRfc3339 } from '@tmp-mail/shared';
import { decodeCursor, encodeCursor } from '../http/cursor.js';
import { toAttachmentContract } from '../serializers.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_LIMIT);
}

export function toMessageSummary(row: MessageRow): MessageSummary {
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
  };
}

export function toMessageDetail(row: MessageRow, attachments: AttachmentRow[]): MessageDetail {
  return {
    ...toMessageSummary(row),
    recipient_address: row.recipient_address,
    text_body: row.text_body,
    html_body_sanitized: row.html_body_sanitized,
    processed_at: row.processed_at === null ? null : toRfc3339(row.processed_at),
    attachments: attachments.map(toAttachmentContract),
  };
}

export interface MessagePage {
  data: MessageSummary[];
  next_cursor: string | null;
}

/**
 * List an inbox's messages, newest first, with opaque cursor pagination. The
 * caller must already be authorized for the inbox.
 */
export async function listInboxMessages(
  repos: Repositories,
  inboxId: string,
  cursor: string | undefined,
  limit: number,
): Promise<MessagePage> {
  const beforeId = cursor ? (decodeCursor(cursor) ?? undefined) : undefined;
  // Fetch one extra row to determine whether another page exists.
  const rows = await repos.messages.listByInbox(inboxId, { beforeId, limit: limit + 1 });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.id) : null;

  return { data: page.map(toMessageSummary), next_cursor: nextCursor };
}
