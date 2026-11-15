import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestEmail, type IngestDeps } from '../src/ingest.js';
import { countMessages, fakeEmail, recordingQueue, seedDomain, seedInbox } from './helpers.js';

function deps(
  queue = recordingQueue(),
  maxBytes = 15 * 1024 * 1024,
): IngestDeps & { queue: ReturnType<typeof recordingQueue> } {
  return {
    db: env.DB,
    rawBucket: env.MAIL_RAW_BUCKET,
    queue,
    maxMessageBytes: maxBytes,
  };
}

describe('ingestEmail', () => {
  let domainId: string;
  let inboxId: string;

  beforeEach(async () => {
    domainId = await seedDomain('public.example');
    inboxId = await seedInbox(domainId, 'someone@public.example');
  });

  it('streams raw MIME to R2, records the message, and enqueues one job', async () => {
    const d = deps();
    const result = await ingestEmail(fakeEmail({ to: 'someone@public.example' }), d);

    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;

    // Raw MIME is in R2.
    const object = await env.MAIL_RAW_BUCKET.get(result.r2RawKey);
    expect(object).not.toBeNull();
    expect(await object!.text()).toContain('Hello world.');

    // Exactly one processing job, matching the internal contract.
    expect(d.queue.sent).toHaveLength(1);
    expect(d.queue.sent[0]).toMatchObject({
      message_id: result.messageId,
      inbox_id: inboxId,
      r2_raw_key: result.r2RawKey,
      recipient_address: 'someone@public.example',
    });

    // One minimal message row, status received, and last_message_at advanced.
    expect(await countMessages(inboxId)).toBe(1);
    const row = await env.DB.prepare('SELECT status, size_bytes FROM messages WHERE id = ?1')
      .bind(result.messageId)
      .first<{ status: string; size_bytes: number }>();
    expect(row?.status).toBe('received');
    expect(row?.size_bytes).toBeGreaterThan(0);

    const inbox = await env.DB.prepare('SELECT last_message_at FROM inboxes WHERE id = ?1')
      .bind(inboxId)
      .first<{ last_message_at: number | null }>();
    expect(inbox?.last_message_at).not.toBeNull();
  });

  it('is idempotent: a repeated Message-ID does not create a second message', async () => {
    const d = deps();
    const email1 = fakeEmail({ to: 'someone@public.example', messageId: '<dup@example.net>' });
    const first = await ingestEmail(email1, d);
    expect(first.outcome).toBe('accepted');

    const email2 = fakeEmail({ to: 'someone@public.example', messageId: '<dup@example.net>' });
    const second = await ingestEmail(email2, d);
    expect(second.outcome).toBe('duplicate');

    expect(await countMessages(inboxId)).toBe(1);
    expect(d.queue.sent).toHaveLength(1);
  });

  it('rejects unknown recipients without writing anything', async () => {
    const d = deps();
    const result = await ingestEmail(fakeEmail({ to: 'nobody@public.example' }), d);
    expect(result).toEqual({ outcome: 'rejected', reason: 'unknown_recipient' });
    expect(d.queue.sent).toHaveLength(0);
    expect(await countMessages(inboxId)).toBe(0);
  });

  it('rejects mail for inactive domains', async () => {
    await seedDomain('paused.example', 'paused');
    const result = await ingestEmail(fakeEmail({ to: 'x@paused.example' }), deps());
    expect(result).toEqual({ outcome: 'rejected', reason: 'inactive_domain' });
  });

  it('accepts mail to an expired inbox and revives the inbox', async () => {
    const oldId = await seedInbox(domainId, 'old@public.example', {
      status: 'expired',
      expiresInSeconds: -10,
    });
    const d = deps();
    const result = await ingestEmail(fakeEmail({ to: 'old@public.example' }), d);

    expect(result.outcome).toBe('accepted');
    expect(d.queue.sent).toHaveLength(1);
    expect(await countMessages(oldId)).toBe(1);

    const nowS = Math.floor(Date.now() / 1000);
    const inbox = await env.DB.prepare('SELECT status, expires_at FROM inboxes WHERE id = ?1')
      .bind(oldId)
      .first<{ status: string; expires_at: number }>();
    expect(inbox?.status).toBe('active');
    expect(inbox?.expires_at).toBeGreaterThan(nowS);

    // The message never inherits the already-passed inbox expiry.
    const message = await env.DB.prepare('SELECT expires_at FROM messages WHERE inbox_id = ?1')
      .bind(oldId)
      .first<{ expires_at: number }>();
    expect(message?.expires_at).toBe(inbox?.expires_at);
  });

  it('rejects mail to a blocked inbox', async () => {
    await seedInbox(domainId, 'bad@public.example', { status: 'blocked' });
    const result = await ingestEmail(fakeEmail({ to: 'bad@public.example' }), deps());
    expect(result).toEqual({ outcome: 'rejected', reason: 'blocked' });
  });

  it('rejects mail to a deleted inbox when the domain has no catch-all', async () => {
    await seedInbox(domainId, 'gone@public.example', { status: 'deleted' });
    const result = await ingestEmail(fakeEmail({ to: 'gone@public.example' }), deps());
    expect(result).toEqual({ outcome: 'rejected', reason: 'unknown_recipient' });
  });

  it('rejects oversized messages before any lookup', async () => {
    const result = await ingestEmail(
      fakeEmail({ to: 'someone@public.example' }),
      deps(recordingQueue(), 4),
    );
    expect(result).toEqual({ outcome: 'rejected', reason: 'too_large' });
    expect(await countMessages(inboxId)).toBe(0);
  });

  it('normalizes the recipient before matching (case/whitespace)', async () => {
    const result = await ingestEmail(fakeEmail({ to: '  SOMEONE@Public.Example ' }), deps());
    expect(result.outcome).toBe('accepted');
  });
});
