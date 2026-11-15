import type { D1Database } from '@cloudflare/workers-types';
import type {
  AbuseReportRow,
  AbuseReportStatus,
  ApiKeyRow,
  AttachmentDisposition,
  AttachmentRow,
  AuditLogRow,
  BlocklistRow,
  BlocklistType,
  DomainRow,
  InboxRow,
  InboxStatus,
  MembershipRow,
  MessageRow,
  ScanStatus,
  SessionRow,
  UserRow,
  WebhookDeliveryRow,
  WebhookDeliveryStatus,
  WebhookRow,
} from './types.js';

// Repository interfaces keep persistence swappable (CLAUDE.md §4: D1 today,
// PostgreSQL later, without changing route handlers or services). All queries
// use prepared statements and are bounded (CLAUDE.md §19).

export interface NewInbox {
  id: string;
  userId: string | null;
  domainId: string;
  localPart: string;
  address: string;
  accessTokenHash: string;
  expiresAt: number;
  createdAt: number;
}

export interface ListMessagesOptions {
  /** Return messages with id strictly less than this (newest-first cursor). */
  beforeId?: string;
  limit: number;
}

/**
 * Minimal message record written at ingestion time, before MIME parsing
 * (CLAUDE.md §7 step 8). Bodies/attachments are filled in by the processor.
 */
export interface NewReceivedMessage {
  id: string;
  inboxId: string;
  /** Owning user (denormalized from the inbox), or null for anonymous inboxes. */
  userId: string | null;
  providerMessageId: string | null;
  r2RawKey: string;
  senderAddress: string;
  recipientAddress: string;
  receivedAt: number;
  expiresAt: number;
  sizeBytes: number;
}

export interface NewDomain {
  id: string;
  name: string;
  zoneId: string | null;
  poolType: 'public' | 'private';
  status: DomainRow['status'];
  allowAnonymous: boolean;
  allowCustom: boolean;
  maxInboxTtlSeconds: number;
  createdAt: number;
}

export interface DomainPatch {
  status?: DomainRow['status'];
  poolType?: 'public' | 'private';
  allowAnonymous?: boolean;
  allowCustom?: boolean;
  maxInboxTtlSeconds?: number;
  zoneId?: string;
  catchAll?: boolean;
}

export interface DomainRepository {
  findByName(name: string): Promise<DomainRow | null>;
  findById(id: string): Promise<DomainRow | null>;
  /** Active public domains, for anonymous/default listings. */
  listPublicActive(limit: number): Promise<DomainRow[]>;
  /** Active private domains the user has an active membership on. */
  listPrivateForUser(userId: string, limit: number): Promise<DomainRow[]>;
  /** Every domain, for admin management. */
  listAll(limit: number): Promise<DomainRow[]>;
  /** Domains the user owns or manages (active membership). */
  listManagedBy(userId: string, limit: number): Promise<DomainRow[]>;
  create(domain: NewDomain): Promise<void>;
  update(id: string, patch: DomainPatch): Promise<void>;
  /**
   * Hard-delete a domain. Memberships and inboxes (and their messages and
   * attachments) cascade, so callers must purge R2 content first. Returns the
   * number of rows removed, so a repeated delete is a no-op.
   */
  delete(id: string): Promise<number>;
}

export interface MembershipRepository {
  findActive(domainId: string, userId: string): Promise<MembershipRow | null>;
  /** Grant a user the owner role on a domain (single-owner enforced by index). */
  createOwner(id: string, domainId: string, userId: string, createdAt: number): Promise<void>;
  /** The domain's active owner, if any. */
  findOwner(domainId: string): Promise<MembershipRow | null>;
}

export interface InboxRepository {
  create(inbox: NewInbox): Promise<void>;
  findById(id: string): Promise<InboxRow | null>;
  findByAddress(address: string): Promise<InboxRow | null>;
  setStatus(id: string, status: InboxStatus): Promise<void>;
  /**
   * Reactivate an expired inbox with a new expiry. Only `expired`/`active`
   * inboxes are touched, so a deleted or blocked inbox can never be revived.
   */
  renew(id: string, expiresAt: number): Promise<void>;
  /** Advance last_message_at to `ts` if it is newer than the stored value. */
  touchLastMessage(id: string, ts: number): Promise<void>;
  /** All inboxes a user has created, newest-first (includes expired/deleted). */
  listByUser(userId: string, limit: number): Promise<InboxRow[]>;
  /** Mark active inboxes past their expiry as `expired`. Returns the count. */
  markExpired(now: number): Promise<number>;
}

/** Parsed fields written when the processor finalizes a message to `ready`. */
export interface FinalizeMessage {
  subject: string;
  senderAddress: string;
  senderName: string | null;
  textBody: string | null;
  htmlSanitized: string | null;
  snippet: string;
  hasAttachments: boolean;
  processedAt: number;
}

