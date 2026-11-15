import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { HonoEnv } from './types.js';
import { contextMiddleware } from './http/context.js';
import { errorBody, handleError } from './http/errors.js';
import { healthRoutes } from './routes/health.js';
import { domainRoutes } from './routes/domains.js';
import { inboxRoutes } from './routes/inboxes.js';
import { messageRoutes } from './routes/messages.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { manageDomainRoutes } from './routes/domains-manage.js';
import { eventRoutes } from './routes/events.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { usageRoutes } from './routes/usage.js';
import { adminRoutes } from './routes/admin.js';
import { abuseRoutes } from './routes/abuse.js';
import { webhookRoutes } from './routes/webhooks.js';
import { rateLimitMiddleware } from './http/rate-limit-middleware.js';

export function createApp(): OpenAPIHono<HonoEnv> {
  // defaultHook converts Zod validation failures into our public error envelope
  // (CLAUDE.md §9) instead of leaking raw Zod output.
  const app = new OpenAPIHono<HonoEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const requestId = c.get('ctx')?.requestId ?? 'unknown';
        return c.json(errorBody('validation_error', 'The request was invalid.', requestId), 400);
      }
    },
  });

  app.use('*', secureHeaders());

  // Explicit CORS allowlist with credentials for the cookie-authenticated
  // dashboard. The set of allowed origins is APP_BASE_URL plus any configured
  // CORS_ORIGINS; the matching origin is echoed back, never a wildcard
  // (CLAUDE.md §9, §12).
  app.use('/v1/*', (c, next) => {
    const extra = (c.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const allowed = new Set([c.env.APP_BASE_URL, ...extra]);
    return cors({
      origin: (origin) => (origin && allowed.has(origin) ? origin : c.env.APP_BASE_URL),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      credentials: true,
      maxAge: 600,
    })(c, next);
  });

  app.use('/v1/*', contextMiddleware);
  app.use('/v1/*', rateLimitMiddleware);

  app.onError((err, c) => handleError(err, c));
  app.notFound((c) => {
    const requestId = c.get('ctx')?.requestId ?? c.res.headers.get('X-Request-Id') ?? 'unknown';
    return c.json(errorBody('not_found', 'Resource not found.', requestId), 404);
  });

  app.route('/', healthRoutes);
  app.route('/', domainRoutes);
  app.route('/', inboxRoutes);
  app.route('/', messageRoutes);
  app.route('/', authRoutes);
  app.route('/', meRoutes);
  app.route('/', manageDomainRoutes);
  app.route('/', eventRoutes);
  app.route('/', apiKeyRoutes);
  app.route('/', usageRoutes);
  app.route('/', adminRoutes);
  app.route('/', abuseRoutes);
  app.route('/', webhookRoutes);

  // OpenAPI 3.1 document + interactive docs (CLAUDE.md §9).
  app.doc31('/openapi.json', (c) => ({
    openapi: '3.1.0',
    info: {
      title: 'Temporary Mail API',
      version: '1.0.0',
      description: 'Receive-only temporary email platform. Public REST API under /v1.',
    },
    servers: [{ url: c.env.API_BASE_URL }],
  }));
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  return app;
}
