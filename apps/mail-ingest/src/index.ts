import type { ForwardableEmailMessage } from '@cloudflare/workers-types';
import { ingestEmail, type RejectReason } from './ingest.js';
import type { Env } from './types.js';

// Structured, body-free logging (CLAUDE.md §16). We log stable internal IDs and
// outcomes, never addresses or message content.
function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ worker: 'mail-ingest', ...fields }));
}

// Reasons we surface as an SMTP rejection so senders learn the address is
// undeliverable (CLAUDE.md §7 step 4). Transient/internal issues instead throw
// so Cloudflare retries.
const REJECT_MESSAGES: Record<RejectReason, string> = {
  invalid_recipient: 'Invalid recipient address',
  inactive_domain: 'Domain not accepting mail',
  unknown_recipient: 'Unknown recipient',
  too_large: 'Message exceeds maximum size',
  blocked: 'Rejected',
};

function parseMaxBytes(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 15 * 1024 * 1024;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await ingestEmail(
        {
          from: message.from,
          to: message.to,
          rawSize: message.rawSize,
          headers: message.headers,
          raw: message.raw,
        },
        {
          db: env.DB,
          rawBucket: env.MAIL_RAW_BUCKET,
          queue: env.EMAIL_PROCESSING_QUEUE,
          maxMessageBytes: parseMaxBytes(env.MAX_MESSAGE_BYTES),
        },
      );

      const duration_ms = Date.now() - startedAt;

      if (result.outcome === 'rejected') {
        message.setReject(REJECT_MESSAGES[result.reason]);
        log({ operation: 'ingest', outcome: 'rejected', reason: result.reason, duration_ms });
        return;
      }

      if (result.outcome === 'duplicate') {
        log({
          operation: 'ingest',
          outcome: 'duplicate',
          message_id: result.messageId,
          inbox_id: result.inboxId,
          duration_ms,
        });
        return;
      }

      log({
        operation: 'ingest',
        outcome: 'accepted',
        message_id: result.messageId,
        inbox_id: result.inboxId,
        duration_ms,
      });
    } catch (err) {
      // Do not log the email body. Surface only the error name and rethrow so the
      // platform retries delivery; the message is not recorded as accepted.
      log({
        operation: 'ingest',
        outcome: 'error',
        error: err instanceof Error ? err.name : 'unknown',
        duration_ms: Date.now() - startedAt,
      });
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;
