import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedAttachment, seedDomain, seedMessage } from './helpers.js';

const BASE = 'http://localhost';

async function createInbox(): Promise<{ id: string; token: string }> {
  const res = await SELF.fetch(`${BASE}/v1/inboxes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'public.example' }),
  });
  const json = (await res.json()) as { data: { id: string; access_token: string } };
  return { id: json.data.id, token: json.data.access_token };
}

describe('attachment download', () => {
  let inbox: { id: string; token: string };
  let messageId: string;

  beforeEach(async () => {
    await seedDomain({ name: 'public.example', poolType: 'public', allowAnonymous: true });
    inbox = await createInbox();
    messageId = await seedMessage(inbox.id, { status: 'ready' });
  });

  it('serves a safe attachment with defensive headers', async () => {
    const attId = await seedAttachment(messageId, { filename: 'notes.txt', content: 'hello file' });
    const res = await SELF.fetch(`${BASE}/v1/messages/${messageId}/attachments/${attId}`, {
      headers: { Authorization: `Bearer ${inbox.token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="notes.txt"');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(await res.text()).toBe('hello file');
  });

  it('refuses to serve blocked attachments', async () => {
    const attId = await seedAttachment(messageId, { filename: 'setup.exe', blocked: true });
    const res = await SELF.fetch(`${BASE}/v1/messages/${messageId}/attachments/${attId}`, {
      headers: { Authorization: `Bearer ${inbox.token}` },
    });
    expect(res.status).toBe(404);
  });

  it('requires the correct inbox token', async () => {
    const attId = await seedAttachment(messageId, { content: 'secret' });
    const res = await SELF.fetch(`${BASE}/v1/messages/${messageId}/attachments/${attId}`, {
      headers: { Authorization: 'Bearer tmb_wrong' },
    });
    expect(res.status).toBe(404);
  });

  it('includes attachments in the message detail', async () => {
    await seedAttachment(messageId, { filename: 'notes.txt', content: 'x' });
    const res = await SELF.fetch(`${BASE}/v1/messages/${messageId}`, {
      headers: { Authorization: `Bearer ${inbox.token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { attachments: Array<{ filename: string }> } };
    expect(json.data.attachments).toHaveLength(1);
    expect(json.data.attachments[0]!.filename).toBe('notes.txt');
  });
});
