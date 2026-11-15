import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, seedUser } from './helpers.js';

const BASE = 'http://localhost';

describe('webhook management', () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = `tm_session=${await createSession(await seedUser('hookdev'))}`;
  });

  function headers() {
    return { 'Content-Type': 'application/json', Cookie: cookie };
  }

  async function create(
    url = 'https://hooks.example.com/in',
  ): Promise<{ id: string; secret: string }> {
    const res = await SELF.fetch(`${BASE}/v1/webhooks`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ url, events: ['message.ready'] }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string; secret: string } };
    expect(json.data.secret.startsWith('whsec_')).toBe(true);
    return json.data;
  }

  it('requires authentication', async () => {
    expect((await SELF.fetch(`${BASE}/v1/webhooks`)).status).toBe(401);
  });

  it('rejects an unsafe (non-https / private) URL', async () => {
    const res = await SELF.fetch(`${BASE}/v1/webhooks`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ url: 'http://localhost/hook', events: ['message.ready'] }),
    });
    expect(res.status).toBe(400);
  });

  it('creates a webhook (secret shown once) and lists it without the secret', async () => {
    const { id } = await create();
    const list = await SELF.fetch(`${BASE}/v1/webhooks`, { headers: { Cookie: cookie } });
    const json = (await list.json()) as { data: Array<{ id: string; secret?: string }> };
    expect(json.data.some((w) => w.id === id)).toBe(true);
    expect(json.data[0]).not.toHaveProperty('secret');
  });

  it('rotates the secret to a new value', async () => {
    const { id, secret } = await create();
    const res = await SELF.fetch(`${BASE}/v1/webhooks/${id}/rotate-secret`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { secret: string } };
    expect(json.data.secret.startsWith('whsec_')).toBe(true);
    expect(json.data.secret).not.toBe(secret);
  });

  it('updates events and disables, then deletes', async () => {
    const { id } = await create();
    const patch = await SELF.fetch(`${BASE}/v1/webhooks/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ events: ['message.ready', 'message.failed'], status: 'disabled' }),
    });
    expect(patch.status).toBe(200);
    const pj = (await patch.json()) as { data: { status: string; events: string[] } };
    expect(pj.data.status).toBe('disabled');
    expect(pj.data.events).toContain('message.failed');

    const del = await SELF.fetch(`${BASE}/v1/webhooks/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(del.status).toBe(204);
  });

  it('queues a test delivery', async () => {
    const { id } = await create();
    const res = await SELF.fetch(`${BASE}/v1/webhooks/${id}/test`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { data: { status: string } };
    expect(json.data.status).toBe('queued');
  });

  it('does not expose another user’s webhook', async () => {
    const { id } = await create();
    const otherCookie = `tm_session=${await createSession(await seedUser('other'))}`;
    const res = await SELF.fetch(`${BASE}/v1/webhooks/${id}/deliveries`, {
      headers: { Cookie: otherCookie },
    });
    expect(res.status).toBe(404);
  });
});