export interface MessageRepository {
  listByInbox(inboxId: string, opts: ListMessagesOptions): Promise<MessageRow[]>;
  /** Unibox: all of a user's messages, newest-first, across every inbox they own. */
  listByUser(userId: string, opts: ListMessagesOptions): Promise<MessageRow[]>;
  findById(id: string): Promise<MessageRow | null>;
  setStatus(id: string, status: MessageRow['status']): Promise<void>;
  /** Insert a minimal received-message record. */
  insertReceived(message: NewReceivedMessage): Promise<void>;
  /** Find an existing message by provider Message-ID within an inbox (idempotency). */
  findByProviderId(inboxId: string, providerMessageId: string): Promise<MessageRow | null>;
  /** Write parsed fields and transition the message to `ready`. Idempotent. */
  finalize(id: string, fields: FinalizeMessage): Promise<void>;
  /** Mark a message `failed`, retaining minimal metadata (CLAUDE.md §8). */
  markFailed(id: string): Promise<void>;
  /** Anonymous (user_id IS NULL) messages past expiry, for physical purge. */
  listExpiredAnonymous(now: number, limit: number): Promise<PurgeableMessage[]>;
  /** Messages held by any inbox on a domain, for physical purge on domain delete. */
  listByDomain(domainId: string, limit: number): Promise<PurgeableMessage[]>;
  /** Hard-delete a message row (attachments cascade). */
  hardDelete(id: string): Promise<void>;
  /** Hard-delete a batch of message rows (attachments cascade). */
  hardDeleteMany(ids: string[]): Promise<void>;
}

export interface PurgeableMessage {
  id: string;
  r2_raw_key: string;
}

export interface NewAttachment {
  id: string;
  messageId: string;
  r2Key: string;
  originalFilename: string;
  safeFilename: string;
  contentType: string;
  sizeBytes: number;
  contentId: string | null;
  disposition: AttachmentDisposition;
  scanStatus: ScanStatus;
  createdAt: number;
  expiresAt: number;
}

export interface AttachmentRepository {
  insert(attachment: NewAttachment): Promise<void>;
  findById(id: string): Promise<AttachmentRow | null>;
  listByMessage(messageId: string): Promise<AttachmentRow[]>;
  /** Stored R2 keys for a batch of messages, so a purge can delete the objects. */
  listKeysByMessages(messageIds: string[]): Promise<string[]>;
  /** Remove all attachments for a message, so reprocessing is idempotent. */
  deleteByMessage(messageId: string): Promise<void>;
}

export interface NewPasswordUser {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: number;
}

export interface UserRepository {
  findById(id: string): Promise<UserRow | null>;
  findByUsername(username: string): Promise<UserRow | null>;
  createWithPassword(user: NewPasswordUser): Promise<void>;
}

export interface NewSession {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface SessionRepository {
  create(session: NewSession): Promise<void>;
  findValid(id: string, now: number): Promise<SessionRow | null>;
  delete(id: string): Promise<void>;
  /** Delete all sessions past their expiry. Returns the count. */
  deleteExpired(now: number): Promise<number>;
}

export interface NewApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  secretHash: string;
  scopesJson: string;
  expiresAt: number | null;
  createdAt: number;
}

export interface ApiKeyRepository {
  create(key: NewApiKey): Promise<void>;
  findActiveByPrefix(keyPrefix: string): Promise<ApiKeyRow | null>;
  listByUser(userId: string): Promise<ApiKeyRow[]>;
  revoke(id: string, userId: string): Promise<number>;
  touchLastUsed(id: string, ts: number): Promise<void>;
}

export interface RateLimitResult {
  count: number;
  windowStart: number;
}

export interface RateLimitRepository {
  /** Increment the counter for a bucket window and return the new count. */
  increment(bucket: string, windowStart: number, expiresAt: number): Promise<RateLimitResult>;
  /** Delete counters whose window has expired. Returns the count. */
  deleteExpired(now: number): Promise<number>;
}

export interface NewBlocklistEntry {
  id: string;
  entryType: BlocklistType;
  value: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: number;
}

export interface BlocklistRepository {
  add(entry: NewBlocklistEntry): Promise<void>;
  remove(id: string): Promise<number>;
  list(limit: number): Promise<BlocklistRow[]>;
  /** True if any of the given (type,value) pairs is blocked. */
  isBlocked(pairs: Array<{ type: BlocklistType; value: string }>): Promise<boolean>;
}

export interface NewAuditLog {
  id: string;
  actorUserId: string | null;
  action: string;
  target: string | null;
  metadataJson: string | null;
  ip: string | null;
  createdAt: number;
}

export interface AuditLogRepository {
  record(entry: NewAuditLog): Promise<void>;
  listRecent(limit: number): Promise<AuditLogRow[]>;
}

export interface NewAbuseReport {
  id: string;
  reporterEmail: string | null;
  subjectType: AbuseReportRow['subject_type'];
  subjectValue: string | null;
  details: string;
  createdAt: number;
}

export interface AbuseReportRepository {
  create(report: NewAbuseReport): Promise<void>;
  list(status: AbuseReportStatus | 'all', limit: number): Promise<AbuseReportRow[]>;
  setStatus(id: string, status: AbuseReportStatus): Promise<number>;
  countOpen(): Promise<number>;
}

