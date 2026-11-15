import { z } from 'zod';

// Internal queue-event contracts. Not part of the public REST API. Both the
// producer (mail-ingest) and consumer (mail-processor) validate against these so
// malformed queue messages fail loudly (CLAUDE.md §19: validate queue events).

export const emailProcessingJobSchema = z.object({
  /** Internal message id (ULID) created at ingestion. */
  message_id: z.string(),
  /** Inbox the message was delivered to. */
  inbox_id: z.string(),
  /** R2 key of the streamed raw MIME. */
  r2_raw_key: z.string(),
  /** Envelope recipient, normalized. */
  recipient_address: z.string(),
  /** Epoch seconds when ingestion accepted the message. */
  received_at: z.number().int().nonnegative(),
  /** Raw message size in bytes. */
  size_bytes: z.number().int().nonnegative(),
});

export type EmailProcessingJob = z.infer<typeof emailProcessingJobSchema>;

// A single queued webhook delivery attempt. The consumer loads the delivery row
// and its webhook, signs, and POSTs.
export const webhookDeliveryJobSchema = z.object({
  delivery_id: z.string(),
});

export type WebhookDeliveryJob = z.infer<typeof webhookDeliveryJobSchema>;

/** Public webhook event types (CLAUDE.md §11). */
export const WEBHOOK_EVENT_TYPES = [
  'message.received',
  'message.ready',
  'message.failed',
  'message.deleted',
  'inbox.expiring',
  'inbox.expired',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
