// Webhook secret generation, encryption at rest, and delivery signing
// (CLAUDE.md §11, §12). The secret is shown to the user once and stored
// AES-GCM-encrypted (keyed by WEBHOOK_SECRET_ENCRYPTION_KEY). Deliveries are
// signed with HMAC-SHA256 over `<timestamp>.<event_id>.<raw_body>`.

import { hashSecret } from './tokens.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SECRET_PREFIX = 'whsec_';
const SECRET_BYTES = 24;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomBase62(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += BASE62[buf[i]! % 62];
  return out;
}

export function generateWebhookSecret(): string {
  return SECRET_PREFIX + randomBase62(SECRET_BYTES);
}

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(keyString: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(keyString));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt a secret for storage. Output is base64(iv || ciphertext+tag). */
export async function encryptSecret(plaintext: string, keyString: string): Promise<string> {
  const key = await aesKey(keyString);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return toB64(packed);
}

export async function decryptSecret(encrypted: string, keyString: string): Promise<string> {
  const key = await aesKey(keyString);
  const packed = fromB64(encrypted);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return decoder.decode(pt);
}

// SSRF defense (CLAUDE.md §11): only https to public hosts. Blocks localhost,
// private, and link-local literals. (DNS rebinding cannot be fully prevented in
// the Workers runtime; deliveries also never follow redirects.)
const PRIVATE_HOST = /^(localhost|.*\.local)$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateIpv4(host: string): boolean {
  const m = IPV4.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a >= 224 // multicast / reserved
  );
}

export function isSafeWebhookUrl(raw: string): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'must be https' };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST.test(host)) return { ok: false, reason: 'private host' };
  if (isPrivateIpv4(host)) return { ok: false, reason: 'private IP' };
  // Block IPv6 loopback / unique-local / link-local literals.
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) {
    return { ok: false, reason: 'private IPv6' };
  }
  return { ok: true };
}

/** Sign a webhook delivery. Returns a lowercase hex HMAC-SHA256. */
export async function signWebhook(
  secret: string,
  timestamp: number,
  eventId: string,
  rawBody: string,
): Promise<string> {
  return hashSecret(`${timestamp}.${eventId}.${rawBody}`, secret);
}
