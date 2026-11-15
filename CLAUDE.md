# Temporary Mail Platform — Repository Instructions

## 1. Mission

Build a receive-only temporary email platform that:

- Receives email for multiple domains through Cloudflare Email Routing.
- Routes every configured domain to one shared Cloudflare Email Worker.
- Supports public and private domain pools selected by each domain owner.
- Creates short-lived inboxes from the web UI or REST API.
- Stores message metadata and sanitized bodies temporarily.
- Stores raw messages and attachments in Cloudflare R2.
- Supports polling, Server-Sent Events (SSE), and signed webhooks.
- Deletes inboxes, messages, raw MIME, and attachments after expiry.
- Never sends, replies to, or forwards email.

This file is the source of truth for implementation decisions. If code and this
document disagree, stop and resolve the conflict before continuing.

## 2. Product Boundaries

### In scope

- Domains owned and managed by the platform operator in one Cloudflare account.
- Catch-all Email Routing for each active domain.
- Public domain pools available to anonymous users and authorized API clients.
- Private domain pools restricted to the domain owner and explicitly authorized
  members or API keys.
- Anonymous web inboxes protected by an unguessable inbox access token.
- Google OAuth accounts for developers who need API keys and webhooks.
- Admin domain management.
- Public REST API under `/v1`.
- OpenAPI documentation.
- Automatic retention and deletion.
- Safe display of plain-text and sanitized HTML messages.
- Attachment download with defensive response headers.
- API quotas, rate limiting, audit events, and webhook retries.

### Out of scope for v1

- Sending email, replying, forwarding, SMTP submission, IMAP, or POP3.
- Customer-owned domains in separate Cloudflare accounts.
- Permanent mailboxes.
- Mail-client synchronization.
- Searching the full contents of all messages.
- Rendering unsanitized HTML.
- Loading remote images or tracking pixels.
- Executing, previewing, or unpacking attachments.
- Using one Worker per domain.

Never add outgoing-email functionality as a shortcut for authentication,
notifications, or verification. Google OAuth is the initial user authentication
method.

## 3. Architecture

```text
Sender
  |
  v
Cloudflare Email Routing (catch-all per domain)
  |
  v
mail-ingest Worker
  |-- validate domain and recipient
  |-- stream raw MIME to R2
  |-- create minimal ingestion record
  `-- enqueue message ID
          |
          v
      email-processing Queue
          |
          v
      mail-processor Worker
          |-- parse MIME
          |-- sanitize HTML
          |-- extract safe metadata
          |-- store attachments in R2
          |-- update database
          |-- publish inbox event
          `-- enqueue webhook deliveries

Web / API clients
  |
  v
api Worker ---> D1 ---> message metadata
      |          |
      |          `---- inboxes, API keys, domains, webhooks
      |
      `-------> R2 ---> raw MIME and attachments
```

Use one catch-all routing rule per domain. Temporary addresses are database
records, not Cloudflare routing rules. This avoids consuming one routing rule for
every inbox.

## 4. Required Technology

- Language: TypeScript with strict mode.
- Package manager: `pnpm`.
- Runtime: Cloudflare Workers.
- API framework: Hono.
- Validation and OpenAPI: `@hono/zod-openapi` and Zod.
- Frontend: React + Vite.
- Database: Cloudflare D1 for v1.
- Object storage: Cloudflare R2.
- Asynchronous work: Cloudflare Queues.
- MIME parsing: `postal-mime`, isolated in the processor Worker.
- HTML sanitization: a Worker-compatible sanitizer with an explicit allowlist.
- IDs: UUIDv7 or ULID; never sequential public IDs.
- Tests: Vitest and Cloudflare Workers test utilities.
- Deployment: Wrangler.

Keep persistence behind repository interfaces so D1 can later be replaced with
PostgreSQL without changing route handlers or email-processing logic.

## 5. Suggested Repository Layout

```text
apps/
  api/
    src/
  mail-ingest/
    src/
  mail-processor/
    src/
  web/
    src/
packages/
  contracts/
  database/
  email/
  security/
  shared/
migrations/
openapi/
scripts/
tests/
CLAUDE.md
pnpm-workspace.yaml
```

Responsibilities:

