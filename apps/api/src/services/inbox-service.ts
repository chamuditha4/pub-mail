import {
  AppError,
  clampTtl,
  forbidden,
  notFound,
  nowSeconds,
  ulid,
  validationError,
} from '@tmp-mail/shared';
import type { AppConfig } from '@tmp-mail/shared';
import type { DomainRow, InboxRow, Repositories } from '@tmp-mail/database';
import { generateInboxAccessToken } from '@tmp-mail/security';
import { isValidLocalPart } from '@tmp-mail/email';
import type { Caller } from '../auth/caller.js';
import { hasScope } from '../auth/caller.js';

export interface CreateInboxInput {
  domain: string;
  localPart?: string;
  expiresIn?: number;
}

export interface CreatedInboxResult {
  inbox: InboxRow;
  domainName: string;
  accessToken: string;
}

// Non-enumerating error used whenever a domain is unknown, inactive, or a
// private domain the caller may not use. All three must be indistinguishable
// (CLAUDE.md §9: same non-enumerating authorization error).
const domainUnavailable = (): AppError => notFound('Domain is not available.');

function randomLocalPart(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * Authorize the caller to create an inbox on the requested domain. Returns the
 * domain row when permitted, otherwise throws a non-enumerating error.
 */
function authorizeDomainForCreate(domain: DomainRow | null, caller: Caller): DomainRow {
  if (!domain || domain.status !== 'active') throw domainUnavailable();

  if (domain.pool_type === 'private') {
    // Private domains must never be revealed to anonymous or unauthorized users.
    if (caller.kind !== 'user') throw domainUnavailable();
    // Membership + scope are checked by the caller before we reach here (async),
    // so this function only performs the synchronous, enumeration-safe checks.
    return domain;
  }

  // Public domain.
  if (caller.kind === 'anonymous' && domain.allow_anonymous_inboxes !== 1) {
    throw forbidden('Anonymous inbox creation is disabled for this domain.');
  }
  return domain;
}

export async function createInbox(
  repos: Repositories,
  config: AppConfig,
  caller: Caller,
  input: CreateInboxInput,
): Promise<CreatedInboxResult> {
  const domainName = input.domain.trim().toLowerCase();
  const domain = authorizeDomainForCreate(await repos.domains.findByName(domainName), caller);

  // Private-domain membership + scope authorization (async part).
  if (domain.pool_type === 'private' && caller.kind === 'user') {
    const membership = await repos.memberships.findActive(domain.id, caller.userId);
    // Revoking membership must remove access immediately (CLAUDE.md §10).
    if (!membership) throw domainUnavailable();
    if (caller.scopes !== 'all' && !hasScope(caller, 'private_domains:read')) {
      throw domainUnavailable();
    }
  }

  // API-key callers need the inbox-write scope; sessions ('all') always pass.
  if (caller.kind === 'user' && caller.scopes !== 'all' && !hasScope(caller, 'inboxes:write')) {
    throw forbidden('This API key cannot create inboxes.');
  }

  // Resolve the local part.
  let localPart: string;
  let allowRetry = false;
  if (input.localPart !== undefined) {
    if (domain.allow_custom_local_parts !== 1) {
      throw forbidden('Custom local parts are not allowed for this domain.');
    }
    const candidate = input.localPart.trim().toLowerCase();
    if (!isValidLocalPart(candidate)) {
      throw validationError('The requested local part is not allowed.');
    }
    localPart = candidate;
  } else {
    localPart = randomLocalPart();
    allowRetry = true;
  }

  const now = nowSeconds();
  const userId = caller.kind === 'user' ? caller.userId : null;

  // Resolve TTL. Signed-in users get long-lived, persistent addresses (their
  // mail is retained anyway); anonymous inboxes are clamped to the short
  // domain/global maximum for abuse control.
  let ttl: number;
  if (caller.kind === 'user') {
    ttl = input.expiresIn ?? config.USER_INBOX_TTL_SECONDS;
    ttl = clampTtl(ttl, config.MIN_INBOX_TTL_SECONDS, config.USER_INBOX_TTL_SECONDS);
  } else {
    const maxTtl = Math.min(config.MAX_INBOX_TTL_SECONDS, domain.max_inbox_ttl_seconds);
    ttl = clampTtl(
      input.expiresIn ?? config.DEFAULT_INBOX_TTL_SECONDS,
      config.MIN_INBOX_TTL_SECONDS,
      maxTtl,
    );
  }
  const expiresAt = now + ttl;

  const { plaintext, hash } = await generateInboxAccessToken(config.TOKEN_PEPPER);

  // Insert, retrying random collisions; a custom-part collision is a hard conflict.
  const maxAttempts = allowRetry ? 5 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const address = `${localPart}@${domainName}`;
    const id = ulid(now * 1000);
    try {
      await repos.inboxes.create({
        id,
        userId,
        domainId: domain.id,
        localPart,
        address,
        accessTokenHash: hash,
        expiresAt,
        createdAt: now,
      });
      const inbox = await repos.inboxes.findById(id);
      if (!inbox) throw new Error('inbox vanished after insert');
      return { inbox, domainName, accessToken: plaintext };
    } catch (err) {
      if (isUniqueViolation(err)) {
        if (!allowRetry) throw new AppError('conflict', 'That address is already in use.');
        localPart = randomLocalPart();
        continue;
      }
      throw err;
    }
  }
  throw new AppError('conflict', 'Could not allocate a unique address. Please retry.');
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}
