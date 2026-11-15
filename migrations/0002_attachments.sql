-- Milestone 3: attachment metadata. Binary content lives in R2, never in D1
-- (CLAUDE.md §6). safe_filename is a sanitized, storage-safe name; the original
-- filename is retained only for display.

CREATE TABLE attachments (
  id                TEXT PRIMARY KEY,
  message_id        TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  r2_key            TEXT NOT NULL,
  original_filename TEXT NOT NULL DEFAULT '',
  safe_filename     TEXT NOT NULL DEFAULT '',
  content_type      TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  content_id        TEXT,
  disposition       TEXT NOT NULL DEFAULT 'attachment'
                      CHECK (disposition IN ('attachment', 'inline')),
  scan_status       TEXT NOT NULL DEFAULT 'not_scanned'
                      CHECK (scan_status IN ('not_scanned', 'clean', 'blocked', 'failed')),
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL
);

CREATE INDEX idx_attachments_message ON attachments (message_id);
CREATE INDEX idx_attachments_expiry ON attachments (expires_at);