- `apps/mail-ingest`: Email Routing handler only. Keep it fast and minimal.
- `apps/mail-processor`: Queue consumer for MIME parsing and webhook scheduling.
- `apps/api`: REST API, SSE, OAuth callbacks, and admin endpoints.
- `apps/web`: Public inbox UI, developer dashboard, and admin UI.
- `packages/contracts`: Zod schemas and shared public API types.
- `packages/database`: migrations, repositories, and transaction helpers.
- `packages/email`: MIME parsing, normalization, and body sanitization.
- `packages/security`: tokens, API-key verification, webhook signing, and limits.

Do not import application code across Workers. Move reusable code into packages.

## 6. Core Data Model

### `users`

- `id`
- `email`
- `name`
- `avatar_url`
- `role`: `user | admin`
- `status`: `active | suspended`
- `created_at`
- `updated_at`

### `oauth_accounts` and `sessions`

Store Google OAuth identity and revocable sessions. Use secure, HTTP-only,
same-site cookies for the dashboard.

### `domains`

- `id`
- `name`, unique and lowercase
- `zone_id`
- `status`: `pending | active | paused | misconfigured`
- `pool_type`: `public | private`
- `allow_anonymous_inboxes`
- `allow_custom_local_parts`
- `max_inbox_ttl_seconds`
- `created_at`
- `updated_at`

Never store a Cloudflare API token in this table.

### `domain_memberships`

- `id`
- `domain_id`
- `user_id`
- `role`: `owner | manager | member`
- `created_at`
- `revoked_at`, nullable

Each domain must have exactly one active owner. A domain owner can choose
`public` or `private`, pause inbox creation, manage members, and configure
domain-level inbox limits. Only an administrator can change the owner or modify
Cloudflare routing. Enforce the single-owner invariant in a transaction and with
the strongest database constraint D1 supports.

Public pool behavior:

- The domain appears in the public domain list.
- Anonymous users may create inboxes when `allow_anonymous_inboxes` is enabled.
- Authenticated API users may create inboxes subject to their quotas.
- The domain owner can switch the domain to private at any time.

Private pool behavior:

- The domain never appears in anonymous or unauthorized domain listings.
- Only the owner, active members, and explicitly authorized API keys may create
  or access inboxes on the domain.
- Knowledge of the domain name, inbox ID, or email address does not grant access.
- Existing inboxes remain functional when switching from public to private, but
  only their existing access tokens or authorized owners/members may read them.
- Switching from private to public requires an explicit confirmation because it
  expands who can create inboxes.

### `inboxes`

- `id`
- `user_id`, nullable for anonymous inboxes
- `domain_id`
- `local_part`
- `address`, unique
- `access_token_hash`
- `status`: `active | expired | deleted | blocked`
- `expires_at`
- `created_at`
- `last_message_at`

The local part must be lowercase ASCII and match the platform allowlist. Reserve
administrative and abuse-sensitive names such as `admin`, `postmaster`, `abuse`,
`security`, `support`, and `root`.

### `messages`

- `id`
- `inbox_id`
- `provider_message_id`, nullable
- `r2_raw_key`
- `sender_address`
- `sender_name`, nullable
- `recipient_address`
- `subject`
- `text_body`, nullable
- `html_body_sanitized`, nullable
- `snippet`
- `received_at`
- `processed_at`, nullable
- `expires_at`
- `status`: `received | processing | ready | failed | deleted`
- `size_bytes`
- `has_attachments`
- `spam_classification`, nullable

Do not put raw MIME or binary attachments in D1.

### `attachments`

- `id`
- `message_id`
- `r2_key`
- `original_filename`
- `safe_filename`
- `content_type`
- `size_bytes`
- `content_id`, nullable
- `disposition`
- `scan_status`: `not_scanned | clean | blocked | failed`
- `created_at`
- `expires_at`

### `api_keys`

- `id`
- `user_id`
- `name`
- `key_prefix`
- `secret_hash`
- `scopes_json`
- `status`: `active | revoked`
- `last_used_at`
- `expires_at`, nullable
- `created_at`

Show the complete API key exactly once. Store only a keyed hash of the secret.

### `webhooks`

- `id`
- `user_id`
- `url`
- `secret_encrypted`
- `events_json`
- `status`
- `created_at`
- `updated_at`

