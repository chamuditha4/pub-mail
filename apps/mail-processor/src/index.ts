import type {
  ExecutionContext,
  MessageBatch,
  ScheduledController,
} from '@cloudflare/workers-types';
import { emailProcessingJobSchema, webhookDeliveryJobSchema } from '@tmp-mail/shared';
import { createRepositories } from '@tmp-mail/database';
import { processJob } from './process.js';
import { runRetention } from './retention.js';
import { deliverWebhook, enqueueMessageWebhooks, type WebhookDeps } from './webhooks.js';
import type { Env } from './types.js';

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ worker: 'mail-processor', ...fields }));
}

function webhookDeps(env: Env): WebhookDeps {
  return {
    db: env.DB,
    queue: env.WEBHOOK_DELIVERY_QUEUE,
    encryptionKey: env.WEBHOOK_SECRET_ENCRYPTION_KEY ?? '',
  };
}

async function handleEmailBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  const deps = {
    db: env.DB,
    rawBucket: env.MAIL_RAW_BUCKET,
    attachmentBucket: env.MAIL_ATTACHMENT_BUCKET,
  };
  const repos = createRepositories(env.DB);

  for (const msg of batch.messages) {
    const startedAt = Date.now();
    const parsed = emailProcessingJobSchema.safeParse(msg.body);
    if (!parsed.success) {
      log({ operation: 'process', outcome: 'invalid_event' });
      msg.ack();
      continue;
    }
    try {
      const result = await processJob(parsed.data, deps);
      // On first successful processing, fan out webhook deliveries (idempotent).
      if (result.outcome === 'processed') {
        const message = await repos.messages.findById(parsed.data.message_id);
        if (message) await enqueueMessageWebhooks(webhookDeps(env), message, 'message.ready');
      }
      log({
        operation: 'process',
        outcome: result.outcome,
        message_id: parsed.data.message_id,
        duration_ms: Date.now() - startedAt,
      });
      msg.ack();
    } catch (err) {
      log({
        operation: 'process',
        outcome: 'error',
        message_id: parsed.data.message_id,
        error: err instanceof Error ? err.name : 'unknown',
        duration_ms: Date.now() - startedAt,
      });
      msg.retry();
    }
  }
}

async function handleWebhookBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  const deps = webhookDeps(env);
  for (const msg of batch.messages) {
    const parsed = webhookDeliveryJobSchema.safeParse(msg.body);
    if (!parsed.success) {
      msg.ack();
      continue;
    }
    try {
      const outcome = await deliverWebhook(deps, parsed.data.delivery_id);
      log({ worker: 'webhook', operation: 'deliver', outcome: outcome.retry ? 'retry' : 'done' });
      if (outcome.retry) msg.retry({ delaySeconds: outcome.delaySeconds });
      else msg.ack();
    } catch (err) {
      log({
        operation: 'deliver',
        outcome: 'error',
        error: err instanceof Error ? err.name : 'unknown',
      });
      msg.retry();
    }
  }
}

export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue.startsWith('webhook-delivery')) {
      await handleWebhookBatch(batch, env);
    } else {
      await handleEmailBatch(batch, env);
    }
  },

  // Scheduled retention sweep (CLAUDE.md §13). Runs on the cron trigger.
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const startedAt = Date.now();
    ctx.waitUntil(
      runRetention({
        db: env.DB,
        rawBucket: env.MAIL_RAW_BUCKET,
        attachmentBucket: env.MAIL_ATTACHMENT_BUCKET,
      })
        .then((result) =>
          log({
            operation: 'retention',
            outcome: 'ok',
            ...result,
            duration_ms: Date.now() - startedAt,
          }),
        )
        .catch((err) =>
          log({
            operation: 'retention',
            outcome: 'error',
            error: err instanceof Error ? err.name : 'unknown',
            duration_ms: Date.now() - startedAt,
          }),
        ),
    );
  },
} satisfies ExportedHandler<Env>;