export interface PlatformMetrics {
  users: number;
  active_domains: number;
  active_inboxes: number;
  messages_total: number;
  messages_ready: number;
  messages_failed: number;
  active_api_keys: number;
  blocklist_entries: number;
  open_abuse_reports: number;
}

export interface MetricsRepository {
  snapshot(): Promise<PlatformMetrics>;
}

export interface NewWebhook {
  id: string;
  userId: string;
  url: string;
  secretEncrypted: string;
  eventsJson: string;
  createdAt: number;
}

export interface WebhookPatch {
  url?: string;
  eventsJson?: string;
  status?: 'active' | 'disabled';
}

export interface WebhookRepository {
  create(webhook: NewWebhook): Promise<void>;
  findById(id: string): Promise<WebhookRow | null>;
  listByUser(userId: string): Promise<WebhookRow[]>;
  listActiveByUser(userId: string): Promise<WebhookRow[]>;
  update(id: string, userId: string, patch: WebhookPatch): Promise<number>;
  rotateSecret(id: string, userId: string, secretEncrypted: string): Promise<number>;
  delete(id: string, userId: string): Promise<number>;
  /** Bump the consecutive-failure counter; disable after `threshold`. */
  recordFailure(id: string, threshold: number): Promise<void>;
  resetFailure(id: string): Promise<void>;
}

export interface NewWebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  dedupeKey: string;
  payloadJson: string;
  createdAt: number;
}

export interface WebhookDeliveryRepository {
  /** Insert a delivery; returns false if it already exists (dedupe). */
  create(delivery: NewWebhookDelivery): Promise<boolean>;
  findById(id: string): Promise<WebhookDeliveryRow | null>;
  markDelivered(id: string, responseStatus: number, deliveredAt: number): Promise<void>;
  markAttempt(
    id: string,
    attempt: number,
    status: WebhookDeliveryStatus,
    responseStatus: number | null,
    nextAttemptAt: number | null,
  ): Promise<void>;
  listByWebhook(webhookId: string, limit: number): Promise<WebhookDeliveryRow[]>;
  deleteOlderThan(cutoff: number): Promise<number>;
}

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
  apiKeys: ApiKeyRepository;
  rateLimits: RateLimitRepository;
  webhooks: WebhookRepository;
  webhookDeliveries: WebhookDeliveryRepository;
  domains: DomainRepository;
  memberships: MembershipRepository;
  inboxes: InboxRepository;
  messages: MessageRepository;
  attachments: AttachmentRepository;
  blocklist: BlocklistRepository;
  auditLogs: AuditLogRepository;
  abuseReports: AbuseReportRepository;
  metrics: MetricsRepository;
}

class D1DomainRepository implements DomainRepository {
  constructor(private readonly db: D1Database) {}

  async findByName(name: string): Promise<DomainRow | null> {
    return this.db.prepare('SELECT * FROM domains WHERE name = ?1').bind(name).first<DomainRow>();
  }

  async findById(id: string): Promise<DomainRow | null> {
    return this.db.prepare('SELECT * FROM domains WHERE id = ?1').bind(id).first<DomainRow>();
  }

  async listPublicActive(limit: number): Promise<DomainRow[]> {
    const { results } = await this.db
      .prepare(
        "SELECT * FROM domains WHERE pool_type = 'public' AND status = 'active' ORDER BY name ASC LIMIT ?1",
      )
      .bind(limit)
      .all<DomainRow>();
    return results;
  }

