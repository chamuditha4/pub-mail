import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { domainListSchema, errorEnvelopeSchema } from '@tmp-mail/contracts';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import { listVisibleDomains } from '../services/domain-service.js';

export const domainRoutes = new OpenAPIHono<HonoEnv>();

const listDomainsRoute = createRoute({
  method: 'get',
  path: '/v1/domains',
  tags: ['domains'],
  summary: 'List available domains',
  description:
    'Public domains plus any private domains the authenticated caller may use. Private domains are never exposed to unauthorized callers.',
  responses: {
    200: {
      description: 'Visible domains',
      content: { 'application/json': { schema: domainListSchema } },
    },
    500: {
      description: 'Internal error',
      content: { 'application/json': { schema: errorEnvelopeSchema } },
    },
  },
});

domainRoutes.openapi(listDomainsRoute, async (c) => {
  const { repos } = c.get('ctx');
  const caller = await resolveCaller(c);
  const data = await listVisibleDomains(repos, caller);
  return c.json({ data }, 200);
});
