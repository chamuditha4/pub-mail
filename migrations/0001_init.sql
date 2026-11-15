-- Milestone 1 schema: identity, domains + pools, inboxes, and message metadata.
-- D1 (SQLite). Timestamps are epoch seconds (INTEGER). Booleans are 0/1.
-- Raw MIME and attachment bytes live in R2, never in D1 (CLAUDE.md §6).

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT,
  avatar_url   TEXT,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE domains (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL UNIQUE,
  zone_id                  TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'active', 'paused', 'misconfigured')),
  pool_type                TEXT NOT NULL DEFAULT 'private'
                             CHECK (pool_type IN ('public', 'private')),
  allow_anonymous_inboxes  INTEGER NOT NULL DEFAULT 0,
  allow_custom_local_parts INTEGER NOT NULL DEFAULT 1,
  max_inbox_ttl_seconds    INTEGER NOT NULL DEFAULT 3600,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

-- Domain listing / lookup paths.
CREATE INDEX idx_domains_pool_status ON domains (pool_type, status);

CREATE TABLE domain_memberships (
  id          TEXT PRIMARY KEY,
  domain_id   TEXT NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'member')),
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);

-- A domain may have at most one active owner (CLAUDE.md §6 single-owner invariant).
CREATE UNIQUE INDEX idx_domain_single_active_owner
  ON domain_memberships (domain_id)
  WHERE role = 'owner' AND revoked_at IS NULL;

-- A user has at most one active membership per domain.
CREATE UNIQUE INDEX idx_domain_membership_active
  ON domain_memberships (domain_id, user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_membership_by_user ON domain_memberships (user_id) WHERE revoked_at IS NULL;

CREATE TABLE inboxes (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT REFERENCES users (id) ON DELETE SET NULL,
  domain_id          TEXT NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  local_part         TEXT NOT NULL,
  address            TEXT NOT NULL UNIQUE,
  access_token_hash  TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'expired', 'deleted', 'blocked')),
  expires_at         INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  last_message_at    INTEGER
);

CREATE INDEX idx_inboxes_by_user ON inboxes (user_id) WHERE user_id IS NOT NULL;
-- Expiry sweeps (Milestone 4) scan active inboxes by expiry time.
CREATE INDEX idx_inboxes_expiry ON inboxes (expires_at) WHERE status = 'active';

CREATE TABLE messages (
  id                   TEXT PRIMARY KEY,
  inbox_id             TEXT NOT NULL REFERENCES inboxes (id) ON DELETE CASCADE,
  provider_message_id  TEXT,
  r2_raw_key           TEXT NOT NULL,
  sender_address       TEXT NOT NULL,
  sender_name          TEXT,
  recipient_address    TEXT NOT NULL,
  subject              TEXT NOT NULL DEFAULT '',
  text_body            TEXT,
  html_body_sanitized  TEXT,
  snippet              TEXT NOT NULL DEFAULT '',
  received_at          INTEGER NOT NULL,
  processed_at         INTEGER,
  expires_at           INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'received'
                         CHECK (status IN ('received', 'processing', 'ready', 'failed', 'deleted')),
  size_bytes           INTEGER NOT NULL DEFAULT 0,
  has_attachments      INTEGER NOT NULL DEFAULT 0,
  spam_classification  TEXT
);

-- Primary message list path: newest-first within an inbox (cursor pagination on id).
CREATE INDEX idx_messages_inbox_recent ON messages (inbox_id, id);
-- Idempotent ingestion: dedupe by provider message id per inbox (CLAUDE.md §7).
CREATE UNIQUE INDEX idx_messages_provider_dedupe
  ON messages (inbox_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX idx_messages_expiry ON messages (expires_at);