### `webhook_deliveries`

- `id`
- `webhook_id`
- `event_id`
- `event_type`
- `payload_json`
- `attempt`
- `next_attempt_at`
- `response_status`, nullable
- `status`
- `created_at`
- `delivered_at`, nullable

### `audit_logs`

Record security-sensitive actions without recording message bodies, API secrets,
OAuth tokens, session cookies, or attachment contents.

## 7. Email Ingestion Rules

The `mail-ingest` Worker must:

1. Normalize the envelope recipient.
2. Confirm that the recipient domain is active.
3. Look up an inbox by its full address. Pool visibility does not affect inbound
   delivery for an already-created inbox.
4. Accept mail for an expired inbox: revive it for its original lifetime (capped
   by the domain's `max_inbox_ttl_seconds`, floored at the minimum anonymous
   lifetime) and deliver the message. Mail that arrives just after a short TTL
   lapses is the mail users care about most, so it must never bounce.
5. Treat a deleted inbox as an unclaimed address: deliver to the domain
   catch-all if enabled, otherwise reject as an unknown recipient. Deleted and
   blocked inboxes are never revived.
6. Reject unknown and blocked recipients at SMTP time where supported.
7. Enforce domain, sender, recipient, and message-size limits.
8. Generate a message ID.
9. Stream `message.raw` directly to R2. Do not buffer the full email.
10. Insert only the minimal message record needed for recovery.
11. Send a small queue event containing IDs and R2 keys.
12. Return without parsing MIME.

Cloudflare currently rejects inbound messages over 25 MiB. Apply a lower
application limit by default, such as 15 MiB, so processing and storage remain
predictable.

Make ingestion idempotent. If the same provider message or ingestion ID is seen
again, do not create a second visible message.

If R2 persistence fails, do not mark the message as accepted internally. Log a
structured error without logging the email body.

## 8. Message Processing Rules

The `mail-processor` Worker must:

1. Fetch raw MIME from R2.
2. Parse the message with strict size limits.
3. Limit header count, nesting depth, body sizes, and attachment count.
4. Prefer a decoded plain-text body for previews.
5. Sanitize HTML using an allowlist.
6. Remove scripts, forms, styles that can escape containment, event handlers,
   embedded objects, iframes, and active content.
7. Replace remote image sources with blocked placeholders.
8. Normalize links and add safe link attributes in the UI.
9. Store attachments separately in R2.
10. Mark risky or unsupported attachment types as blocked.
11. Update the message to `ready`.
12. publish an SSE event and enqueue webhook deliveries.

Processing must be idempotent and safe to retry.

If parsing fails, retain limited metadata, mark the message `failed`, and make a
safe failure state visible. Never expose parser stack traces to clients.

## 9. REST API Contract

All public endpoints use `/v1`. JSON keys use `snake_case`. Timestamps use UTC
RFC 3339. Paginated endpoints use opaque cursor pagination, never page numbers.

### Authentication methods

- Anonymous inbox access: `Authorization: Bearer <inbox_access_token>`.
- Developer API access: `Authorization: Bearer tm_live_<key_id>_<secret>`.
- Dashboard access: secure session cookie after Google OAuth.
- Admin access: admin role plus Cloudflare Access or an equivalent outer layer.

Never accept API keys in query strings.

### Required endpoints

