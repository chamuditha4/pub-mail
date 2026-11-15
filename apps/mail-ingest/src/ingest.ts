import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import {
  createRepositories,
  type DomainRow,
  type InboxRow,
  type Repositories,
} from '@tmp-mail/database';
import { normalizeAddress } from '@tmp-mail/email';
import { nowSeconds, ulid, type EmailProcessingJob } from '@tmp-mail/shared';

// Cloudflare Email Routing handler logic (CLAUDE.md §7). Kept free of the
// ForwardableEmailMessage type so it can be unit-tested with a plain object and
// Miniflare-backed bindings. Never parses MIME.

/** Minimal view of an inbound message needed for ingestion. */
export interface IncomingEmail {
  /** Envelope sender (MAIL FROM). */
  from: string;
  /** Envelope recipient (RCPT TO). */
  to: string;
  /** Raw message size in bytes. */
  rawSize: number;
  /** Message headers (used only for the idempotency Message-ID). */
  headers: Headers;
  /** Raw MIME stream — streamed straight to R2, never buffered. */
  raw: ReadableStream<Uint8Array>;
}

/** A queue producer; abstracted so tests can record without a consumer. The
 *  return value is ignored (Cloudflare's Queue.send resolves a send response). */
export interface QueueSender {
  send(body: EmailProcessingJob): Promise<unknown>;
}

export interface IngestDeps {
  db: D1Database;
  rawBucket: R2Bucket;
  queue: QueueSender;
  maxMessageBytes: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  repos?: Repositories;
}

export type RejectReason =
  'invalid_recipient' | 'inactive_domain' | 'unknown_recipient' | 'too_large' | 'blocked';

/**
 * Shortest lifetime an expired inbox is revived for when mail arrives late.
 * Matches the minimum anonymous inbox lifetime (CLAUDE.md §13).
 */
const MIN_RENEWAL_SECONDS = 600;

/**
 * Expired inboxes accept mail instead of bouncing it: mail sent moments after a
 * short TTL lapsed is exactly the mail users care about (signup codes, resets).
 * The inbox is revived for its original lifetime, clamped to the domain's
 * maximum, so retention stays bounded and the domain owner keeps control.
 */
function renewalSeconds(inbox: InboxRow, domain: DomainRow): number {
  const original = inbox.expires_at - inbox.created_at;
  const capped = Math.min(original, domain.max_inbox_ttl_seconds);
  return Math.max(capped, MIN_RENEWAL_SECONDS);
}

export type IngestResult =
  | { outcome: 'accepted'; messageId: string; inboxId: string; r2RawKey: string }
  | { outcome: 'duplicate'; messageId: string; inboxId: string }
  | { outcome: 'rejected'; reason: RejectReason };

