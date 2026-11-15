// Row shapes as stored in D1. Booleans are 0/1 integers; timestamps are epoch
// seconds. Repositories map these to/from domain objects used by services.

export type PoolType = 'public' | 'private';
export type DomainStatus = 'pending' | 'active' | 'paused' | 'misconfigured';
export type InboxStatus = 'active' | 'expired' | 'deleted' | 'blocked';
export type MessageStatus = 'received' | 'processing' | 'ready' | 'failed' | 'deleted';
export type MembershipRole = 'owner' | 'manager' | 'member';

export interface DomainRow {
  id: string;
  name: string;
  zone_id: string | null;
  status: DomainStatus;
  pool_type: PoolType;
  allow_anonymous_inboxes: number;
  allow_custom_local_parts: number;
  max_inbox_ttl_seconds: number;
  catch_all: number;
  created_at: number;
  updated_at: number;
}

export interface InboxRow {
  id: string;
  user_id: string | null;
  domain_id: string;
  local_part: string;
  address: string;
  access_token_hash: string;
  status: InboxStatus;
  expires_at: number;
  created_at: number;
  last_message_at: number | null;
}

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface UserRow {
  id: string;
  email: string;
  username: string | null;
  password_hash: string | null;
  password_salt: string | null;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface MessageRow {
  id: string;
  inbox_id: string;
  user_id: string | null;
  provider_message_id: string | null;
  r2_raw_key: string;
  sender_address: string;
  sender_name: string | null;
  recipient_address: string;
  subject: string;
  text_body: string | null;
  html_body_sanitized: string | null;
  snippet: string;
  received_at: number;
  processed_at: number | null;
  expires_at: number;
  status: MessageStatus;
  size_bytes: number;
  has_attachments: number;
  spam_classification: string | null;
}

export interface WebhookRow {
  id: string;
  user_id: string;
  url: string;
  secret_encrypted: string;
  events_json: string;
  status: 'active' | 'disabled';
  failure_count: number;
  created_at: number;
  updated_at: number;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead';

export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event_id: string;
  event_type: string;
  dedupe_key: string;
  payload_json: string;
  attempt: number;
  status: WebhookDeliveryStatus;
  response_status: number | null;
  next_attempt_at: number | null;
  created_at: number;
  delivered_at: number | null;
}

export type BlocklistType = 'sender' | 'recipient' | 'ip' | 'domain';

export interface BlocklistRow {
  id: string;
  entry_type: BlocklistType;
  value: string;
  reason: string | null;
  created_by: string | null;
  created_at: number;
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  target: string | null;
  metadata_json: string | null;
  ip: string | null;
  created_at: number;
}

export type AbuseReportStatus = 'open' | 'reviewed' | 'closed';

export interface AbuseReportRow {
  id: string;
  reporter_email: string | null;
  subject_type: 'address' | 'domain' | 'message' | 'other';
  subject_value: string | null;
  details: string;
  status: AbuseReportStatus;
  created_at: number;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  secret_hash: string;
  scopes_json: string;
  status: 'active' | 'revoked';
  last_used_at: number | null;
  expires_at: number | null;
  created_at: number;
}

export type AttachmentDisposition = 'attachment' | 'inline';
export type ScanStatus = 'not_scanned' | 'clean' | 'blocked' | 'failed';

export interface AttachmentRow {
  id: string;
  message_id: string;
  r2_key: string;
  original_filename: string;
  safe_filename: string;
  content_type: string;
  size_bytes: number;
  content_id: string | null;
  disposition: AttachmentDisposition;
  scan_status: ScanStatus;
  created_at: number;
  expires_at: number;
}

export interface MembershipRow {
  id: string;
  domain_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: number;
  revoked_at: number | null;
}
