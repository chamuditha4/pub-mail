import type { R2Bucket } from '@cloudflare/workers-types';
import type { Repositories } from '@tmp-mail/database';

// Physical removal of a domain's stored mail (CLAUDE.md §13). Deleting the
// domain row cascades inboxes, messages, and attachment rows in D1, but R2
// objects have no such cascade — they must be deleted first or they become
// orphans nothing can find. Work is batched and bounded so one request never
// runs unbounded (CLAUDE.md §19); an incomplete purge is resumed by calling
// again, since every batch is idempotent.

export interface DomainPurgeDeps {
  repos: Repositories;
  rawBucket: R2Bucket;
  attachmentBucket: R2Bucket;
  /** Messages handled per batch. */
  batchSize?: number;
  /** Upper bound on batches per call, to stay inside the request CPU budget. */
  maxBatches?: number;
}

export interface DomainPurgeResult {
  purgedMessages: number;
  /** False when messages remain and the caller should purge again. */
  complete: boolean;
}

// R2 accepts at most 1000 keys per bulk delete.
const R2_DELETE_LIMIT = 1000;

async function deleteObjects(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += R2_DELETE_LIMIT) {
    await bucket.delete(keys.slice(i, i + R2_DELETE_LIMIT));
  }
}

export async function purgeDomainContent(
  domainId: string,
  deps: DomainPurgeDeps,
): Promise<DomainPurgeResult> {
  const batchSize = deps.batchSize ?? 200;
  const maxBatches = deps.maxBatches ?? 25;
  let purgedMessages = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const messages = await deps.repos.messages.listByDomain(domainId, batchSize);
    if (messages.length === 0) return { purgedMessages, complete: true };

    const ids = messages.map((m) => m.id);
    const attachmentKeys = await deps.repos.attachments.listKeysByMessages(ids);
    const rawKeys = messages.map((m) => m.r2_raw_key).filter((k) => k.length > 0);

    // R2 deletes come first: a row removed with its object still present is an
    // orphan, while an object removed before its row is simply already gone.
    await deleteObjects(deps.rawBucket, rawKeys);
    await deleteObjects(deps.attachmentBucket, attachmentKeys);
    await deps.repos.messages.hardDeleteMany(ids);
    purgedMessages += ids.length;
  }

  // Still work left after the batch budget: report it rather than deleting the
  // domain and stranding the remaining objects.
  const remaining = await deps.repos.messages.listByDomain(domainId, 1);
  return { purgedMessages, complete: remaining.length === 0 };
}
