import { Hono } from 'hono';
import type { Context } from 'hono';
import { AppError, nowSeconds, toRfc3339, ulid, validationError } from '@tmp-mail/shared';
import { createBlocklistRequestSchema } from '@tmp-mail/contracts';
import type { AbuseReportRow, AuditLogRow, BlocklistRow } from '@tmp-mail/database';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import type { UserCaller } from '../auth/caller.js';
import { audit } from '../services/audit.js';

// Admin-only operations (CLAUDE.md §12): metrics, abuse blocklist, audit log,
// and abuse-report review. Restricted by the admin role.
export const adminRoutes = new Hono<HonoEnv>();

async function requireAdmin(c: Context<HonoEnv>): Promise<UserCaller> {
  const caller = await resolveCaller(c);
  if (caller.kind !== 'user') throw new AppError('unauthorized', 'Not authenticated.');
  if (!caller.isAdmin) throw new AppError('forbidden', 'Admin access required.');
  return caller;
}

function serializeBlock(row: BlocklistRow) {
  return {
    id: row.id,
    entry_type: row.entry_type,
    value: row.value,
    reason: row.reason,
    created_at: toRfc3339(row.created_at),
  };
}

function serializeAudit(row: AuditLogRow) {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    action: row.action,
    target: row.target,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as unknown) : null,
    ip: row.ip,
    created_at: toRfc3339(row.created_at),
  };
}

function serializeReport(row: AbuseReportRow) {
  return {
    id: row.id,
    reporter_email: row.reporter_email,
    subject_type: row.subject_type,
    subject_value: row.subject_value,
    details: row.details,
    status: row.status,
    created_at: toRfc3339(row.created_at),
  };
}

adminRoutes.get('/v1/admin/metrics', async (c) => {
  await requireAdmin(c);
  const { repos } = c.get('ctx');
  return c.json({ data: await repos.metrics.snapshot() });
});

adminRoutes.get('/v1/admin/blocklist', async (c) => {
  await requireAdmin(c);
  const { repos } = c.get('ctx');
  const rows = await repos.blocklist.list(500);
  return c.json({ data: rows.map(serializeBlock) });
});

adminRoutes.post('/v1/admin/blocklist', async (c) => {
  const admin = await requireAdmin(c);
  const { repos } = c.get('ctx');
  const parsed = createBlocklistRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError('Invalid blocklist entry.');

  const value = parsed.data.value.trim().toLowerCase();
  const id = ulid();
  await repos.blocklist.add({
    id,
    entryType: parsed.data.entry_type,
    value,
    reason: parsed.data.reason ?? null,
    createdBy: admin.userId,
    createdAt: nowSeconds(),
  });
  await audit(c, {
    actorUserId: admin.userId,
    action: 'blocklist.add',
    target: id,
    metadata: { entry_type: parsed.data.entry_type, value },
  });
  return c.json({ data: { id } }, 201);
});

adminRoutes.delete('/v1/admin/blocklist/:id', async (c) => {
  const admin = await requireAdmin(c);
  const { repos } = c.get('ctx');
  const id = c.req.param('id');
  const changed = await repos.blocklist.remove(id);
  if (changed === 0) throw new AppError('not_found', 'Entry not found.');
  await audit(c, { actorUserId: admin.userId, action: 'blocklist.remove', target: id });
  return c.body(null, 204);
});

adminRoutes.get('/v1/admin/audit-logs', async (c) => {
  await requireAdmin(c);
  const { repos } = c.get('ctx');
  const rows = await repos.auditLogs.listRecent(200);
  return c.json({ data: rows.map(serializeAudit) });
});

adminRoutes.get('/v1/admin/abuse-reports', async (c) => {
  await requireAdmin(c);
  const { repos } = c.get('ctx');
  const status = c.req.query('status');
  const filter = status === 'reviewed' || status === 'closed' || status === 'open' ? status : 'all';
  const rows = await repos.abuseReports.list(filter, 200);
  return c.json({ data: rows.map(serializeReport) });
});

adminRoutes.patch('/v1/admin/abuse-reports/:id', async (c) => {
  const admin = await requireAdmin(c);
  const { repos } = c.get('ctx');
  const body = (await c.req.json().catch(() => null)) as { status?: string } | null;
  const status = body?.status;
  if (status !== 'open' && status !== 'reviewed' && status !== 'closed') {
    throw validationError('status must be open, reviewed, or closed.');
  }
  const changed = await repos.abuseReports.setStatus(c.req.param('id'), status);
  if (changed === 0) throw new AppError('not_found', 'Report not found.');
  await audit(c, {
    actorUserId: admin.userId,
    action: 'abuse_report.status',
    target: c.req.param('id'),
    metadata: { status },
  });
  return c.body(null, 204);
});
