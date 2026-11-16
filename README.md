# pub-mail

A self-hosted, receive-only temporary email platform that runs entirely on
Cloudflare: **Workers, D1, R2, Queues and Email Routing**. It gives you disposable
inboxes on your own domains, a REST API and web app to read the mail, signed
webhooks, API keys, and admin/abuse controls.

> Deployment-specific values in this repo (`example.com` hostnames, the D1
> `database_id`, `TOKEN_PEPPER`, `WEBHOOK_SECRET_ENCRYPTION_KEY`) are
> **placeholders**. Follow the installation steps below to replace them with your
> own. Never deploy the placeholder secrets.

## Features

- **Anonymous and signed-in inboxes** on public or private domains, with
  configurable TTLs. Signed-in users get a unified inbox that outlives the
  individual addresses.
- **REST API** with OpenAPI 3.1 (`/openapi.json`) and Swagger UI (`/docs`), inbox
  access tokens, and scoped API keys with rate limiting.
- **Safe display:** MIME parsed server-side, HTML sanitized against an allowlist,
  remote images blocked, attachments stored in R2 and served with defensive headers,
  and a web UI that renders mail in a sandboxed iframe.
- **Real-time updates** over SSE, plus a scheduled retention sweep that purges
  expired anonymous mail from R2 and D1.
- **Signed webhooks** (HMAC-SHA256, SSRF-defended, retried with backoff, secrets
  encrypted at rest).
- **Domain management:** users add their own domains; admins activate them.
  Optional Cloudflare Email Routing automation. Per-domain catch-all.
- **Admin and abuse controls:** blocklists, audit log, metrics, abuse reports.

See [`CLAUDE.md`](./CLAUDE.md) for the full design specification.

## How it fits together

| Worker               | Role                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `tmp-mail-ingest`    | Email Worker. Receives mail from Email Routing, streams raw MIME to R2, enqueues a job.                              |
| `tmp-mail-processor` | Queue consumer + cron. Parses MIME, sanitizes HTML, stores attachments, delivers webhooks, runs the retention sweep. |
| `tmp-mail-api`       | REST API (Hono). Auth, inboxes, messages, domains, API keys, webhooks, admin.                                        |
| `tmp-mail-web`       | Static React app served from Workers Assets.                                                                         |

All four share one **D1** database (`tmp-mail`), two **R2** buckets
(`tmp-mail-raw`, `tmp-mail-attachments`) and four **Queues**.

## Installation

### Prerequisites

- A Cloudflare account on the **Workers Paid** plan (Queues require it).
- A domain whose DNS is on Cloudflare, for the API/web hostnames and for the
  mail domains you want to receive on.
