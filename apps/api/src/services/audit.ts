import type { Context } from 'hono';
import { nowSeconds, ulid } from '@tmp-mail/shared';
import type { HonoEnv } from '../types.js';

// Record a security-sensitive action (CLAUDE.md §12). Best-effort: audit writes
// never fail the request. Never pass secrets, tokens, or message content in
// `metadata` — only stable ids and safe fields.
export async function audit(
  c: Context<HonoEnv>,
  entry: {
    actorUserId: string | null;
    action: string;
    target?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { repos } = c.get('ctx');
    await repos.auditLogs.record({
      id: ulid(),
      actorUserId: entry.actorUserId,
      action: entry.action,
      target: entry.target ?? null,
      metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ip: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? null,
      createdAt: nowSeconds(),
    });
  } catch {
    // Do not let auditing break the request.
  }
}
