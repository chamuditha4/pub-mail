-- Milestone 7: abuse controls, audit logs, and abuse reporting (CLAUDE.md §12).

-- Blocklist for senders, recipients, IPs, and domains. Enforced at ingestion
-- (senders/recipients/domains) and at inbox creation (IPs).
CREATE TABLE blocklist (
  id         TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('sender', 'recipient', 'ip', 'domain')),
  value      TEXT NOT NULL,
  reason     TEXT,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (entry_type, value)
);

-- Security-sensitive actions. Never records message bodies, secrets, tokens, or
-- attachment contents (CLAUDE.md §6, §12).
CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  target        TEXT,
  metadata_json TEXT,
  ip            TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_audit_created ON audit_logs (created_at);
CREATE INDEX idx_audit_actor ON audit_logs (actor_user_id) WHERE actor_user_id IS NOT NULL;

-- Public abuse reports awaiting review.
CREATE TABLE abuse_reports (
  id             TEXT PRIMARY KEY,
  reporter_email TEXT,
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('address', 'domain', 'message', 'other')),
  subject_value  TEXT,
  details        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'closed')),
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_abuse_reports_status ON abuse_reports (status, created_at);