- Node.js 20 or newer and [pnpm](https://pnpm.io) 10 (`corepack enable`).

### 1. Clone and install

```bash
git clone https://github.com/chamuditha4/pub-mail.git
cd pub-mail
pnpm install
pnpm exec wrangler login   # or set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
```

### 2. Create the Cloudflare resources

```bash
# Database: copy the printed database_id
pnpm exec wrangler d1 create tmp-mail

# Buckets
pnpm exec wrangler r2 bucket create tmp-mail-raw
pnpm exec wrangler r2 bucket create tmp-mail-attachments

# Queues (including dead-letter queues)
pnpm exec wrangler queues create email-processing
pnpm exec wrangler queues create email-processing-dlq
pnpm exec wrangler queues create webhook-delivery
pnpm exec wrangler queues create webhook-delivery-dlq
```

### 3. Configure `wrangler.toml`

Edit the four files in `apps/*/wrangler.toml`:

1. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the id from step 2, in
   `apps/api`, `apps/mail-ingest` and `apps/mail-processor`.
2. In `apps/api/wrangler.toml`, set your hostnames:
   - `routes` pattern, `APP_BASE_URL` and `API_BASE_URL` (for example
     `api.yourdomain.com` and `app.yourdomain.com`)
   - `CORS_ORIGINS`: any extra browser origins allowed to call the API
3. In `apps/web/wrangler.toml`, set the `routes` pattern to your app hostname.
4. Remove the placeholder `TOKEN_PEPPER` and `WEBHOOK_SECRET_ENCRYPTION_KEY` lines
   from `[vars]` in `apps/api/wrangler.toml` and `apps/mail-processor/wrangler.toml`.
   They become real secrets in step 5, and a variable and a secret cannot share a name.
5. Set `APP_ENV = "production"` where you want production behaviour.

### 4. Apply the database migrations

```bash
cd apps/api
pnpm exec wrangler d1 migrations apply tmp-mail --remote
cd ../..
```

### 5. Set the secrets

Generate two long random values and store them as Worker secrets:

```bash
PEPPER=$(openssl rand -base64 48)
WEBHOOK_KEY=$(openssl rand -base64 48)

# The API needs both. Keep the pepper stable: changing it invalidates every
# stored token, session and API key.
printf %s "$PEPPER"      | pnpm --filter @tmp-mail/api exec wrangler secret put TOKEN_PEPPER
printf %s "$WEBHOOK_KEY" | pnpm --filter @tmp-mail/api exec wrangler secret put WEBHOOK_SECRET_ENCRYPTION_KEY

# The processor decrypts webhook secrets, so it needs the SAME webhook key.
printf %s "$WEBHOOK_KEY" | pnpm --filter @tmp-mail/mail-processor exec wrangler secret put WEBHOOK_SECRET_ENCRYPTION_KEY
```

> If a command says the Worker does not exist yet, deploy it once (step 6) and
> repeat that secret.

Optional, to let the admin UI enable Email Routing for a domain automatically
instead of showing the manual guide:

```bash
pnpm --filter @tmp-mail/api exec wrangler secret put CLOUDFLARE_ACCOUNT_ID
pnpm --filter @tmp-mail/api exec wrangler secret put CLOUDFLARE_EMAIL_API_TOKEN
```

The token needs Email Routing edit access plus zone read for your mail domains.

### 6. Deploy

Deploy the Workers that own the queues first, then the API, then the web app.

```bash
pnpm --filter @tmp-mail/mail-processor deploy
pnpm --filter @tmp-mail/mail-ingest deploy
pnpm --filter @tmp-mail/api deploy

# The web app bakes in the API URL at build time:
VITE_API_BASE=https://api.yourdomain.com pnpm --filter @tmp-mail/web deploy
```

Check `https://api.yourdomain.com/health/ready` and open
`https://app.yourdomain.com`.

### 7. Create your admin account

Add `ADMIN_USERNAMES = "yourname"` under `[vars]` in `apps/api/wrangler.toml`,
redeploy the API, then sign up with that username in the web app. Admins can activate domains
and see the admin console.

### 8. Add a mail domain

1. In the web app, add your domain (it starts as `pending`).
2. In the Cloudflare dashboard, open the domain, go to **Email > Email Routing**
   and enable it (this adds the MX and SPF records).
3. Under **Routing rules > Catch-all address**, choose **Send to a Worker** and
   select **`tmp-mail-ingest`**.
4. In the web app, run **Verify** (or have an admin activate the domain). Once
   it is **active** it appears in the public domain list and accepts inboxes.

With the optional Cloudflare token from step 5, steps 2 and 3 are done for you by
the **enable-routing** action.

### 9. Try it

```bash
curl -s https://api.yourdomain.com/v1/domains

curl -s -X POST https://api.yourdomain.com/v1/inboxes \
  -H 'Content-Type: application/json' \
  -d '{"domain":"mail.yourdomain.com"}'
# -> returns the address, an id, and an access token (shown once)

# Send a mail to that address, then:
curl -s https://api.yourdomain.com/v1/inboxes/<id>/messages \
  -H 'Authorization: Bearer <access token>'
```

## Configuration reference

Non-secret values go in `[vars]` in `apps/api/wrangler.toml`.

| Name                            | Default           | Meaning                                           |
| ------------------------------- | ----------------- | ------------------------------------------------- |
| `APP_ENV`                       | `development`     | `development`, `staging` or `production`.         |
| `APP_BASE_URL`, `API_BASE_URL`  | required          | Public URLs of the web app and API.               |
| `CORS_ORIGINS`                  | empty             | Extra allowed browser origins, comma-separated.   |
| `DEFAULT_INBOX_TTL_SECONDS`     | `3600`            | Lifetime of a new anonymous inbox.                |
| `MIN_/MAX_INBOX_TTL_SECONDS`    | `600` / `86400`   | Bounds a caller may request.                      |
| `USER_INBOX_TTL_SECONDS`        | `2592000`         | Lifetime of a signed-in user's address (30 days). |
| `ANON_INBOX_CREATIONS_PER_HOUR` | `20`              | Per-IP limit for anonymous inbox creation.        |
| `API_REQUESTS_PER_MINUTE`       | `120`             | Per-API-key request limit.                        |
| `MAX_MESSAGE_BYTES`             | `15728640`        | Largest accepted message (15 MiB).                |
| `ADMIN_USERNAMES`               | empty             | Usernames granted admin.                          |
| `INGEST_WORKER_NAME`            | `tmp-mail-ingest` | Worker the Email Routing automation targets.      |

Secrets (set with `wrangler secret put`): `TOKEN_PEPPER` (required, 16+ chars),
`WEBHOOK_SECRET_ENCRYPTION_KEY`, and optionally `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_EMAIL_API_TOKEN`. See [`.env.example`](./.env.example) for local tooling.

## API overview

Interactive docs are served at `/docs`, and the machine-readable spec at `/openapi.json`.

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

The inbox access token is returned exactly once, when the inbox is created, and
is sent as `Authorization: Bearer tmb_...`. Accounts, API keys (`tm_live_...`),
webhooks, the unified inbox and the admin endpoints are listed in `/docs`.

## Local development

```bash
pnpm install
pnpm --filter @tmp-mail/api dev      # API on http://localhost:8787
pnpm --filter @tmp-mail/web dev      # web app on http://localhost:5173
```

```bash
pnpm typecheck   # tsc across all projects
pnpm test        # unit + Workers-pool integration tests
pnpm lint
pnpm format      # prettier --write
pnpm build       # wrangler dry-run build of each Worker
```

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, tests and
build on every push and pull request.

## Repository layout

```text
apps/
  api/             REST API Worker (Hono + @hono/zod-openapi)
  mail-ingest/     Email Worker: streams raw MIME to R2, enqueues jobs
  mail-processor/  Queue consumer + cron: parsing, webhooks, retention
  web/             React + Vite app (Workers Assets)
packages/
  contracts/       Zod schemas + public API types
  database/        D1 repositories
  email/           address normalization, MIME parsing, HTML sanitizing
  security/        token generation, keyed hashing, webhook signing
  shared/          ids (ULID), errors, time, env validation
migrations/        D1 SQL migrations
```
