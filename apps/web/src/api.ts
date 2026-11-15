// Thin client for the temporary-mail REST API. The inbox access token is passed
// as a Bearer credential; it is stored only in this browser (localStorage).

const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://api.example.com';

export interface Domain {
  name: string;
  pool_type: 'public' | 'private';
  allow_anonymous_inboxes: boolean;
  allow_custom_local_parts: boolean;
  max_inbox_ttl_seconds: number;
}

export interface CreatedInbox {
  id: string;
  address: string;
  domain: string;
  status: string;
  expires_at: string;
  created_at: string;
  last_message_at: string | null;
  access_token: string;
}

export interface MessageSummary {
  id: string;
  sender_address: string;
  sender_name: string | null;
  subject: string;
  snippet: string;
  received_at: string;
  status: string;
  has_attachments: boolean;
  size_bytes: number;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  disposition: string;
  blocked: boolean;
}

export interface MessageDetail extends MessageSummary {
  recipient_address: string;
  text_body: string | null;
  html_body_sanitized: string | null;
  processed_at: string | null;
  attachments: Attachment[];
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // credentials:'include' sends the session cookie for authenticated (unibox)
  // requests; anonymous inbox requests rely on the Bearer token instead.
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { error?: { message?: string } }).error?.message ?? 'Request failed';
    throw new ApiError(res.status, message);
  }
  return (body as { data: T }).data;
}

export interface User {
  id: string;
  username: string;
  role: string;
}

export interface UniboxMessage extends MessageSummary {
  recipient_address: string;
  inbox_id: string;
}

export interface OwnedInbox {
  id: string;
  address: string;
  domain: string;
  status: string;
  expires_at: string;
  created_at: string;
  last_message_at: string | null;
}

export interface AdminDomain {
  id: string;
  name: string;
  zone_id: string | null;
  status: 'pending' | 'active' | 'paused' | 'misconfigured';
  pool_type: 'public' | 'private';
  allow_anonymous_inboxes: boolean;
  allow_custom_local_parts: boolean;
  max_inbox_ttl_seconds: number;
  catch_all: boolean;
  routing_configured: boolean;
  created_at: string;
}

export interface CreateDomainInput {
  name: string;
  zone_id?: string;
  pool_type?: 'public' | 'private';
  allow_anonymous_inboxes?: boolean;
  allow_custom_local_parts?: boolean;
}

export interface ApiKeyMetadata {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  status: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface CreatedApiKey extends ApiKeyMetadata {
  key: string;
}

export interface PlatformMetrics {
  users: number;
  active_domains: number;
  active_inboxes: number;
  messages_total: number;
  messages_ready: number;
  messages_failed: number;
  active_api_keys: number;
  blocklist_entries: number;
  open_abuse_reports: number;
}

export interface BlocklistEntry {
  id: string;
  entry_type: string;
  value: string;
  reason: string | null;
  created_at: string;
}

export interface WebhookMetadata {
  id: string;
  url: string;
  events: string[];
  status: string;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreatedWebhook extends WebhookMetadata {
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: string;
  status: string;
  attempt: number;
  response_status: number | null;
  created_at: string;
  delivered_at: string | null;
}

export interface AbuseReport {
  id: string;
  reporter_email: string | null;
  subject_type: string;
  subject_value: string | null;
  details: string;
  status: string;
  created_at: string;
}

async function requestFull<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { error?: { message?: string } }).error?.message ?? 'Request failed';
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const api = {
  base: API_BASE,

  me: () => request<User>('/v1/me'),
  signup: (username: string, password: string) =>
    request<User>('/v1/auth/signup', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<User>('/v1/auth/login', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>('/v1/auth/logout', undefined, { method: 'POST' }),
  uniboxMessages: (cursor?: string) =>
    request<UniboxMessage[]>(`/v1/me/messages${cursor ? `?cursor=${cursor}` : ''}`),
  myInboxes: () => request<OwnedInbox[]>('/v1/me/inboxes'),

  listDomains: () => request<Domain[]>('/v1/domains'),

  createInbox: (domain: string, localPart?: string, expiresIn?: number) =>
    request<CreatedInbox>('/v1/inboxes', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain,
        ...(localPart ? { local_part: localPart } : {}),
        ...(expiresIn ? { expires_in: expiresIn } : {}),
      }),
    }),

  listMessages: (inboxId: string, token: string) =>
    request<MessageSummary[]>(`/v1/inboxes/${inboxId}/messages`, token),

