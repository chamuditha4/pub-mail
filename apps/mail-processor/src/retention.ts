import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { createRepositories, type Repositories } from '@tmp-mail/database';
import { nowSeconds } from '@tmp-mail/shared';

// Scheduled retention sweep (CLAUDE.md §13). Expired inboxes are marked; the
// content of expired ANONYMOUS messages is physically removed from R2 and D1
// (raw MIME + attachments). Signed-in users' mail is intentionally retained
// (unibox). Expired sessions are cleared. Bounded and idempotent.

export interface RetentionDeps {
  db: D1Database;
  rawBucket: R2Bucket;
  attachmentBucket: R2Bucket;
  now?: () => number;
  batchSize?: number;
  repos?: Repositories;
}

export interface RetentionResult {
  expiredInboxes: number;
  purgedMessages: number;
  deletedSessions: number;
  prunedRateLimits: number;
  prunedWebhookDeliveries: number;
}

const WEBHOOK_DELIVERY_RETENTION_SECONDS = 30 * 24 * 3600; // keep 30 days of history

export async function runRetention(deps: RetentionDeps): Promise<RetentionResult> {
  const repos = deps.repos ?? createRepositories(deps.db);
  const now = (deps.now ?? nowSeconds)();
  const batchSize = deps.batchSize ?? 500;

  // 1. Mark expired inboxes.
  const expiredInboxes = await repos.inboxes.markExpired(now);

  // 2. Physically purge expired anonymous message content from R2 + D1.
  const purgeable = await repos.messages.listExpiredAnonymous(now, batchSize);
  let purgedMessages = 0;
  for (const msg of purgeable) {
    const attachments = await repos.attachments.listByMessage(msg.id);
    // Delete raw MIME and attachment objects from R2 (idempotent, ignore misses).
    await deps.rawBucket.delete(msg.r2_raw_key).catch(() => undefined);
    for (const att of attachments) {
      if (att.r2_key) await deps.attachmentBucket.delete(att.r2_key).catch(() => undefined);
    }
    // Removing the message row cascades its attachment rows.
    await repos.messages.hardDelete(msg.id);
    purgedMessages += 1;
  }

  // 3. Clear expired sessions and stale rate-limit counters.
  const deletedSessions = await repos.sessions.deleteExpired(now);
  const prunedRateLimits = await repos.rateLimits.deleteExpired(now);
  const prunedWebhookDeliveries = await repos.webhookDeliveries.deleteOlderThan(
    now - WEBHOOK_DELIVERY_RETENTION_SECONDS,
  );

  return {
    expiredInboxes,
    purgedMessages,
    deletedSessions,
    prunedRateLimits,
    prunedWebhookDeliveries,
  };
}