  async listPrivateForUser(userId: string, limit: number): Promise<DomainRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT d.* FROM domains d
         JOIN domain_memberships m ON m.domain_id = d.id
         WHERE d.pool_type = 'private'
           AND d.status = 'active'
           AND m.user_id = ?1
           AND m.revoked_at IS NULL
         ORDER BY d.name ASC LIMIT ?2`,
      )
      .bind(userId, limit)
      .all<DomainRow>();
    return results;
  }

  async listAll(limit: number): Promise<DomainRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM domains ORDER BY name ASC LIMIT ?1')
      .bind(limit)
      .all<DomainRow>();
    return results;
  }

  async listManagedBy(userId: string, limit: number): Promise<DomainRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT d.* FROM domains d
         JOIN domain_memberships m ON m.domain_id = d.id
         WHERE m.user_id = ?1 AND m.revoked_at IS NULL AND m.role IN ('owner', 'manager')
         ORDER BY d.name ASC LIMIT ?2`,
      )
      .bind(userId, limit)
      .all<DomainRow>();
    return results;
  }

  async create(d: NewDomain): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO domains
           (id, name, zone_id, status, pool_type, allow_anonymous_inboxes,
            allow_custom_local_parts, max_inbox_ttl_seconds, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      )
      .bind(
        d.id,
        d.name,
        d.zoneId,
        d.status,
        d.poolType,
        d.allowAnonymous ? 1 : 0,
        d.allowCustom ? 1 : 0,
        d.maxInboxTtlSeconds,
        d.createdAt,
      )
      .run();
  }

  async update(id: string, patch: DomainPatch): Promise<void> {
    const sets: string[] = [];
    const binds: unknown[] = [];
    let i = 1;
    const add = (col: string, val: unknown) => {
      sets.push(`${col} = ?${++i}`);
      binds.push(val);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.poolType !== undefined) add('pool_type', patch.poolType);
    if (patch.allowAnonymous !== undefined)
      add('allow_anonymous_inboxes', patch.allowAnonymous ? 1 : 0);
    if (patch.allowCustom !== undefined) add('allow_custom_local_parts', patch.allowCustom ? 1 : 0);
    if (patch.maxInboxTtlSeconds !== undefined)
      add('max_inbox_ttl_seconds', patch.maxInboxTtlSeconds);
    if (patch.zoneId !== undefined) add('zone_id', patch.zoneId);
    if (patch.catchAll !== undefined) add('catch_all', patch.catchAll ? 1 : 0);
    if (sets.length === 0) return;
    sets.push(`updated_at = ?${++i}`);
    binds.push(Math.floor(Date.now() / 1000));
    await this.db
      .prepare(`UPDATE domains SET ${sets.join(', ')} WHERE id = ?1`)
      .bind(id, ...binds)
      .run();
  }

  async delete(id: string): Promise<number> {
    const res = await this.db.prepare('DELETE FROM domains WHERE id = ?1').bind(id).run();
    return res.meta.changes ?? 0;
  }
}

class D1MembershipRepository implements MembershipRepository {
  constructor(private readonly db: D1Database) {}

  async findActive(domainId: string, userId: string): Promise<MembershipRow | null> {
    return this.db
      .prepare(
        'SELECT * FROM domain_memberships WHERE domain_id = ?1 AND user_id = ?2 AND revoked_at IS NULL',
      )
      .bind(domainId, userId)
      .first<MembershipRow>();
  }