| Method   | Path                                                    | Purpose                                                                        |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET`    | `/v1/domains`                                           | List public domains plus private domains available to the authenticated caller |
| `POST`   | `/v1/inboxes`                                           | Create a temporary inbox                                                       |
| `GET`    | `/v1/inboxes/{inbox_id}`                                | Read inbox metadata                                                            |
| `DELETE` | `/v1/inboxes/{inbox_id}`                                | Delete inbox and schedule purge                                                |
| `GET`    | `/v1/inboxes/{inbox_id}/messages`                       | List messages                                                                  |
| `GET`    | `/v1/inboxes/{inbox_id}/events`                         | SSE stream for inbox events                                                    |
| `GET`    | `/v1/messages/{message_id}`                             | Read a parsed message                                                          |
| `DELETE` | `/v1/messages/{message_id}`                             | Delete a message                                                               |
| `GET`    | `/v1/messages/{message_id}/attachments/{attachment_id}` | Download an attachment                                                         |
| `GET`    | `/v1/api-keys`                                          | List API-key metadata                                                          |
| `POST`   | `/v1/api-keys`                                          | Create an API key                                                              |
| `DELETE` | `/v1/api-keys/{key_id}`                                 | Revoke an API key                                                              |
| `GET`    | `/v1/webhooks`                                          | List webhooks                                                                  |
| `POST`   | `/v1/webhooks`                                          | Create a webhook                                                               |
| `PATCH`  | `/v1/webhooks/{webhook_id}`                             | Update a webhook                                                               |
| `DELETE` | `/v1/webhooks/{webhook_id}`                             | Delete a webhook                                                               |
| `POST`   | `/v1/webhooks/{webhook_id}/rotate-secret`               | Rotate webhook secret                                                          |
| `POST`   | `/v1/webhooks/{webhook_id}/test`                        | Send a test HTTP webhook                                                       |
| `GET`    | `/v1/usage`                                             | Return current quota usage                                                     |
| `GET`    | `/health/live`                                          | Process liveness only                                                          |
| `GET`    | `/health/ready`                                         | Dependency readiness                                                           |

Admin-only endpoints:

| Method  | Path                                    | Purpose                              |
| ------- | --------------------------------------- | ------------------------------------ |
| `GET`   | `/v1/admin/domains`                     | List every configured domain         |
| `POST`  | `/v1/admin/domains`                     | Register an existing Cloudflare zone |
| `POST`  | `/v1/admin/domains/{id}/enable-routing` | Enable Email Routing and catch-all   |
| `POST`  | `/v1/admin/domains/{id}/verify`         | Verify DNS/routing status            |
| `PATCH` | `/v1/admin/domains/{id}`                | Pause, publish, or change limits     |
| `GET`   | `/v1/admin/metrics`                     | Operational metrics                  |

Domain-owner endpoints:

| Method   | Path                                       | Purpose                                         |
| -------- | ------------------------------------------ | ----------------------------------------------- |
| `GET`    | `/v1/owner/domains`                        | List domains owned by or shared with the caller |
| `GET`    | `/v1/owner/domains/{id}`                   | Read domain policy and usage                    |
| `PATCH`  | `/v1/owner/domains/{id}`                   | Change pool type and allowed inbox behavior     |
| `DELETE` | `/v1/owner/domains/{id}`                   | Remove the domain and purge all mail on it      |
| `GET`    | `/v1/owner/domains/{id}/members`           | List active members                             |
| `POST`   | `/v1/owner/domains/{id}/members`           | Grant an existing user access                   |
| `DELETE` | `/v1/owner/domains/{id}/members/{user_id}` | Revoke access                                   |

Domain deletion is destructive and irreversible: it erases every inbox and
message on the domain, including inboxes other users created. Only an
administrator or the domain's active owner may delete a domain, the caller must
echo the domain name back as confirmation, and R2 content must be purged before
the database rows are removed so no object is orphaned.

`GET /v1/domains` must never reveal a private domain to an unauthorized caller,
including through counts, pagination cursors, errors, timing-sensitive secondary
lookups, or cached responses. Domain-list cache keys must include the caller's
authorization context.

### Inbox creation

Request:

```json
{
  "domain": "example.com",
  "local_part": "optional-custom-name",
  "expires_in": 3600
}
```

Response:

```json
{
  "data": {
    "id": "01...",
    "address": "random@example.com",
    "access_token": "tmb_...",
    "expires_at": "2026-07-27T12:00:00Z"
  }
}
```

Return `access_token` only during creation. If the caller uses a developer API
key, associate the inbox with that user and still require object-level
authorization.

Inbox creation authorization:

- Anonymous callers can select only active public domains with
  `allow_anonymous_inboxes` enabled.
- Authenticated users can select public domains and private domains for which
  they have an active membership.
- API-key callers must additionally have the required inbox-write and
  private-domain scopes.
- Domain owners may disable custom local parts or apply stricter TTL and quota
  limits to their domain.
- Return the same non-enumerating authorization error when a private domain is
  unknown or inaccessible.

### Error format

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Request limit exceeded.",
    "request_id": "req_..."
  }
}
```

