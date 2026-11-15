-- Switch authentication from Google OAuth to username + password.
-- Passwords are stored as PBKDF2-SHA256 hashes with a per-user salt (and a
-- server-side pepper mixed in at hash time). Never store plaintext (CLAUDE.md §12).

DROP TABLE IF EXISTS oauth_accounts;

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;

CREATE UNIQUE INDEX idx_users_username ON users (username) WHERE username IS NOT NULL;