  async createOwner(
    id: string,
    domainId: string,
    userId: string,
    createdAt: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO domain_memberships (id, domain_id, user_id, role, created_at, revoked_at)
         VALUES (?1, ?2, ?3, 'owner', ?4, NULL)`,
      )
      .bind(id, domainId, userId, createdAt)
      .run();
  }

  async findOwner(domainId: string): Promise<MembershipRow | null> {
    return this.db
      .prepare(
        "SELECT * FROM domain_memberships WHERE domain_id = ?1 AND role = 'owner' AND revoked_at IS NULL",
      )
      .bind(domainId)
      .first<MembershipRow>();
  }
}

class D1InboxRepository implements InboxRepository {
  constructor(private readonly db: D1Database) {}

  async create(inbox: NewInbox): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO inboxes
           (id, user_id, domain_id, local_part, address, access_token_hash, status, expires_at, created_at, last_message_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, NULL)`,
      )
      .bind(
        inbox.id,
        inbox.userId,
        inbox.domainId,
        inbox.localPart,
        inbox.address,
        inbox.accessTokenHash,
        inbox.expiresAt,
        inbox.createdAt,
      )
      .run();
  }

  async findById(id: string): Promise<InboxRow | null> {
    return this.db.prepare('SELECT * FROM inboxes WHERE id = ?1').bind(id).first<InboxRow>();
  }

  async findByAddress(address: string): Promise<InboxRow | null> {
    return this.db
      .prepare('SELECT * FROM inboxes WHERE address = ?1')
      .bind(address)
      .first<InboxRow>();
  }

  async setStatus(id: string, status: InboxStatus): Promise<void> {
    await this.db.prepare('UPDATE inboxes SET status = ?2 WHERE id = ?1').bind(id, status).run();
  }

  async renew(id: string, expiresAt: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE inboxes SET status = 'active', expires_at = ?2
         WHERE id = ?1 AND status IN ('active', 'expired')`,
      )
      .bind(id, expiresAt)
      .run();
  }

  async touchLastMessage(id: string, ts: number): Promise<void> {
    await this.db
      .prepare(
        'UPDATE inboxes SET last_message_at = ?2 WHERE id = ?1 AND (last_message_at IS NULL OR last_message_at < ?2)',
      )
      .bind(id, ts)
      .run();
  }

  async listByUser(userId: string, limit: number): Promise<InboxRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM inboxes WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2')
      .bind(userId, limit)
      .all<InboxRow>();
    return results;
  }

  async markExpired(now: number): Promise<number> {
    const res = await this.db
      .prepare("UPDATE inboxes SET status = 'expired' WHERE status = 'active' AND expires_at <= ?1")
      .bind(now)
      .run();
    return res.meta.changes ?? 0;
  }
}

class D1MessageRepository implements MessageRepository {
  constructor(private readonly db: D1Database) {}

  async listByInbox(inboxId: string, opts: ListMessagesOptions): Promise<MessageRow[]> {
    const stmt = opts.beforeId
      ? this.db
          .prepare(
            `SELECT * FROM messages
             WHERE inbox_id = ?1 AND status != 'deleted' AND id < ?2
             ORDER BY id DESC LIMIT ?3`,
          )
          .bind(inboxId, opts.beforeId, opts.limit)
      : this.db
          .prepare(
            `SELECT * FROM messages
             WHERE inbox_id = ?1 AND status != 'deleted'
             ORDER BY id DESC LIMIT ?2`,
          )
          .bind(inboxId, opts.limit);
    const { results } = await stmt.all<MessageRow>();
    return results;
  }

  async findById(id: string): Promise<MessageRow | null> {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?1').bind(id).first<MessageRow>();
  }

  async setStatus(id: string, status: MessageRow['status']): Promise<void> {
    await this.db.prepare('UPDATE messages SET status = ?2 WHERE id = ?1').bind(id, status).run();
  }

  async insertReceived(message: NewReceivedMessage): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO messages
           (id, inbox_id, user_id, provider_message_id, r2_raw_key, sender_address, sender_name,
            recipient_address, subject, snippet, received_at, expires_at, status, size_bytes, has_attachments)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, '', '', ?8, ?9, 'received', ?10, 0)`,
      )
      .bind(
        message.id,
        message.inboxId,
        message.userId,
        message.providerMessageId,
        message.r2RawKey,
        message.senderAddress,
        message.recipientAddress,
        message.receivedAt,
        message.expiresAt,
        message.sizeBytes,
      )
      .run();
  }

  async listByUser(userId: string, opts: ListMessagesOptions): Promise<MessageRow[]> {
    const stmt = opts.beforeId
      ? this.db
          .prepare(
            `SELECT * FROM messages
             WHERE user_id = ?1 AND status != 'deleted' AND id < ?2
             ORDER BY id DESC LIMIT ?3`,
          )
          .bind(userId, opts.beforeId, opts.limit)
      : this.db
          .prepare(
            `SELECT * FROM messages
             WHERE user_id = ?1 AND status != 'deleted'
             ORDER BY id DESC LIMIT ?2`,
          )
          .bind(userId, opts.limit);
    const { results } = await stmt.all<MessageRow>();
    return results;
  }

  async findByProviderId(inboxId: string, providerMessageId: string): Promise<MessageRow | null> {
    return this.db
      .prepare('SELECT * FROM messages WHERE inbox_id = ?1 AND provider_message_id = ?2')
      .bind(inboxId, providerMessageId)
      .first<MessageRow>();
  }

  async finalize(id: string, f: FinalizeMessage): Promise<void> {
    await this.db
      .prepare(
        `UPDATE messages SET
           subject = ?2,
           sender_address = ?3,
           sender_name = ?4,
           text_body = ?5,
           html_body_sanitized = ?6,
           snippet = ?7,
           has_attachments = ?8,
           processed_at = ?9,
           status = 'ready'
         WHERE id = ?1 AND status != 'deleted'`,
      )
      .bind(
        id,
        f.subject,
        f.senderAddress,
        f.senderName,
        f.textBody,
        f.htmlSanitized,
        f.snippet,
        f.hasAttachments ? 1 : 0,
        f.processedAt,
      )
      .run();
  }

  async markFailed(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE messages SET status = 'failed' WHERE id = ?1 AND status != 'deleted'")
      .bind(id)
      .run();
  }

  async listExpiredAnonymous(now: number, limit: number): Promise<PurgeableMessage[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, r2_raw_key FROM messages
         WHERE user_id IS NULL AND status != 'deleted' AND expires_at <= ?1
         LIMIT ?2`,
      )
      .bind(now, limit)
      .all<PurgeableMessage>();
    return results;
  }

  async listByDomain(domainId: string, limit: number): Promise<PurgeableMessage[]> {
    const { results } = await this.db
      .prepare(
        `SELECT m.id, m.r2_raw_key FROM messages m
         JOIN inboxes i ON i.id = m.inbox_id
         WHERE i.domain_id = ?1
         LIMIT ?2`,
      )
      .bind(domainId, limit)
      .all<PurgeableMessage>();
    return results;
  }

  async hardDelete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM messages WHERE id = ?1').bind(id).run();
  }

  async hardDeleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
    await this.db
      .prepare(`DELETE FROM messages WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();
  }
}

