import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

const PEPPER = 'test-pepper-value-1234567890';

describe('password hashing', () => {
  it('verifies the correct password and rejects wrong ones', async () => {
    const stored = await hashPassword('correct horse battery staple', PEPPER);
    expect(await verifyPassword('correct horse battery staple', stored, PEPPER)).toBe(true);
    expect(await verifyPassword('wrong password', stored, PEPPER)).toBe(false);
  });

  it('requires the pepper to verify', async () => {
    const stored = await hashPassword('s3cret-passw0rd', PEPPER);
    expect(await verifyPassword('s3cret-passw0rd', stored, 'different-pepper')).toBe(false);
  });

  it('uses a unique salt per hash and never stores the plaintext', async () => {
    const a = await hashPassword('same-password-123', PEPPER);
    const b = await hashPassword('same-password-123', PEPPER);
    expect(a.salt).not.toEqual(b.salt);
    expect(a.hash).not.toEqual(b.hash);
    expect(a.hash).not.toContain('same-password');
  });
});
