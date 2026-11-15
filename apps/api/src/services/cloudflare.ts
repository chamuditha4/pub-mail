// Minimal Cloudflare Email Routing client for admin domain activation
// (CLAUDE.md §14). Used only with a narrowly-scoped API token stored as a Worker
// secret. All calls target the operator's own account/zones.

const API = 'https://api.cloudflare.com/client/v4';

export interface CloudflareConfig {
  token: string;
  ingestWorkerName: string;
}

interface CfResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

async function cf<T>(config: CloudflareConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as CfResponse<T> | null;
  if (!res.ok || !body?.success) {
    const msg = body?.errors?.[0]?.message ?? `Cloudflare API error (${res.status})`;
    throw new Error(msg);
  }
  return body.result;
}

export interface RoutingStatus {
  enabled: boolean;
  status: string;
}

export async function getRoutingStatus(
  config: CloudflareConfig,
  zoneId: string,
): Promise<RoutingStatus> {
  const r = await cf<{ enabled: boolean; status: string }>(
    config,
    `/zones/${zoneId}/email/routing`,
  );
  return { enabled: r.enabled, status: r.status };
}

export async function enableRouting(config: CloudflareConfig, zoneId: string): Promise<void> {
  await cf(config, `/zones/${zoneId}/email/routing/enable`, { method: 'POST', body: '{}' });
}

/** Add the DNS records (MX/SPF) Email Routing needs. Idempotent server-side. */
export async function addRoutingDns(config: CloudflareConfig, zoneId: string): Promise<void> {
  await cf(config, `/zones/${zoneId}/email/routing/dns`, { method: 'POST', body: '{}' });
}

/**
 * Stop routing the zone's mail to the ingest Worker. Used when a domain is
 * removed from the platform so inbound mail is no longer accepted on our behalf.
 * The zone keeps Email Routing enabled; only the catch-all action is cleared.
 */
export async function disableCatchAll(config: CloudflareConfig, zoneId: string): Promise<void> {
  await cf(config, `/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'tmp-mail catch-all (disabled)',
      enabled: false,
      matchers: [{ type: 'all' }],
      actions: [{ type: 'drop' }],
    }),
  });
}

/** Point the zone's catch-all rule at the ingest Worker. */
export async function setCatchAllToWorker(config: CloudflareConfig, zoneId: string): Promise<void> {
  await cf(config, `/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'tmp-mail catch-all',
      enabled: true,
      matchers: [{ type: 'all' }],
      actions: [{ type: 'worker', value: [config.ingestWorkerName] }],
    }),
  });
}
