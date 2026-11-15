import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ulid } from '@tmp-mail/shared';
import { ingestEmail, type IngestDeps } from '../src/ingest.js';
import { fakeEmail, recordingQueue } from './helpers.js';

const now = () => Math.floor(Date.now() / 1000);

function deps(queue = recordingQueue()): IngestDeps & { queue: ReturnType<typeof recordingQueue> } {
  return { db: env.DB, rawBucket: env.MAIL_RAW_BUCKET, queue, maxMessageBytes: 15 * 1024 * 1024 };
}

async function seedCatchAllDomain(name: string): Promise<{ domainId: string; ownerId: string }> {
  const ts = now();
  const domainId = ulid();
  const ownerId = ulid();
  await env.DB.prepare(
    `INSERT INTO users (id,email,username,role,status,created_at,updated_at) VALUES (?1,?2,?2,'user','active',?3,?3)`,
  )
    .bind(ownerId, `owner-${ownerId.slice(-6).toLowerCase()}`, ts)
    .run();
  await env.DB.prepare(
    `INSERT INTO domains (id,name,zone_id,status,pool_type,allow_anonymous_inboxes,allow_custom_local_parts,max_inbox_ttl_seconds,catch_all,created_at,updated_at)
     VALUES (?1,?2,NULL,'active','public',1,1,86400,1,?3,?3)`,
  )
    .bind(domainId, name, ts)
    .run();
  // The domain's catch-all inbox, owned by the owner.
  await env.DB.prepare(
    `INSERT INTO inboxes (id,user_id,domain_id,local_part,address,access_token_hash,status,expires_at,created_at,last_message_at)
     VALUES (?1,?2,?3,'*',?4,'hash','active',?5,?6,NULL)`,
  )
    .bind(ulid(), ownerId, domainId, `*@${name}`, now() + 86400, ts)
    .run();
  return { domainId, ownerId };
}

describe('catch-all delivery', () => {
  let ownerId: string;
  let domainId: string;

  beforeEach(async () => {
    const seeded = await seedCatchAllDomain('catch.example');
    ownerId = seeded.ownerId;
    domainId = seeded.domainId;
  });

  it('routes an unmatched address to the owner’s catch-all inbox', async () => {
    const result = await ingestEmail(fakeEmail({ to: 'anything-random@catch.example' }), deps());
    expect(result.outcome).toBe('accepted');

    const row = await env.DB.prepare(
      'SELECT user_id, recipient_address FROM messages WHERE inbox_id = (SELECT id FROM inboxes WHERE address = ?1)',
    )
      .bind('*@catch.example')
      .first<{ user_id: string; recipient_address: string }>();
    expect(row?.user_id).toBe(ownerId); // shows in the owner's unibox
    expect(row?.recipient_address).toBe('anything-random@catch.example'); // real target preserved
  });

  it('does NOT capture mail to an inbox another user explicitly created', async () => {
    // A different user claims a specific address on the same domain.
    const otherUser = ulid();
    const ts = now();
    await env.DB.prepare(
      `INSERT INTO users (id,email,username,role,status,created_at,updated_at) VALUES (?1,?2,?2,'user','active',?3,?3)`,
    )
      .bind(otherUser, `other-${otherUser.slice(-6).toLowerCase()}`, ts)
      .run();
    await env.DB.prepare(
      `INSERT INTO inboxes (id,user_id,domain_id,local_part,address,access_token_hash,status,expires_at,created_at,last_message_at)
       VALUES (?1,?2,?3,'claimed',?4,'hash','active',?5,?6,NULL)`,
    )
      .bind(ulid(), otherUser, domainId, 'claimed@catch.example', ts + 86400, ts)
      .run();

    const result = await ingestEmail(fakeEmail({ to: 'claimed@catch.example' }), deps());
    expect(result.outcome).toBe('accepted');

    // The message belongs to the OTHER user, not the catch-all owner.
    const row = await env.DB.prepare(
      "SELECT user_id FROM messages WHERE recipient_address = 'claimed@catch.example'",
    ).first<{ user_id: string }>();
    expect(row?.user_id).toBe(otherUser);
    expect(row?.user_id).not.toBe(ownerId);
  });

  it('routes mail for a deleted inbox to the catch-all instead of bouncing', async () => {
    const ts = now();
    await env.DB.prepare(
      `INSERT INTO inboxes (id,user_id,domain_id,local_part,address,access_token_hash,status,expires_at,created_at,last_message_at)
       VALUES (?1,NULL,?2,'gone',?3,'hash','deleted',?4,?5,NULL)`,
    )
      .bind(ulid(), domainId, 'gone@catch.example', ts + 3600, ts)
      .run();

    const result = await ingestEmail(fakeEmail({ to: 'gone@catch.example' }), deps());
    expect(result.outcome).toBe('accepted');

    const row = await env.DB.prepare(
      "SELECT user_id FROM messages WHERE recipient_address = 'gone@catch.example'",
    ).first<{ user_id: string }>();
    expect(row?.user_id).toBe(ownerId);
  });

  it('still rejects unmatched mail when catch-all is off', async () => {
    await env.DB.prepare('UPDATE domains SET catch_all = 0 WHERE id = ?1').bind(domainId).run();
    const result = await ingestEmail(fakeEmail({ to: 'nobody@catch.example' }), deps());
    expect(result).toEqual({ outcome: 'rejected', reason: 'unknown_recipient' });
  });
});
