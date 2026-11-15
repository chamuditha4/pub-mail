import { forbidden } from '@tmp-mail/shared';

// The authenticated principal for a request: anonymous, a session user, or an
// API-key user. Services authorize against this, never against raw headers.

export type Scope =
  | 'domains:read'
  | 'private_domains:read'
  | 'inboxes:read'
  | 'inboxes:write'
  | 'messages:read'
  | 'messages:delete'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'usage:read';

export interface AnonymousCaller {
  kind: 'anonymous';
}

export interface UserCaller {
  kind: 'user';
  userId: string;
  /** Scopes granted when the caller authenticated via an API key; a session has all user scopes. */
  scopes: Set<Scope> | 'all';
  /** Whether the user may access admin domain-management endpoints. */
  isAdmin: boolean;
}

export type Caller = AnonymousCaller | UserCaller;

export const anonymous: AnonymousCaller = { kind: 'anonymous' };

export function hasScope(caller: Caller, scope: Scope): boolean {
  if (caller.kind === 'anonymous') return false;
  return caller.scopes === 'all' || caller.scopes.has(scope);
}

/**
 * Enforce a scope for API-key callers. Session users (scopes = 'all') and
 * anonymous inbox-token callers are unaffected — the latter are authorized by
 * the inbox token, not scopes.
 */
export function assertScope(caller: Caller, scope: Scope): void {
  if (caller.kind === 'user' && caller.scopes !== 'all' && !caller.scopes.has(scope)) {
    throw forbidden(`This API key is missing the "${scope}" scope.`);
  }
}
