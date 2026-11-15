-- Deleting a domain purges every message stored under its inboxes, which walks
-- inboxes by domain_id. Index that path (CLAUDE.md §19) so the purge does not
-- scan the whole inbox table.

CREATE INDEX IF NOT EXISTS idx_inboxes_by_domain ON inboxes (domain_id);
