import { env } from 'cloudflare:test';
import { ulid, type EmailProcessingJob } from '@tmp-mail/shared';

const nowS = () => Math.floor(Date.now() / 1000);

/** Seed domain + inbox + a `received` message and store its raw MIME in R2. */
export async function seedReceivedMessage(rawMime: string): Promise<EmailProcessingJob> {
  const ts = nowS();
  const domainId = ulid();
  const inboxId = ulid();
  const messageId = ulid();
  const r2Key = `raw/${inboxId}/${messageId}.eml`;
  const address = `user-${messageId.slice(-6).toLowerCase()}@public.example`;

  await env.DB.prepare(
    `INSERT INTO domains (id,name,zone_id,status,pool_type,allow_anonymous_inboxes,allow_custom_local_parts,max_inbox_ttl_seconds,created_at,updated_at)
     VALUES (?1,?2,NULL,'active','public',1,1,86400,?3,?3)`,
  )
    .bind(domainId, `d-${domainId.slice(-6).toLowerCase()}.example`, ts)
    .run();

  await env.DB.prepare(
    `INSERT INTO inboxes (id,user_id,domain_id,local_part,address,access_token_hash,status,expires_at,created_at,last_message_at)
     VALUES (?1,NULL,?2,'user',?3,'hash','active',?4,?5,NULL)`,
  )
    .bind(inboxId, domainId, address, ts + 3600, ts)
    .run();

  await env.DB.prepare(
    `INSERT INTO messages (id,inbox_id,provider_message_id,r2_raw_key,sender_address,recipient_address,received_at,expires_at,status,size_bytes,has_attachments)
     VALUES (?1,?2,NULL,?3,'unknown@sender',?4,?5,?6,'received',?7,0)`,
  )
    .bind(messageId, inboxId, r2Key, address, ts, ts + 3600, rawMime.length)
    .run();

  await env.MAIL_RAW_BUCKET.put(r2Key, rawMime);

  return {
    message_id: messageId,
    inbox_id: inboxId,
    r2_raw_key: r2Key,
    recipient_address: address,
    received_at: ts,
    size_bytes: rawMime.length,
  };
}

export async function getMessage(id: string) {
  return env.DB.prepare('SELECT * FROM messages WHERE id = ?1').bind(id).first<{
    status: string;
    subject: string;
    text_body: string | null;
    html_body_sanitized: string | null;
    snippet: string;
    has_attachments: number;
    sender_address: string;
  }>();
}

export async function listAttachments(messageId: string) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM attachments WHERE message_id = ?1 ORDER BY id ASC',
  )
    .bind(messageId)
    .all<{
      id: string;
      r2_key: string;
      safe_filename: string;
      content_type: string;
      scan_status: string;
      size_bytes: number;
    }>();
  return results;
}
