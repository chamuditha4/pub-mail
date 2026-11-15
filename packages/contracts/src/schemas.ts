import { z } from '@hono/zod-openapi';

// Public API contract schemas (CLAUDE.md §9). JSON keys are snake_case and
// timestamps are UTC RFC 3339 strings. `.strict()` rejects unknown properties.

export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'rate_limit_exceeded' }),
      message: z.string().openapi({ example: 'Request limit exceeded.' }),
      request_id: z.string().openapi({ example: 'req_01HZ...' }),
    }),
  })
  .openapi('ErrorEnvelope');

export const domainSchema = z
  .object({
    name: z.string().openapi({ example: 'example.com' }),
    pool_type: z.enum(['public', 'private']),
    allow_anonymous_inboxes: z.boolean(),
    allow_custom_local_parts: z.boolean(),
    max_inbox_ttl_seconds: z.number().int().positive(),
  })
  .openapi('Domain');

export const domainListSchema = z
  .object({
    data: z.array(domainSchema),
  })
  .openapi('DomainList');

// Admin view of a domain (full record).
export const adminDomainSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    zone_id: z.string().nullable(),
    status: z.enum(['pending', 'active', 'paused', 'misconfigured']),
    pool_type: z.enum(['public', 'private']),
    allow_anonymous_inboxes: z.boolean(),
    allow_custom_local_parts: z.boolean(),
    max_inbox_ttl_seconds: z.number().int().positive(),
    catch_all: z.boolean(),
    routing_configured: z.boolean(),
    created_at: z.string(),
  })
  .openapi('AdminDomain');

export const adminDomainListSchema = z
  .object({ data: z.array(adminDomainSchema), routing_automation: z.boolean() })
  .openapi('AdminDomainList');

const domainNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, 'invalid domain');

export const createDomainRequestSchema = z
  .object({
    name: domainNameSchema.openapi({ example: 'example.com' }),
    zone_id: z.string().min(1).optional(),
    pool_type: z.enum(['public', 'private']).default('private'),
    allow_anonymous_inboxes: z.boolean().default(false),
    allow_custom_local_parts: z.boolean().default(true),
    max_inbox_ttl_seconds: z.number().int().positive().max(86_400).default(86_400),
  })
  .strict()
  .openapi('CreateDomainRequest');

export const updateDomainRequestSchema = z
  .object({
    status: z.enum(['pending', 'active', 'paused', 'misconfigured']).optional(),
    pool_type: z.enum(['public', 'private']).optional(),
    allow_anonymous_inboxes: z.boolean().optional(),
    allow_custom_local_parts: z.boolean().optional(),
    max_inbox_ttl_seconds: z.number().int().positive().max(86_400).optional(),
    zone_id: z.string().min(1).optional(),
    catch_all: z.boolean().optional(),
  })
  .strict()
  .openapi('UpdateDomainRequest');

// A conservative local-part allowlist: lowercase ASCII letters, digits, and the
// separators `.`, `-`, `_`. 1–64 chars. (CLAUDE.md §6 inboxes.)
export const localPartSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, 'invalid local part')
  .openapi({ example: 'my-inbox' });

export const createInboxRequestSchema = z
  .object({
    domain: z.string().min(1).openapi({ example: 'example.com' }),
    local_part: localPartSchema.optional(),
    expires_in: z.number().int().positive().optional().openapi({ example: 3600 }),
  })
  .strict()
  .openapi('CreateInboxRequest');

export const inboxSchema = z
  .object({
    id: z.string().openapi({ example: '01J...' }),
    address: z.string().openapi({ example: 'random@example.com' }),
    domain: z.string().openapi({ example: 'example.com' }),
    status: z.enum(['active', 'expired', 'deleted', 'blocked']),
    expires_at: z.string().openapi({ example: '2026-07-27T12:00:00Z' }),
    created_at: z.string(),
    last_message_at: z.string().nullable(),
  })
  .openapi('Inbox');

