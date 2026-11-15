import { describe, expect, it } from 'vitest';
import { createInboxRequestSchema, localPartSchema } from './schemas.js';

describe('createInboxRequestSchema', () => {
  it('accepts a minimal valid request', () => {
    const parsed = createInboxRequestSchema.safeParse({ domain: 'example.com' });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown properties', () => {
    const parsed = createInboxRequestSchema.safeParse({ domain: 'example.com', extra: 1 });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-positive expires_in', () => {
    const parsed = createInboxRequestSchema.safeParse({ domain: 'example.com', expires_in: -5 });
    expect(parsed.success).toBe(false);
  });
});

describe('localPartSchema', () => {
  it('accepts allowlisted local parts and rejects malformed ones', () => {
    expect(localPartSchema.safeParse('good-name_1').success).toBe(true);
    expect(localPartSchema.safeParse('.bad').success).toBe(false);
    expect(localPartSchema.safeParse('UPPER').success).toBe(false);
  });
});
