// Token generation and keyed hashing (CLAUDE.md §12).
//
// - Inbox access tokens carry >= 128 bits of entropy.
// - Secrets are never stored in plaintext: we persist only a keyed HMAC-SHA256
//   hash, computed with a server-side pepper.
// - Comparison is constant-time.

const INBOX_TOKEN_PREFIX = 'tmb_';
const INBOX_TOKEN_ENTROPY_BYTES = 24; // 192 bits, comfortably above the 128-bit floor.

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomBase62(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += BASE62[buf[i]! % 62];
  }
  return out;
}

export interface GeneratedToken {
  /** The plaintext token — returned to the caller exactly once, never stored. */
  plaintext: string;
  /** Keyed hash suitable for persistence. */
  hash: string;
}

const encoder = new TextEncoder();

async function importHmacKey(pepper: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Compute the keyed hash of a secret using the server-side pepper. */
export async function hashSecret(secret: string, pepper: string): Promise<string> {
  const key = await importHmacKey(pepper);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(secret));
  return toHex(sig);
}

/** Constant-time string comparison. Returns false for mismatched lengths. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Generate a new inbox access token and its stored hash. */
export async function generateInboxAccessToken(pepper: string): Promise<GeneratedToken> {
  const plaintext = INBOX_TOKEN_PREFIX + randomBase62(INBOX_TOKEN_ENTROPY_BYTES);
  const hash = await hashSecret(plaintext, pepper);
  return { plaintext, hash };
}

const SESSION_TOKEN_ENTROPY_BYTES = 32; // 256 bits.

/**
 * Generate a session token and its stored hash. The plaintext goes in the
 * session cookie; only the hash is persisted (CLAUDE.md §12).
 */
export async function generateSessionToken(pepper: string): Promise<GeneratedToken> {
  const plaintext = randomBase62(SESSION_TOKEN_ENTROPY_BYTES);
  const hash = await hashSecret(plaintext, pepper);
  return { plaintext, hash };
}

/** Verify a presented inbox token against a stored hash in constant time. */
export async function verifySecret(
  presented: string,
  storedHash: string,
  pepper: string,
): Promise<boolean> {
  const computed = await hashSecret(presented, pepper);
  return constantTimeEqual(computed, storedHash);
}

export function looksLikeInboxToken(value: string): boolean {
  return value.startsWith(INBOX_TOKEN_PREFIX) && value.length > INBOX_TOKEN_PREFIX.length + 20;
}
