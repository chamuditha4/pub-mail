import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { createRepositories, type Repositories } from '@tmp-mail/database';
import { DEFAULT_PARSE_LIMITS, parseEmail, safeFilename, type ParseLimits } from '@tmp-mail/email';
import { nowSeconds, ulid, type EmailProcessingJob } from '@tmp-mail/shared';

// Message processing (CLAUDE.md §8). Fetches raw MIME from R2, parses and
// sanitizes, stores attachments, and finalizes the message. Idempotent and safe
// to retry: re-running replaces attachments and re-writes parsed fields.

export interface ProcessDeps {
  db: D1Database;
  rawBucket: R2Bucket;
  attachmentBucket: R2Bucket;
  now?: () => number;
  limits?: ParseLimits;
  repos?: Repositories;
}

export type ProcessResult =
  | { outcome: 'processed'; attachments: number; blocked: number }
  | { outcome: 'failed'; reason: 'parse_error' }
  | { outcome: 'skipped'; reason: 'missing_message' | 'already_ready' | 'deleted' };

// Executable / script types that are never served for download (CLAUDE.md §8
// step 10). Blocked attachments are recorded but their bytes are not stored.
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'dll',
  'com',
  'bat',
  'cmd',
  'msi',
  'scr',
  'pif',
  'cpl',
  'msc',
  'jar',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'ps1',
  'psm1',
  'reg',
  'hta',
  'lnk',
  'app',
  'deb',
  'dmg',
  'iso',
  'apk',
  'sh',
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function isBlockedAttachment(filename: string, contentType: string): boolean {
  if (BLOCKED_EXTENSIONS.has(extensionOf(filename))) return true;
  const ct = contentType.toLowerCase();
  return (
    ct === 'application/x-msdownload' ||
    ct === 'application/x-msdos-program' ||
    ct === 'application/x-sh' ||
    ct === 'application/hta'
  );
}

/** Process a single email-processing job. */
export async function processJob(
  job: EmailProcessingJob,
  deps: ProcessDeps,
): Promise<ProcessResult> {
  const repos = deps.repos ?? createRepositories(deps.db);
  const now = (deps.now ?? nowSeconds)();
  const limits = deps.limits ?? DEFAULT_PARSE_LIMITS;

  const message = await repos.messages.findById(job.message_id);
  if (!message) return { outcome: 'skipped', reason: 'missing_message' };
  if (message.status === 'deleted') return { outcome: 'skipped', reason: 'deleted' };
  if (message.status === 'ready') return { outcome: 'skipped', reason: 'already_ready' };

  // Fetch raw MIME. A missing object means R2 is not yet consistent or the
  // upload failed; throw so the queue retries rather than marking ready.
  const object = await deps.rawBucket.get(job.r2_raw_key);
  if (!object) {
    throw new Error(`raw object not found: ${job.r2_raw_key}`);
  }
  const raw = await object.arrayBuffer();

  // Parse failures are terminal for this message: retain metadata, mark it
  // failed, and stop (CLAUDE.md §8). Do not surface parser internals.
  let parsed;
  try {
    parsed = await parseEmail(raw, limits);
  } catch {
    await repos.messages.markFailed(message.id);
    return { outcome: 'failed', reason: 'parse_error' };
  }

  // Idempotency: clear any attachments from a prior partial run before writing.
  await repos.attachments.deleteByMessage(message.id);

  let blocked = 0;
  for (const att of parsed.attachments) {
    const id = ulid(now * 1000);
    const safe = safeFilename(att.filename);
    const isBlocked = isBlockedAttachment(att.filename, att.mimeType);
    let r2Key = '';

    if (isBlocked) {
      blocked += 1;
    } else {
      r2Key = `att/${message.id}/${id}`;
      await deps.attachmentBucket.put(r2Key, att.content, {
        httpMetadata: { contentType: att.mimeType },
        customMetadata: { message_id: message.id, attachment_id: id },
      });
    }

    await repos.attachments.insert({
      id,
      messageId: message.id,
      r2Key,
      originalFilename: att.filename,
      safeFilename: safe,
      contentType: att.mimeType,
      sizeBytes: att.size,
      contentId: att.contentId,
      disposition: att.disposition,
      scanStatus: isBlocked ? 'blocked' : 'not_scanned',
      createdAt: now,
      expiresAt: message.expires_at,
    });
  }

  await repos.messages.finalize(message.id, {
    subject: parsed.subject,
    senderAddress: parsed.fromAddress || message.sender_address,
    senderName: parsed.fromName,
    textBody: parsed.textBody,
    htmlSanitized: parsed.htmlSanitized,
    snippet: parsed.snippet,
    hasAttachments: parsed.attachments.length > 0,
    processedAt: now,
  });

  return { outcome: 'processed', attachments: parsed.attachments.length, blocked };
}
