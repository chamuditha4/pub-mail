import { notFound } from '@tmp-mail/shared';
import type { AppConfig } from '@tmp-mail/shared';
import type { InboxRow, Repositories } from '@tmp-mail/database';
import { verifySecret } from '@tmp-mail/security';
import type { Caller } from './caller.js';

// A fixed dummy hash used to equalize timing when an inbox does not exist, so
// the presence of an inbox cannot be inferred from response latency
// (CLAUDE.md §9: no timing-sensitive secondary lookups).
const DUMMY_HASH = '0'.repeat(64);

/** Extract a Bearer token, or null if absent/malformed. */
export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, ...rest] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || rest.length === 0) return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/**
 * Object-level authorization for a single inbox (CLAUDE.md §12: inbox IDs alone
 * never grant access). Access is granted when either:
 *   - the presented Bearer token matches the inbox's access-token hash, or
 *   - the caller is the authenticated owner of the inbox.
 *
 * Any failure — missing inbox, wrong token, non-active status — yields the same
 * `not_found` error so callers cannot enumerate inboxes.
 */
export async function authorizeInboxAccess(
  repos: Repositories,
  config: AppConfig,
  inboxId: string,
  authorization: string | undefined,
  caller: Caller,
): Promise<InboxRow> {
  const inbox = await repos.inboxes.findById(inboxId);
  const token = bearerToken(authorization);

  // Owner short-circuit (still constant-work below to avoid timing signals).
  const isOwner = inbox !== null && caller.kind === 'user' && inbox.user_id === caller.userId;

  // Always run a hash comparison to keep timing uniform whether or not the
  // inbox exists and whether or not a token was supplied.
  const tokenMatches = await verifySecret(
    token ?? '',
    inbox?.access_token_hash ?? DUMMY_HASH,
    config.TOKEN_PEPPER,
  );

  const authorized =
    inbox !== null && inbox.status === 'active' && (isOwner || (token !== null && tokenMatches));

  if (!authorized || inbox === null) {
    throw notFound('Inbox not found.');
  }
  return inbox;
}
