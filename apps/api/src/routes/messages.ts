import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { errorEnvelopeSchema, messageDetailEnvelopeSchema } from '@tmp-mail/contracts';
import { notFound } from '@tmp-mail/shared';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import { assertScope, type Scope } from '../auth/caller.js';
import { authorizeInboxAccess } from '../auth/inbox-auth.js';
import { toMessageDetail } from '../services/message-service.js';

export const messageRoutes = new OpenAPIHono<HonoEnv>();

const idParam = z.object({
  message_id: z
    .string()
    .min(1)
    .openapi({ param: { name: 'message_id', in: 'path' } }),
});

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: errorEnvelopeSchema } },
});

// Load a message and authorize the caller. Any failure is reported as the same
// not_found so callers cannot enumerate messages. Two ways to authorize:
//   - the authenticated owner (message.user_id === caller.userId) — works even
//     when the inbox is expired/deleted, so the unibox can read old mail; or
//   - a valid inbox access token for the message's still-active inbox.
async function loadAuthorizedMessage(c: Context<HonoEnv>, messageId: string, scope: Scope) {
  const { repos, config } = c.get('ctx');
  const caller = await resolveCaller(c);
  assertScope(caller, scope);
  const message = await repos.messages.findById(messageId);
  if (!message || message.status === 'deleted') {
    // Still perform inbox authorization work to keep behavior uniform.
    await authorizeInboxAccess(repos, config, 'none', c.req.header('Authorization'), caller).catch(
      () => undefined,
    );
    throw notFound('Message not found.');
  }

  const isOwner =
    caller.kind === 'user' && message.user_id !== null && message.user_id === caller.userId;
  if (!isOwner) {
    await authorizeInboxAccess(
      repos,
      config,
      message.inbox_id,
      c.req.header('Authorization'),
      caller,
    );
  }
  return message;
}

const getMessageRoute = createRoute({
  method: 'get',
  path: '/v1/messages/{message_id}',
  tags: ['messages'],
  summary: 'Read a parsed message',
  request: { params: idParam },
  responses: {
    200: {
      description: 'Message detail',
      content: { 'application/json': { schema: messageDetailEnvelopeSchema } },
    },
    404: errorResponse('Message not found'),
  },
});

messageRoutes.openapi(getMessageRoute, async (c) => {
  const { repos } = c.get('ctx');
  const { message_id } = c.req.valid('param');
  const message = await loadAuthorizedMessage(c, message_id, 'messages:read');
  const attachments = await repos.attachments.listByMessage(message.id);
  return c.json({ data: toMessageDetail(message, attachments) }, 200);
});

const deleteMessageRoute = createRoute({
  method: 'delete',
  path: '/v1/messages/{message_id}',
  tags: ['messages'],
  summary: 'Delete a message',
  request: { params: idParam },
  responses: {
    204: { description: 'Message deleted' },
    404: errorResponse('Message not found'),
  },
});

messageRoutes.openapi(deleteMessageRoute, async (c) => {
  const { repos } = c.get('ctx');
  const { message_id } = c.req.valid('param');
  const message = await loadAuthorizedMessage(c, message_id, 'messages:delete');
  await repos.messages.setStatus(message.id, 'deleted');
  return c.body(null, 204);
});

const downloadAttachmentRoute = createRoute({
  method: 'get',
  path: '/v1/messages/{message_id}/attachments/{attachment_id}',
  tags: ['messages'],
  summary: 'Download an attachment',
  request: {
    params: z.object({
      message_id: z
        .string()
        .min(1)
        .openapi({ param: { name: 'message_id', in: 'path' } }),
      attachment_id: z
        .string()
        .min(1)
        .openapi({ param: { name: 'attachment_id', in: 'path' } }),
    }),
  },
  responses: {
    200: { description: 'Attachment bytes (Content-Disposition: attachment)' },
    404: errorResponse('Not found'),
  },
});

messageRoutes.openapi(downloadAttachmentRoute, async (c) => {
  const { repos } = c.get('ctx');
  const { message_id, attachment_id } = c.req.valid('param');

  // Authorize via the parent message's inbox before touching R2.
  const message = await loadAuthorizedMessage(c, message_id, 'messages:read');
  const attachment = await repos.attachments.findById(attachment_id);
  if (!attachment || attachment.message_id !== message.id) {
    throw notFound('Attachment not found.');
  }
  // Blocked or unstored attachments are never served.
  if (attachment.scan_status === 'blocked' || attachment.r2_key === '') {
    throw notFound('Attachment not found.');
  }

  const object = await c.env.MAIL_ATTACHMENT_BUCKET.get(attachment.r2_key);
  if (!object) throw notFound('Attachment not found.');

  // Defensive response headers (CLAUDE.md §12): force download, no sniffing,
  // and a restrictive CSP so the byte stream can never execute in a browser.
  const filename = attachment.safe_filename || 'attachment';
  c.header('Content-Type', 'application/octet-stream');
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "default-src 'none'; sandbox");
  c.header('Cache-Control', 'private, no-store');
  c.header('Content-Length', String(attachment.size_bytes));
  return c.body(object.body as unknown as ReadableStream, 200);
});
