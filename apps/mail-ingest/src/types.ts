import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { EmailProcessingJob } from '@tmp-mail/shared';

/** Bindings for the mail-ingest Worker (CLAUDE.md §20). */
export interface Env {
  DB: D1Database;
  MAIL_RAW_BUCKET: R2Bucket;
  EMAIL_PROCESSING_QUEUE: Queue<EmailProcessingJob>;
  APP_ENV: string;
  MAX_MESSAGE_BYTES: string;
}
