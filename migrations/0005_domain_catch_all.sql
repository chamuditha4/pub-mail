-- Optional per-domain catch-all. When enabled, incoming mail to an address with
-- no specific inbox is delivered to the domain owner's catch-all inbox (visible
-- only in that owner's unibox). Off by default. Mail to inboxes another user
-- explicitly created still routes to that user — the owner never sees it.

ALTER TABLE domains ADD COLUMN catch_all INTEGER NOT NULL DEFAULT 0;
