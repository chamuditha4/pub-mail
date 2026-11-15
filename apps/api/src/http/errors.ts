import type { Context } from 'hono';
import { AppError } from '@tmp-mail/shared';
import type { HonoEnv } from '../types.js';

// Public error envelope (CLAUDE.md §9). Internal exception text is never exposed
// (CLAUDE.md §19); unexpected errors become a generic internal_error.

interface ErrorBody {
  error: { code: string; message: string; request_id: string };
}

export function errorBody(code: string, message: string, requestId: string): ErrorBody {
  return { error: { code, message, request_id: requestId } };
}

export function handleError(err: unknown, c: Context<HonoEnv>): Response {
  const requestId = c.get('ctx')?.requestId ?? c.res.headers.get('X-Request-Id') ?? 'unknown';

  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message, requestId), err.status as 400);
  }

  // Do not leak internal details. Log a structured, body-free error.
  console.error(
    JSON.stringify({
      worker: 'api',
      outcome: 'error',
      request_id: requestId,
      error: err instanceof Error ? err.name : 'unknown',
    }),
  );
  return c.json(errorBody('internal_error', 'An unexpected error occurred.', requestId), 500);
}
