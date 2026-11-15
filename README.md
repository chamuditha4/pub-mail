# tmp-mail

> **Self-hosting:** replace every `REPLACE...` / `example.com` value in `apps/*/wrangler.toml` with your own
> (D1 database id, hostnames) and set `TOKEN_PEPPER` and `WEBHOOK_SECRET_ENCRYPTION_KEY` as real Worker
> secrets with `wrangler secret put` — the values committed here are placeholders, never use them.

A receive-only temporary email platform built on Cloudflare Workers, D1, R2, and
Queues. See [`CLAUDE.md`](./CLAUDE.md) for the full specification — it is the
source of truth for all implementation decisions.

## Status

Implemented so far:

- **Milestone 0 — Foundation:** pnpm monorepo, TypeScript strict mode,
  ESLint/Prettier, Vitest (Cloudflare Workers pool), Wrangler, env validation, CI.
- **Milestone 1 — Database & inbox API:** D1 schema + repositories, domain
  listing, anonymous inbox creation, public/private domain policies + membership
  authorization, inbox access tokens, message list/delete, OpenAPI 3.1 document.
- **Milestone 2 — Email ingestion:** `mail-ingest` Email Worker that normalizes
  the recipient, validates the active domain + active/unexpired inbox, enforces
  size limits, streams raw MIME to R2 without buffering, writes a minimal message
  record, and enqueues one processing job. Idempotent (dedupe on Message-ID),
  with body-free structured logging and SMTP-time rejection of bad recipients.
- **Milestone 3 — Parsing & safe display:** `mail-processor` queue consumer that
  parses MIME (`postal-mime`), sanitizes HTML against an allowlist (`xss` —
  strips scripts/styles/iframes/handlers, blocks remote images), extracts and
  stores attachments in R2 (executables blocked), and finalizes the message to
  `ready`. Attachment download endpoint with defensive headers
  (`Content-Disposition: attachment`, `nosniff`, restrictive CSP). React + Vite
  inbox UI that renders sanitized HTML in a fully sandboxed iframe.
- **Accounts & unibox (Milestone 5 core):** username/password auth
  (PBKDF2-SHA256 hashing, per-user salt + server pepper), revocable sessions via
  secure HTTP-only cookies, `POST /v1/auth/signup|login|logout`, `GET /v1/me`.
  Denormalized `messages.user_id` powers a **unified
  inbox** (`GET /v1/me/messages`, `GET /v1/me/inboxes`) showing every message
  across all of a user's generated addresses — **retained even after an inbox is
  deleted or expires** (a deliberate retention change from §13, for signed-in
  users only). Owners can read old mail from expired/deleted inboxes; anonymous
  inboxes keep the short-lived behavior. Web UI: sign-in, unibox, per-address
  creation.
- **Domain management (owner model):** any signed-in user can add domains via
  `/v1/owner/domains` and becomes the owner; they see and manage only their own.
  Admins see and manage every domain. New domains start `pending` and only appear
  in the public list once **active** — and only an admin (or the routing
  `verify` flow) can activate, so a user can't force a broken domain into the
  public pool. Optional Cloudflare Email Routing automation (`enable-routing` /
  `verify`, gated by a CF API token). UI: add-domain form + step-by-step
  activation guide (Email Routing + catch-all → `tmp-mail-ingest`). Admin is
  granted by user role or the `ADMIN_USERNAMES` var.
- **Developer API guide** page in the web app (curl examples for auth, inboxes,
  messages, attachments, unibox) linking to the interactive Swagger UI at
  `/docs`. UI is **responsive** across mobile and desktop.
- **Domain catch-all:** per-domain, owner-toggled (off by default). When on, mail
  to any address with no specific inbox is delivered to the domain owner's
  catch-all inbox and shows in their unibox (with the real recipient address).
  Mail to inboxes other users created still routes to them — never to the owner.
