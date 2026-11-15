-- Developer API keys (CLAUDE.md §6, §10) and rate-limit counters (§15).
-- The full key is shown once; only a keyed hash of the secret is stored. The
-- public key_prefix lets verification fetch exactly one row.

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL UNIQUE,
  secret_hash  TEXT NOT NULL,
  scopes_json  TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at INTEGER,
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_api_keys_by_user ON api_keys (user_id) WHERE status = 'active';

-- Fixed-window rate-limit counters. `bucket` encodes the limit name, identifier,
-- and window start. Pruned by the retention sweep.
CREATE TABLE rate_limits (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE INDEX idx_rate_limits_expiry ON rate_limits (expires_at);
