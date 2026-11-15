import { z } from 'zod';

// Runtime environment validation (CLAUDE.md §19: validate all external input,
// including environment variables). Bindings (DB, buckets, queues) are validated
// structurally by each Worker; this schema covers the string/number config vars.

const intFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().positive());

export const appConfigSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_BASE_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  // Extra browser origins allowed by CORS besides APP_BASE_URL (comma-separated).
  // Lets the app work from the workers.dev URL or the apex in addition to the
  // canonical app domain (CLAUDE.md §9: explicit allowlist, never a wildcard).
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  DEFAULT_INBOX_TTL_SECONDS: intFromString(3600),
  MAX_INBOX_TTL_SECONDS: intFromString(86_400),
  MIN_INBOX_TTL_SECONDS: intFromString(600),
  // Signed-in users get long-lived ("persistent") addresses that keep receiving,
  // decoupled from the short anonymous TTL. Default 30 days.
  USER_INBOX_TTL_SECONDS: intFromString(30 * 24 * 3600),
  // Rate limits (CLAUDE.md §15). Configurable rather than hard-coded.
  ANON_INBOX_CREATIONS_PER_HOUR: intFromString(20),
  API_REQUESTS_PER_MINUTE: intFromString(120),
  // Key used to encrypt webhook secrets at rest (CLAUDE.md §11, §20). Optional;
  // webhook endpoints error clearly when it is absent.
  WEBHOOK_SECRET_ENCRYPTION_KEY: z.string().optional(),
  MAX_MESSAGE_BYTES: intFromString(15 * 1024 * 1024),
  // Secret used to key inbox-token, session, API-key, and password hashes
  // (CLAUDE.md §10, §12).
  TOKEN_PEPPER: z.string().min(16),

  // Comma-separated usernames granted admin (domain management). Optional.
  ADMIN_USERNAMES: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    ),

  // Cloudflare Email Routing automation (CLAUDE.md §14). All optional; when the
  // token is absent, the admin UI falls back to the manual setup guide.
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_EMAIL_API_TOKEN: z.string().optional(),
  INGEST_WORKER_NAME: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : 'tmp-mail-ingest')),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Parse and validate raw config from a Worker `env`. Throws a descriptive error
 * on failure so misconfiguration fails fast at startup rather than at request
 * time.
 */
export function loadAppConfig(raw: Record<string, unknown>): AppConfig {
  const result = appConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid application configuration: ${issues}`);
  }
  return result.data;
}