Keep error messages useful but do not reveal whether an inaccessible inbox,
message, API key, or user exists.

### API requirements

- Generate and publish an OpenAPI 3.1 document.
- Serve interactive API documentation.
- Return `X-Request-Id` on every response.
- Return standard rate-limit headers.
- Support `Idempotency-Key` on inbox and webhook creation.
- Use content-type validation.
- Reject unknown request properties.
- Apply request-body size limits.
- Set explicit CORS allowlists; never use credentialed wildcard CORS.
- Version behavior through `/v1`; do not silently introduce breaking changes.

## 10. API-Key Scopes

Initial scopes:

- `domains:read`
- `private_domains:read`
- `inboxes:read`
- `inboxes:write`
- `messages:read`
- `messages:delete`
- `webhooks:read`
- `webhooks:write`
- `usage:read`

Admin scopes are separate and cannot be assigned from the developer dashboard:

- `admin:domains`
- `admin:metrics`
- `admin:abuse`

API keys must be high-entropy random values. Include a public key ID/prefix so
verification can fetch one database row rather than scan all hashes. Use a
server-side pepper and Web Crypto. Revocation must take effect promptly.

An API key can use a private domain only when its user has an active domain
membership and the key has `private_domains:read`. Revoking the membership must
remove private-domain access immediately even if the API key remains active.

## 11. Webhooks

Initial event types:

- `message.received`
- `message.ready`
- `message.failed`
- `message.deleted`
- `inbox.expiring`
- `inbox.expired`

Sign each webhook using HMAC-SHA256 over:

```text
<timestamp>.<event_id>.<raw_request_body>
```

Headers:

- `Webhook-Id`
- `Webhook-Timestamp`
- `Webhook-Signature: v1=<hex-or-base64-signature>`

The payload includes an immutable event ID. Document verification and replay
protection. Retry transient failures with exponential backoff and jitter.
Disable endpoints after repeated permanent failures. Never follow redirects to
private or link-local networks. Protect webhook delivery against SSRF and DNS
rebinding.

## 12. Security and Privacy Requirements

These are release blockers:

- Inbox IDs and message IDs alone never grant access.
- Anonymous access tokens contain at least 128 bits of entropy.
- API secrets and inbox tokens are never stored in plaintext.
- Use constant-time comparison where practical.
- Do not log message bodies, raw MIME, tokens, cookies, API keys, OAuth secrets,
  webhook secrets, or attachment contents.
- Do not render raw HTML.
- Disable remote content by default to prevent sender tracking.
- Attachment responses use `Content-Disposition: attachment`,
  `X-Content-Type-Options: nosniff`, and a restrictive CSP.
- Sanitize filenames and never use user filenames as R2 keys.
- Protect every lookup against broken object-level authorization.
- Treat private domain names and membership as authorization-protected data.
- Never expose a private domain in public domain suggestions, frontend bundles,
  analytics dimensions, unauthenticated API documentation examples, or errors.
- Apply rate limits to inbox creation, polling, SSE connections, downloads, and
  API keys.
- Add CSRF protection to cookie-authenticated state changes.
- Set secure headers on both API and web applications.
- Validate OAuth `state`, nonce, redirect URI, and PKCE where applicable.
- Restrict admin routes using both application authorization and an outer
  access-control layer.
- Maintain an abuse blocklist for domains, senders, recipients, and IPs.
- Provide an abuse-reporting path before public launch.
- Purge expired data from D1 and R2, including orphaned objects.

Do not claim end-to-end encryption. Cloudflare and this application process
incoming email content.

## 13. Retention

Defaults:

- Default inbox lifetime: 60 minutes.
- Allowed anonymous lifetime: 10 minutes to 24 hours.
- Message and attachment expiry: no later than inbox expiry.
- An expired inbox that receives mail is revived for one more lifetime, so a
  continuously mailed address stays alive. Retention stays bounded because each
  renewal is capped by the domain's `max_inbox_ttl_seconds`.
- Deleted records may remain as minimal non-content tombstones only when needed
  for idempotency or abuse prevention.

Use scheduled jobs to:

