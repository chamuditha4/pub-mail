import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedDomain, seedMessage } from './helpers.js';

const BASE = 'http://localhost';

async function createInbox(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`${BASE}/v1/inboxes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('inbox creation', () => {
  beforeEach(async () => {
    await seedDomain({ name: 'public.example', poolType: 'public', allowAnonymous: true });
  });

  it('creates an anonymous inbox on a public domain and returns a one-time token', async () => {
    const res = await createInbox({ domain: 'public.example' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { address: string; access_token: string; id: string };
    };
    expect(json.data.address.endsWith('@public.example')).toBe(true);
    expect(json.data.access_token.startsWith('tmb_')).toBe(true);
    expect(json.data.id).toHaveLength(26);
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('honors a custom local part when allowed', async () => {
    const res = await createInbox({ domain: 'public.example', local_part: 'chosen-name' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { address: string } };
    expect(json.data.address).toBe('chosen-name@public.example');
  });

  it('rejects reserved local parts', async () => {
    const res = await createInbox({ domain: 'public.example', local_part: 'admin' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown request properties', async () => {
    const res = await createInbox({ domain: 'public.example', surprise: true });
    expect(res.status).toBe(400);
  });

  it('returns a non-enumerating error for unknown domains', async () => {
    const res = await createInbox({ domain: 'does-not-exist.example' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('not_found');
  });

  it('refuses anonymous creation when the domain forbids it', async () => {
    await seedDomain({ name: 'noanon.example', poolType: 'public', allowAnonymous: false });
    const res = await createInbox({ domain: 'noanon.example' });
    expect(res.status).toBe(403);
  });

  it('never reveals private domains to anonymous callers', async () => {
    await seedDomain({ name: 'secret.example', poolType: 'private' });
    const res = await createInbox({ domain: 'secret.example' });
    // Must be indistinguishable from an unknown domain.
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('Domain is not available.');
  });
});

describe('inbox access isolation (Milestone 1 exit criterion)', () => {
  let addrA: { id: string; token: string };
  let addrB: { id: string; token: string };

  beforeEach(async () => {
    await seedDomain({ name: 'public.example', poolType: 'public', allowAnonymous: true });
    const a = (await (await createInbox({ domain: 'public.example' })).json()) as {
      data: { id: string; access_token: string };
    };
    const b = (await (await createInbox({ domain: 'public.example' })).json()) as {
      data: { id: string; access_token: string };
    };
    addrA = { id: a.data.id, token: a.data.access_token };
    addrB = { id: b.data.id, token: b.data.access_token };
  });

  it('lets an inbox read itself with its token', async () => {
    const res = await SELF.fetch(`${BASE}/v1/inboxes/${addrA.id}`, {
      headers: { Authorization: `Bearer ${addrA.token}` },
    });
    expect(res.status).toBe(200);
  });

  it('forbids reading another inbox with the wrong token', async () => {
    const res = await SELF.fetch(`${BASE}/v1/inboxes/${addrB.id}`, {
      headers: { Authorization: `Bearer ${addrA.token}` },
    });
    expect(res.status).toBe(404);
  });

  it('forbids reading messages of another inbox', async () => {
    await seedMessage(addrB.id, { subject: 'private to B' });
    const res = await SELF.fetch(`${BASE}/v1/inboxes/${addrB.id}/messages`, {
      headers: { Authorization: `Bearer ${addrA.token}` },
    });
    expect(res.status).toBe(404);
  });

  it('rejects access with no token', async () => {
    const res = await SELF.fetch(`${BASE}/v1/inboxes/${addrA.id}`);
    expect(res.status).toBe(404);
  });

  it('lists its own messages newest-first', async () => {
    await seedMessage(addrA.id, { subject: 'first' });
    await seedMessage(addrA.id, { subject: 'second' });
    const res = await SELF.fetch(`${BASE}/v1/inboxes/${addrA.id}/messages`, {
      headers: { Authorization: `Bearer ${addrA.token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ subject: string }>;
      next_cursor: string | null;
    };
    expect(json.data).toHaveLength(2);
    expect(json.data[0]!.subject).toBe('second');
    expect(json.next_cursor).toBeNull();
  });

  it('deletes its own inbox and then cannot read it', async () => {
    const del = await SELF.fetch(`${BASE}/v1/inboxes/${addrA.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${addrA.token}` },
    });
    expect(del.status).toBe(204);
    const read = await SELF.fetch(`${BASE}/v1/inboxes/${addrA.id}`, {
      headers: { Authorization: `Bearer ${addrA.token}` },
    });
    expect(read.status).toBe(404);
  });
});
