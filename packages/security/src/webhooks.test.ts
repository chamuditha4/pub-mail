import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  isSafeWebhookUrl,
  signWebhook,
} from './webhooks.js';

const KEY = 'webhook-encryption-key-value-123456';

describe('webhook secrets', () => {
  it('generates a prefixed secret', () => {
    expect(generateWebhookSecret().startsWith('whsec_')).toBe(true);
  });

  it('round-trips encryption and never stores plaintext', async () => {
    const secret = generateWebhookSecret();
    const enc = await encryptSecret(secret, KEY);
    expect(enc).not.toContain(secret);
    expect(await decryptSecret(enc, KEY)).toBe(secret);
  });

  it('produces a stable, key-dependent signature', async () => {
    const sig = await signWebhook('whsec_abc', 1700000000, 'evt_1', '{"a":1}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await signWebhook('whsec_abc', 1700000000, 'evt_1', '{"a":1}')).toBe(sig);
    expect(await signWebhook('whsec_xyz', 1700000000, 'evt_1', '{"a":1}')).not.toBe(sig);
  });
});

describe('isSafeWebhookUrl (SSRF)', () => {
  it('allows public https', () => {
    expect(isSafeWebhookUrl('https://hooks.example.com/path').ok).toBe(true);
  });

  it('blocks http, localhost, and private ranges', () => {
    expect(isSafeWebhookUrl('http://example.com').ok).toBe(false);
    expect(isSafeWebhookUrl('https://localhost/x').ok).toBe(false);
    expect(isSafeWebhookUrl('https://127.0.0.1/x').ok).toBe(false);
    expect(isSafeWebhookUrl('https://10.0.0.5/x').ok).toBe(false);
    expect(isSafeWebhookUrl('https://192.168.1.1/x').ok).toBe(false);
    expect(isSafeWebhookUrl('https://169.254.169.254/x').ok).toBe(false);
    expect(isSafeWebhookUrl('https://[::1]/x').ok).toBe(false);
  });
});