class D1AttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: D1Database) {}

  async insert(a: NewAttachment): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO attachments
           (id, message_id, r2_key, original_filename, safe_filename, content_type,
            size_bytes, content_id, disposition, scan_status, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        a.id,
        a.messageId,
        a.r2Key,
        a.originalFilename,
        a.safeFilename,
        a.contentType,
        a.sizeBytes,
        a.contentId,
        a.disposition,
        a.scanStatus,
        a.createdAt,
        a.expiresAt,
      )
      .run();
  }

  async findById(id: string): Promise<AttachmentRow | null> {
    return this.db
      .prepare('SELECT * FROM attachments WHERE id = ?1')
      .bind(id)
      .first<AttachmentRow>();
  }

  async listByMessage(messageId: string): Promise<AttachmentRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM attachments WHERE message_id = ?1 ORDER BY id ASC')
      .bind(messageId)
      .all<AttachmentRow>();
    return results;
  }

  async listKeysByMessages(messageIds: string[]): Promise<string[]> {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map((_, i) => `?${i + 1}`).join(', ');
    const { results } = await this.db
      .prepare(
        `SELECT r2_key FROM attachments WHERE message_id IN (${placeholders}) AND r2_key != ''`,
      )
      .bind(...messageIds)
      .all<{ r2_key: string }>();
    return results.map((r) => r.r2_key);
  }

  async deleteByMessage(messageId: string): Promise<void> {
    await this.db.prepare('DELETE FROM attachments WHERE message_id = ?1').bind(messageId).run();
  }
}

class D1UserRepository implements UserRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<UserRow | null> {
    return this.db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserRow>();
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    return this.db
      .prepare('SELECT * FROM users WHERE username = ?1')
      .bind(username)
      .first<UserRow>();
  }

  async createWithPassword(user: NewPasswordUser): Promise<void> {
    // email is NOT NULL UNIQUE in the base schema; mirror the username into it
    // since username is the login identifier now.
    await this.db
      .prepare(
        `INSERT INTO users
           (id, email, username, password_hash, password_salt, name, avatar_url, role, status, created_at, updated_at)
         VALUES (?1, ?2, ?2, ?3, ?4, ?2, NULL, 'user', 'active', ?5, ?5)`,
      )
      .bind(user.id, user.username, user.passwordHash, user.passwordSalt, user.createdAt)
      .run();
  }
}

class D1SessionRepository implements SessionRepository {
  constructor(private readonly db: D1Database) {}

  async create(session: NewSession): Promise<void> {
    await this.db
      .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(session.id, session.userId, session.createdAt, session.expiresAt)
      .run();
  }

  async findValid(id: string, now: number): Promise<SessionRow | null> {
    return this.db
      .prepare('SELECT * FROM sessions WHERE id = ?1 AND expires_at > ?2')
      .bind(id, now)
      .first<SessionRow>();
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE id = ?1').bind(id).run();
  }

  async deleteExpired(now: number): Promise<number> {
    const res = await this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?1')
      .bind(now)
      .run();
    return res.meta.changes ?? 0;
  }
}

class D1ApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: D1Database) {}

  async create(k: NewApiKey): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO api_keys
           (id, user_id, name, key_prefix, secret_hash, scopes_json, status, last_used_at, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', NULL, ?7, ?8)`,
      )
      .bind(
        k.id,
        k.userId,
        k.name,
        k.keyPrefix,
        k.secretHash,
        k.scopesJson,
        k.expiresAt,
        k.createdAt,
      )
      .run();
  }

  async findActiveByPrefix(keyPrefix: string): Promise<ApiKeyRow | null> {
    return this.db
      .prepare("SELECT * FROM api_keys WHERE key_prefix = ?1 AND status = 'active'")
      .bind(keyPrefix)
      .first<ApiKeyRow>();
  }

  async listByUser(userId: string): Promise<ApiKeyRow[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM api_keys WHERE user_id = ?1 AND status = 'active' ORDER BY id DESC")
      .bind(userId)
      .all<ApiKeyRow>();
    return results;
  }

  async revoke(id: string, userId: string): Promise<number> {
    const res = await this.db
      .prepare("UPDATE api_keys SET status = 'revoked' WHERE id = ?1 AND user_id = ?2")
      .bind(id, userId)
      .run();
    return res.meta.changes ?? 0;
  }

  async touchLastUsed(id: string, ts: number): Promise<void> {
    await this.db.prepare('UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1').bind(id, ts).run();
  }
}

class D1RateLimitRepository implements RateLimitRepository {
  constructor(private readonly db: D1Database) {}

  async increment(
    bucket: string,
    windowStart: number,
    expiresAt: number,
  ): Promise<RateLimitResult> {
    const row = await this.db
      .prepare(
        `INSERT INTO rate_limits (bucket, count, window_start, expires_at)
         VALUES (?1, 1, ?2, ?3)
         ON CONFLICT(bucket) DO UPDATE SET count = count + 1
         RETURNING count, window_start`,
      )
      .bind(bucket, windowStart, expiresAt)
      .first<{ count: number; window_start: number }>();
    return { count: row?.count ?? 1, windowStart: row?.window_start ?? windowStart };
  }

  async deleteExpired(now: number): Promise<number> {
    const res = await this.db
      .prepare('DELETE FROM rate_limits WHERE expires_at <= ?1')
      .bind(now)
      .run();
    return res.meta.changes ?? 0;
  }
}

class D1BlocklistRepository implements BlocklistRepository {
  constructor(private readonly db: D1Database) {}

