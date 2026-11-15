import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { AppConfig, WebhookDeliveryJob } from '@tmp-mail/shared';
import type { Repositories } from '@tmp-mail/database';

/** Raw Worker bindings (CLAUDE.md §20). */
export interface Env {
  DB: D1Database;
  MAIL_RAW_BUCKET: R2Bucket;
  MAIL_ATTACHMENT_BUCKET: R2Bucket;
  WEBHOOK_DELIVERY_QUEUE: Queue<WebhookDeliveryJob>;
  APP_ENV: string;
  APP_BASE_URL: string;
  API_BASE_URL: string;
  CORS_ORIGINS?: string;
  DEFAULT_INBOX_TTL_SECONDS: string;
  MIN_INBOX_TTL_SECONDS: string;
  MAX_INBOX_TTL_SECONDS: string;
  USER_INBOX_TTL_SECONDS: string;
  MAX_MESSAGE_BYTES: string;
  TOKEN_PEPPER: string;
  ANON_INBOX_CREATIONS_PER_HOUR?: string;
  API_REQUESTS_PER_MINUTE?: string;
  ADMIN_USERNAMES?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
  INGEST_WORKER_NAME?: string;
}

/** Per-request derived context attached to Hono variables. */
export interface RequestContext {
  requestId: string;
  config: AppConfig;
  repos: Repositories;
}

export interface HonoEnv {
  Bindings: Env;
  Variables: {
    ctx: RequestContext;
  };
}
