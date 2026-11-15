import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { WebhookDeliveryJob } from '@tmp-mail/shared';

/** Bindings for the mail-processor Worker (CLAUDE.md §20). */
export interface Env {
  DB: D1Database;
  MAIL_RAW_BUCKET: R2Bucket;
  MAIL_ATTACHMENT_BUCKET: R2Bucket;
  WEBHOOK_DELIVERY_QUEUE: Queue<WebhookDeliveryJob>;
  WEBHOOK_SECRET_ENCRYPTION_KEY: string;
  APP_ENV: string;
}
