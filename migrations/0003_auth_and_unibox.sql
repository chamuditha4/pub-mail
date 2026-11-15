-- Accounts + unibox. Google OAuth identities, revocable sessions, and a
-- denormalized user_id on messages so an authenticated user's mail survives the
-- deletion/expiry of the individual inbox it arrived at (product requirement:
-- a unified inbox across all of a user's generated addresses).

CREATE TABLE oauth_accounts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX idx_oauth_by_user ON oauth_accounts (user_id);

-- Sessions: the cookie carries a high-entropy token; we store only its keyed
-- hash as the primary key (CLAUDE.md §12: secrets never stored in plaintext).
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY, -- keyed hash of the session token
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX idx_sessions_by_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- Denormalized owner on messages. NULL for anonymous inboxes. Set at ingest.
ALTER TABLE messages ADD COLUMN user_id TEXT;

-- Unibox listing: a user's messages newest-first, independent of inbox lifecycle.
CREATE INDEX idx_messages_user_recent ON messages (user_id, id) WHERE user_id IS NOT NULL;
