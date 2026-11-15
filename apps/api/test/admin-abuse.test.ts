import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, seedAdmin, seedUser } from './helpers.js';

const BASE = 'http://localhost';

describe('admin abuse controls', () => {
  let adminCookie: string;

  beforeEach(async () => {
    adminCookie = `tm_session=${await createSession(await seedAdmin('root7'))}`;
  });

  it('restricts admin endpoints to admins', async () => {
    expect((await SELF.fetch(`${BASE}/v1/admin/metrics`)).status).toBe(401);
    const userCookie = `tm_session=${await createSession(await seedUser('plain7'))}`;
    const res = await SELF.fetch(`${BASE}/v1/admin/metrics`, { headers: { Cookie: userCookie } });
    expect(res.status).toBe(403);
  });

  it('returns platform metrics', async () => {
    const res = await SELF.fetch(`${BASE}/v1/admin/metrics`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { users: number; messages_total: number } };
    expect(typeof json.data.users).toBe('number');
    expect(typeof json.data.messages_total).toBe('number');
  });

  it('manages the blocklist and writes an audit log', async () => {
    const add = await SELF.fetch(`${BASE}/v1/admin/blocklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ entry_type: 'sender', value: 'BAD@Spam.example', reason: 'spam' }),
    });
    expect(add.status).toBe(201);
    const { data } = (await add.json()) as { data: { id: string } };

    const list = await SELF.fetch(`${BASE}/v1/admin/blocklist`, {
      headers: { Cookie: adminCookie },
    });
    const lj = (await list.json()) as { data: Array<{ value: string }> };
    expect(lj.data.some((e) => e.value === 'bad@spam.example')).toBe(true); // normalized

    // The action is audited.
    const audits = await SELF.fetch(`${BASE}/v1/admin/audit-logs`, {
      headers: { Cookie: adminCookie },
    });
    const aj = (await audits.json()) as { data: Array<{ action: string }> };
    expect(aj.data.some((a) => a.action === 'blocklist.add')).toBe(true);

    const del = await SELF.fetch(`${BASE}/v1/admin/blocklist/${data.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(del.status).toBe(204);
  });

  it('accepts public abuse reports and lets an admin review them', async () => {
    const report = await SELF.fetch(`${BASE}/v1/abuse-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject_type: 'address',
        subject_value: 'x@y.example',
        details: 'spam from here',
      }),
    });
    expect(report.status).toBe(201);
    const { data } = (await report.json()) as { data: { id: string } };

    const list = await SELF.fetch(`${BASE}/v1/admin/abuse-reports?status=open`, {
      headers: { Cookie: adminCookie },
    });
    const lj = (await list.json()) as { data: Array<{ id: string }> };
    expect(lj.data.some((r) => r.id === data.id)).toBe(true);

    const patch = await SELF.fetch(`${BASE}/v1/admin/abuse-reports/${data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'closed' }),
    });
    expect(patch.status).toBe(204);
  });

  it('blocks inbox creation from a blocklisted IP', async () => {
    // Block an IP, then attempt inbox creation with that IP header.
    await SELF.fetch(`${BASE}/v1/admin/blocklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ entry_type: 'ip', value: '203.0.113.5' }),
    });

    const res = await SELF.fetch(`${BASE}/v1/inboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
      body: JSON.stringify({ domain: 'anything.example' }),
    });
    expect(res.status).toBe(403);
  });
});
