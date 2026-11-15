import { Hono } from 'hono';
import type { Context } from 'hono';
import { AppError, nowSeconds, toRfc3339, ulid, validationError } from '@tmp-mail/shared';
import {
  createWebhookRequestSchema,
  updateWebhookRequestSchema,
  type WebhookMetadata,
} from '@tmp-mail/contracts';
import type { WebhookDeliveryRow, WebhookRow } from '@tmp-mail/database';
import { encryptSecret, generateWebhookSecret, isSafeWebhookUrl } from '@tmp-mail/security';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import { assertScope, type Scope, type UserCaller } from '../auth/caller.js';
import { audit } from '../services/audit.js';

// Webhook management (CLAUDE.md §11). Session or API key (webhooks:read/write).
export const webhookRoutes = new Hono<HonoEnv>();

async function requireUser(c: Context<HonoEnv>, scope: Scope): Promise<UserCaller> {
  const caller = await resolveCaller(c);
  if (caller.kind !== 'user') throw new AppError('unauthorized', 'Not authenticated.');
  assertScope(caller, scope);
  return caller;
}

function assertSameOrigin(c: Context<HonoEnv>): void {
  const { config } = c.get('ctx');
  const origin = c.req.header('Origin');
  if (!origin) return;
  const allowed = new Set([config.APP_BASE_URL, ...config.CORS_ORIGINS]);
  if (!allowed.has(origin)) throw new AppError('forbidden', 'Cross-origin request rejected.');
}

function encryptionKey(c: Context<HonoEnv>): string {
  const key = c.get('ctx').config.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!key) throw new AppError('internal_error', 'Webhooks are not configured.');
  return key;
}

function parseEvents(json: string): string[] {
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function serialize(row: WebhookRow): WebhookMetadata {
  return {
    id: row.id,
    url: row.url,
    events: parseEvents(row.events_json),
    status: row.status,
    failure_count: row.failure_count,
    created_at: toRfc3339(row.created_at),
    updated_at: toRfc3339(row.updated_at),
  };
}

function serializeDelivery(row: WebhookDeliveryRow) {
  return {
    id: row.id,
    event_id: row.event_id,
    event_type: row.event_type,
    status: row.status,
    attempt: row.attempt,
    response_status: row.response_status,
    created_at: toRfc3339(row.created_at),
    delivered_at: row.delivered_at === null ? null : toRfc3339(row.delivered_at),
  };
}

/** Load a webhook the caller owns, or 404. */
async function loadOwned(c: Context<HonoEnv>, caller: UserCaller): Promise<WebhookRow> {
  const { repos } = c.get('ctx');
  const wh = await repos.webhooks.findById(c.req.param('id') ?? '');
  if (!wh || wh.user_id !== caller.userId) throw new AppError('not_found', 'Webhook not found.');
  return wh;
}

webhookRoutes.get('/v1/webhooks', async (c) => {
  const caller = await requireUser(c, 'webhooks:read');
  const { repos } = c.get('ctx');
  const rows = await repos.webhooks.listByUser(caller.userId);
  return c.json({ data: rows.map(serialize) });
});

webhookRoutes.post('/v1/webhooks', async (c) => {
  assertSameOrigin(c);
  const caller = await requireUser(c, 'webhooks:write');
  const key = encryptionKey(c);
  const { repos } = c.get('ctx');

  const parsed = createWebhookRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError('Provide a valid https url and at least one event.');
  const safe = isSafeWebhookUrl(parsed.data.url);
  if (!safe.ok) throw validationError(`Invalid webhook URL: ${safe.reason}.`);

  const secret = generateWebhookSecret();
  const id = ulid();
  await repos.webhooks.create({
    id,
    userId: caller.userId,
    url: parsed.data.url,
    secretEncrypted: await encryptSecret(secret, key),
    eventsJson: JSON.stringify(parsed.data.events),
    createdAt: nowSeconds(),
  });
  await audit(c, { actorUserId: caller.userId, action: 'webhook.create', target: id });
  const row = await repos.webhooks.findById(id);
  return c.json({ data: { ...serialize(row!), secret } }, 201);
});

webhookRoutes.patch('/v1/webhooks/:id', async (c) => {
  assertSameOrigin(c);
  const caller = await requireUser(c, 'webhooks:write');
  const { repos } = c.get('ctx');
  await loadOwned(c, caller);

  const parsed = updateWebhookRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError('Invalid webhook update.');
  if (parsed.data.url) {
    const safe = isSafeWebhookUrl(parsed.data.url);
    if (!safe.ok) throw validationError(`Invalid webhook URL: ${safe.reason}.`);
  }
  await repos.webhooks.update(c.req.param('id')!, caller.userId, {
    url: parsed.data.url,
    eventsJson: parsed.data.events ? JSON.stringify(parsed.data.events) : undefined,
    status: parsed.data.status,
  });
  const row = await repos.webhooks.findById(c.req.param('id')!);
  return c.json({ data: serialize(row!) });
});

webhookRoutes.delete('/v1/webhooks/:id', async (c) => {
  assertSameOrigin(c);
  const caller = await requireUser(c, 'webhooks:write');
  const { repos } = c.get('ctx');
  const changed = await repos.webhooks.delete(c.req.param('id') ?? '', caller.userId);
  if (changed === 0) throw new AppError('not_found', 'Webhook not found.');
  await audit(c, {
    actorUserId: caller.userId,
    action: 'webhook.delete',
    target: c.req.param('id'),
  });
  return c.body(null, 204);
});

webhookRoutes.post('/v1/webhooks/:id/rotate-secret', async (c) => {
  assertSameOrigin(c);
  const caller = await requireUser(c, 'webhooks:write');
  const key = encryptionKey(c);
  const { repos } = c.get('ctx');
  await loadOwned(c, caller);

  const secret = generateWebhookSecret();
  await repos.webhooks.rotateSecret(
    c.req.param('id')!,
    caller.userId,
    await encryptSecret(secret, key),
  );
  await audit(c, {
    actorUserId: caller.userId,
    action: 'webhook.rotate_secret',
    target: c.req.param('id'),
  });
  const row = await repos.webhooks.findById(c.req.param('id')!);
  return c.json({ data: { ...serialize(row!), secret } });
});

webhookRoutes.post('/v1/webhooks/:id/test', async (c) => {
  assertSameOrigin(c);
  const caller = await requireUser(c, 'webhooks:write');
  const { repos } = c.get('ctx');
  const wh = await loadOwned(c, caller);

  const now = nowSeconds();
  const eventId = `evt_${ulid(now * 1000)}`;
  const deliveryId = ulid();
  const payload = JSON.stringify({
    id: eventId,
    type: 'message.received',
    created_at: toRfc3339(now),
    data: { test: true, webhook_id: wh.id },
  });
  await repos.webhookDeliveries.create({
    id: deliveryId,
    webhookId: wh.id,
    eventId,
    eventType: 'message.received',
    dedupeKey: `test:${deliveryId}`,
    payloadJson: payload,
    createdAt: now,
  });
  await c.env.WEBHOOK_DELIVERY_QUEUE.send({ delivery_id: deliveryId });
  return c.json({ data: { delivery_id: deliveryId, status: 'queued' } }, 202);
});

webhookRoutes.get('/v1/webhooks/:id/deliveries', async (c) => {
  const caller = await requireUser(c, 'webhooks:read');
  const { repos } = c.get('ctx');
  const wh = await loadOwned(c, caller);
  const rows = await repos.webhookDeliveries.listByWebhook(wh.id, 50);
  return c.json({ data: rows.map(serializeDelivery) });
});
