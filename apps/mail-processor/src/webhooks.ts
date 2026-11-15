import type { D1Database, Queue } from '@cloudflare/workers-types';
import { createRepositories, type MessageRow, type Repositories } from '@tmp-mail/database';
import {
  nowSeconds,
  toRfc3339,
  ulid,
  type WebhookDeliveryJob,
  type WebhookEventType,
} from '@tmp-mail/shared';
import { decryptSecret, isSafeWebhookUrl, signWebhook } from '@tmp-mail/security';

const MAX_ATTEMPTS = 6;
const DISABLE_THRESHOLD = 10;
const DELIVER_TIMEOUT_MS = 10_000;

export interface WebhookDeps {
  db: D1Database;
  queue: Queue<WebhookDeliveryJob>;
  encryptionKey: string;
  now?: () => number;
  repos?: Repositories;
}

function webhookHasEvent(eventsJson: string, event: WebhookEventType): boolean {
  try {
    const arr = JSON.parse(eventsJson) as unknown;
    return Array.isArray(arr) && arr.includes(event);
  } catch {
    return false;
  }
}

function messagePayload(eventType: WebhookEventType, message: MessageRow, now: number): string {
  return JSON.stringify({
    id: `evt_${ulid(now * 1000)}`,
    type: eventType,
    created_at: toRfc3339(now),
    data: {
      message: {
        id: message.id,
        inbox_id: message.inbox_id,
        subject: message.subject,
        sender_address: message.sender_address,
        sender_name: message.sender_name,
        snippet: message.snippet,
        recipient_address: message.recipient_address,
        received_at: toRfc3339(message.received_at),
        has_attachments: message.has_attachments === 1,
      },
    },
  });
}

/**
 * Create + enqueue webhook deliveries for a message event, to the message's
 * owner's active webhooks that subscribe to it. Deduped per (webhook, event) so
 * the event is delivered once despite reprocessing.
 */
export async function enqueueMessageWebhooks(
  deps: WebhookDeps,
  message: MessageRow,
  eventType: WebhookEventType,
): Promise<number> {
  if (message.user_id === null) return 0; // anonymous mail has no webhooks
  const repos = deps.repos ?? createRepositories(deps.db);
  const now = (deps.now ?? nowSeconds)();

  const webhooks = await repos.webhooks.listActiveByUser(message.user_id);
  let enqueued = 0;
  for (const wh of webhooks) {
    if (!webhookHasEvent(wh.events_json, eventType)) continue;
    const payload = messagePayload(eventType, message, now);
    const eventId = (JSON.parse(payload) as { id: string }).id;
    const deliveryId = ulid();
    const created = await repos.webhookDeliveries.create({
      id: deliveryId,
      webhookId: wh.id,
      eventId,
      eventType,
      dedupeKey: `${eventType}:${message.id}`,
      payloadJson: payload,
      createdAt: now,
    });
    if (created) {
      await deps.queue.send({ delivery_id: deliveryId });
      enqueued += 1;
    }
  }
  return enqueued;
}

export type DeliveryOutcome = { retry: false } | { retry: true; delaySeconds: number };

/** Backoff with jitter (CLAUDE.md §11). */
function backoffSeconds(attempt: number): number {
  const base = Math.min(3600, 2 ** attempt * 10); // 20s, 40s, 80s, … capped 1h
  const jitter = Math.floor(Math.random() * Math.min(30, base));
  return base + jitter;
}

/**
 * Attempt a single webhook delivery. Returns whether the queue should retry and
 * with what delay. Signs the stored payload; never follows redirects; refuses
 * unsafe URLs (SSRF).
 */
export async function deliverWebhook(
  deps: WebhookDeps,
  deliveryId: string,
): Promise<DeliveryOutcome> {
  const repos = deps.repos ?? createRepositories(deps.db);
  const now = (deps.now ?? nowSeconds)();

  const delivery = await repos.webhookDeliveries.findById(deliveryId);
  if (!delivery || delivery.status === 'delivered' || delivery.status === 'dead') {
    return { retry: false };
  }
  const webhook = await repos.webhooks.findById(delivery.webhook_id);
  if (!webhook || webhook.status !== 'active') {
    await repos.webhookDeliveries.markAttempt(deliveryId, delivery.attempt, 'dead', null, null);
    return { retry: false };
  }

  const safe = isSafeWebhookUrl(webhook.url);
  if (!safe.ok) {
    await repos.webhookDeliveries.markAttempt(deliveryId, delivery.attempt + 1, 'dead', null, null);
    await repos.webhooks.recordFailure(webhook.id, DISABLE_THRESHOLD);
    return { retry: false };
  }

  const attempt = delivery.attempt + 1;
  const timestamp = now;
  let secret: string;
  try {
    secret = await decryptSecret(webhook.secret_encrypted, deps.encryptionKey);
  } catch {
    await repos.webhookDeliveries.markAttempt(deliveryId, attempt, 'dead', null, null);
    return { retry: false };
  }
  const signature = await signWebhook(secret, timestamp, delivery.event_id, delivery.payload_json);

  let responseStatus: number | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS);
    const res = await fetch(webhook.url, {
      method: 'POST',
      redirect: 'manual', // never follow redirects (SSRF)
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'tmpmail-webhooks/1',
        'Webhook-Id': delivery.event_id,
        'Webhook-Timestamp': String(timestamp),
        'Webhook-Signature': `v1=${signature}`,
      },
      body: delivery.payload_json,
    });
    clearTimeout(timer);
    responseStatus = res.status;
    if (res.status >= 200 && res.status < 300) {
      await repos.webhookDeliveries.markDelivered(deliveryId, res.status, now);
      await repos.webhooks.resetFailure(webhook.id);
      return { retry: false };
    }
  } catch {
    responseStatus = null; // network error / timeout
  }

  // Failed attempt.
  if (attempt >= MAX_ATTEMPTS) {
    await repos.webhookDeliveries.markAttempt(deliveryId, attempt, 'dead', responseStatus, null);
    await repos.webhooks.recordFailure(webhook.id, DISABLE_THRESHOLD);
    return { retry: false };
  }
  const delay = backoffSeconds(attempt);
  await repos.webhookDeliveries.markAttempt(
    deliveryId,
    attempt,
    'failed',
    responseStatus,
    now + delay,
  );
  return { retry: true, delaySeconds: delay };
}
