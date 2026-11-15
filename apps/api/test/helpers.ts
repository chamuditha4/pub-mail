import { env } from 'cloudflare:test';
import { ulid } from '@tmp-mail/shared';
import { hashSecret } from '@tmp-mail/security';

const now = () => Math.floor(Date.now() / 1000);

export async function seedUser(username: string): Promise<string> {
  const id = ulid();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, username, name, avatar_url, role, status, created_at, updated_at)
     VALUES (?1, ?2, ?2, NULL, NULL, 'user', 'active', ?3, ?3)`,
  )
    .bind(id, username, ts)
    .run();
  return id;
}

export async function seedAdmin(username: string): Promise<string> {
  const id = ulid();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, username, name, avatar_url, role, status, created_at, updated_at)
     VALUES (?1, ?2, ?2, NULL, NULL, 'admin', 'active', ?3, ?3)`,
  )
    .bind(id, username, ts)
    .run();
  return id;
}

/** Create a valid session for a user and return the cookie token. */
export async function createSession(userId: string): Promise<string> {
  const token = `sess_${ulid()}`;
  const hash = await hashSecret(token, env.TOKEN_PEPPER);
  const ts = now();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(hash, userId, ts, ts + 3600)
    .run();
  return token;
}

export async function seedUserInbox(
  userId: string,
  address: string,
  status = 'active',
): Promise<string> {
  const id = ulid();
  const ts = now();
  const domainId = ulid();
  await env.DB.prepare(
    `INSERT INTO domains (id, name, zone_id, status, pool_type, allow_anonymous_inboxes, allow_custom_local_parts, max_inbox_ttl_seconds, created_at, updated_at)
     VALUES (?1, ?2, NULL, 'active', 'public', 1, 1, 86400, ?3, ?3)`,
  )
    .bind(domainId, `d-${domainId.slice(-6).toLowerCase()}.example`, ts)
    .run();
  await env.DB.prepare(
    `INSERT INTO inboxes (id, user_id, domain_id, local_part, address, access_token_hash, status, expires_at, created_at, last_message_at)
     VALUES (?1, ?2, ?3, 'lp', ?4, 'hash', ?5, ?6, ?7, NULL)`,
  )
    .bind(id, userId, domainId, address, status, ts + 3600, ts)
    .run();
  return id;
}

export async function seedUserMessage(
  inboxId: string,
  userId: string,
  subject: string,
): Promise<string> {
  const id = ulid();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO messages
       (id, inbox_id, user_id, provider_message_id, r2_raw_key, sender_address, sender_name, recipient_address, subject, snippet, received_at, expires_at, status, size_bytes, has_attachments)
     VALUES (?1, ?2, ?3, NULL, ?4, 'sender@example.net', NULL, 'addr@example.com', ?5, 'snippet', ?6, ?7, 'ready', 100, 0)`,
  )
    .bind(id, inboxId, userId, `raw/${id}`, subject, ts, ts + 3600)
    .run();
  return id;
}

export interface SeedDomainOptions {
  name: string;
  poolType?: 'public' | 'private';
  status?: 'pending' | 'active' | 'paused' | 'misconfigured';
  allowAnonymous?: boolean;
  allowCustom?: boolean;
  maxTtl?: number;
}

export async function seedDomain(opts: SeedDomainOptions): Promise<string> {
  const id = ulid();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO domains
       (id, name, zone_id, status, pool_type, allow_anonymous_inboxes, allow_custom_local_parts, max_inbox_ttl_seconds, created_at, updated_at)
     VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
  )
    .bind(
      id,
      opts.name,
      opts.status ?? 'active',
      opts.poolType ?? 'public',
      (opts.allowAnonymous ?? true) ? 1 : 0,
      (opts.allowCustom ?? true) ? 1 : 0,
      opts.maxTtl ?? 86_400,
      ts,
    )
    .run();
  return id;
}

export async function seedMessage(
  inboxId: string,
  overrides: Partial<{
    senderAddress: string;
    subject: string;
    snippet: string;
    status: string;
  }> = {},
): Promise<string> {
  const id = ulid();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO messages
       (id, inbox_id, provider_message_id, r2_raw_key, sender_address, sender_name, recipient_address, subject, snippet, received_at, expires_at, status, size_bytes, has_attachments)
     VALUES (?1, ?2, NULL, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9, ?10, 100, 0)`,
  )
    .bind(
      id,
      inboxId,
      `raw/${id}`,
      overrides.senderAddress ?? 'sender@example.net',
      'recipient@example.com',
      overrides.subject ?? 'Test subject',
      overrides.snippet ?? 'A short preview',
      ts,
      ts + 3600,
      overrides.status ?? 'ready',
    )
    .run();
  return id;
}

export async function seedAttachment(
  messageId: string,
  opts: { filename?: string; content?: string; blocked?: boolean } = {},
): Promise<string> {
  const id = ulid();
  const ts = now();
  const blocked = opts.blocked ?? false;
  const content = opts.content ?? 'attachment bytes';
  const r2Key = blocked ? '' : `att/${messageId}/${id}`;
  if (!blocked) {
    await env.MAIL_ATTACHMENT_BUCKET.put(r2Key, content);
  }
  await env.DB.prepare(
    `INSERT INTO attachments
       (id, message_id, r2_key, original_filename, safe_filename, content_type, size_bytes, content_id, disposition, scan_status, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, NULL, 'attachment', ?7, ?8, ?9)`,
  )
    .bind(
      id,
      messageId,
      r2Key,
      opts.filename ?? 'notes.txt',
      blocked ? 'application/octet-stream' : 'text/plain',
      content.length,
      blocked ? 'blocked' : 'not_scanned',
      ts,
      ts + 3600,
    )
    .run();
  return id;
}

export async function inboxAddress(inboxId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT address FROM inboxes WHERE id = ?1')
    .bind(inboxId)
    .first<{ address: string }>();
  return row?.address ?? null;
}
