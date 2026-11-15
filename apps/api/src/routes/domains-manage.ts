import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  AppError,
  conflict,
  notFound,
  nowSeconds,
  toRfc3339,
  ulid,
  validationError,
} from '@tmp-mail/shared';
import { createDomainRequestSchema, updateDomainRequestSchema } from '@tmp-mail/contracts';
import type { AdminDomain } from '@tmp-mail/contracts';
import type { DomainRow, Repositories } from '@tmp-mail/database';
import { generateInboxAccessToken } from '@tmp-mail/security';
import type { AppConfig } from '@tmp-mail/shared';
import type { HonoEnv } from '../types.js';
import { resolveCaller } from '../auth/resolve-caller.js';
import type { UserCaller } from '../auth/caller.js';
import {
  addRoutingDns,
  disableCatchAll,
  enableRouting,
  getRoutingStatus,
  setCatchAllToWorker,
  type CloudflareConfig,
} from '../services/cloudflare.js';
import { purgeDomainContent } from '../services/domain-purge.js';
import { audit } from '../services/audit.js';

// Domain management for any authenticated user: creating a domain makes the
// caller its owner (CLAUDE.md §6). Admins can see and manage every domain.
export const manageDomainRoutes = new Hono<HonoEnv>();

async function requireUser(c: Context<HonoEnv>): Promise<UserCaller> {
  const caller = await resolveCaller(c);
  if (caller.kind !== 'user') throw new AppError('unauthorized', 'Not authenticated.');
  return caller;
}

/** Load a domain the caller may manage (owner/manager, or admin), else 404. */
async function loadManaged(c: Context<HonoEnv>, caller: UserCaller): Promise<DomainRow> {
  const { repos } = c.get('ctx');
  const id = c.req.param('id') ?? '';
  const domain = await repos.domains.findById(id);
  if (!domain) throw notFound('Domain not found.');
  if (caller.isAdmin) return domain;
  const membership = await repos.memberships.findActive(domain.id, caller.userId);
  if (!membership || (membership.role !== 'owner' && membership.role !== 'manager')) {
    throw notFound('Domain not found.');
  }
  return domain;
}

function toAdminDomain(row: DomainRow): AdminDomain {
  return {
    id: row.id,
    name: row.name,
    zone_id: row.zone_id,
    status: row.status,
    pool_type: row.pool_type,
    allow_anonymous_inboxes: row.allow_anonymous_inboxes === 1,
    allow_custom_local_parts: row.allow_custom_local_parts === 1,
    max_inbox_ttl_seconds: row.max_inbox_ttl_seconds,
    catch_all: row.catch_all === 1,
    routing_configured: row.status === 'active',
    created_at: toRfc3339(row.created_at),
  };
}

const CATCH_ALL_TTL_SECONDS = 3650 * 24 * 3600; // ~10 years (effectively permanent)

// Ensure the domain's catch-all inbox exists, owned by the domain owner (or the
// managing caller when the domain has no owner). Unmatched incoming mail is
// routed here by mail-ingest and surfaces in that user's unibox.
async function ensureCatchAllInbox(
  repos: Repositories,
  config: AppConfig,
  domain: DomainRow,
  callerUserId: string,
): Promise<void> {
  const address = `*@${domain.name}`;
  if (await repos.inboxes.findByAddress(address)) return;

  const owner = await repos.memberships.findOwner(domain.id);
  const ownerUserId = owner?.user_id ?? callerUserId;
  const now = nowSeconds();
  const { hash } = await generateInboxAccessToken(config.TOKEN_PEPPER);
  await repos.inboxes.create({
    id: ulid(),
    userId: ownerUserId,
    domainId: domain.id,
    localPart: '*',
    address,
    accessTokenHash: hash,
    expiresAt: now + CATCH_ALL_TTL_SECONDS,
    createdAt: now,
  });
}

function cfConfig(c: Context<HonoEnv>): CloudflareConfig {
  const { config } = c.get('ctx');
  if (!config.CLOUDFLARE_EMAIL_API_TOKEN) {
    throw validationError(
      'Cloudflare automation is not configured. Follow the manual activation guide, then mark the domain active.',
    );
  }
  return { token: config.CLOUDFLARE_EMAIL_API_TOKEN, ingestWorkerName: config.INGEST_WORKER_NAME };
}

manageDomainRoutes.get('/v1/owner/domains', async (c) => {
  const caller = await requireUser(c);
  const { repos, config } = c.get('ctx');
  const rows = caller.isAdmin
    ? await repos.domains.listAll(500)
    : await repos.domains.listManagedBy(caller.userId, 200);
  return c.json({
    data: rows.map(toAdminDomain),
    routing_automation: Boolean(config.CLOUDFLARE_EMAIL_API_TOKEN),
    is_admin: caller.isAdmin,
  });
});

manageDomainRoutes.post('/v1/owner/domains', async (c) => {
  const caller = await requireUser(c);
  const { repos } = c.get('ctx');
  const parsed = createDomainRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError('Invalid domain request.');

  const name = parsed.data.name.toLowerCase();
  if (await repos.domains.findByName(name)) throw conflict('That domain already exists.');

  const now = nowSeconds();
  const id = ulid();
  await repos.domains.create({
    id,
    name,
    zoneId: parsed.data.zone_id ?? null,
    poolType: parsed.data.pool_type,
    // New domains start pending; they only appear in the public list once active.
    status: 'pending',
    allowAnonymous: parsed.data.allow_anonymous_inboxes,
    allowCustom: parsed.data.allow_custom_local_parts,
    maxInboxTtlSeconds: parsed.data.max_inbox_ttl_seconds,
    createdAt: now,
  });
  // The creator becomes the domain owner.
  await repos.memberships.createOwner(ulid(), id, caller.userId, now);

  const row = await repos.domains.findById(id);
  return c.json({ data: toAdminDomain(row!) }, 201);
});