1. Mark expired inboxes immediately.
2. Delete related R2 raw messages and attachments.
3. Delete or redact message rows.
4. Remove expired sessions and webhook delivery payloads.
5. Detect and delete orphaned R2 objects.

Deletion must be idempotent. Record aggregate deletion metrics without retaining
email content.

## 14. Cloudflare Domain Management

All v1 email domains must exist in the operator's Cloudflare account.

The admin domain workflow:

1. Admin selects or enters an existing Cloudflare zone.
2. The API verifies the exact zone ID.
3. The admin assigns a verified platform user as the domain owner.
4. The owner selects a public or private pool; default new domains to private.
5. The API enables Email Routing DNS configuration using a narrowly scoped
   Cloudflare API token.
6. The API creates one catch-all rule that targets `mail-ingest`.
7. The API verifies the routing status.
8. The domain becomes active only after a real end-to-end test succeeds.
9. A public domain is exposed to anonymous clients only after both the routing
   test and the owner's explicit public-pool confirmation succeed.

Store the Cloudflare API token only as a Worker secret. Use minimum permissions:
zone read, DNS changes required for Email Routing, Email Routing settings write,
and Email Routing rules write. Do not use the global API key.

Do not attempt to onboard a domain from another person's Cloudflare account in
v1. That requires a separately designed authorization and tenant-isolation flow.

## 15. Rate Limiting and Quotas

Implement configurable limits rather than hard-coding plan values.

At minimum enforce:

- Anonymous inbox creations per IP and time window.
- Active inboxes per anonymous session.
- Private-domain inbox creations per owner, member, and API key.
- API requests per key.
- Inbox creations per API key.
- Concurrent SSE connections per inbox and key.
- Poll frequency per inbox.
- Messages per inbox per time window.
- Bytes received per domain, inbox, and account.
- Attachment count and size per message.
- Webhooks and webhook attempts per account.

The free Cloudflare Workers plan has a daily request allowance and tight CPU
limits. Production must use an appropriate paid plan. A single Worker can scale
across domains; storage writes, spam volume, and parsing are expected to become
the practical constraints before route count.

## 16. Observability

Use structured JSON logs with:

- `request_id`
- `event_id`
- `message_id`
- `inbox_id`
- `domain_id`
- `worker`
- `operation`
- `duration_ms`
- `outcome`
- safe error code

Do not include addresses in logs unless normalized and privacy-reviewed. Prefer
stable internal IDs.

Track:

- accepted, rejected, processed, failed, and deleted messages
- ingestion and processing latency
- queue depth and oldest-message age
- R2 and D1 errors
- API latency and error rate
- authentication failures and rate-limit events
- SSE connections
- webhook success, retry, and disable rates
- bytes stored and deleted

Add alerts for sustained queue backlog, processing failures, purge failures,
storage errors, and unusual inbound spikes.

## 17. Testing Strategy

Required test layers:

### Unit tests

- address normalization
- local-part validation and reserved names
- token generation and hashing
- API-key scope checks
- webhook signatures
- HTML sanitization
- MIME edge cases
- retention calculations

### Integration tests

- D1 repositories and migrations
- R2 raw-message and attachment lifecycle
- queue retry idempotency
- inbox and message authorization
- public/private domain visibility and membership revocation
- API idempotency keys
- OAuth callback validation
- webhook retry and SSRF defenses

### End-to-end tests

- create inbox, receive fixture email, process, list, read, and delete
- plain text, HTML, multipart, Unicode, malformed MIME, and attachments
- expired inbox rejection
- unknown recipient rejection
- anonymous token isolation
- API-key scope enforcement
- private domains absent from unauthorized lists, cursors, caches, and errors
- public-to-private and private-to-public transition behavior
- real domain smoke test in staging

Maintain sanitized `.eml` fixtures. Never commit real user email.

## 18. Implementation Milestones

### Milestone 0 — Foundation

- Create the pnpm monorepo.
- Configure TypeScript, linting, formatting, Vitest, and Wrangler.
- Add local bindings and environment validation.
- Set up CI for type-checking, tests, and builds.

Exit criterion: every application builds and a minimal Worker test passes.

### Milestone 1 — Database and inbox API

