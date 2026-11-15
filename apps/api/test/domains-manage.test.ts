import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, seedAdmin, seedUser } from './helpers.js';

const BASE = 'http://localhost';

async function cookieFor(id: string): Promise<string> {
  return `tm_session=${await createSession(id)}`;
}

function jsonHeaders(cookie: string) {
  return { 'Content-Type': 'application/json', Cookie: cookie };
}

describe('domain management (owner + admin)', () => {
  let userCookie: string;

  beforeEach(async () => {
    userCookie = await cookieFor(await seedUser('owner1'));
  });

  it('requires authentication', async () => {
    expect((await SELF.fetch(`${BASE}/v1/owner/domains`)).status).toBe(401);
  });

  it('lets a regular user add a domain and become its owner', async () => {
    const create = await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(userCookie),
      body: JSON.stringify({ name: 'mine.example', pool_type: 'private' }),
    });
    expect(create.status).toBe(201);

    const list = await SELF.fetch(`${BASE}/v1/owner/domains`, { headers: { Cookie: userCookie } });
    const json = (await list.json()) as { data: Array<{ name: string }>; is_admin: boolean };
    expect(json.data.map((d) => d.name)).toEqual(['mine.example']);
    expect(json.is_admin).toBe(false);
  });

  it('does not show one user’s domains to another', async () => {
    await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(userCookie),
      body: JSON.stringify({ name: 'private-a.example' }),
    });
    const otherCookie = await cookieFor(await seedUser('owner2'));
    const list = await SELF.fetch(`${BASE}/v1/owner/domains`, { headers: { Cookie: otherCookie } });
    const json = (await list.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(0);
  });

  it('admins see every domain', async () => {
    await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(userCookie),
      body: JSON.stringify({ name: 'somebody.example' }),
    });
    const adminCookie = await cookieFor(await seedAdmin('rootadmin'));
    const list = await SELF.fetch(`${BASE}/v1/owner/domains`, { headers: { Cookie: adminCookie } });
    const json = (await list.json()) as { data: Array<{ name: string }>; is_admin: boolean };
    expect(json.is_admin).toBe(true);
    expect(json.data.some((d) => d.name === 'somebody.example')).toBe(true);
  });

  it('rejects duplicate domains', async () => {
    const body = JSON.stringify({ name: 'dupe.example' });
    await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(userCookie),
      body,
    });
    const again = await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(userCookie),
      body,
    });
    expect(again.status).toBe(409);
  });

  it('does not let a non-admin owner force a domain active (no public leak)', async () => {
    const create = await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(userCookie),
      body: JSON.stringify({ name: 'wannabe-public.example', pool_type: 'public' }),
    });
    const { data } = (await create.json()) as { data: { id: string } };

    const patch = await SELF.fetch(`${BASE}/v1/owner/domains/${data.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(userCookie),
      body: JSON.stringify({ status: 'active', allow_anonymous_inboxes: true }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { data: { status: string } };
    expect(patched.data.status).toBe('pending'); // status change ignored for non-admins

    // And it must NOT appear in the public domain list.
    const publicList = await SELF.fetch(`${BASE}/v1/domains`);
    const pj = (await publicList.json()) as { data: Array<{ name: string }> };
    expect(pj.data.some((d) => d.name === 'wannabe-public.example')).toBe(false);
  });

  it('lets an admin activate a domain into the public list', async () => {
    const adminCookie = await cookieFor(await seedAdmin('root2'));
    const create = await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ name: 'goespublic.example', pool_type: 'public' }),
    });
    const { data } = (await create.json()) as { data: { id: string } };
    await SELF.fetch(`${BASE}/v1/owner/domains/${data.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ status: 'active', allow_anonymous_inboxes: true }),
    });
    const publicList = await SELF.fetch(`${BASE}/v1/domains`);
    const pj = (await publicList.json()) as { data: Array<{ name: string }> };
    expect(pj.data.some((d) => d.name === 'goespublic.example')).toBe(true);
  });

  it('enabling catch-all provisions the owner’s catch-all inbox', async () => {
    const create = await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(userCookie),
      body: JSON.stringify({ name: 'catchdom.example' }),
    });
    const { data } = (await create.json()) as { data: { id: string } };

    const patch = await SELF.fetch(`${BASE}/v1/owner/domains/${data.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(userCookie),
      body: JSON.stringify({ catch_all: true }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { data: { catch_all: boolean } };
    expect(patched.data.catch_all).toBe(true);

    // The catch-all inbox now exists, owned by the domain owner (this user).
    const inbox = await env.DB.prepare('SELECT user_id, status FROM inboxes WHERE address = ?1')
      .bind('*@catchdom.example')
      .first<{ user_id: string; status: string }>();
    expect(inbox).not.toBeNull();
    expect(inbox?.status).toBe('active');
  });

  describe('deleting a domain', () => {
    async function createDomain(cookie: string, name: string): Promise<string> {
      const res = await SELF.fetch(`${BASE}/v1/owner/domains`, {
        method: 'POST',
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ name }),
      });
      const { data } = (await res.json()) as { data: { id: string } };
      return data.id;
    }

    /** Seed an inbox with one message + attachment (rows and R2 objects). */
    async function seedContent(domainId: string, address: string): Promise<void> {
      const ts = Math.floor(Date.now() / 1000);
      const inboxId = `inb-${address}`;
      const messageId = `msg-${address}`;
      await env.DB.prepare(
        `INSERT INTO inboxes (id, user_id, domain_id, local_part, address, access_token_hash, status, expires_at, created_at, last_message_at)
         VALUES (?1, NULL, ?2, 'lp', ?3, 'hash', 'active', ?4, ?5, NULL)`,
      )
        .bind(inboxId, domainId, address, ts + 3600, ts)
        .run();
      await env.DB.prepare(
        `INSERT INTO messages
           (id, inbox_id, provider_message_id, r2_raw_key, sender_address, sender_name, recipient_address, subject, snippet, received_at, expires_at, status, size_bytes, has_attachments)
         VALUES (?1, ?2, NULL, ?3, 'sender@example.net', NULL, ?4, 'Subject', 'snippet', ?5, ?6, 'ready', 10, 1)`,
      )
        .bind(messageId, inboxId, `raw/${messageId}`, address, ts, ts + 3600)
        .run();
      await env.DB.prepare(
        `INSERT INTO attachments
           (id, message_id, r2_key, original_filename, safe_filename, content_type, size_bytes, content_id, disposition, scan_status, created_at, expires_at)
         VALUES (?1, ?2, ?3, 'a.txt', 'a.txt', 'text/plain', 5, NULL, 'attachment', 'not_scanned', ?4, ?5)`,
      )
        .bind(`att-${address}`, messageId, `att/${messageId}`, ts, ts + 3600)
        .run();
      await env.MAIL_RAW_BUCKET.put(`raw/${messageId}`, 'raw mime');
      await env.MAIL_ATTACHMENT_BUCKET.put(`att/${messageId}`, 'bytes');
    }

    it('requires the domain name as confirmation', async () => {
      const id = await createDomain(userCookie, 'needsconfirm.example');
      const res = await SELF.fetch(`${BASE}/v1/owner/domains/${id}`, {
        method: 'DELETE',
        headers: { Cookie: userCookie },
      });
      expect(res.status).toBe(400);

      const wrong = await SELF.fetch(`${BASE}/v1/owner/domains/${id}?confirm=other.example`, {
        method: 'DELETE',
        headers: { Cookie: userCookie },
      });
      expect(wrong.status).toBe(400);

      // Still there.
      const row = await env.DB.prepare('SELECT id FROM domains WHERE id = ?1').bind(id).first();
      expect(row).not.toBeNull();
    });

    it('lets the owner delete their domain and purges its mail from D1 and R2', async () => {
      const id = await createDomain(userCookie, 'goodbye.example');
      await seedContent(id, 'a@goodbye.example');

      const res = await SELF.fetch(`${BASE}/v1/owner/domains/${id}?confirm=goodbye.example`, {
        method: 'DELETE',
        headers: { Cookie: userCookie },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: { purged_messages: number } };
      expect(json.data.purged_messages).toBe(1);

      // Domain, memberships, inboxes, messages and attachments are all gone.
      expect(
        await env.DB.prepare('SELECT id FROM domains WHERE id = ?1').bind(id).first(),
      ).toBeNull();
      const inboxes = await env.DB.prepare('SELECT COUNT(*) AS n FROM inboxes WHERE domain_id = ?1')
        .bind(id)
        .first<{ n: number }>();
      expect(inboxes?.n).toBe(0);
      expect(
        await env.DB.prepare('SELECT id FROM messages WHERE id = ?1')
          .bind('msg-a@goodbye.example')
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare('SELECT id FROM attachments WHERE message_id = ?1')
          .bind('msg-a@goodbye.example')
          .first(),
      ).toBeNull();

      // R2 objects were removed, not orphaned.
      expect(await env.MAIL_RAW_BUCKET.head('raw/msg-a@goodbye.example')).toBeNull();
      expect(await env.MAIL_ATTACHMENT_BUCKET.head('att/msg-a@goodbye.example')).toBeNull();

      // And the address is free again for a new domain to claim.
      const list = await SELF.fetch(`${BASE}/v1/owner/domains`, {
        headers: { Cookie: userCookie },
      });
      const lj = (await list.json()) as { data: Array<{ name: string }> };
      expect(lj.data.some((d) => d.name === 'goodbye.example')).toBe(false);
    });

    it('does not let another user delete someone else’s domain', async () => {
      const id = await createDomain(userCookie, 'notyours.example');
      const otherCookie = await cookieFor(await seedUser('intruder'));
      const res = await SELF.fetch(`${BASE}/v1/owner/domains/${id}?confirm=notyours.example`, {
        method: 'DELETE',
        headers: { Cookie: otherCookie },
      });
      expect(res.status).toBe(404); // non-enumerating
      expect(
        await env.DB.prepare('SELECT id FROM domains WHERE id = ?1').bind(id).first(),
      ).not.toBeNull();
    });

    it('lets an admin delete any domain', async () => {
      const id = await createDomain(userCookie, 'adminkill.example');
      const adminCookie = await cookieFor(await seedAdmin('root3'));
      const res = await SELF.fetch(`${BASE}/v1/owner/domains/${id}?confirm=adminkill.example`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      expect(
        await env.DB.prepare('SELECT id FROM domains WHERE id = ?1').bind(id).first(),
      ).toBeNull();

      // The deletion is audited.
      const audits = await SELF.fetch(`${BASE}/v1/admin/audit-logs`, {
        headers: { Cookie: adminCookie },
      });
      const aj = (await audits.json()) as { data: Array<{ action: string; target: string }> };
      expect(aj.data.some((a) => a.action === 'domain.delete' && a.target === id)).toBe(true);
    });
  });

  it('reports when routing automation is unavailable', async () => {
    const create = await SELF.fetch(`${BASE}/v1/owner/domains`, {
      method: 'POST',
      headers: jsonHeaders(userCookie),
      body: JSON.stringify({ name: 'noroute.example', zone_id: 'zone123' }),
    });
    const { data } = (await create.json()) as { data: { id: string } };
    const res = await SELF.fetch(`${BASE}/v1/owner/domains/${data.id}/enable-routing`, {
      method: 'POST',
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(400);
  });
});
