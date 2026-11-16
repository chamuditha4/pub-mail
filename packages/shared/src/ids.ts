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

function randomDigits(): number[] {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  // Map each random byte into the 32-symbol alphabet.
  return Array.from(bytes, (b) => b % ENCODING_LEN);
}

// Monotonic within a millisecond (ULID spec): a second id generated in the same
// millisecond is the previous random part + 1, so ids sort in creation order
// even when many are minted back to back. Without this, same-millisecond ids
// order randomly and "newest first" listings flake on fast machines.
let lastTime = -1;
let lastDigits: number[] = [];

function incrementDigits(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i]! < ENCODING_LEN - 1) {
      digits[i] = digits[i]! + 1;
      return true;
    }
    digits[i] = 0;
  }
  return false; // overflow
}

/** Generate a 26-character ULID. */
export function ulid(now: number = Date.now()): string {
  let digits: number[];
  if (now === lastTime) {
    digits = lastDigits.slice();
    if (!incrementDigits(digits)) digits = randomDigits(); // 2^80 ids in one ms: effectively unreachable
  } else {
    digits = randomDigits();
  }
  lastTime = now;
  lastDigits = digits;
  return encodeTime(now) + digits.map((d) => ENCODING[d]).join('');
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}
