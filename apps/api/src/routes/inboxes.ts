import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  createInboxRequestSchema,
  createdInboxEnvelopeSchema,
  errorEnvelopeSchema,
  inboxEnvelopeSchema,
  messageListSchema,
} from '@tmp-mail/contracts';
import type { HonoEnv } from '../types.js';
import { AppError, nowSeconds } from '@tmp-mail/shared';
import { resolveCaller } from '../auth/resolve-caller.js';
import { assertScope } from '../auth/caller.js';
import { checkRateLimit, setRateLimitHeaders } from '../services/rate-limit.js';
import { authorizeInboxAccess } from '../auth/inbox-auth.js';
import { createInbox } from '../services/inbox-service.js';
import { clampLimit, listInboxMessages } from '../services/message-service.js';
import { toCreatedInboxContract, toInboxContract } from '../serializers.js';

export const inboxRoutes = new OpenAPIHono<HonoEnv>();

const idParam = z.object({
  inbox_id: z
    .string()
    .min(1)
    .openapi({ param: { name: 'inbox_id', in: 'path' } }),
});

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: errorEnvelopeSchema } },
});

const createInboxRoute = createRoute({
  method: 'post',
  path: '/v1/inboxes',
  tags: ['inboxes'],
  summary: 'Create a temporary inbox',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createInboxRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'Inbox created; access_token is returned only here',
      content: { 'application/json': { schema: createdInboxEnvelopeSchema } },
    },
    400: errorResponse('Invalid request'),
    403: errorResponse('Not permitted'),
    404: errorResponse('Domain unavailable'),
    409: errorResponse('Address already in use'),
  },
});

inboxRoutes.openapi(createInboxRoute, async (c) => {
  const { repos, config } = c.get('ctx');
  const caller = await resolveCaller(c);
  const body = c.req.valid('json');

  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown';
  if (await repos.blocklist.isBlocked([{ type: 'ip', value: ip.toLowerCase() }])) {
    throw new AppError('forbidden', 'Blocked.');
  }

  if (caller.kind === 'anonymous') {
    // Rate-limit anonymous inbox creation per client IP (CLAUDE.md §15).
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown';
    const outcome = await checkRateLimit(
      repos,
      'anon_inbox',
      ip,
      config.ANON_INBOX_CREATIONS_PER_HOUR,
      3600,
      nowSeconds(),
    );
    setRateLimitHeaders(c, outcome);
    if (!outcome.allowed) {
      throw new AppError('rate_limit_exceeded', 'Too many inboxes created. Try again later.');
    }
  }

  const result = await createInbox(repos, config, caller, {
    domain: body.domain,
    localPart: body.local_part,
    expiresIn: body.expires_in,
  });

  return c.json({ data: toCreatedInboxContract(result.inbox, result.accessToken) }, 201);
});

const getInboxRoute = createRoute({
  method: 'get',
  path: '/v1/inboxes/{inbox_id}',
  tags: ['inboxes'],
  summary: 'Read inbox metadata',
  request: { params: idParam },
  responses: {
    200: {
      description: 'Inbox metadata',
      content: { 'application/json': { schema: inboxEnvelopeSchema } },
    },
    404: errorResponse('Inbox not found'),
  },
});

inboxRoutes.openapi(getInboxRoute, async (c) => {
  const { repos, config } = c.get('ctx');
  const caller = await resolveCaller(c);
  assertScope(caller, 'inboxes:read');
  const { inbox_id } = c.req.valid('param');
  const inbox = await authorizeInboxAccess(
    repos,
    config,
    inbox_id,
    c.req.header('Authorization'),
    caller,
  );
  return c.json({ data: toInboxContract(inbox) }, 200);
});

const deleteInboxRoute = createRoute({
  method: 'delete',
  path: '/v1/inboxes/{inbox_id}',
  tags: ['inboxes'],
  summary: 'Delete an inbox and schedule purge',
  request: { params: idParam },
  responses: {
    204: { description: 'Inbox deleted' },
    404: errorResponse('Inbox not found'),
  },
});

inboxRoutes.openapi(deleteInboxRoute, async (c) => {
  const { repos, config } = c.get('ctx');
  const caller = await resolveCaller(c);
  const { inbox_id } = c.req.valid('param');
  const inbox = await authorizeInboxAccess(
    repos,
    config,
    inbox_id,
    c.req.header('Authorization'),
    caller,
  );
  // Mark deleted now; physical purge of R2/D1 content happens in the retention
  // sweep (Milestone 4). Deletion is idempotent.
  await repos.inboxes.setStatus(inbox.id, 'deleted');
  return c.body(null, 204);
});

const listMessagesRoute = createRoute({
  method: 'get',
  path: '/v1/inboxes/{inbox_id}/messages',
  tags: ['inboxes'],
  summary: 'List inbox messages',
  request: {
    params: idParam,
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Messages, newest first',
      content: { 'application/json': { schema: messageListSchema } },
    },
    404: errorResponse('Inbox not found'),
  },
});

inboxRoutes.openapi(listMessagesRoute, async (c) => {
  const { repos, config } = c.get('ctx');
  const caller = await resolveCaller(c);
  assertScope(caller, 'messages:read');
  const { inbox_id } = c.req.valid('param');
  const { cursor, limit } = c.req.valid('query');

  const inbox = await authorizeInboxAccess(
    repos,
    config,
    inbox_id,
    c.req.header('Authorization'),
    caller,
  );
  const page = await listInboxMessages(repos, inbox.id, cursor, clampLimit(limit));
  return c.json(page, 200);
});