  getMessage: (messageId: string, token?: string) =>
    request<MessageDetail>(`/v1/messages/${messageId}`, token),

  deleteMessage: (messageId: string, token?: string) =>
    request<void>(`/v1/messages/${messageId}`, token, { method: 'DELETE' }),

  deleteInbox: (inboxId: string, token: string) =>
    request<void>(`/v1/inboxes/${inboxId}`, token, { method: 'DELETE' }),

  attachmentUrl: (messageId: string, attachmentId: string) =>
    `${API_BASE}/v1/messages/${messageId}/attachments/${attachmentId}`,

  inboxEventsUrl: (inboxId: string, token: string) =>
    `${API_BASE}/v1/inboxes/${inboxId}/events?access_token=${encodeURIComponent(token)}`,
  meEventsUrl: `${API_BASE}/v1/me/events`,

  manageDomains: () =>
    requestFull<{ data: AdminDomain[]; routing_automation: boolean; is_admin: boolean }>(
      '/v1/owner/domains',
    ),
  createManagedDomain: (input: CreateDomainInput) =>
    request<AdminDomain>('/v1/owner/domains', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  updateManagedDomain: (id: string, patch: Record<string, unknown>) =>
    request<AdminDomain>(`/v1/owner/domains/${id}`, undefined, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  // Irreversible: deletes the domain with every inbox and message on it. The
  // API requires the domain name echoed back as confirmation.
  deleteManagedDomain: (id: string, name: string) =>
    request<{ id: string; name: string; purged_messages: number }>(
      `/v1/owner/domains/${id}?confirm=${encodeURIComponent(name)}`,
      undefined,
      { method: 'DELETE' },
    ),
  enableDomainRouting: (id: string) =>
    request<unknown>(`/v1/owner/domains/${id}/enable-routing`, undefined, { method: 'POST' }),
  verifyDomain: (id: string) =>
    request<AdminDomain>(`/v1/owner/domains/${id}/verify`, undefined, { method: 'POST' }),

  adminMetrics: () => request<PlatformMetrics>('/v1/admin/metrics'),
  adminBlocklist: () => request<BlocklistEntry[]>('/v1/admin/blocklist'),
  adminAddBlock: (entry: { entry_type: string; value: string; reason?: string }) =>
    request<{ id: string }>('/v1/admin/blocklist', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }),
  adminRemoveBlock: (id: string) =>
    request<void>(`/v1/admin/blocklist/${id}`, undefined, { method: 'DELETE' }),
  adminAbuseReports: (status = 'open') =>
    request<AbuseReport[]>(`/v1/admin/abuse-reports?status=${status}`),
  adminSetReportStatus: (id: string, status: string) =>
    request<void>(`/v1/admin/abuse-reports/${id}`, undefined, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
  submitAbuseReport: (body: {
    subject_type: string;
    subject_value?: string;
    details: string;
    reporter_email?: string;
  }) =>
    request<{ id: string }>('/v1/abuse-reports', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  listApiKeys: () => request<ApiKeyMetadata[]>('/v1/api-keys'),
  createApiKey: (name: string, scopes: string[]) =>
    request<CreatedApiKey>('/v1/api-keys', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes }),
    }),
  revokeApiKey: (id: string) =>
    request<void>(`/v1/api-keys/${id}`, undefined, { method: 'DELETE' }),

  listWebhooks: () => request<WebhookMetadata[]>('/v1/webhooks'),
  createWebhook: (url: string, events: string[]) =>
    request<CreatedWebhook>('/v1/webhooks', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, events }),
    }),
  updateWebhook: (id: string, patch: Record<string, unknown>) =>
    request<WebhookMetadata>(`/v1/webhooks/${id}`, undefined, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deleteWebhook: (id: string) =>
    request<void>(`/v1/webhooks/${id}`, undefined, { method: 'DELETE' }),
  rotateWebhookSecret: (id: string) =>
    request<CreatedWebhook>(`/v1/webhooks/${id}/rotate-secret`, undefined, { method: 'POST' }),
  testWebhook: (id: string) =>
    request<{ delivery_id: string }>(`/v1/webhooks/${id}/test`, undefined, { method: 'POST' }),
  webhookDeliveries: (id: string) => request<WebhookDelivery[]>(`/v1/webhooks/${id}/deliveries`),
};

/** Download an attachment through an authenticated fetch, then save the blob. */
export async function downloadAttachment(
  messageId: string,
  att: Attachment,
  token?: string,
): Promise<void> {
  const res = await fetch(api.attachmentUrl(messageId, att.id), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = att.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
