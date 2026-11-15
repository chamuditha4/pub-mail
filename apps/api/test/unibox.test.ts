import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, seedUser, seedUserInbox, seedUserMessage } from './helpers.js';

const BASE = 'http://localhost';

describe('accounts + unibox', () => {
  let userA: string;
  let tokenA: string;

  beforeEach(async () => {
    userA = await seedUser('alice');
    tokenA = await createSession(userA);
  });

  it('GET /v1/me returns the authenticated user, 401 without a session', async () => {
    const anon = await SELF.fetch(`${BASE}/v1/me`);
    expect(anon.status).toBe(401);

    const res = await SELF.fetch(`${BASE}/v1/me`, {
      headers: { Cookie: `tm_session=${tokenA}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { username: string } };
    expect(json.data.username).toBe('alice');
  });

  it('unibox lists messages across all of a user’s inboxes', async () => {
    const inbox1 = await seedUserInbox(userA, 'one@example.com');
    const inbox2 = await seedUserInbox(userA, 'two@example.com');
    await seedUserMessage(inbox1, userA, 'from inbox one');
    await seedUserMessage(inbox2, userA, 'from inbox two');

    const res = await SELF.fetch(`${BASE}/v1/me/messages`, {
      headers: { Cookie: `tm_session=${tokenA}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ subject: string }> };
    expect(json.data).toHaveLength(2);
    expect(json.data.map((m) => m.subject).sort()).toEqual(['from inbox one', 'from inbox two']);
  });

  it('unibox retains messages from a DELETED inbox', async () => {
    const inbox = await seedUserInbox(userA, 'gone@example.com', 'deleted');
    const messageId = await seedUserMessage(inbox, userA, 'survived deletion');

    // Appears in the unibox despite the inbox being deleted.
    const list = await SELF.fetch(`${BASE}/v1/me/messages`, {
      headers: { Cookie: `tm_session=${tokenA}` },
    });
    const json = (await list.json()) as { data: Array<{ subject: string }> };
    expect(json.data.some((m) => m.subject === 'survived deletion')).toBe(true);

    // And the owner can still read it in full, even though the inbox is deleted.
    const read = await SELF.fetch(`${BASE}/v1/messages/${messageId}`, {
      headers: { Cookie: `tm_session=${tokenA}` },
    });
    expect(read.status).toBe(200);
  });

  it('lists a user’s inboxes including expired/deleted ones', async () => {
    await seedUserInbox(userA, 'active@example.com', 'active');
    await seedUserInbox(userA, 'expired@example.com', 'expired');
    const res = await SELF.fetch(`${BASE}/v1/me/inboxes`, {
      headers: { Cookie: `tm_session=${tokenA}` },
    });
    const json = (await res.json()) as { data: Array<{ address: string }> };
    expect(json.data.map((i) => i.address).sort()).toEqual([
      'active@example.com',
      'expired@example.com',
    ]);
  });

  it('does not leak another user’s messages', async () => {
    const userB = await seedUser('bob');
    const inboxB = await seedUserInbox(userB, 'bob-inbox@example.com');
    const bMessage = await seedUserMessage(inboxB, userB, 'bob secret');

    // Alice's unibox is empty of Bob's mail.
    const list = await SELF.fetch(`${BASE}/v1/me/messages`, {
      headers: { Cookie: `tm_session=${tokenA}` },
    });
    const json = (await list.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(0);

    // Alice cannot read Bob's message by id.
    const read = await SELF.fetch(`${BASE}/v1/messages/${bMessage}`, {
      headers: { Cookie: `tm_session=${tokenA}` },
    });
    expect(read.status).toBe(404);
  });

  it('rejects the unibox without a session', async () => {
    const res = await SELF.fetch(`${BASE}/v1/me/messages`);
    expect(res.status).toBe(401);
  });
});
