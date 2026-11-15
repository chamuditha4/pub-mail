// Email address normalization and local-part validation (CLAUDE.md §6, §7, §17).
// Shared by inbox creation (api) and envelope handling (mail-ingest) so both use
// identical rules.

// Reserved local parts that must never be issued as temporary inboxes.
export const RESERVED_LOCAL_PARTS: ReadonlySet<string> = new Set([
  'admin',
  'postmaster',
  'abuse',
  'security',
  'support',
  'root',
  'hostmaster',
  'webmaster',
  'noreply',
  'no-reply',
]);

const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export function isReservedLocalPart(localPart: string): boolean {
  return RESERVED_LOCAL_PARTS.has(localPart.toLowerCase());
}

/** Validate a local part against the platform allowlist (excludes reserved names). */
export function isValidLocalPart(localPart: string): boolean {
  return (
    localPart.length >= 1 &&
    localPart.length <= 64 &&
    LOCAL_PART_RE.test(localPart) &&
    !isReservedLocalPart(localPart)
  );
}

export function isValidDomain(domain: string): boolean {
  return domain.length <= 253 && DOMAIN_RE.test(domain);
}

export interface NormalizedAddress {
  localPart: string;
  domain: string;
  address: string;
}

/**
 * Normalize a raw envelope recipient into lowercase `local@domain` parts.
 * Returns null when the address is structurally invalid. Does not apply
 * provider-specific rules (e.g. gmail dot-folding) — temporary inboxes are
 * matched by their exact stored address.
 */
export function normalizeAddress(raw: string): NormalizedAddress | null {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;

  const localPart = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (!LOCAL_PART_RE.test(localPart)) return null;
  if (!isValidDomain(domain)) return null;

  return { localPart, domain, address: `${localPart}@${domain}` };
}