function providerMessageId(headers: Headers): string | null {
  const raw = headers.get('message-id');
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 998 ? trimmed : null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

/**
 * Ingest one inbound email. Returns a result describing the outcome; the caller
 * is responsible for SMTP-level rejection and structured logging.
 */
export async function ingestEmail(email: IncomingEmail, deps: IngestDeps): Promise<IngestResult> {
  const repos: Repositories = deps.repos ?? createRepositories(deps.db);
  const now = (deps.now ?? nowSeconds)();

  // 7. Enforce the application size limit (below Cloudflare's 25 MiB cap).
  if (email.rawSize > deps.maxMessageBytes) {
    return { outcome: 'rejected', reason: 'too_large' };
  }

  // 1. Normalize the envelope recipient.
  const recipient = normalizeAddress(email.to);
  if (!recipient) return { outcome: 'rejected', reason: 'invalid_recipient' };

  // Abuse blocklist (CLAUDE.md §12): reject blocked senders/recipients/domains.
  const sender = normalizeAddress(email.from)?.address ?? email.from.trim().toLowerCase();
  const blocked = await repos.blocklist.isBlocked([
    { type: 'sender', value: sender },
    { type: 'recipient', value: recipient.address },
    { type: 'domain', value: recipient.domain },
  ]);
  if (blocked) return { outcome: 'rejected', reason: 'blocked' };

  // 2. Confirm the recipient domain is active.
  const domain = await repos.domains.findByName(recipient.domain);
  if (!domain || domain.status !== 'active') {
    return { outcome: 'rejected', reason: 'inactive_domain' };
  }

  // 3. Look up an inbox by its full address. An expired inbox still accepts mail
  //    (it is revived below); only deleted and blocked inboxes stop delivery. If
  //    no inbox claims the address and the domain has catch-all enabled, fall
  //    back to the domain's catch-all inbox (owned by the domain owner). Mail to
  //    an inbox another user created still matches that inbox above, so the
  //    owner never sees it.
  const direct = await repos.inboxes.findByAddress(recipient.address);
  if (direct?.status === 'blocked') return { outcome: 'rejected', reason: 'blocked' };

  // A deleted inbox releases its address back to the domain's catch-all.
  let inbox = direct && direct.status !== 'deleted' ? direct : null;
  if (!inbox && domain.catch_all === 1) {
    const catchAll = await repos.inboxes.findByAddress(`*@${recipient.domain}`);
    if (catchAll && catchAll.status !== 'deleted' && catchAll.status !== 'blocked') {
      inbox = catchAll;
    }
  }
  if (!inbox) return { outcome: 'rejected', reason: 'unknown_recipient' };

  // Revive an expired mailbox rather than bouncing the message. Done before the
  // R2 write so the message never inherits an already-passed expiry.
  let expiresAt = inbox.expires_at;
  if (inbox.status === 'expired' || expiresAt <= now) {
    expiresAt = now + renewalSeconds(inbox, domain);
    await repos.inboxes.renew(inbox.id, expiresAt);
  }

  // 8. Generate a message id (idempotency: dedupe on provider Message-ID).
  const provider = providerMessageId(email.headers);
  if (provider) {
    const existing = await repos.messages.findByProviderId(inbox.id, provider);
    if (existing) return { outcome: 'duplicate', messageId: existing.id, inboxId: inbox.id };
  }

  const messageId = ulid(now * 1000);
  const r2RawKey = `raw/${inbox.id}/${messageId}.eml`;

  // 9. Stream raw MIME straight to R2. `message.raw` is an unknown-length
  //    stream, but R2 requires a known content length, so we pipe it through a
  //    FixedLengthStream (sized by rawSize) — still streaming, never buffering
  //    the whole message. If this fails, do NOT record acceptance (CLAUDE.md §7)
  //    — throw so Cloudflare retries.
  const fixed = new FixedLengthStream(email.rawSize);
  await Promise.all([
    email.raw.pipeTo(fixed.writable),
    deps.rawBucket.put(r2RawKey, fixed.readable, {
      customMetadata: {
        inbox_id: inbox.id,
        message_id: messageId,
        recipient: recipient.address,
      },
    }),
  ]);

  // 10. Insert the minimal record. Message expiry never exceeds inbox expiry.
  try {
    await repos.messages.insertReceived({
      id: messageId,
      inboxId: inbox.id,
      userId: inbox.user_id,
      providerMessageId: provider,
      r2RawKey,
      senderAddress: sender,
      recipientAddress: recipient.address,
      receivedAt: now,
      expiresAt,
      sizeBytes: email.rawSize,
    });
  } catch (err) {
    // A concurrent delivery of the same Message-ID loses the unique-index race:
    // treat as a duplicate rather than an error.
    if (provider && isUniqueViolation(err)) {
      const existing = await repos.messages.findByProviderId(inbox.id, provider);
      if (existing) return { outcome: 'duplicate', messageId: existing.id, inboxId: inbox.id };
    }
    throw err;
  }

  await repos.inboxes.touchLastMessage(inbox.id, now);

  // 11. Enqueue a small processing job (IDs + R2 key only).
  const job: EmailProcessingJob = {
    message_id: messageId,
    inbox_id: inbox.id,
    r2_raw_key: r2RawKey,
    recipient_address: recipient.address,
    received_at: now,
    size_bytes: email.rawSize,
  };
  await deps.queue.send(job);

  return { outcome: 'accepted', messageId, inboxId: inbox.id, r2RawKey };
}