manageDomainRoutes.patch('/v1/owner/domains/:id', async (c) => {
  const caller = await requireUser(c);
  const { repos, config } = c.get('ctx');
  const domain = await loadManaged(c, caller);

  const parsed = updateDomainRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError('Invalid domain update.');
  const b = parsed.data;

  // Enabling catch-all provisions the owner's catch-all inbox.
  if (b.catch_all === true) {
    await ensureCatchAllInbox(repos, config, domain, caller.userId);
  }

  await repos.domains.update(domain.id, {
    // Only admins may flip status directly; owners activate via the verify flow,
    // so a broken domain can't be forced into the public list.
    status: caller.isAdmin ? b.status : undefined,
    poolType: b.pool_type,
    allowAnonymous: b.allow_anonymous_inboxes,
    allowCustom: b.allow_custom_local_parts,
    maxInboxTtlSeconds: b.max_inbox_ttl_seconds,
    zoneId: b.zone_id,
    catchAll: b.catch_all,
  });
  const row = await repos.domains.findById(domain.id);
  return c.json({ data: toAdminDomain(row!) });
});

/**
 * Remove a domain from the platform. Admins may delete any domain; otherwise the
 * caller must be its active owner (a manager cannot). This destroys every inbox
 * and message on the domain — including other users' — so the caller must echo
 * the domain name back as `?confirm=<name>`. Stored mail is purged from R2 first
 * (CLAUDE.md §13); the domain row then cascades the D1 rows away.
 */
manageDomainRoutes.delete('/v1/owner/domains/:id', async (c) => {
  const caller = await requireUser(c);
  const { repos, config } = c.get('ctx');
  const domain = await loadManaged(c, caller);

  if (!caller.isAdmin) {
    const membership = await repos.memberships.findActive(domain.id, caller.userId);
    // Same non-enumerating error a stranger gets (CLAUDE.md §9).
    if (membership?.role !== 'owner') throw notFound('Domain not found.');
  }

  if (c.req.query('confirm') !== domain.name) {
    throw validationError('Confirm deletion by passing ?confirm=<domain name>.');
  }

  const purge = await purgeDomainContent(domain.id, {
    repos,
    rawBucket: c.env.MAIL_RAW_BUCKET,
    attachmentBucket: c.env.MAIL_ATTACHMENT_BUCKET,
  });
  if (!purge.complete) {
    // Progress was made and is durable; another call finishes the job.
    throw conflict('Still purging stored mail for this domain. Repeat the request to continue.');
  }

  // Best-effort routing teardown so Cloudflare stops handing us this zone's
  // mail. Reported back rather than swallowed: if it fails, the operator must
  // clear the catch-all rule by hand.
  let routingDisabled: boolean | null = null;
  if (domain.zone_id && config.CLOUDFLARE_EMAIL_API_TOKEN) {
    try {
      await disableCatchAll(
        { token: config.CLOUDFLARE_EMAIL_API_TOKEN, ingestWorkerName: config.INGEST_WORKER_NAME },
        domain.zone_id,
      );
      routingDisabled = true;
    } catch (err) {
      routingDisabled = false;
      console.error(
        JSON.stringify({
          worker: 'api',
          operation: 'domain.delete.disable_catch_all',
          domain_id: domain.id,
          outcome: 'error',
          error: err instanceof Error ? err.name : 'unknown',
        }),
      );
    }
  }

  const removed = await repos.domains.delete(domain.id);
  if (removed === 0) throw notFound('Domain not found.');

  await audit(c, {
    actorUserId: caller.userId,
    action: 'domain.delete',
    target: domain.id,
    metadata: {
      name: domain.name,
      purged_messages: purge.purgedMessages,
      routing_disabled: routingDisabled,
    },
  });

  return c.json({
    data: {
      id: domain.id,
      name: domain.name,
      purged_messages: purge.purgedMessages,
      routing_disabled: routingDisabled,
    },
  });
});

manageDomainRoutes.post('/v1/owner/domains/:id/enable-routing', async (c) => {
  const caller = await requireUser(c);
  const cf = cfConfig(c);
  const domain = await loadManaged(c, caller);
  if (!domain.zone_id) throw validationError('Set the Cloudflare zone_id first.');

  await enableRouting(cf, domain.zone_id);
  await addRoutingDns(cf, domain.zone_id).catch(() => undefined);
  await setCatchAllToWorker(cf, domain.zone_id);
  const status = await getRoutingStatus(cf, domain.zone_id);
  return c.json({ data: { routing: status } });
});

manageDomainRoutes.post('/v1/owner/domains/:id/verify', async (c) => {
  const caller = await requireUser(c);
  const { repos } = c.get('ctx');
  const cf = cfConfig(c);
  const domain = await loadManaged(c, caller);
  if (!domain.zone_id) throw validationError('Set the Cloudflare zone_id first.');

  const status = await getRoutingStatus(cf, domain.zone_id);
  const ready = status.enabled && status.status === 'ready';
  await repos.domains.update(domain.id, { status: ready ? 'active' : 'misconfigured' });
  const row = await repos.domains.findById(domain.id);
  return c.json({ data: toAdminDomain(row!) });
});
