import { describe, expect, it } from 'vitest';
import { isReservedLocalPart, isValidLocalPart, normalizeAddress } from './address.js';

describe('normalizeAddress', () => {
  it('lowercases and splits a valid address', () => {
    expect(normalizeAddress('  Foo.Bar@Example.COM ')).toEqual({
      localPart: 'foo.bar',
      domain: 'example.com',
      address: 'foo.bar@example.com',
    });
  });

  it('rejects malformed addresses', () => {
    expect(normalizeAddress('no-at-sign')).toBeNull();
    expect(normalizeAddress('@example.com')).toBeNull();
    expect(normalizeAddress('user@')).toBeNull();
    expect(normalizeAddress('user@localhost')).toBeNull();
    expect(normalizeAddress('a b@example.com')).toBeNull();
  });
});

describe('local part validation', () => {
  it('accepts allowlisted local parts', () => {
    expect(isValidLocalPart('abc')).toBe(true);
    expect(isValidLocalPart('a.b-c_d')).toBe(true);
    expect(isValidLocalPart('user01')).toBe(true);
  });

  it('rejects invalid local parts', () => {
    expect(isValidLocalPart('.leading')).toBe(false);
    expect(isValidLocalPart('trailing.')).toBe(false);
    expect(isValidLocalPart('UpperCase')).toBe(false);
    expect(isValidLocalPart('has space')).toBe(false);
    expect(isValidLocalPart('')).toBe(false);
  });

  it('rejects reserved names', () => {
    for (const name of ['admin', 'postmaster', 'abuse', 'security', 'support', 'root']) {
      expect(isReservedLocalPart(name)).toBe(true);
      expect(isValidLocalPart(name)).toBe(false);
    }
  });
});
