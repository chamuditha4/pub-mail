import type { Attachment, Inbox, CreatedInbox } from '@tmp-mail/contracts';
import type { AttachmentRow, InboxRow } from '@tmp-mail/database';
import { toRfc3339 } from '@tmp-mail/shared';

export function toAttachmentContract(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    filename: row.safe_filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    disposition: row.disposition,
    blocked: row.scan_status === 'blocked',
  };
}

function domainFromAddress(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : '';
}

export function toInboxContract(row: InboxRow): Inbox {
  return {
    id: row.id,
    address: row.address,
    domain: domainFromAddress(row.address),
    status: row.status,
    expires_at: toRfc3339(row.expires_at),
    created_at: toRfc3339(row.created_at),
    last_message_at: row.last_message_at === null ? null : toRfc3339(row.last_message_at),
  };
}

export function toCreatedInboxContract(row: InboxRow, accessToken: string): CreatedInbox {
  return { ...toInboxContract(row), access_token: accessToken };
}
