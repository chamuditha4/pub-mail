import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { HonoEnv } from '../types.js';

// Liveness is process-only; readiness checks dependencies (D1) (CLAUDE.md §9).
export const healthRoutes = new OpenAPIHono<HonoEnv>();

const liveRoute = createRoute({
  method: 'get',
  path: '/health/live',
  tags: ['health'],
  summary: 'Liveness probe',
  responses: {
    200: {
      description: 'Process is alive',
      content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
    },
  },
});

const readyRoute = createRoute({
  method: 'get',
  path: '/health/ready',
  tags: ['health'],
  summary: 'Readiness probe',
  responses: {
    200: {
      description: 'Dependencies are reachable',
      content: { 'application/json': { schema: z.object({ status: z.literal('ready') }) } },
    },
    503: {
      description: 'A dependency is unavailable',
      content: { 'application/json': { schema: z.object({ status: z.literal('unavailable') }) } },
    },
  },
});

healthRoutes.openapi(liveRoute, (c) => c.json({ status: 'ok' as const }, 200));

healthRoutes.openapi(readyRoute, async (c) => {
  try {
    // Cheap dependency probe: confirm D1 answers a trivial query.
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ready' as const }, 200);
  } catch {
    return c.json({ status: 'unavailable' as const }, 503);
  }
});
