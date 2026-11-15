// Developer API keys (CLAUDE.md §10). Format: tm_live_<prefix>_<secret>.
// The prefix is a public lookup id; the secret is high-entropy and stored only
// as a keyed hash. Verification fetches one row by prefix then constant-time
// compares the secret hash.

import { hashSecret } from './tokens.js';

const PREFIX = 'tm_live_';
const KEY_ID_BYTES = 9; // ~12 base62 chars
const SECRET_BYTES = 24; // 192 bits

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomBase62(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += BASE62[buf[i]! % 62];
  return out;
}

export interface GeneratedApiKey {
  /** The full `tm_live_<prefix>_<secret>` key — shown to the caller exactly once. */
  fullKey: string;
  /** Public prefix used to look up the key row. */
  keyPrefix: string;
  /** Keyed hash of the secret, for storage. */
  secretHash: string;
}

export async function generateApiKey(pepper: string): Promise<GeneratedApiKey> {
  const keyPrefix = randomBase62(KEY_ID_BYTES);
  const secret = randomBase62(SECRET_BYTES);
  const secretHash = await hashSecret(secret, pepper);
  return { fullKey: `${PREFIX}${keyPrefix}_${secret}`, keyPrefix, secretHash };
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(PREFIX);
}

export interface ParsedApiKey {
  keyPrefix: string;
  secret: string;
}

/** Parse a presented API key into its prefix and secret, or null if malformed. */
export function parseApiKey(token: string): ParsedApiKey | null {
  if (!token.startsWith(PREFIX)) return null;
  const rest = token.slice(PREFIX.length);
  const underscore = rest.indexOf('_');
  if (underscore <= 0 || underscore === rest.length - 1) return null;
  return { keyPrefix: rest.slice(0, underscore), secret: rest.slice(underscore + 1) };
}
