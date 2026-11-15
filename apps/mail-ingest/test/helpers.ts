import { env } from 'cloudflare:test';
import { ulid } from '@tmp-mail/shared';
import type { EmailProcessingJob } from '@tmp-mail/shared';
import type { IncomingEmail, QueueSender } from '../src/ingest.js';

const nowS = () => Math.floor(Date.now() / 1000);

export async function seedDomain(name: string, status = 'active'): Promise<string> {
  const id = ulid();
  const ts = nowS();
  await env.DB.prepare(
    `INSERT INTO domains
       (id, name, zone_id, status, pool_type, allow_anonymous_inboxes, allow_custom_local_parts, max_inbox_ttl_seconds, created_at, updated_at)
     VALUES (?1, ?2, NULL, ?3, 'public', 1, 1, 86400, ?4, ?4)`,
  )
    .bind(id, name, status, ts)
    .run();
  return id;
}

export async function seedInbox(
  domainId: string,
  address: string,
  opts: { status?: string; expiresInSeconds?: number } = {},
): Promise<string> {
  const id = ulid();
  const ts = nowS();
  const localPart = address.slice(0, address.lastIndexOf('@'));
  await env.DB.prepare(
    `INSERT INTO inboxes
       (id, user_id, domain_id, local_part, address, access_token_hash, status, expires_at, created_at, last_message_at)
     VALUES (?1, NULL, ?2, ?3, ?4, 'hash', ?5, ?6, ?7, NULL)`,
  )
    .bind(
      id,
      domainId,
      localPart,
      address,
      opts.status ?? 'active',
      ts + (opts.expiresInSeconds ?? 3600),
      ts,
    )
    .run();
  return id;
}

/** A queue producer that records what was sent, for assertions. */
export function recordingQueue(): QueueSender & { sent: EmailProcessingJob[] } {
  const sent: EmailProcessingJob[] = [];
  return {
    sent,
    async send(body: EmailProcessingJob) {
      sent.push(body);
    },
  };
}

export function fakeEmail(
  overrides: Partial<{ from: string; to: string; body: string; messageId: string | null }> = {},
): IncomingEmail {
  const body = overrides.body ?? 'Subject: Hi\r\n\r\nHello world.\r\n';
  const headers = new Headers();
  const messageId =
    overrides.messageId === undefined ? '<abc-123@example.net>' : overrides.messageId;
  if (messageId) headers.set('message-id', messageId);
  return {
    from: overrides.from ?? 'sender@example.net',
    to: overrides.to ?? 'someone@public.example',
    rawSize: new TextEncoder().encode(body).byteLength,
    headers,
    raw: new Response(body).body as ReadableStream<Uint8Array>,
  };
}

export async function countMessages(inboxId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE inbox_id = ?1')
    .bind(inboxId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