- **Milestone 6 — Signed webhooks:** webhook CRUD + secret rotation + test send
  (`/v1/webhooks`), secrets **encrypted at rest** and shown once. The processor
  fans out deliveries on `message.ready` to the owner's subscribed webhooks and
  consumes a `webhook-delivery` queue: **HMAC-SHA256 signed** (`Webhook-Signature:
v1=…` over `timestamp.event_id.body`, with `Webhook-Id`/`Webhook-Timestamp`),
  **SSRF-defended** (https-only, private-IP/host block, never follows redirects),
  retried with exponential backoff + jitter, auto-disabled after repeated
  failures, and **deduped for once-logically delivery**. Delivery history +
  webhook UI. Exit criterion met (verified live: queued → delivered 200).
- **Milestone 7 — Admin & abuse controls:** abuse **blocklist**
  (senders/recipients/domains enforced at ingestion, IPs at inbox creation) with
  admin CRUD; **audit logs** for security-sensitive actions (auth, key + domain +
  blocklist changes) with an admin view; **admin metrics** (`/v1/admin/metrics`);
  a public **abuse-reporting** path (`POST /v1/abuse-reports`, rate-limited) with
  admin review/status. Admin console + report form in the web UI.
- **Milestone 5 — Developer API keys + rate limiting:** create/list/revoke API
  keys (`/v1/api-keys`), format `tm_live_<prefix>_<secret>` with only a keyed
  hash stored and the full key shown once; API-key auth with per-key **scope**
  enforcement; `GET /v1/usage`. Configurable fixed-window **rate limiting**
  (anonymous inbox-creation per IP, API requests per key) with standard
  `X-RateLimit-*` headers; counters pruned by the retention sweep. Web UI for key
  management. Exit criterion met: an API client creates an inbox and reads mail
  with no web UI.
- **Milestone 4 — Real-time & retention:** SSE endpoints
  (`/v1/inboxes/{id}/events`, `/v1/me/events`) push live updates so the UI
  refreshes without polling (with a 20s safety poll fallback). A scheduled
  retention sweep (`mail-processor` cron, every 5 min) marks expired inboxes,
  **physically purges** expired anonymous messages from R2 + D1 (raw MIME +
  attachments), and clears expired sessions — while retaining signed-in users'
  mail (unibox).

## Layout

```text
apps/
  api/            REST API Worker (Hono + @hono/zod-openapi)
  mail-ingest/    Email Routing Worker: streams raw MIME to R2, enqueues jobs
packages/
  contracts/      Zod schemas + public API types
  database/       D1 migrations helpers + repositories
  email/          address normalization + local-part rules
  security/       token generation, keyed hashing, constant-time compare
  shared/         ids (ULID), errors, time, env validation
migrations/       D1 SQL migrations
```

## Commands

```bash
pnpm install
pnpm typecheck      # tsc -b across all projects
pnpm test           # unit + Workers-pool integration tests
pnpm lint
pnpm format         # prettier --write
pnpm build          # wrangler dry-run build of each Worker

# API worker
pnpm --filter @tmp-mail/api dev     # local dev server (wrangler)
```

## API (Milestone 1)

| Method   | Path                              | Auth                  |
| -------- | --------------------------------- | --------------------- |
| `GET`    | `/v1/domains`                     | none (public domains) |
| `POST`   | `/v1/inboxes`                     | none (anonymous)      |
| `GET`    | `/v1/inboxes/{inbox_id}`          | inbox access token    |
| `DELETE` | `/v1/inboxes/{inbox_id}`          | inbox access token    |
| `GET`    | `/v1/inboxes/{inbox_id}/messages` | inbox access token    |
| `GET`    | `/v1/messages/{message_id}`       | inbox access token    |
| `DELETE` | `/v1/messages/{message_id}`       | inbox access token    |
| `GET`    | `/health/live`, `/health/ready`   | none                  |
| `GET`    | `/openapi.json`, `/docs`          | none                  |

The inbox access token is returned exactly once, when the inbox is created, and
is presented as `Authorization: Bearer tmb_...`.
