import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ulid } from '@tmp-mail/shared';
import { runRetention } from '../src/retention.js';

const past = () => Math.floor(Date.now() / 1000) - 3600;
const future = () => Math.floor(Date.now() / 1000) + 3600;

async function seedDomainInbox(userId: string | null, expiresAt: number): Promise<string> {
  const domainId = ulid();
  const inboxId = ulid();
  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO domains (id,name,zone_id,status,pool_type,allow_anonymous_inboxes,allow_custom_local_parts,max_inbox_ttl_seconds,created_at,updated_at)
     VALUES (?1,?2,NULL,'active','public',1,1,86400,?3,?3)`,
  )
    .bind(domainId, `d-${domainId.slice(-6).toLowerCase()}.example`, ts)
    .run();
  await env.DB.prepare(
    `INSERT INTO inboxes (id,user_id,domain_id,local_part,address,access_token_hash,status,expires_at,created_at,last_message_at)
     VALUES (?1,?2,?3,'lp',?4,'hash','active',?5,?6,NULL)`,
  )
    .bind(
      inboxId,
      userId,
      domainId,
      `a-${inboxId.slice(-6).toLowerCase()}@x.example`,
      expiresAt,
      ts,
    )
    .run();
  return inboxId;
}

async function seedMessage(
  inboxId: string,
  userId: string | null,
  expiresAt: number,
): Promise<{ id: string; rawKey: string }> {
  const id = ulid();
  const rawKey = `raw/${inboxId}/${id}.eml`;
  await env.DB.prepare(
    `INSERT INTO messages (id,inbox_id,user_id,provider_message_id,r2_raw_key,sender_address,recipient_address,received_at,expires_at,status,size_bytes,has_attachments)
     VALUES (?1,?2,?3,NULL,?4,'s@x','r@x',?5,?6,'ready',10,1)`,
  )
    .bind(id, inboxId, userId, rawKey, expiresAt - 3600, expiresAt)
    .run();
  await env.MAIL_RAW_BUCKET.put(rawKey, 'raw mime bytes');
  return { id, rawKey };
}

async function seedAttachment(messageId: string): Promise<string> {
  const id = ulid();
  const key = `att/${messageId}/${id}`;
  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO attachments (id,message_id,r2_key,original_filename,safe_filename,content_type,size_bytes,content_id,disposition,scan_status,created_at,expires_at)
     VALUES (?1,?2,?3,'f.txt','f.txt','text/plain',5,NULL,'attachment','not_scanned',?4,?4)`,
  )
    .bind(id, messageId, key, ts)
    .run();
  await env.MAIL_ATTACHMENT_BUCKET.put(key, 'attachment bytes');
  return key;
}

async function seedUser(): Promise<string> {
  const id = ulid();
  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO users (id,email,username,role,status,created_at,updated_at)
     VALUES (?1,?2,?2,'user','active',?3,?3)`,
  )
    .bind(id, `u-${id.slice(-6).toLowerCase()}`, ts)
    .run();
  return id;
}

function deps() {
  return {
    db: env.DB,
    rawBucket: env.MAIL_RAW_BUCKET,
    attachmentBucket: env.MAIL_ATTACHMENT_BUCKET,
  };
}

describe('runRetention', () => {
  it('marks expired inboxes and physically purges anonymous expired content', async () => {
    const inbox = await seedDomainInbox(null, past());
    const { id: messageId, rawKey } = await seedMessage(inbox, null, past());
    const attKey = await seedAttachment(messageId);

    const result = await runRetention(deps());
    expect(result.expiredInboxes).toBeGreaterThanOrEqual(1);
    expect(result.purgedMessages).toBeGreaterThanOrEqual(1);

    // Inbox marked expired.
    const inboxRow = await env.DB.prepare('SELECT status FROM inboxes WHERE id = ?1')
      .bind(inbox)
      .first<{ status: string }>();
    expect(inboxRow?.status).toBe('expired');

    // Message row and its attachments gone.
    const msgRow = await env.DB.prepare('SELECT id FROM messages WHERE id = ?1')
      .bind(messageId)
      .first();
    expect(msgRow).toBeNull();
    const attRow = await env.DB.prepare('SELECT id FROM attachments WHERE message_id = ?1')
      .bind(messageId)
      .first();
    expect(attRow).toBeNull();

    // R2 objects physically removed.
    expect(await env.MAIL_RAW_BUCKET.head(rawKey)).toBeNull();
    expect(await env.MAIL_ATTACHMENT_BUCKET.head(attKey)).toBeNull();
  });

  it('retains signed-in users’ expired mail', async () => {
    const userId = await seedUser();
    const inbox = await seedDomainInbox(userId, past());
    const { id: messageId, rawKey } = await seedMessage(inbox, userId, past());

    await runRetention(deps());

    // The user's message and raw content survive despite expiry.
    const msgRow = await env.DB.prepare('SELECT id FROM messages WHERE id = ?1')
      .bind(messageId)
      .first();
    expect(msgRow).not.toBeNull();
    expect(await env.MAIL_RAW_BUCKET.head(rawKey)).not.toBeNull();
  });

  it('does not purge an unexpired anonymous message', async () => {
    const inbox = await seedDomainInbox(null, future());
    const { id: messageId } = await seedMessage(inbox, null, future());
    await runRetention(deps());
    const msgRow = await env.DB.prepare('SELECT id FROM messages WHERE id = ?1')
      .bind(messageId)
      .first();
    expect(msgRow).not.toBeNull();
  });

  it('deletes expired sessions', async () => {
    const userId = await seedUser();
    const ts = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      'INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)',
    )
      .bind(ulid(), userId, ts - 7200, ts - 60)
      .run();

    const result = await runRetention(deps());
    expect(result.deletedSessions).toBeGreaterThanOrEqual(1);
  });
});