// Inbox creation response additionally includes the one-time access token.
export const createdInboxSchema = inboxSchema
  .extend({
    access_token: z.string().openapi({ example: 'tmb_...' }),
  })
  .openapi('CreatedInbox');

export const inboxEnvelopeSchema = z.object({ data: inboxSchema }).openapi('InboxEnvelope');
export const createdInboxEnvelopeSchema = z
  .object({ data: createdInboxSchema })
  .openapi('CreatedInboxEnvelope');

export const userSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    role: z.enum(['user', 'admin']),
  })
  .openapi('User');

// Username: lowercase letters, digits, and . _ - (3–32 chars).
export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, 'invalid username')
  .openapi({ example: 'alice' });

export const credentialsSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(8).max(200).openapi({ example: 'correct horse battery' }),
  })
  .strict()
  .openapi('Credentials');

export const webhookEventSchema = z.enum([
  'message.received',
  'message.ready',
  'message.failed',
  'message.deleted',
  'inbox.expiring',
  'inbox.expired',
]);

export const createWebhookRequestSchema = z
  .object({
    url: z.string().url().max(2048),
    events: z.array(webhookEventSchema).min(1),
  })
  .strict()
  .openapi('CreateWebhookRequest');

export const updateWebhookRequestSchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    events: z.array(webhookEventSchema).min(1).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict()
  .openapi('UpdateWebhookRequest');

export const webhookMetadataSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
    status: z.enum(['active', 'disabled']),
    failure_count: z.number().int().nonnegative(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Webhook');

export const createdWebhookSchema = webhookMetadataSchema
  .extend({ secret: z.string().openapi({ example: 'whsec_…' }) })
  .openapi('CreatedWebhook');

export const webhookDeliverySchema = z
  .object({
    id: z.string(),
    event_id: z.string(),
    event_type: z.string(),
    status: z.enum(['pending', 'delivered', 'failed', 'dead']),
    attempt: z.number().int(),
    response_status: z.number().int().nullable(),
    created_at: z.string(),
    delivered_at: z.string().nullable(),
  })
  .openapi('WebhookDelivery');

export const createBlocklistRequestSchema = z
  .object({
    entry_type: z.enum(['sender', 'recipient', 'ip', 'domain']),
    value: z.string().min(1).max(320),
    reason: z.string().max(300).optional(),
  })
  .strict()
  .openapi('CreateBlocklistRequest');

export const createAbuseReportRequestSchema = z
  .object({
    subject_type: z.enum(['address', 'domain', 'message', 'other']),
    subject_value: z.string().max(320).optional(),
    details: z.string().min(3).max(2000),
    reporter_email: z.string().email().max(320).optional(),
  })
  .strict()
  .openapi('CreateAbuseReportRequest');

// Developer API-key scopes (CLAUDE.md §10). Admin scopes are separate and never
// assignable here.
export const apiScopeSchema = z.enum([
  'domains:read',
  'private_domains:read',
  'inboxes:read',
  'inboxes:write',
  'messages:read',
  'messages:delete',
  'webhooks:read',
  'webhooks:write',
  'usage:read',
]);

export const createApiKeyRequestSchema = z
  .object({
    name: z.string().min(1).max(80),
    scopes: z.array(apiScopeSchema).min(1),
    expires_in: z.number().int().positive().optional(),
  })
  .strict()
  .openapi('CreateApiKeyRequest');

export const apiKeyMetadataSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    key_prefix: z.string(),
    scopes: z.array(z.string()),
    status: z.enum(['active', 'revoked']),
    last_used_at: z.string().nullable(),
    expires_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('ApiKeyMetadata');

// Returned only on creation — includes the full key exactly once.
export const createdApiKeySchema = apiKeyMetadataSchema
  .extend({ key: z.string().openapi({ example: 'tm_live_ab12cd34_…' }) })
  .openapi('CreatedApiKey');

export const usageSchema = z
  .object({
    active_inboxes: z.number().int().nonnegative(),
    active_api_keys: z.number().int().nonnegative(),
    limits: z.object({
      anon_inbox_creations_per_hour: z.number().int(),
      api_requests_per_minute: z.number().int(),
    }),
  })
  .openapi('Usage');

export const messageSummarySchema = z
  .object({
    id: z.string(),
    sender_address: z.string(),
    sender_name: z.string().nullable(),
    subject: z.string(),
    snippet: z.string(),
    received_at: z.string(),
    status: z.enum(['received', 'processing', 'ready', 'failed', 'deleted']),
    has_attachments: z.boolean(),
    size_bytes: z.number().int().nonnegative(),
  })
  .openapi('MessageSummary');

export const messageListSchema = z
  .object({
    data: z.array(messageSummarySchema),
    next_cursor: z.string().nullable(),
  })
  .openapi('MessageList');

export const attachmentSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    content_type: z.string(),
    size_bytes: z.number().int().nonnegative(),
    disposition: z.enum(['attachment', 'inline']),
    blocked: z.boolean().openapi({ description: 'True when the type is disallowed for download.' }),
  })
  .openapi('Attachment');

