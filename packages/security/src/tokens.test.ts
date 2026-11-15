import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  generateInboxAccessToken,
  hashSecret,
  looksLikeInboxToken,
  verifySecret,
} from './tokens.js';

const PEPPER = 'test-pepper-value-1234567890';

describe('constantTimeEqual', () => {
  it('matches identical strings and rejects differences', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('inbox access tokens', () => {
  it('generates a prefixed, high-entropy token and a stable hash', async () => {
    const { plaintext, hash } = await generateInboxAccessToken(PEPPER);
    expect(looksLikeInboxToken(plaintext)).toBe(true);
    expect(plaintext.startsWith('tmb_')).toBe(true);
    // Hash must not contain the plaintext and must be deterministic.
    expect(hash).not.toContain(plaintext);
    expect(await hashSecret(plaintext, PEPPER)).toEqual(hash);
  });

  it('verifies the correct token and rejects the wrong one', async () => {
    const { plaintext, hash } = await generateInboxAccessToken(PEPPER);
    expect(await verifySecret(plaintext, hash, PEPPER)).toBe(true);
    expect(await verifySecret(plaintext + 'x', hash, PEPPER)).toBe(false);
    expect(await verifySecret(plaintext, hash, 'wrong-pepper')).toBe(false);
  });

  it('produces unique tokens', async () => {
    const a = await generateInboxAccessToken(PEPPER);
    const b = await generateInboxAccessToken(PEPPER);
    expect(a.plaintext).not.toEqual(b.plaintext);
  });
});
