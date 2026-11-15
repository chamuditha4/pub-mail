import { describe, expect, it } from 'vitest';
import { isUlid, ulid } from './ids.js';

describe('ulid', () => {
  it('produces 26-char Crockford base32 identifiers', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it('is monotonic across time so ids sort chronologically', () => {
    const earlier = ulid(1_000_000);
    const later = ulid(2_000_000);
    expect(earlier < later).toBe(true);
  });

  it('is non-sequential within the same millisecond', () => {
    const a = ulid(1234);
    const b = ulid(1234);
    expect(a).not.toEqual(b);
  });
});
