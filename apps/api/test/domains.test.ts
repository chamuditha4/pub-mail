import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedDomain } from './helpers.js';

const BASE = 'http://localhost';

describe('GET /v1/domains', () => {
  beforeEach(async () => {
    await seedDomain({ name: 'alpha.example', poolType: 'public', status: 'active' });
    await seedDomain({ name: 'beta.example', poolType: 'public', status: 'active' });
    await seedDomain({ name: 'paused.example', poolType: 'public', status: 'paused' });
    await seedDomain({ name: 'hidden.example', poolType: 'private', status: 'active' });
  });

  it('lists only active public domains for anonymous callers', async () => {
    const res = await SELF.fetch(`${BASE}/v1/domains`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ name: string; pool_type: string }> };
    const names = json.data.map((d) => d.name);
    expect(names).toContain('alpha.example');
    expect(names).toContain('beta.example');
    // Paused and private domains must never appear.
    expect(names).not.toContain('paused.example');
    expect(names).not.toContain('hidden.example');
    expect(json.data.every((d) => d.pool_type === 'public')).toBe(true);
  });
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    const live = await SELF.fetch(`${BASE}/health/live`);
    expect(live.status).toBe(200);
    const ready = await SELF.fetch(`${BASE}/health/ready`);
    expect(ready.status).toBe(200);
  });
});

describe('OpenAPI document', () => {
  it('serves an OpenAPI 3.1 document', async () => {
    const res = await SELF.fetch(`${BASE}/openapi.json`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(json.openapi).toBe('3.1.0');
    expect(Object.keys(json.paths)).toContain('/v1/inboxes');
  });
});