- Add initial D1 migrations and repositories.
- Implement domain listing and anonymous inbox creation.
- Implement public/private domain policies and membership authorization.
- Implement inbox access tokens and authorization.
- Implement message list placeholders and deletion.
- Generate OpenAPI documentation.

Exit criterion: two anonymous inboxes cannot read each other's data.

### Milestone 2 — Email ingestion

- Deploy `mail-ingest`.
- Configure one staging domain and catch-all route.
- Validate active recipients.
- Stream raw MIME to R2 and enqueue processing events.
- Add idempotency and safe logs.

Exit criterion: a real email reaches R2 and creates one processing job.

### Milestone 3 — Parsing and safe display

- Parse MIME from R2.
- Sanitize HTML and block remote content.
- Extract and store attachments.
- Complete message read and attachment endpoints.
- Build the temporary inbox UI.

Exit criterion: the supported email fixture suite renders safely.

### Milestone 4 — Real-time delivery and retention

- Add SSE.
- Add scheduled expiry and complete R2/D1 purge.
- Add orphan cleanup.
- Show expiry countdown and deletion state in the UI.

Exit criterion: expired content becomes inaccessible and is physically removed.

### Milestone 5 — Developer API

- Add Google OAuth.
- Add API-key creation, scopes, revocation, and usage.
- Add quotas and rate-limit headers.
- Publish API documentation and examples.

Exit criterion: an API client can create an inbox and receive/read a message
without using the web UI.

### Milestone 6 — Webhooks

- Add webhook configuration and secret rotation.
- Sign deliveries.
- Add queued retries, replay protection guidance, and SSRF defenses.
- Add delivery history without sensitive message content.

Exit criterion: `message.ready` is delivered once logically despite retries.

### Milestone 7 — Admin, abuse controls, and launch

- Automate Cloudflare domain activation.
- Add owner assignment, pool visibility controls, and private-domain membership.
- Add metrics, audit logs, blocklists, and abuse workflows.
- Add production alerts and operational runbooks.
- Complete threat modeling and load testing.

Exit criterion: staging passes security, deletion, failure-recovery, and burst
tests before production traffic is enabled.

## 19. Coding Rules

- Work milestone by milestone; do not scaffold the entire product with empty
  placeholders.
- Before editing, inspect nearby code and existing tests.
- Keep routes thin: validate, authorize, call a service, and serialize.
- Put business rules in services and persistence in repositories.
- Do not use `any`; use `unknown` and narrow it.
- Validate all external input, including environment variables and queue events.
- Use prepared statements for all database access.
- Avoid unbounded queries, arrays, body reads, and concurrency.
- Add indexes for every production query path.
- Make background operations idempotent.
- Treat retries and partial failures as normal.
- Do not silently catch errors.
- Do not expose internal exception text through the API.
- Update OpenAPI schemas and tests with every API change.
- Add a migration for schema changes; never edit an already-applied migration.
- Keep secrets out of source, fixtures, logs, and generated client bundles.
- Run formatting, linting, type-checking, tests, and builds before declaring a
  milestone complete.

## 20. Environment and Secrets

Expected configuration names:

```text
APP_ENV
APP_BASE_URL
API_BASE_URL
DEFAULT_INBOX_TTL_SECONDS
MAX_INBOX_TTL_SECONDS
MAX_MESSAGE_BYTES
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
SESSION_SECRET
TOKEN_PEPPER
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_EMAIL_API_TOKEN
WEBHOOK_SECRET_ENCRYPTION_KEY
```

Expected bindings:

```text
DB
MAIL_RAW_BUCKET
MAIL_ATTACHMENT_BUCKET
EMAIL_PROCESSING_QUEUE
WEBHOOK_DELIVERY_QUEUE
RATE_LIMITER
```

Use separate Cloudflare accounts or clearly isolated resources for development,
staging, and production. Never test routing with a production domain.

## 21. Definition of Done

A feature is complete only when:

- behavior and error cases are implemented
- authorization is enforced
- rate limits are considered
- logs contain no sensitive content
- unit/integration tests cover the change
- OpenAPI is updated when applicable
- migrations are included when applicable
- formatting, linting, type-checking, tests, and builds pass
- retention and deletion behavior is verified
- relevant operational metrics exist

When uncertain, choose the design that minimizes retained email content,
privileged credentials, and synchronous processing.
