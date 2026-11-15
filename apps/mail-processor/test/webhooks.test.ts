import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ulid } from '@tmp-mail/shared';
import { encryptSecret, signWebhook } from '@tmp-mail/security';
import { deliverWebhook, enqueueMessageWebhooks, type WebhookDeps } from '../src/webhooks.js';

const KEY = 'REPLACE-ME-set-a-wrangler-secret-0000';
const now = () => Math.floor(Date.now() / 1000);

function recordingQueue() {
  const sent: Array<{ delivery_id: string }> = [];
  return { sent, send: async (b: { delivery_id: string }) => void sent.push(b) };
}

function deps(
  queue = recordingQueue(),
  fixedNow?: number,
): WebhookDeps & { sent: Array<{ delivery_id: string }> } {
  return {
    db: env.DB,
    queue: queue as unknown as WebhookDeps['queue'],
    encryptionKey: KEY,
    sent: queue.sent,
    ...(fixedNow ? { now: () => fixedNow } : {}),
  };
}

async function seedUser(): Promise<string> {
  const id = ulid();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO users (id,email,username,role,status,created_at,updated_at) VALUES (?1,?2,?2,'user','active',?3,?3)`,
  )
    .bind(id, `u-${id.slice(-6).toLowerCase()}`, ts)
    .run();
  return id;
}

async function seedWebhook(
  userId: string,
  url: string,
  events: string[],
  secret = 'whsec_test123',
): Promise<string> {
  const id = ulid();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO webhooks (id,user_id,url,secret_encrypted,events_json,status,failure_count,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,'active',0,?6,?6)`,
  )
    .bind(id, userId, url, await encryptSecret(secret, KEY), JSON.stringify(events), ts)
    .run();
  return id;
}

function fakeMessage(userId: string, id = ulid()) {
  return {
    id,
    inbox_id: ulid(),
    user_id: userId,
    provider_message_id: null,
    r2_raw_key: 'raw/x',
    sender_address: 's@x',
    sender_name: null,
    recipient_address: 'r@x',
    subject: 'Hi',
    text_body: null,
    html_body_sanitized: null,
    snippet: 'preview',
    received_at: now(),
    processed_at: now(),
    expires_at: now() + 3600,
    status: 'ready' as const,
    size_bytes: 10,
    has_attachments: 0,
    spam_classification: null,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('webhook fan-out and delivery', () => {
  it('enqueues one delivery per subscribed webhook and dedupes reprocessing', async () => {
    const userId = await seedUser();
    await seedWebhook(userId, 'https://hooks.example.com/a', ['message.ready']);
    await seedWebhook(userId, 'https://hooks.example.com/b', ['message.failed']); // not subscribed
    const message = fakeMessage(userId);

    const d = deps();
    expect(await enqueueMessageWebhooks(d, message, 'message.ready')).toBe(1);
    expect(d.sent).toHaveLength(1);

    // Reprocessing the same message does not enqueue again.
    expect(await enqueueMessageWebhooks(d, message, 'message.ready')).toBe(0);
  });

  it('signs and POSTs the delivery, then marks it delivered', async () => {
    const userId = await seedUser();
    const secret = 'whsec_signme';
    const webhookId = await seedWebhook(
      userId,
      'https://hooks.example.com/x',
      ['message.ready'],
      secret,
    );

    const captured: { headers?: Headers; body?: string } = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured.headers = new Headers(init.headers);
      captured.body = init.body as string;
      return new Response('', { status: 200 });
    });

    const fixed = 1_700_000_000;
    const message = fakeMessage(userId);
    const d = deps(recordingQueue(), fixed);
    await enqueueMessageWebhooks(d, message, 'message.ready');
    const deliveryId = d.sent[0]!.delivery_id;

    const outcome = await deliverWebhook(d, deliveryId);
    expect(outcome).toEqual({ retry: false });

    // Signature is HMAC over timestamp.event_id.body with the webhook secret.
    const row = await env.DB.prepare(
      'SELECT status, event_id, payload_json FROM webhook_deliveries WHERE id = ?1',
    )
      .bind(deliveryId)
      .first<{ status: string; event_id: string; payload_json: string }>();
    expect(row?.status).toBe('delivered');
    const expected = await signWebhook(secret, fixed, row!.event_id, row!.payload_json);
    expect(captured.headers?.get('Webhook-Signature')).toBe(`v1=${expected}`);
    expect(captured.headers?.get('Webhook-Id')).toBe(row!.event_id);
    expect(webhookId).toBeTruthy();
  });

  it('retries with a delay on a 5xx response', async () => {
    const userId = await seedUser();
    await seedWebhook(userId, 'https://hooks.example.com/fail', ['message.ready']);
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));

    const d = deps();
    await enqueueMessageWebhooks(d, fakeMessage(userId), 'message.ready');
    const deliveryId = d.sent[0]!.delivery_id;

    const outcome = await deliverWebhook(d, deliveryId);
    expect(outcome.retry).toBe(true);
    if (outcome.retry) expect(outcome.delaySeconds).toBeGreaterThan(0);

    const row = await env.DB.prepare('SELECT status, attempt FROM webhook_deliveries WHERE id = ?1')
      .bind(deliveryId)
      .first<{ status: string; attempt: number }>();
    expect(row?.status).toBe('failed');
    expect(row?.attempt).toBe(1);
  });

  it('refuses to deliver to an unsafe (SSRF) URL', async () => {
    const userId = await seedUser();
    await seedWebhook(userId, 'https://127.0.0.1/internal', ['message.ready']);
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    const d = deps();
    await enqueueMessageWebhooks(d, fakeMessage(userId), 'message.ready');
    const outcome = await deliverWebhook(d, d.sent[0]!.delivery_id);
    expect(outcome).toEqual({ retry: false });
    expect(spy).not.toHaveBeenCalled();
  });
});
