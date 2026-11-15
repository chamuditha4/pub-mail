import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ulid } from '@tmp-mail/shared';
import { ingestEmail, type IngestDeps } from '../src/ingest.js';
import { fakeEmail, recordingQueue, seedDomain, seedInbox } from './helpers.js';

function deps(queue = recordingQueue()): IngestDeps & { queue: ReturnType<typeof recordingQueue> } {
  return { db: env.DB, rawBucket: env.MAIL_RAW_BUCKET, queue, maxMessageBytes: 15 * 1024 * 1024 };
}

async function block(entryType: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO blocklist (id, entry_type, value, reason, created_by, created_at) VALUES (?1,?2,?3,NULL,NULL,?4)',
  )
    .bind(ulid(), entryType, value, Math.floor(Date.now() / 1000))
    .run();
}

describe('blocklist enforcement at ingestion', () => {
  beforeEach(async () => {
    const domainId = await seedDomain('block.example');
    await seedInbox(domainId, 'target@block.example');
  });

  it('rejects a blocked sender', async () => {
    await block('sender', 'spammer@bad.example');
    const result = await ingestEmail(
      fakeEmail({ to: 'target@block.example', from: 'spammer@bad.example' }),
      deps(),
    );
    expect(result).toEqual({ outcome: 'rejected', reason: 'blocked' });
  });

  it('rejects a blocked recipient', async () => {
    await block('recipient', 'target@block.example');
    const result = await ingestEmail(fakeEmail({ to: 'target@block.example' }), deps());
    expect(result).toEqual({ outcome: 'rejected', reason: 'blocked' });
  });

  it('rejects a blocked domain', async () => {
    await block('domain', 'block.example');
    const result = await ingestEmail(fakeEmail({ to: 'target@block.example' }), deps());
    expect(result).toEqual({ outcome: 'rejected', reason: 'blocked' });
  });

  it('accepts when nothing is blocked', async () => {
    const result = await ingestEmail(fakeEmail({ to: 'target@block.example' }), deps());
    expect(result.outcome).toBe('accepted');
  });
});