  async add(e: NewBlocklistEntry): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO blocklist (id, entry_type, value, reason, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(entry_type, value) DO UPDATE SET reason = excluded.reason`,
      )
      .bind(e.id, e.entryType, e.value, e.reason, e.createdBy, e.createdAt)
      .run();
  }

  async remove(id: string): Promise<number> {
    const res = await this.db.prepare('DELETE FROM blocklist WHERE id = ?1').bind(id).run();
    return res.meta.changes ?? 0;
  }

  async list(limit: number): Promise<BlocklistRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM blocklist ORDER BY created_at DESC LIMIT ?1')
      .bind(limit)
      .all<BlocklistRow>();
    return results;
  }

  async isBlocked(pairs: Array<{ type: BlocklistType; value: string }>): Promise<boolean> {
    if (pairs.length === 0) return false;
    // Build an OR of (entry_type = ? AND value = ?) with a bounded pair count.
    const clauses = pairs.map((_, i) => `(entry_type = ?${i * 2 + 1} AND value = ?${i * 2 + 2})`);
    const binds = pairs.flatMap((p) => [p.type, p.value]);
    const row = await this.db
      .prepare(`SELECT 1 AS hit FROM blocklist WHERE ${clauses.join(' OR ')} LIMIT 1`)
      .bind(...binds)
      .first<{ hit: number }>();
    return row !== null;
  }
}

class D1AuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: D1Database) {}

  async record(e: NewAuditLog): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_logs (id, actor_user_id, action, target, metadata_json, ip, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(e.id, e.actorUserId, e.action, e.target, e.metadataJson, e.ip, e.createdAt)
      .run();
  }

  async listRecent(limit: number): Promise<AuditLogRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?1')
      .bind(limit)
      .all<AuditLogRow>();
    return results;
  }
}

class D1AbuseReportRepository implements AbuseReportRepository {
  constructor(private readonly db: D1Database) {}

  async create(r: NewAbuseReport): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO abuse_reports (id, reporter_email, subject_type, subject_value, details, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6)`,
      )
      .bind(r.id, r.reporterEmail, r.subjectType, r.subjectValue, r.details, r.createdAt)
      .run();
  }

  async list(status: AbuseReportStatus | 'all', limit: number): Promise<AbuseReportRow[]> {
    const stmt =
      status === 'all'
        ? this.db
            .prepare('SELECT * FROM abuse_reports ORDER BY created_at DESC LIMIT ?1')
            .bind(limit)
        : this.db
            .prepare(
              'SELECT * FROM abuse_reports WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2',
            )
            .bind(status, limit);
    const { results } = await stmt.all<AbuseReportRow>();
    return results;
  }

  async setStatus(id: string, status: AbuseReportStatus): Promise<number> {
    const res = await this.db
      .prepare('UPDATE abuse_reports SET status = ?2 WHERE id = ?1')
      .bind(id, status)
      .run();
    return res.meta.changes ?? 0;
  }

  async countOpen(): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM abuse_reports WHERE status = 'open'")
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
}

class D1MetricsRepository implements MetricsRepository {
  constructor(private readonly db: D1Database) {}

  async snapshot(): Promise<PlatformMetrics> {
    const row = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM users) AS users,
           (SELECT COUNT(*) FROM domains WHERE status = 'active') AS active_domains,
           (SELECT COUNT(*) FROM inboxes WHERE status = 'active') AS active_inboxes,
           (SELECT COUNT(*) FROM messages) AS messages_total,
           (SELECT COUNT(*) FROM messages WHERE status = 'ready') AS messages_ready,
           (SELECT COUNT(*) FROM messages WHERE status = 'failed') AS messages_failed,
           (SELECT COUNT(*) FROM api_keys WHERE status = 'active') AS active_api_keys,
           (SELECT COUNT(*) FROM blocklist) AS blocklist_entries,
           (SELECT COUNT(*) FROM abuse_reports WHERE status = 'open') AS open_abuse_reports`,
      )
      .first<PlatformMetrics>();
    return (
      row ?? {
        users: 0,
        active_domains: 0,
        active_inboxes: 0,
        messages_total: 0,
        messages_ready: 0,
        messages_failed: 0,
        active_api_keys: 0,
        blocklist_entries: 0,
        open_abuse_reports: 0,
      }
    );
  }
}

class D1WebhookRepository implements WebhookRepository {
  constructor(private readonly db: D1Database) {}

  async create(w: NewWebhook): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO webhooks (id, user_id, url, secret_encrypted, events_json, status, failure_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', 0, ?6, ?6)`,
      )
      .bind(w.id, w.userId, w.url, w.secretEncrypted, w.eventsJson, w.createdAt)
      .run();
  }

  async findById(id: string): Promise<WebhookRow | null> {
    return this.db.prepare('SELECT * FROM webhooks WHERE id = ?1').bind(id).first<WebhookRow>();
  }

  async listByUser(userId: string): Promise<WebhookRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM webhooks WHERE user_id = ?1 ORDER BY id DESC')
      .bind(userId)
      .all<WebhookRow>();
    return results;
  }

  async listActiveByUser(userId: string): Promise<WebhookRow[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM webhooks WHERE user_id = ?1 AND status = 'active'")
      .bind(userId)
      .all<WebhookRow>();
    return results;
  }

  async update(id: string, userId: string, patch: WebhookPatch): Promise<number> {
    const sets: string[] = [];
    const binds: unknown[] = [];
    let i = 2;
    const add = (col: string, val: unknown) => {
      sets.push(`${col} = ?${++i}`);
      binds.push(val);
    };
    if (patch.url !== undefined) add('url', patch.url);
    if (patch.eventsJson !== undefined) add('events_json', patch.eventsJson);
    if (patch.status !== undefined) add('status', patch.status);
    if (sets.length === 0) return 0;
    sets.push(`updated_at = ?${++i}`);
    binds.push(Math.floor(Date.now() / 1000));
    const res = await this.db
      .prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?1 AND user_id = ?2`)
      .bind(id, userId, ...binds)
      .run();
    return res.meta.changes ?? 0;
  }

  async rotateSecret(id: string, userId: string, secretEncrypted: string): Promise<number> {
    const res = await this.db
      .prepare(
        "UPDATE webhooks SET secret_encrypted = ?3, status = 'active', failure_count = 0, updated_at = ?4 WHERE id = ?1 AND user_id = ?2",
      )
      .bind(id, userId, secretEncrypted, Math.floor(Date.now() / 1000))
      .run();
    return res.meta.changes ?? 0;
  }

  async delete(id: string, userId: string): Promise<number> {
    const res = await this.db
      .prepare('DELETE FROM webhooks WHERE id = ?1 AND user_id = ?2')
      .bind(id, userId)
      .run();
    return res.meta.changes ?? 0;
  }

  async recordFailure(id: string, threshold: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE webhooks
         SET failure_count = failure_count + 1,
             status = CASE WHEN failure_count + 1 >= ?2 THEN 'disabled' ELSE status END
         WHERE id = ?1`,
      )
      .bind(id, threshold)
      .run();
  }

  async resetFailure(id: string): Promise<void> {
    await this.db.prepare('UPDATE webhooks SET failure_count = 0 WHERE id = ?1').bind(id).run();
  }
}

