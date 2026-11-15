import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { processJob, type ProcessDeps } from '../src/process.js';
import {
  HTML_WITH_SCRIPT_AND_IMAGE,
  MULTIPART_WITH_ATTACHMENT,
  MULTIPART_WITH_BLOCKED_EXE,
  PLAIN_TEXT,
} from './fixtures.js';
import { getMessage, listAttachments, seedReceivedMessage } from './helpers.js';

function deps(): ProcessDeps {
  return {
    db: env.DB,
    rawBucket: env.MAIL_RAW_BUCKET,
    attachmentBucket: env.MAIL_ATTACHMENT_BUCKET,
  };
}

describe('processJob', () => {
  it('processes a plain-text message to ready with a snippet', async () => {
    const job = await seedReceivedMessage(PLAIN_TEXT);
    const result = await processJob(job, deps());
    expect(result.outcome).toBe('processed');

    const msg = await getMessage(job.message_id);
    expect(msg?.status).toBe('ready');
    expect(msg?.subject).toBe('Plain hello');
    expect(msg?.text_body).toContain('Hello in plain text');
    expect(msg?.snippet).toContain('Hello in plain text');
    expect(msg?.sender_address).toBe('alice@example.net');
  });

  it('sanitizes HTML: removes scripts, blocks remote images, keeps safe links', async () => {
    const job = await seedReceivedMessage(HTML_WITH_SCRIPT_AND_IMAGE);
    await processJob(job, deps());

    const msg = await getMessage(job.message_id);
    expect(msg?.status).toBe('ready');
    const html = msg?.html_body_sanitized ?? '';
    expect(html).toContain('<h1>Heading</h1>');
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toMatch(/\ssrc=/);
    expect(html).toContain('data-tm-blocked-src="https://tracker.example/pixel.gif"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('stores a safe attachment in R2 and records it', async () => {
    const job = await seedReceivedMessage(MULTIPART_WITH_ATTACHMENT);
    const result = await processJob(job, deps());
    expect(result).toMatchObject({ outcome: 'processed', attachments: 1, blocked: 0 });

    const [att] = await listAttachments(job.message_id);
    expect(att?.safe_filename).toBe('notes.txt');
    expect(att?.scan_status).toBe('not_scanned');
    expect(att?.r2_key).not.toBe('');

    const object = await env.MAIL_ATTACHMENT_BUCKET.get(att!.r2_key);
    expect(object).not.toBeNull();
    expect(await object!.text()).toContain('note contents');

    const msg = await getMessage(job.message_id);
    expect(msg?.has_attachments).toBe(1);
  });

  it('blocks executable attachments and does not store their bytes', async () => {
    const job = await seedReceivedMessage(MULTIPART_WITH_BLOCKED_EXE);
    const result = await processJob(job, deps());
    expect(result).toMatchObject({ outcome: 'processed', blocked: 1 });

    const [att] = await listAttachments(job.message_id);
    expect(att?.safe_filename).toBe('setup.exe');
    expect(att?.scan_status).toBe('blocked');
    expect(att?.r2_key).toBe('');
  });

  it('is idempotent: reprocessing does not duplicate attachments', async () => {
    const job = await seedReceivedMessage(MULTIPART_WITH_ATTACHMENT);
    await processJob(job, deps());
    // Second run should skip because the message is already ready.
    const second = await processJob(job, deps());
    expect(second).toEqual({ outcome: 'skipped', reason: 'already_ready' });
    expect(await listAttachments(job.message_id)).toHaveLength(1);
  });

  it('throws when the raw object is missing so the queue can retry', async () => {
    const job = await seedReceivedMessage(PLAIN_TEXT);
    await env.MAIL_RAW_BUCKET.delete(job.r2_raw_key);
    await expect(processJob(job, deps())).rejects.toThrow();
  });
});
