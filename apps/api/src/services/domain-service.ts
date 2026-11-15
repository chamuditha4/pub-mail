import type { Domain } from '@tmp-mail/contracts';
import type { DomainRow, Repositories } from '@tmp-mail/database';
import type { Caller } from '../auth/caller.js';

const MAX_DOMAINS = 200;

function toDomain(row: DomainRow): Domain {
  return {
    name: row.name,
    pool_type: row.pool_type,
    allow_anonymous_inboxes: row.allow_anonymous_inboxes === 1,
    allow_custom_local_parts: row.allow_custom_local_parts === 1,
    max_inbox_ttl_seconds: row.max_inbox_ttl_seconds,
  };
}

/**
 * List domains visible to the caller (CLAUDE.md §9). Public active domains are
 * always included. Private domains appear only when the caller has an active
 * membership — never leaked to anonymous or unauthorized callers, including
 * through this list's contents.
 */
export async function listVisibleDomains(repos: Repositories, caller: Caller): Promise<Domain[]> {
  const publicDomains = await repos.domains.listPublicActive(MAX_DOMAINS);
  if (caller.kind !== 'user') {
    return publicDomains.map(toDomain);
  }
  const privateDomains = await repos.domains.listPrivateForUser(caller.userId, MAX_DOMAINS);
  // De-duplicate defensively (a domain is either public or private, but guard anyway).
  const byName = new Map<string, DomainRow>();
  for (const d of [...publicDomains, ...privateDomains]) byName.set(d.name, d);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).map(toDomain);
}