class D1WebhookDeliveryRepository implements WebhookDeliveryRepository {
  constructor(private readonly db: D1Database) {}

  async create(d: NewWebhookDelivery): Promise<boolean> {
    const res = await this.db
      .prepare(
        `INSERT OR IGNORE INTO webhook_deliveries
           (id, webhook_id, event_id, event_type, dedupe_key, payload_json, attempt, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'pending', ?7)`,
      )
      .bind(d.id, d.webhookId, d.eventId, d.eventType, d.dedupeKey, d.payloadJson, d.createdAt)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async findById(id: string): Promise<WebhookDeliveryRow | null> {
    return this.db
      .prepare('SELECT * FROM webhook_deliveries WHERE id = ?1')
      .bind(id)
      .first<WebhookDeliveryRow>();
  }

  async markDelivered(id: string, responseStatus: number, deliveredAt: number): Promise<void> {
    await this.db
      .prepare(
        "UPDATE webhook_deliveries SET status = 'delivered', response_status = ?2, delivered_at = ?3, next_attempt_at = NULL WHERE id = ?1",
      )
      .bind(id, responseStatus, deliveredAt)
      .run();
  }

  async markAttempt(
    id: string,
    attempt: number,
    status: WebhookDeliveryStatus,
    responseStatus: number | null,
    nextAttemptAt: number | null,
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE webhook_deliveries SET attempt = ?2, status = ?3, response_status = ?4, next_attempt_at = ?5 WHERE id = ?1',
      )
      .bind(id, attempt, status, responseStatus, nextAttemptAt)
      .run();
  }

  async listByWebhook(webhookId: string, limit: number): Promise<WebhookDeliveryRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ?1 ORDER BY id DESC LIMIT ?2')
      .bind(webhookId, limit)
      .all<WebhookDeliveryRow>();
    return results;
  }

  async deleteOlderThan(cutoff: number): Promise<number> {
    const res = await this.db
      .prepare("DELETE FROM webhook_deliveries WHERE created_at <= ?1 AND status != 'pending'")
      .bind(cutoff)
      .run();
    return res.meta.changes ?? 0;
  }
}

export function createRepositories(db: D1Database): Repositories {
  return {
    users: new D1UserRepository(db),
    sessions: new D1SessionRepository(db),
    apiKeys: new D1ApiKeyRepository(db),
    rateLimits: new D1RateLimitRepository(db),
    webhooks: new D1WebhookRepository(db),
    webhookDeliveries: new D1WebhookDeliveryRepository(db),
    blocklist: new D1BlocklistRepository(db),
    auditLogs: new D1AuditLogRepository(db),
    abuseReports: new D1AbuseReportRepository(db),
    metrics: new D1MetricsRepository(db),
    domains: new D1DomainRepository(db),
    memberships: new D1MembershipRepository(db),
    inboxes: new D1InboxRepository(db),
    messages: new D1MessageRepository(db),
    attachments: new D1AttachmentRepository(db),
  };
}