// Unibox item: a message plus the generated address it arrived at.
export const uniboxMessageSchema = messageSummarySchema
  .extend({
    recipient_address: z.string(),
    inbox_id: z.string(),
  })
  .openapi('UniboxMessage');

export const uniboxListSchema = z
  .object({
    data: z.array(uniboxMessageSchema),
    next_cursor: z.string().nullable(),
  })
  .openapi('UniboxList');

// A user's inbox (may be expired/deleted but still listed for the owner).
export const ownedInboxSchema = z
  .object({
    id: z.string(),
    address: z.string(),
    domain: z.string(),
    status: z.enum(['active', 'expired', 'deleted', 'blocked']),
    expires_at: z.string(),
    created_at: z.string(),
    last_message_at: z.string().nullable(),
  })
  .openapi('OwnedInbox');

export const ownedInboxListSchema = z
  .object({ data: z.array(ownedInboxSchema) })
  .openapi('OwnedInboxList');

export const messageDetailSchema = messageSummarySchema
  .extend({
    recipient_address: z.string(),
    text_body: z.string().nullable(),
    html_body_sanitized: z.string().nullable(),
    processed_at: z.string().nullable(),
    attachments: z.array(attachmentSchema),
  })
  .openapi('MessageDetail');

export const messageDetailEnvelopeSchema = z
  .object({ data: messageDetailSchema })
  .openapi('MessageDetailEnvelope');

export type Domain = z.infer<typeof domainSchema>;
export type CreateInboxRequest = z.infer<typeof createInboxRequestSchema>;
export type Inbox = z.infer<typeof inboxSchema>;
export type CreatedInbox = z.infer<typeof createdInboxSchema>;
export type MessageSummary = z.infer<typeof messageSummarySchema>;
export type MessageDetail = z.infer<typeof messageDetailSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type User = z.infer<typeof userSchema>;
export type UniboxMessage = z.infer<typeof uniboxMessageSchema>;
export type OwnedInbox = z.infer<typeof ownedInboxSchema>;
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;
export type WebhookMetadata = z.infer<typeof webhookMetadataSchema>;
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export type CreateBlocklistRequest = z.infer<typeof createBlocklistRequestSchema>;
export type CreateAbuseReportRequest = z.infer<typeof createAbuseReportRequestSchema>;
export type ApiScope = z.infer<typeof apiScopeSchema>;
export type ApiKeyMetadata = z.infer<typeof apiKeyMetadataSchema>;
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;
export type Usage = z.infer<typeof usageSchema>;
export type AdminDomain = z.infer<typeof adminDomainSchema>;
export type CreateDomainRequest = z.infer<typeof createDomainRequestSchema>;
export type UpdateDomainRequest = z.infer<typeof updateDomainRequestSchema>;
