-- Milestone 6: webhooks (CLAUDE.md §6, §11). Secrets are stored encrypted at
-- rest. Deliveries are queued, signed, and retried with backoff; history keeps
-- only compact payloads, never raw MIME or bodies.

CREATE TABLE webhooks (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  secret_encrypted  TEXT NOT NULL,
  events_json       TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failure_count     INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_webhooks_by_user ON webhooks (user_id);
CREATE INDEX idx_webhooks_active_user ON webhooks (user_id) WHERE status = 'active';

CREATE TABLE webhook_deliveries (
  id              TEXT PRIMARY KEY,
  webhook_id      TEXT NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
  event_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  dedupe_key      TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  attempt         INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'failed', 'dead')),
  response_status INTEGER,
  next_attempt_at INTEGER,
  created_at      INTEGER NOT NULL,
  delivered_at    INTEGER
);

-- One logical delivery per (webhook, event) — makes enqueue idempotent so an
-- event is delivered once despite reprocessing (CLAUDE.md M6 exit criterion).
CREATE UNIQUE INDEX idx_webhook_deliveries_dedupe ON webhook_deliveries (webhook_id, dedupe_key);
CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries (webhook_id, id);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries (created_at);
