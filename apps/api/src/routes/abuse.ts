import { Hono } from 'hono';
import { AppError, nowSeconds, ulid, validationError } from '@tmp-mail/shared';
import { createAbuseReportRequestSchema } from '@tmp-mail/contracts';
import type { HonoEnv } from '../types.js';
import { checkRateLimit, setRateLimitHeaders } from '../services/rate-limit.js';
import { audit } from '../services/audit.js';

// Public abuse-reporting path (CLAUDE.md §12), available before launch. Rate
// limited per IP to prevent spam.
export const abuseRoutes = new Hono<HonoEnv>();

abuseRoutes.post('/v1/abuse-reports', async (c) => {
  const { repos } = c.get('ctx');

  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown';
  const outcome = await checkRateLimit(repos, 'abuse_report', ip, 10, 3600, nowSeconds());
  setRateLimitHeaders(c, outcome);
  if (!outcome.allowed) {
    throw new AppError('rate_limit_exceeded', 'Too many reports. Try again later.');
  }

  const parsed = createAbuseReportRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError('Provide subject_type and details.');

  const id = ulid();
  await repos.abuseReports.create({
    id,
    reporterEmail: parsed.data.reporter_email ?? null,
    subjectType: parsed.data.subject_type,
    subjectValue: parsed.data.subject_value ?? null,
    details: parsed.data.details,
    createdAt: nowSeconds(),
  });
  await audit(c, {
    actorUserId: null,
    action: 'abuse_report.create',
    target: id,
    metadata: { subject_type: parsed.data.subject_type },
  });
  return c.json({ data: { id, status: 'received' } }, 201);
});
