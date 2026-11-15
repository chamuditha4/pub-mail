// ULID generation (Crockford base32). Lexicographically sortable, non-sequential
// randomness. Used for all public IDs so we never expose enumerable integers.
// See CLAUDE.md §4 (IDs: UUIDv7 or ULID; never sequential public IDs).

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let mod: number;
  let str = '';
  let time = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    mod = time % ENCODING_LEN;
    str = ENCODING[mod] + str;
    time = (time - mod) / ENCODING_LEN;
  }
  return str;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let str = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    // Map each random byte into the 32-symbol alphabet.
    str += ENCODING[bytes[i]! % ENCODING_LEN];
  }
  return str;
}

/** Generate a 26-character ULID. */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}
